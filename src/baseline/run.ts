import { LlmClient } from "../llm/anthropic.js";
import { parseWith } from "../llm/json.js";
import { ModelReview, Review, type PrRef } from "../review/schema.js";
import { classifyRisk } from "../review/classify.js";
import { LIMITS } from "../config.js";
import type { PrMetadata } from "../github/client.js";
import type { LlmLike } from "../llm/types.js";

/**
 * The BASELINE: one LLM call, title + body + raw diff, nothing else. Same output
 * contract as the agent (ModelReview -> deterministic risk). This is the "one
 * direct prompt with basic instructions" the hackathon brief describes.
 */
const SYSTEM = `You are a senior software engineer doing PRE-MERGE RISK TRIAGE.
You are given a pull request's title, description, and unified diff — nothing else.
Decide how much careful human attention this PR needs before merging. Most PRs
are fine; "Low" with no findings is a common, correct result.

Identify concerns that affect correctness, reliability, security, performance, or
a consumer of this code — NOT formatting, naming, or style. Top revert causes:
missing caller updates when a signature or contract changes, unhandled edge cases
(null/empty/boundary) on a new path, behaviour that differs from the old path in
an edge case, breaking changes without migration, missing tests for new logic,
swallowed or misdirected errors, concurrency hazards, security, and data loss.

Severity (drives the risk label): high = would plausibly break production or a
documented contract as-is; medium = a real concern to confirm by hand; low =
worth noting, not blocking.

Respond with ONLY a JSON object (no prose, no code fence needed) of the form:
{
  "summary": "2-3 sentences on what this PR does",
  "findings": [
    {
      "severity": "high" | "medium" | "low",
      "file": "path taken from the diff",
      "line": <integer line number in the new file, or null>,
      "category": "missing-caller-update" | "unhandled-edge-case" | "breaking-change" | "test-gap" | "error-handling" | "concurrency" | "security" | "performance" | "data-loss" | "api-contract" | "other",
      "rationale": "why this is a concern, grounded in the diff",
      "suggestedCheck": "a concrete thing a human reviewer should verify"
    }
  ]
}

Only report concerns you can justify from the diff itself. If nothing is
concerning, return "findings": [].`;

function mustHaveKey(): string {
  throw new Error("runBaseline: provide either `apiKey` or an `llm` instance");
}

export interface BaselineArgs {
  meta: PrMetadata;
  diff: string;
  /** intended model id (recorded in meta even when an injected client is used) */
  model: string;
  /** required unless `llm` is injected */
  apiKey?: string;
  /** test double / alternate client */
  llm?: LlmLike;
}

export async function runBaseline(args: BaselineArgs): Promise<Review> {
  const started = Date.now();
  const llm: LlmLike =
    args.llm ??
    new LlmClient({
      apiKey: args.apiKey ?? mustHaveKey(),
      model: args.model,
    });

  const diffBudgetChars = LIMITS.maxInlineDiffLines * 200;
  const diff =
    args.diff.length > diffBudgetChars
      ? args.diff.slice(0, diffBudgetChars) + "\n… (diff truncated)"
      : args.diff;

  const user = [
    `Repo: ${args.meta.repo}   PR #${args.meta.number}`,
    `Title: ${args.meta.title}`,
    "",
    "Description:",
    args.meta.body?.slice(0, 4000) || "(none)",
    "",
    "Unified diff:",
    "```diff",
    diff,
    "```",
  ].join("\n");

  const res = await llm.call({
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    maxTokens: 3000,
  });

  const model = parseWith(ModelReview, res.text);
  const usage = llm.usage;

  const pr: PrRef = {
    repo: args.meta.repo,
    number: args.meta.number,
    title: args.meta.title,
    baseSha: args.meta.baseSha,
    headSha: args.meta.headSha,
    filesChanged: args.meta.changedFiles,
    additions: args.meta.additions,
    deletions: args.meta.deletions,
  };

  return Review.parse({
    pr,
    summary: model.summary,
    findings: model.findings,
    risk: classifyRisk(model.findings),
    meta: {
      mode: "baseline",
      model: args.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      wallMs: Date.now() - started,
      toolCalls: 0,
    },
  });
}
