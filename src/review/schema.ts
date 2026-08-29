import { z } from "zod";

export const Severity = z.enum(["high", "medium", "low"]);
export type Severity = z.infer<typeof Severity>;

/**
 * Closed vocabulary of finding types. Keeps the baseline and agent outputs
 * comparable and lets the eval do category-level analysis.
 */
export const FindingCategory = z.enum([
  "missing-caller-update", // signature/contract changed, callers not updated
  "unhandled-edge-case", // null/empty/boundary path not handled
  "breaking-change", // public API / behavior change without migration
  "test-gap", // new logic with no covering test
  "error-handling", // swallowed / missing / wrong error handling
  "concurrency", // race, ordering, shared-state hazard
  "security", // injection, authz, secret exposure, unsafe deserialization
  "performance", // O(n^2), N+1, sync work on hot path
  "data-loss", // destructive migration / overwrite without guard
  "api-contract", // response shape / status / nullability change
  "other",
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

/**
 * Tolerant on the fields models fumble: an invented category becomes "other",
 * a non-integer / negative line becomes null, an odd severity becomes "medium".
 * The substance (file, rationale, check) still has to be there.
 */
export const Finding = z.object({
  severity: Severity.catch("medium"),
  file: z.string().min(1),
  line: z.number().int().nonnegative().nullable().catch(null),
  category: FindingCategory.catch("other"),
  rationale: z.string().min(1),
  suggestedCheck: z.string().min(1),
});
export type Finding = z.infer<typeof Finding>;

export const RiskLevel = z.enum(["High", "Medium", "Low"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const PrRef = z.object({
  repo: z.string(), // "owner/name"
  number: z.number().int().positive(),
  title: z.string(),
  baseSha: z.string(),
  headSha: z.string(),
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type PrRef = z.infer<typeof PrRef>;

export const ReviewMeta = z.object({
  mode: z.string(), // "baseline" | "baseline-plus" | "agent" | experiment labels
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  wallMs: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
});
export type ReviewMeta = z.infer<typeof ReviewMeta>;

export const Review = z.object({
  pr: PrRef,
  summary: z.string().min(1),
  findings: z.array(Finding),
  /** deterministic label from `findings` (src/review/classify.ts) — primary */
  risk: RiskLevel,
  /** the model's own P(this PR needs a revert/hotfix), 0–1 — secondary */
  modelRiskScore: z.number().min(0).max(1),
  /** fixed formula over `findings`, 0–1 — secondary, more stable */
  derivedRiskScore: z.number().min(0).max(1),
  meta: ReviewMeta,
});
export type Review = z.infer<typeof Review>;

/**
 * What the LLM is asked to produce. The High/Med/Low *label* is still computed
 * from findings (not voted on), but the model does give a probability, which we
 * score for calibration against what actually got reverted.
 */
export const ModelReview = z.object({
  summary: z.string().min(1),
  findings: z.array(Finding),
  riskScore: z.number().min(0).max(1).catch(0.5),
});
export type ModelReview = z.infer<typeof ModelReview>;
