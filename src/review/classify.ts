import type { Finding, RiskLevel } from "./schema.js";

/**
 * Deterministic risk classification. The model never picks the label directly —
 * it only reports findings, and this rule turns findings into a risk level.
 * That keeps labels consistent across runs and makes the classification
 * auditable and explainable.
 *
 *   any high severity            -> High
 *   >= 2 medium severity         -> Medium
 *   exactly 1 medium             -> Medium
 *   only low / none              -> Low
 *
 * (One medium is still Medium: a single real contract/edge-case concern is worth
 * a human's slow look. Tune here if the eval shows too many false alarms.)
 */
export function classifyRisk(findings: Finding[]): RiskLevel {
  const highs = findings.filter((f) => f.severity === "high").length;
  const mediums = findings.filter((f) => f.severity === "medium").length;
  if (highs >= 1) return "High";
  if (mediums >= 1) return "Medium";
  return "Low";
}

const SEVERITY_WEIGHT = { high: 0.55, medium: 0.25, low: 0.05 } as const;

/**
 * A stable 0–1 risk estimate from the findings alone: the probability that at
 * least one finding is "real trouble", treating findings as independent.
 *   1 − ∏(1 − weight(severity))
 * One high → 0.55; two highs → 0.80; one high + one medium → 0.66; none → 0.
 * Compared against the model's self-reported score for calibration.
 */
export function derivedRiskScore(findings: Finding[]): number {
  const p = findings.reduce(
    (acc, f) => acc * (1 - SEVERITY_WEIGHT[f.severity]),
    1,
  );
  return Number((1 - p).toFixed(4));
}
