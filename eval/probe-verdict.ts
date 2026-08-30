/**
 * Applies the pre-registered Sonnet-probe decision rule to the committed
 * results/probe-sonnet-*.json files. Reports only — changes nothing.
 *
 * Question: does `--deep` (investigate -> verify -> classify, no critic) beat
 * the direct call on claude-sonnet-5? i.e. is "the loop degrades it" a
 * Haiku-only finding.
 *
 * Reversal thresholds — probe-sonnet-deep minus probe-sonnet-direct:
 *   strict balanced accuracy   delta > 1/12   (one case)
 *   recall (revert -> High)    delta > 1/6    (one revert)
 *   AUC (derived risk score)   delta > 0.03
 *
 * Outcome:
 *   3/3 hold                          -> POSSIBLE REVERSAL: pre-register a 3-seed Sonnet gate
 *   2/3 hold AND all 3 deltas > 0     -> PARTIAL SIGNAL: note in CHANGELOG cross-model; 3-seed run is future work
 *   otherwise                         -> NO REVERSAL at 1 seed: future work
 * All non-decisive outcomes: record and stop, no 3-seed run this cycle.
 * The critic (probe-sonnet-critic) is observational and never gated on here.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "./report.js";

const R = join(process.cwd(), "results");
const load = (name: string): RunResult | null => {
  const p = join(R, `${name}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as RunResult) : null;
};

const direct = load("probe-sonnet-direct");
const deep = load("probe-sonnet-deep");
const critic = load("probe-sonnet-critic");

if (!direct || !deep) {
  console.error(
    "need results/probe-sonnet-direct.json and results/probe-sonnet-deep.json — run scripts/probe-sonnet.sh first",
  );
  process.exit(2);
}

const f3 = (x: number) => x.toFixed(3);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `$${x.toFixed(4)}`;

const row = (label: string, d: RunResult, k: (s: RunResult["scorecard"]) => number, fmt: (x: number) => string) =>
  `  ${label.padEnd(22)} direct ${fmt(k(direct!.scorecard)).padStart(8)}   deep ${fmt(k(deep!.scorecard)).padStart(8)}   Δ ${fmt(k(deep!.scorecard) - k(direct!.scorecard)).padStart(8)}`;

const dStrict = deep.scorecard.balancedAccuracy - direct.scorecard.balancedAccuracy;
const dRecall = deep.scorecard.recall - direct.scorecard.recall;
const dAuc = deep.scorecard.aucDerived - direct.scorecard.aucDerived;

const T_STRICT = 1 / 12;
const T_RECALL = 1 / 6;
const T_AUC = 0.03;

const holds = [dStrict > T_STRICT, dRecall > T_RECALL, dAuc > T_AUC];
const nHolds = holds.filter(Boolean).length;
const allPositive = dStrict > 0 && dRecall > 0 && dAuc > 0;

let outcome: string;
if (nHolds === 3) {
  outcome =
    "POSSIBLE REVERSAL — pre-register a 3-seed Sonnet gate (separate spec, shown before running).";
} else if (nHolds === 2 && allPositive) {
  outcome =
    'PARTIAL SIGNAL — record "partial signal on Sonnet, 3-seed run is future work" in the\n           CHANGELOG cross-model section. Stop. No 3-seed run this cycle.';
} else {
  outcome =
    'NO REVERSAL at 1 seed — record "no reversal on Sonnet at 1 seed; full run is future\n           work" in the CHANGELOG cross-model section. Stop.';
}

const line = "─".repeat(72);
console.log(`\n${line}`);
console.log("SONNET PROBE — pre-registered, 1 seed, --deep vs direct call");
console.log(line);
console.log(row("strict bal. acc", deep, (s) => s.balancedAccuracy, pct));
console.log(row("recall (revert→High)", deep, (s) => s.recall, pct));
console.log(row("AUC (derived score)", deep, (s) => s.aucDerived, f3));
console.log("");
console.log("  context (not gated):");
console.log(row("specificity", deep, (s) => s.specificity, pct));
console.log(row("AUC (model score)", deep, (s) => s.aucModel, f3));
console.log(row("root-cause hits", deep, (s) => s.rootCauseHits, (x) => `${x}`));
console.log("");
const mark = (b: boolean) => (b ? "hold" : "no  ");
console.log(`  strict Δ ${pct(dStrict)}  > 1/12 (${pct(T_STRICT)})?  ${mark(holds[0]!)}`);
console.log(`  recall Δ ${pct(dRecall)}  > 1/6  (${pct(T_RECALL)})?  ${mark(holds[1]!)}`);
console.log(`  AUC(d) Δ ${f3(dAuc)}  > 0.03?          ${mark(holds[2]!)}`);
console.log(`\n  ${nHolds}/3 thresholds hold${nHolds === 2 ? `, all 3 deltas > 0: ${allPositive}` : ""}`);
console.log(`\n${line}`);
console.log(`OUTCOME: ${outcome}`);
console.log(line);

console.log("\ncost:");
console.log(`  probe-sonnet-direct   ${usd(direct.scorecard.totalCostUsd)}`);
console.log(`  probe-sonnet-deep     ${usd(deep.scorecard.totalCostUsd)}`);
const combined = direct.scorecard.totalCostUsd + deep.scorecard.totalCostUsd;
console.log(`  combined              ${usd(combined)}`);
if (critic) {
  console.log(`  probe-sonnet-critic   ${usd(critic.scorecard.totalCostUsd)} (observational)`);
} else if (deep.scorecard.totalCostUsd > 4) {
  console.log("\n  ⛔ --deep alone > $4 — do NOT run the critic phase; flag the overspend.");
} else if (combined > 4) {
  console.log("\n  ⛔ direct + deep > ~$4 — do NOT run the critic phase.");
} else {
  console.log("\n  ✅ under ~$4 — critic phase may run:  bash scripts/probe-sonnet.sh critic");
}
