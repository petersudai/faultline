import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Scorecard, Scored } from "./score.js";

export interface RunResult {
  mode: "baseline" | "agent";
  model: string;
  fake: boolean;
  timestamp: string;
  caseIds: string[];
  scorecard: Scorecard;
}

const RESULTS_DIR = join(process.cwd(), "results");

export function writeRunResult(r: RunResult): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${r.mode}.json`), JSON.stringify(r, null, 2));
}

export function readRunResult(mode: "baseline" | "agent"): RunResult | null {
  const p = join(RESULTS_DIR, `${mode}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as RunResult) : null;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `$${x.toFixed(4)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function delta(a: number, b: number, asPct = true): string {
  const d = b - a;
  const s = asPct ? `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} pp` : `${d >= 0 ? "+" : ""}${d.toFixed(2)}`;
  return d === 0 ? "—" : s;
}

function metricRows(base: Scorecard | null, agent: Scorecard | null): string {
  const cols = (get: (s: Scorecard) => string, d?: string) =>
    `| ${base ? get(base) : "—"} | ${agent ? get(agent) : "—"} | ${d ?? ""} |`;

  const rows: string[] = [];
  rows.push(`| **Balanced accuracy** (primary) ` + cols((s) => pct(s.balancedAccuracy), base && agent ? delta(base.balancedAccuracy, agent.balancedAccuracy) : ""));
  rows.push(`| Recall (risky caught) ` + cols((s) => pct(s.recall), base && agent ? delta(base.recall, agent.recall) : ""));
  rows.push(`| Specificity (clean passed) ` + cols((s) => pct(s.specificity), base && agent ? delta(base.specificity, agent.specificity) : ""));
  rows.push(`| Precision ` + cols((s) => pct(s.precision), base && agent ? delta(base.precision, agent.precision) : ""));
  rows.push(`| F1 ` + cols((s) => pct(s.f1), base && agent ? delta(base.f1, agent.f1) : ""));
  rows.push(`| Root-cause hit rate (risky) ` + cols((s) => `${s.rootCauseHits}/${s.riskyCount} (${pct(s.rootCauseHitRate)})`, base && agent ? delta(base.rootCauseHitRate, agent.rootCauseHitRate) : ""));
  rows.push(`| False-alarm rate (high/clean PR) ` + cols((s) => s.falseAlarmRate.toFixed(2), base && agent ? delta(base.falseAlarmRate, agent.falseAlarmRate, false) : ""));
  rows.push(`| Hard cases correct ` + cols((s) => `${s.hardCorrect}/${s.hardTotal}`));
  rows.push(`| Mean cost / PR ` + cols((s) => usd(s.meanCostUsd)));
  rows.push(`| Mean time / PR ` + cols((s) => secs(s.meanWallMs)));
  return rows.join("\n");
}

function confusion(s: Scorecard): string {
  const { tp, fp, tn, fn } = s.confusion;
  return [
    "|              | pred High | pred not-High |",
    "|--------------|-----------|---------------|",
    `| **risky**    | ${tp} (TP) | ${fn} (FN) |`,
    `| **clean**    | ${fp} (FP) | ${tn} (TN) |`,
  ].join("\n");
}

function perCaseTable(base: Scorecard | null, agent: Scorecard | null): string {
  const ids = (agent ?? base)!.perCase.map((c) => c.caseId);
  const byId = (s: Scorecard | null, id: string): Scored | undefined =>
    s?.perCase.find((c) => c.caseId === id);
  const lines = [
    "| case | label | hard | baseline | agent | root cause |",
    "|------|-------|------|----------|-------|------------|",
  ];
  for (const id of ids) {
    const b = byId(base, id);
    const a = byId(agent, id);
    const mark = (c?: Scored) =>
      !c ? "—" : `${c.predictedRisk}${c.correct ? " ✓" : " ✗"}`;
    const rc = a ?? b;
    const rcTxt =
      rc?.label === "risky"
        ? rc.rootCauseHit
          ? "hit"
          : rc.rootCauseBorderline
            ? "borderline"
            : "miss"
        : "—";
    lines.push(
      `| ${id} | ${rc?.label ?? "?"} | ${rc?.hard ? "★" : ""} | ${mark(b)} | ${mark(a)} | ${rcTxt} |`,
    );
  }
  return lines.join("\n");
}

export function renderSummary(base: RunResult | null, agent: RunResult | null): string {
  const out: string[] = [];
  out.push(`# faultline — evaluation summary`);
  out.push("");
  const meta = agent ?? base;
  if (meta) {
    out.push(
      `_${meta.caseIds.length} cases · baseline model ${base?.model ?? "—"} · agent model ${agent?.model ?? "—"}${
        (base?.fake || agent?.fake) ? " · **FAKE LLM run (plumbing only)**" : ""
      } · generated ${new Date().toISOString()}_`,
    );
  }
  out.push("");
  out.push("## Headline");
  out.push("");
  out.push("| metric | baseline | agent | Δ |");
  out.push("|--------|----------|-------|---|");
  out.push(metricRows(base?.scorecard ?? null, agent?.scorecard ?? null));
  out.push("");
  if (base) {
    out.push("## Confusion — baseline");
    out.push("");
    out.push(confusion(base.scorecard));
    out.push("");
  }
  if (agent) {
    out.push("## Confusion — agent");
    out.push("");
    out.push(confusion(agent.scorecard));
    out.push("");
  }
  out.push("## Per case");
  out.push("");
  out.push(perCaseTable(base?.scorecard ?? null, agent?.scorecard ?? null));
  out.push("");
  const mr = [
    ...new Set([
      ...(base?.scorecard.manualReview ?? []),
      ...(agent?.scorecard.manualReview ?? []),
    ]),
  ];
  if (mr.length) {
    out.push("## Manual review needed");
    out.push("");
    for (const m of mr) out.push(`- ${m}`);
    out.push("");
  }
  return out.join("\n");
}

export function regenerateSummary(): string {
  const base = readRunResult("baseline");
  const agent = readRunResult("agent");
  const md = renderSummary(base, agent);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, "summary.md"), md);
  return md;
}

// `npm run report`
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  console.log(regenerateSummary());
}
