import type Anthropic from "@anthropic-ai/sdk";
import { LlmClient } from "../llm/anthropic.js";
import { parseWith } from "../llm/json.js";
import { ModelReview, Review, type PrRef, type Finding } from "../review/schema.js";
import { classifyRisk } from "../review/classify.js";
import { LIMITS } from "../config.js";
import { nullLogger, type Logger } from "../logging.js";
import type { LlmLike, Message } from "../llm/types.js";
import type { PrMetadata, ChangedFile } from "../github/client.js";
import type { RepoContext } from "../repo/tools.js";
import { buildToolkit, ALL_TOOLS, type ToolName } from "./toolDefs.js";
import {
  INVESTIGATOR_SYSTEM,
  VERIFIER_SYSTEM,
  investigatorOpening,
} from "./prompts.js";

export interface AgentDeps {
  llm: LlmLike;
  /** optional distinct client for the verify pass (defaults to `llm`) */
  verifier?: LlmLike;
  repo: RepoContext | null;
  headSha: string | undefined;
  getDiff: (path?: string) => Promise<string>;
  changedFiles: ChangedFile[];
  logger?: Logger;
  /** knobs for the changelog experiments */
  tools?: ToolName[];
  maxSteps?: number;
  verify?: boolean;
}

function assistantContent(text: string, toolUses: { id: string; name: string; input: unknown }[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (text.trim()) blocks.push({ type: "text", text });
  for (const tu of toolUses) {
    blocks.push({
      type: "tool_use",
      id: tu.id,
      name: tu.name,
      input: (tu.input ?? {}) as Record<string, unknown>,
    });
  }
  return blocks;
}

const MAX_TOOL_RESULT_CHARS = 14_000;

function clip(s: string): string {
  return s.length > MAX_TOOL_RESULT_CHARS
    ? s.slice(0, MAX_TOOL_RESULT_CHARS) + "\n… (truncated)"
    : s;
}

export async function runAgent(
  meta: PrMetadata,
  deps: AgentDeps,
): Promise<Review> {
  const started = Date.now();
  const log = deps.logger ?? nullLogger;
  const maxSteps = deps.maxSteps ?? LIMITS.agentMaxSteps;
  const toolNames = deps.tools ?? ALL_TOOLS;

  const toolkit = buildToolkit(
    {
      repo: deps.repo,
      baseSha: meta.baseSha,
      headSha: deps.headSha,
      getDiff: deps.getDiff,
      changedFiles: deps.changedFiles,
    },
    toolNames,
  );

  const messages: Message[] = [
    {
      role: "user",
      content: investigatorOpening({
        repo: meta.repo,
        number: meta.number,
        title: meta.title,
        body: meta.body,
        changedFiles: deps.changedFiles,
        maxSteps,
      }),
    },
  ];

  log.step({ kind: "phase", label: "investigate-start", meta: { maxSteps, tools: toolNames } });

  let toolCalls = 0;
  let draft: { summary: string; findings: Finding[] } | null = null;

  for (let step = 0; step < maxSteps + 1; step++) {
    const res = await deps.llm.call({
      system: INVESTIGATOR_SYSTEM,
      messages,
      tools: toolkit.specs,
      maxTokens: 3500,
    });
    log.step({
      kind: "llm",
      label: `investigate-${step}`,
      output: { text: res.text, toolUses: res.toolUses, stopReason: res.stopReason },
      meta: { inputTokens: res.inputTokens, outputTokens: res.outputTokens },
    });

    if (res.toolUses.length === 0) {
      try {
        draft = parseWith(ModelReview, res.text);
        break;
      } catch (e) {
        if (step >= maxSteps) throw e;
        messages.push({ role: "assistant", content: assistantContent(res.text, []) });
        messages.push({
          role: "user",
          content:
            "That was not valid JSON in the required shape. Output ONLY the JSON object now.",
        });
        continue;
      }
    }

    if (step >= maxSteps) {
      // out of steps — force a final answer without tools
      messages.push({ role: "assistant", content: assistantContent(res.text, res.toolUses) });
      messages.push({
        role: "user",
        content: res.toolUses.map((tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: "step budget exhausted — do not call more tools",
        })),
      });
      const final = await deps.llm.call({
        system: INVESTIGATOR_SYSTEM,
        messages: [
          ...messages,
          { role: "user", content: "Output ONLY the final JSON object now." },
        ],
        maxTokens: 3500,
      });
      draft = parseWith(ModelReview, final.text);
      log.step({ kind: "llm", label: "investigate-forced-final", output: { text: final.text } });
      break;
    }

    messages.push({ role: "assistant", content: assistantContent(res.text, res.toolUses) });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of res.toolUses) {
      toolCalls++;
      let out: unknown;
      try {
        out = await toolkit.dispatch(tu.name, tu.input);
      } catch (e) {
        out = { error: e instanceof Error ? e.message : String(e) };
      }
      log.step({ kind: "tool", label: tu.name, input: tu.input, output: out });
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: clip(typeof out === "string" ? out : JSON.stringify(out)),
      });
    }
    messages.push({ role: "user", content: results });
  }

  if (!draft) throw new Error("agent produced no draft review");

  // ---- verify pass -----------------------------------------------------------
  let verified = draft;
  if (deps.verify) {
    const verifier = deps.verifier ?? deps.llm;
    const wholeDiff = await deps.getDiff();
    const vres = await verifier.call({
      system: VERIFIER_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            "PR diff:",
            "```diff",
            wholeDiff.slice(0, LIMITS.maxInlineDiffLines * 220),
            "```",
            "",
            "Draft findings to verify:",
            JSON.stringify(draft, null, 2),
          ].join("\n"),
        },
      ],
      maxTokens: 3000,
    });
    log.step({ kind: "phase", label: "verify", output: { text: vres.text } });
    try {
      verified = parseWith(ModelReview, vres.text);
    } catch {
      // if the verifier botches the format, keep the draft rather than fail
      verified = draft;
      log.step({ kind: "error", label: "verify-parse-failed", output: { text: vres.text } });
    }
  }

  const risk = classifyRisk(verified.findings);
  const usage = deps.llm.usage;
  const verifierUsage = deps.verifier?.usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  const pr: PrRef = {
    repo: meta.repo,
    number: meta.number,
    title: meta.title,
    baseSha: meta.baseSha,
    headSha: meta.headSha,
    filesChanged: meta.changedFiles,
    additions: meta.additions,
    deletions: meta.deletions,
  };

  const review = Review.parse({
    pr,
    summary: verified.summary,
    findings: verified.findings,
    risk,
    meta: {
      mode: "agent",
      model: deps.llm.model,
      inputTokens: usage.inputTokens + verifierUsage.inputTokens,
      outputTokens: usage.outputTokens + verifierUsage.outputTokens,
      costUsd: usage.costUsd + verifierUsage.costUsd,
      wallMs: Date.now() - started,
      toolCalls,
    },
  });

  log.step({ kind: "phase", label: "done", output: { risk, findings: verified.findings.length } });
  log.artifact("review.json", JSON.stringify(review, null, 2));
  return review;
}
