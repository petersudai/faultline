import type Anthropic from "@anthropic-ai/sdk";
import { LlmClient } from "../llm/anthropic.js";
import { parseWith } from "../llm/json.js";
import { ModelReview, Review, type PrRef, type Finding } from "../review/schema.js";
import { classifyRisk, derivedRiskScore } from "../review/classify.js";
import { LIMITS } from "../config.js";
import { nullLogger, type Logger } from "../logging.js";
import type { LlmLike, Message } from "../llm/types.js";
import type { PrMetadata, ChangedFile } from "../github/client.js";
import type { RepoContext } from "../repo/tools.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildToolkit, ALL_TOOLS, SUBMIT_TOOL, type ToolName } from "./toolDefs.js";
import { z } from "zod";
import {
  INVESTIGATOR_SYSTEM,
  VERIFIER_SYSTEM,
  SECOND_PASS_SYSTEM,
  investigatorOpening,
} from "./prompts.js";
import { Finding as FindingSchema } from "../review/schema.js";

export interface AgentDeps {
  llm: LlmLike;
  /** optional distinct client for the verify pass (defaults to `llm`) */
  verifier?: LlmLike;
  repo: RepoContext | null;
  headSha: string | undefined;
  getDiff: (path?: string) => Promise<string>;
  changedFiles: ChangedFile[];
  logger?: Logger;
  /** recorded in Review.meta.mode (e.g. "agent", "agent-noverify") */
  mode?: string;
  /** knobs for the changelog experiments */
  tools?: ToolName[];
  maxSteps?: number;
  verify?: boolean;
  /** experiment R: bolt on a security-specialist second pass (expected: removed) */
  secondPass?: boolean;
}

const SecondPassOut = z.object({ findings: z.array(FindingSchema) });

function findingKey(f: Finding): string {
  return `${f.file}:${f.line ?? "-"}:${f.category}`;
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

const MAX_TOOL_RESULT_CHARS = 22_000;

function clip(s: string): string {
  return s.length > MAX_TOOL_RESULT_CHARS
    ? s.slice(0, MAX_TOOL_RESULT_CHARS) + "\n… (truncated)"
    : s;
}

/**
 * Drop findings that point at a file which is neither in the PR nor present in
 * the repo — i.e. the model invented the path. Findings on real-but-unchanged
 * files are kept (a caller that needs updating is a legitimate concern).
 */
function pruneHallucinatedFiles(
  findings: Finding[],
  changedFiles: ChangedFile[],
  repo: RepoContext | null,
): { kept: Finding[]; dropped: Finding[] } {
  const changed = new Set<string>();
  for (const f of changedFiles) {
    changed.add(f.path);
    if (f.previousPath) changed.add(f.previousPath);
  }
  const kept: Finding[] = [];
  const dropped: Finding[] = [];
  for (const f of findings) {
    const path = f.file.replace(/^\.?\//, "");
    const real =
      changed.has(f.file) ||
      changed.has(path) ||
      (repo != null && existsSync(join(repo.dir, path)));
    if (real || repo == null) kept.push(f);
    else dropped.push(f);
  }
  return { kept, dropped };
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

  const specs = [...toolkit.specs, SUBMIT_TOOL];
  let toolCalls = 0;
  let draft: { summary: string; findings: Finding[]; riskScore: number } | null =
    null;

  for (let step = 0; step <= maxSteps + 1 && !draft; step++) {
    const forced = step > maxSteps;
    const res = await deps.llm.call({
      system: INVESTIGATOR_SYSTEM,
      messages: forced
        ? [
            ...messages,
            {
              role: "user",
              content:
                "Step budget reached. Call submit_review now with your assessment based on what you have.",
            },
          ]
        : messages,
      tools: specs,
      maxTokens: 3500,
    });
    log.step({
      kind: "llm",
      label: `investigate-${step}${forced ? "-forced" : ""}`,
      output: { text: res.text, toolUses: res.toolUses, stopReason: res.stopReason },
      meta: { inputTokens: res.inputTokens, outputTokens: res.outputTokens },
    });

    const submit = res.toolUses.find((t) => t.name === "submit_review");
    if (submit) {
      try {
        draft = parseWith(ModelReview, JSON.stringify(submit.input));
        break;
      } catch (e) {
        if (forced) {
          // last resort: try to salvage from any text, else give up cleanly
          draft = parseWith(ModelReview, res.text);
          break;
        }
        messages.push({ role: "assistant", content: assistantContent(res.text, res.toolUses) });
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: submit.id,
              content: `submit_review input was invalid: ${e instanceof Error ? e.message : e}. Call it again with valid fields.`,
              is_error: true,
            },
          ],
        });
        continue;
      }
    }

    if (res.toolUses.length === 0) {
      // stopped without submitting — try to read a review from the text, else nudge
      try {
        draft = parseWith(ModelReview, res.text);
        break;
      } catch {
        messages.push({ role: "assistant", content: assistantContent(res.text, []) });
        messages.push({
          role: "user",
          content: "Call submit_review with your assessment to finish.",
        });
        continue;
      }
    }

    // ordinary investigative tool calls
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

  if (!draft) throw new Error("agent never submitted a review");

  // ---- experiment R: security-specialist second pass ------------------------
  if (deps.secondPass) {
    const wholeDiff = await deps.getDiff();
    const sres = await deps.llm.call({
      system: SECOND_PASS_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            "PR diff:",
            "```diff",
            wholeDiff.slice(0, LIMITS.maxInlineDiffLines * 220),
            "```",
            "",
            "Generalist findings:",
            JSON.stringify(draft.findings, null, 2),
          ].join("\n"),
        },
      ],
      maxTokens: 2000,
    });
    log.step({ kind: "phase", label: "second-pass", output: { text: sres.text } });
    try {
      const extra = parseWith(SecondPassOut, sres.text).findings;
      const seen = new Set(draft.findings.map(findingKey));
      const merged = [...draft.findings];
      for (const f of extra) if (!seen.has(findingKey(f))) merged.push(f);
      draft = { ...draft, findings: merged };
    } catch {
      log.step({ kind: "error", label: "second-pass-parse-failed" });
    }
  }

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

  const { kept, dropped } = pruneHallucinatedFiles(
    verified.findings,
    deps.changedFiles,
    deps.repo,
  );
  if (dropped.length) {
    log.step({
      kind: "phase",
      label: "pruned-hallucinated-files",
      output: dropped.map((f) => ({ file: f.file, rationale: f.rationale })),
    });
  }
  verified = { ...verified, findings: kept };

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
    modelRiskScore: verified.riskScore,
    derivedRiskScore: derivedRiskScore(verified.findings),
    meta: {
      mode: deps.mode ?? "agent",
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
  log.finalize();
  return review;
}
