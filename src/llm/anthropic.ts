import Anthropic from "@anthropic-ai/sdk";
import { LIMITS, costUsdDetailed } from "../config.js";
import type { Message, LlmResult, ToolSpec } from "./types.js";

export class TokenBudgetExceeded extends Error {
  constructor(budget: number) {
    super(`Token budget of ${budget.toLocaleString()} tokens exceeded`);
    this.name = "TokenBudgetExceeded";
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 529]);
const EPHEMERAL = { type: "ephemeral" as const };

export interface LlmClientOpts {
  apiKey: string;
  model: string;
  budgetTokens?: number;
  /** disable prompt caching (default: on) */
  noCache?: boolean;
  onUsage?: (u: { inputTokens: number; outputTokens: number }) => void;
}

/**
 * Thin wrapper over the Anthropic SDK:
 *  - temperature 0, always
 *  - prompt caching on the system prompt, the tools, and a moving breakpoint on
 *    the last message, so an agent loop re-reads its transcript from cache
 *  - cache-aware running cost + a hard token budget
 *  - explicit exponential backoff (SDK retries disabled so we own the policy)
 */
export class LlmClient {
  private readonly client: Anthropic;
  readonly model: string;
  private readonly budget: number;
  private readonly noCache: boolean;
  private readonly onUsage?: (u: {
    inputTokens: number;
    outputTokens: number;
  }) => void;

  private inTok = 0;
  private outTok = 0;
  private cacheReadTok = 0;
  private cacheWriteTok = 0;

  constructor(opts: LlmClientOpts) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      timeout: LIMITS.llmTimeoutMs,
      maxRetries: 0,
    });
    this.model = opts.model;
    this.budget = opts.budgetTokens ?? LIMITS.runTokenBudget;
    this.noCache = opts.noCache ?? false;
    this.onUsage = opts.onUsage;
  }

  get usage(): {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
  } {
    return {
      inputTokens: this.inTok,
      outputTokens: this.outTok,
      cacheReadTokens: this.cacheReadTok,
      cacheWriteTokens: this.cacheWriteTok,
      costUsd: costUsdDetailed(this.model, {
        input: this.inTok,
        cacheRead: this.cacheReadTok,
        cacheWrite: this.cacheWriteTok,
        output: this.outTok,
      }),
    };
  }

  /** put a cache breakpoint on the final block of the final message */
  private withMovingBreakpoint(messages: Message[]): Message[] {
    if (this.noCache || messages.length === 0) return messages;
    const copy = messages.slice();
    const last = copy[copy.length - 1]!;
    const content =
      typeof last.content === "string"
        ? [{ type: "text" as const, text: last.content }]
        : last.content.slice();
    const tail = content[content.length - 1];
    if (tail && typeof tail === "object") {
      content[content.length - 1] = { ...tail, cache_control: EPHEMERAL } as never;
    }
    copy[copy.length - 1] = { ...last, content: content as never };
    return copy;
  }

  async call(params: {
    system: string;
    messages: Message[];
    tools?: ToolSpec[];
    maxTokens?: number;
  }): Promise<LlmResult> {
    if (this.inTok + this.cacheReadTok + this.cacheWriteTok + this.outTok > this.budget) {
      throw new TokenBudgetExceeded(this.budget);
    }

    const system = this.noCache
      ? params.system
      : [{ type: "text" as const, text: params.system, cache_control: EPHEMERAL }];

    let tools: Anthropic.Tool[] | undefined;
    if (params.tools?.length) {
      tools = params.tools.map((t) => ({ ...t })) as Anthropic.Tool[];
      if (!this.noCache) {
        tools[tools.length - 1] = {
          ...tools[tools.length - 1]!,
          cache_control: EPHEMERAL,
        };
      }
    }

    const res = await this.withRetry(() =>
      this.client.messages.create({
        model: this.model,
        max_tokens: params.maxTokens ?? 2048,
        temperature: 0,
        system: system as never,
        messages: this.withMovingBreakpoint(params.messages),
        ...(tools ? { tools } : {}),
      }),
    );

    const u = res.usage;
    this.inTok += u.input_tokens;
    this.outTok += u.output_tokens;
    this.cacheReadTok += u.cache_read_input_tokens ?? 0;
    this.cacheWriteTok += u.cache_creation_input_tokens ?? 0;
    this.onUsage?.({
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const toolUses = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input as unknown }));

    return {
      text,
      toolUses,
      stopReason: res.stop_reason,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
    };
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= LIMITS.llmMaxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof Anthropic.APIConnectionError ||
          (err instanceof Anthropic.APIError &&
            typeof err.status === "number" &&
            RETRYABLE_STATUS.has(err.status));
        if (!retryable || attempt === LIMITS.llmMaxRetries) break;
        const backoff =
          Math.min(30_000, 1_000 * 2 ** attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }
}
