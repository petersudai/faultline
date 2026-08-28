import Anthropic from "@anthropic-ai/sdk";
import { LIMITS, costUsd } from "../config.js";
import type { Message, LlmResult, ToolSpec } from "./types.js";

export class TokenBudgetExceeded extends Error {
  constructor(budget: number) {
    super(`Token budget of ${budget.toLocaleString()} tokens exceeded`);
    this.name = "TokenBudgetExceeded";
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 529]);

export interface LlmClientOpts {
  apiKey: string;
  model: string;
  budgetTokens?: number;
  onUsage?: (u: { inputTokens: number; outputTokens: number }) => void;
}

/**
 * Thin wrapper over the Anthropic SDK:
 *  - temperature 0, always
 *  - running token + cost accounting
 *  - a hard token budget that aborts a runaway loop
 *  - explicit exponential backoff (SDK retries disabled so we own the policy)
 */
export class LlmClient {
  private readonly client: Anthropic;
  readonly model: string;
  private readonly budget: number;
  private readonly onUsage?: (u: {
    inputTokens: number;
    outputTokens: number;
  }) => void;
  private inTok = 0;
  private outTok = 0;

  constructor(opts: LlmClientOpts) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      timeout: LIMITS.llmTimeoutMs,
      maxRetries: 0,
    });
    this.model = opts.model;
    this.budget = opts.budgetTokens ?? LIMITS.runTokenBudget;
    this.onUsage = opts.onUsage;
  }

  get usage(): { inputTokens: number; outputTokens: number; costUsd: number } {
    return {
      inputTokens: this.inTok,
      outputTokens: this.outTok,
      costUsd: costUsd(this.model, this.inTok, this.outTok),
    };
  }

  async call(params: {
    system: string;
    messages: Message[];
    tools?: ToolSpec[];
    maxTokens?: number;
  }): Promise<LlmResult> {
    if (this.inTok + this.outTok > this.budget) {
      throw new TokenBudgetExceeded(this.budget);
    }

    const res = await this.withRetry(() =>
      this.client.messages.create({
        model: this.model,
        max_tokens: params.maxTokens ?? 2048,
        temperature: 0,
        system: params.system,
        messages: params.messages,
        ...(params.tools && params.tools.length
          ? { tools: params.tools as Anthropic.Tool[] }
          : {}),
      }),
    );

    this.inTok += res.usage.input_tokens;
    this.outTok += res.usage.output_tokens;
    this.onUsage?.({
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
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
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
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
