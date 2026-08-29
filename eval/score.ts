import type { Review } from "../src/review/schema.js";
import type { Case } from "./cases.js";

/**
 * Deterministic scoring. No LLM, no randomness. Given (case, review) pairs it
 * produces the scorecard the report renders. The primary number is
 * balanced accuracy on "High risk" vs "not High" against the risky/clean label.
 */

export interface Scored {
  caseId: string;
  label: "risky" | "clean";
  hard: boolean;
  predictedRisk: string;
  predictedHigh: boolean;
  correct: boolean;
  modelRiskScore: number;
  derivedRiskScore: number;
  rootCauseHit: boolean | null; // null for clean cases
  rootCauseBorderline: boolean;
  highFindings: number;
  totalFindings: number;
  costUsd: number;
  wallMs: number;
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  meanScore: number;
  observedRiskyRate: number;
}

export interface Scorecard {
  n: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
  accuracy: number;
  balancedAccuracy: number;
  precision: number;
  recall: number;
  specificity: number;
  f1: number;
  riskyCount: number;
  rootCauseHits: number;
  rootCauseHitRate: number;
  falseAlarmRate: number; // mean high-severity findings per clean PR
  meanFindings: number;
  meanCostUsd: number;
  totalCostUsd: number;
  meanWallMs: number;
  hardCorrect: number;
  hardTotal: number;
  /** mean squared error of the 0–1 risk score vs the 0/1 outcome; lower better */
  brierModel: number;
  brierDerived: number;
  calibrationModel: CalibrationBin[];
  perCase: Scored[];
  manualReview: string[];
}

function calibrationBins(
  rows: { score: number; risky: boolean }[],
  edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001],
): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const inBin = rows.filter((r) => r.score >= lo && r.score < hi);
    bins.push({
      lo,
      hi: Math.min(hi, 1),
      n: inBin.length,
      meanScore: inBin.length
        ? inBin.reduce((a, r) => a + r.score, 0) / inBin.length
        : 0,
      observedRiskyRate: inBin.length
        ? inBin.filter((r) => r.risky).length / inBin.length
        : 0,
    });
  }
  return bins;
}

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "then",
  "than", "some", "case", "path", "code", "have", "which", "while", "also",
  "are", "was", "not", "but", "new", "use", "uses", "using", "via", "because",
  "behavior", "behaviour", "change", "changes", "changed", "breaks", "break",
  "still", "does", "different", "differently", "wrong", "handling", "handle",
]);

function keywords(hint: string): string[] {
  return [
    ...new Set(
      hint
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !STOP.has(w)),
    ),
  ];
}

function baseName(p: string): string {
  return p.split("/").pop() ?? p;
}

function fileMatches(findingFile: string, rootFiles: string[]): boolean {
  const f = findingFile.replace(/^\.?\//, "").toLowerCase();
  return rootFiles.some((rf) => {
    const r = rf.replace(/^\.?\//, "").toLowerCase();
    return (
      f === r ||
      f.endsWith("/" + r) ||
      r.endsWith("/" + f) ||
      baseName(f) === baseName(r)
    );
  });
}

export function scoreOne(c: Case, review: Review): Scored {
  const predictedHigh = review.risk === "High";
  const actualRisky = c.label === "risky";
  const highFindings = review.findings.filter((f) => f.severity === "high").length;

  let rootCauseHit: boolean | null = null;
  let borderline = false;

  if (actualRisky) {
    const kw = keywords(c.rootCauseHint);
    let hit = false;
    let fileOnly = false;
    for (const f of review.findings) {
      if (!fileMatches(f.file, c.rootCauseFiles)) continue;
      const rationale = f.rationale.toLowerCase();
      if (kw.some((k) => rationale.includes(k))) {
        hit = true;
        break;
      }
      fileOnly = true;
    }
    rootCauseHit = hit;
    borderline = !hit && fileOnly;
  }

  return {
    caseId: c.id,
    label: c.label,
    hard: c.hard,
    predictedRisk: review.risk,
    predictedHigh,
    correct: predictedHigh === actualRisky,
    modelRiskScore: review.modelRiskScore,
    derivedRiskScore: review.derivedRiskScore,
    rootCauseHit,
    rootCauseBorderline: borderline,
    highFindings,
    totalFindings: review.findings.length,
    costUsd: review.meta.costUsd,
    wallMs: review.meta.wallMs,
  };
}

export function scoreAll(pairs: { c: Case; review: Review }[]): Scorecard {
  const perCase = pairs.map(({ c, review }) => scoreOne(c, review));
  const n = perCase.length;

  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const s of perCase) {
    const actualRisky = s.label === "risky";
    if (s.predictedHigh && actualRisky) tp++;
    else if (s.predictedHigh && !actualRisky) fp++;
    else if (!s.predictedHigh && !actualRisky) tn++;
    else fn++;
  }

  const recall = tp + fn ? tp / (tp + fn) : 0;
  const specificity = tn + fp ? tn / (tn + fp) : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  const risky = perCase.filter((s) => s.label === "risky");
  const clean = perCase.filter((s) => s.label === "clean");
  const hard = perCase.filter((s) => s.hard);
  const rootCauseHits = risky.filter((s) => s.rootCauseHit).length;

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const outcome = (s: Scored) => (s.label === "risky" ? 1 : 0);
  const brier = (pick: (s: Scored) => number) =>
    n ? sum(perCase.map((s) => (pick(s) - outcome(s)) ** 2)) / n : 0;
  const calRows = perCase.map((s) => ({
    score: s.modelRiskScore,
    risky: s.label === "risky",
  }));

  return {
    n,
    confusion: { tp, fp, tn, fn },
    accuracy: n ? (tp + tn) / n : 0,
    balancedAccuracy: (recall + specificity) / 2,
    precision,
    recall,
    specificity,
    f1,
    riskyCount: risky.length,
    rootCauseHits,
    rootCauseHitRate: risky.length ? rootCauseHits / risky.length : 0,
    falseAlarmRate: clean.length ? sum(clean.map((s) => s.highFindings)) / clean.length : 0,
    meanFindings: n ? sum(perCase.map((s) => s.totalFindings)) / n : 0,
    meanCostUsd: n ? sum(perCase.map((s) => s.costUsd)) / n : 0,
    totalCostUsd: sum(perCase.map((s) => s.costUsd)),
    meanWallMs: n ? sum(perCase.map((s) => s.wallMs)) / n : 0,
    hardCorrect: hard.filter((s) => s.correct).length,
    hardTotal: hard.length,
    brierModel: brier((s) => s.modelRiskScore),
    brierDerived: brier((s) => s.derivedRiskScore),
    calibrationModel: calibrationBins(calRows),
    perCase,
    manualReview: perCase
      .filter((s) => s.rootCauseBorderline)
      .map(
        (s) =>
          `${s.caseId}: a finding lands on a root-cause file but shares no keyword with the hint — confirm the match by hand`,
      ),
  };
}
