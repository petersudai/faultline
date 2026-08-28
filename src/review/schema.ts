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

export const Finding = z.object({
  severity: Severity,
  file: z.string().min(1),
  /** null = file-level finding with no single line */
  line: z.number().int().nonnegative().nullable(),
  category: FindingCategory,
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
  mode: z.enum(["baseline", "agent"]),
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
  risk: RiskLevel,
  meta: ReviewMeta,
});
export type Review = z.infer<typeof Review>;

/**
 * What the LLM is asked to produce (summary + findings only). Risk is computed
 * deterministically from findings; meta is filled in by the runner. Keeping this
 * separate stops the model from "voting" on its own risk label.
 */
export const ModelReview = z.object({
  summary: z.string().min(1),
  findings: z.array(Finding),
});
export type ModelReview = z.infer<typeof ModelReview>;
