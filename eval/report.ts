import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Scorecard, Scored, CalibrationBin } from "./score.js";

export interface RunResult {
  mode: string;
  model: string;
  fake: boolean;
  timestamp: string;
  caseIds: string[];
  scorecard: Scorecard;
}

const RESULTS_DIR = join(process.cwd(), "results");
/** display order; anything else is appended alphabetically */
const MODE_ORDER = ["baseline", "baseline-plus", "agent"];

export function writeRunResult(r: RunResult): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${r.mode}.json`), JSON.stringify(r, null, 2));
}

export function readAllResults(): RunResult[] {
  if (!existsSync(RESULTS_DIR)) return [];
  const runs = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(RESULTS_DIR, f), "utf8")) as RunResult)
    .filter((r) => r?.scorecard?.triage); // skip results from an older schema
  return runs.sort((a, b) => {
    const ia = MODE_ORDER.indexOf(a.mode);
    const ib = MODE_ORDER.indexOf(b.mode);
    if (ia !== -1 || ib !== -1)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.mode.localeCompare(b.mode);
  });
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `$${x.toFixed(4)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const num = (x: number) => x.toFixed(3);

function row(label: string, runs: RunResult[], get: (s: Scorecard) => string): string {
  return `| ${label} | ${runs.map((r) => get(r.scorecard)).join(" | ")} |`;
}

function metricTable(runs: RunResult[]): string {
  const head = `| metric | ${runs.map((r) => r.mode).join(" | ")} |`;
  const sep = `|--------|${runs.map(() => "------").join("|")}|`;
  const lines = [head, sep];
  lines.push(row("**Bal. accuracy — strict** (High = block)", runs, (s) => pct(s.balancedAccuracy)));
  lines.push(row("· recall (risky → High)", runs, (s) => pct(s.recall)));
  lines.push(row("· specificity (clean → not-High)", runs, (s) => pct(s.specificity)));
  lines.push(row("**Bal. accuracy — triage** (High/Med = look closer)", runs, (s) => pct(s.triage.balancedAccuracy)));
  lines.push(row("· recall (risky → flagged)", runs, (s) => pct(s.triage.recall)));
  lines.push(row("· specificity (clean → Low)", runs, (s) => pct(s.triage.specificity)));
  lines.push(row("Root-cause hit rate", runs, (s) => `${s.rootCauseHits}/${s.riskyCount} (${pct(s.rootCauseHitRate)})`));
  lines.push(row("False-alarm rate (high/clean PR)", runs, (s) => s.falseAlarmRate.toFixed(2)));
  lines.push(row("Hard cases correct", runs, (s) => `${s.hardCorrect}/${s.hardTotal}`));
  lines.push(row("Brier — model score", runs, (s) => num(s.brierModel)));
  lines.push(row("Brier — derived score", runs, (s) => num(s.brierDerived)));
  lines.push(row("Mean cost / PR", runs, (s) => usd(s.meanCostUsd)));
  lines.push(row("Mean time / PR", runs, (s) => secs(s.meanWallMs)));
  return lines.join("\n");
}

function confusion(s: Scorecard): string {
  const { tp, fp, tn, fn } = s.confusion;
  return [
    "|            | pred High | pred not-High |",
    "|------------|-----------|---------------|",
    `| **risky**  | ${tp} (TP)  | ${fn} (FN) |`,
    `| **clean**  | ${fp} (FP)  | ${tn} (TN) |`,
  ].join("\n");
}

function calibrationTable(bins: CalibrationBin[]): string {
  const lines = [
    "| score range | n | mean score | observed revert rate |",
    "|-------------|---|-----------|----------------------|",
  ];
  for (const b of bins) {
    if (b.n === 0) continue;
    lines.push(
      `| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.n} | ${b.meanScore.toFixed(2)} | ${b.observedRiskyRate.toFixed(2)} |`,
    );
  }
  return lines.join("\n");
}

function perCaseTable(runs: RunResult[]): string {
  const ids = runs[0]!.scorecard.perCase.map((c) => c.caseId);
  const byId = (r: RunResult, id: string): Scored | undefined =>
    r.scorecard.perCase.find((c) => c.caseId === id);
  const head = `| case | label | hard | ${runs.map((r) => r.mode).join(" | ")} | root cause |`;
  const sep = `|------|-------|------|${runs.map(() => "----").join("|")}|------------|`;
  const lines = [head, sep];
  for (const id of ids) {
    const anchor = runs.map((r) => byId(r, id)).find(Boolean)!;
    const cells = runs.map((r) => {
      const c = byId(r, id);
      return c ? `${c.predictedRisk}${c.correct ? " ✓" : " ✗"}` : "—";
    });
    const rc =
      anchor.label === "risky"
        ? runs
            .map((r) => byId(r, id))
            .some((c) => c?.rootCauseHit)
          ? "hit"
          : runs.map((r) => byId(r, id)).some((c) => c?.rootCauseBorderline)
            ? "borderline"
            : "miss"
        : "—";
    lines.push(
      `| ${id} | ${anchor.label} | ${anchor.hard ? "★" : ""} | ${cells.join(" | ")} | ${rc} |`,
    );
  }
  return lines.join("\n");
}

export function renderSummary(runs: RunResult[]): string {
  if (!runs.length) return "# faultline — no results yet\n";
  const out: string[] = [];
  out.push("# faultline — evaluation summary");
  out.push("");
  const anyFake = runs.some((r) => r.fake);
  out.push(
    `_${runs[0]!.caseIds.length} cases · ${runs
      .map((r) => `${r.mode}=${r.model}`)
      .join(" · ")}${anyFake ? " · **FAKE LLM run**" : ""} · ${new Date().toISOString()}_`,
  );
  out.push("");
  out.push("## Headline");
  out.push("");
  out.push(metricTable(runs));
  out.push("");
  for (const r of runs) {
    out.push(`## Confusion — ${r.mode}`);
    out.push("");
    out.push(confusion(r.scorecard));
    out.push("");
  }
  const agent = runs.find((r) => r.mode === "agent") ?? runs[runs.length - 1]!;
  out.push(`## Calibration — model score (${agent.mode})`);
  out.push("");
  out.push(
    "_A well-calibrated score has observed revert rate ≈ mean score in each row._",
  );
  out.push("");
  out.push(calibrationTable(agent.scorecard.calibrationModel));
  out.push("");
  out.push("## Per case");
  out.push("");
  out.push(perCaseTable(runs));
  out.push("");
  const mr = [...new Set(runs.flatMap((r) => r.scorecard.manualReview))];
  if (mr.length) {
    out.push("## Manual review needed");
    out.push("");
    for (const m of mr) out.push(`- ${m}`);
    out.push("");
  }
  return out.join("\n");
}

export function regenerateSummary(): string {
  const md = renderSummary(readAllResults());
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, "summary.md"), md);
  return md;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  console.log(regenerateSummary());
}
