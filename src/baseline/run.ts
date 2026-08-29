import { LlmClient } from "../llm/anthropic.js";
import { parseWith } from "../llm/json.js";
import { ModelReview, Review, type PrRef } from "../review/schema.js";
import { classifyRisk, derivedRiskScore } from "../review/classify.js";
import { LIMITS } from "../config.js";
import type { PrMetadata } from "../github/client.js";
import type { LlmLike } from "../llm/types.js";

/**
 * The BASELINE. Two variants share this one code path:
 *   "baseline"      — title + body + raw diff, nothing else
 *   "baseline-plus" — the above plus the full text of every changed file (head)
 * Both are a single model call: no tools, no loop, no verify. Same output
 * contract as the agent, so the only variable is the agentic machinery.
 */
const SYSTEM = `You are a senior software engineer doing PRE-MERGE RISK TRIAGE.
Decide how much careful human attention a pull request needs before merging.
Most PRs are fine; "Low" with no findings is a common, correct result.

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
  "summary": "2-3 sentences on what this PR changes and the biggest risk",
  "riskScore": <number 0..1 — your probability that this PR will need a revert or hotfix within two weeks of merging>,
  "findings": [
    {
      "severity": "high" | "medium" | "low",
      "file": "path taken from the diff",
      "line": <integer line number in the new file, or null if unsure>,
      "category": "missing-caller-update" | "unhandled-edge-case" | "breaking-change" | "test-gap" | "error-handling" | "concurrency" | "security" | "performance" | "data-loss" | "api-contract" | "other",
      "rationale": "why this is a concern, grounded in the diff",
      "suggestedCheck": "a concrete thing a human reviewer should verify"
    }
  ]
}

Only report concerns you can justify from the evidence given. If nothing is
concerning, return "findings": [] and a low riskScore.`;

function mustHaveKey(): string {
  throw new Error("runBaseline: provide either `apiKey` or an `llm` instance");
}

export interface ContextFile {
  path: string;
  content: string;
}

export interface BaselineArgs {
  meta: PrMetadata;
  diff: string;
  /** intended model id (recorded in meta even when an injected client is used) */
  model: string;
  /** "baseline" (default) or "baseline-plus" */
  mode?: string;
  /** full changed-file text; when present the mode is recorded as given */
  contextFiles?: ContextFile[];
  apiKey?: string;
  llm?: LlmLike;
}

const PER_FILE_CHARS = 24_000;

export async function runBaseline(args: BaselineArgs): Promise<Review> {
  const started = Date.now();
  const mode = args.mode ?? "baseline";
  const llm: LlmLike =
    args.llm ??
    new LlmClient({ apiKey: args.apiKey ?? mustHaveKey(), model: args.model });

  const diffBudget = LIMITS.maxInlineDiffLines * 220;
  const diff =
    args.diff.length > diffBudget
      ? args.diff.slice(0, diffBudget) + "\n… (diff truncated)"
      : args.diff;

  const parts = [
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
  ];

  if (args.contextFiles?.length) {
    parts.push("", "Full content of the changed files (post-PR / head):");
    for (const f of args.contextFiles) {
      parts.push(
        "",
        `--- ${f.path} ---`,
        "```",
        f.content.length > PER_FILE_CHARS
          ? f.content.slice(0, PER_FILE_CHARS) + "\n… (file truncated)"
          : f.content,
        "```",
      );
    }
  }

  const res = await llm.call({
    system: SYSTEM,
    messages: [{ role: "user", content: parts.join("\n") }],
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
    modelRiskScore: model.riskScore,
    derivedRiskScore: derivedRiskScore(model.findings),
    meta: {
      mode,
      model: args.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      wallMs: Date.now() - started,
      toolCalls: 0,
    },
  });
}
