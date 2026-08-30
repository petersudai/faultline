/**
 * Pool the per-case reviews from several eval runs into one aggregate
 * RunResult. Used to collapse the 3 gate seeds into results/abl-4-verify.json
 * and results/agent.json so results/summary.md shows the gate outcome as a
 * single row per config. The 9 gate-*.json seed files are kept under
 * results/gate/ for the per-seed detail.
 *
 *   npx tsx eval/aggregate.ts --labels gate-abl4-s1,gate-abl4-s2,gate-abl4-s3 --out abl-4-verify
 *
 * The pooled scorecard is scoreAll() over all seed x case (case, review) pairs
 * (18 risky / 18 clean for 3 seeds), so recall / specificity / AUC are the
 * seed-pooled values; confusion counts and perCase are the pooled set.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCases } from "./cases.js";
import { scoreAll } from "./score.js";
import { writeRunResult, regenerateSummary, type RunResult } from "./report.js";
import { Review } from "../src/review/schema.js";

function val(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const labels = (val("--labels") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const out = val("--out");
if (!labels.length || !out) {
  console.error("usage: aggregate --labels a,b,c --out <name> [--no-summary]");
  process.exit(2);
}

const cases = loadCases();
const pairs: { c: (typeof cases)[number]; review: Review }[] = [];
for (const label of labels) {
  for (const c of cases) {
    const p = join(process.cwd(), "results", label, `${c.id}.json`);
    const review = Review.parse(JSON.parse(readFileSync(p, "utf8")));
    pairs.push({ c, review });
  }
}

// Pooled over all seed x case pairs: rates / Brier / AUC are the seed-pooled
// values; confusion counts, root-cause and hard tallies are over n=nSeeds*12.
const scorecard = scoreAll(pairs);
const nSeeds = labels.length;
const model = pairs[0]!.review.meta.model;
const totalCost = pairs.reduce((a, x) => a + x.review.meta.costUsd, 0);

const result: RunResult = {
  mode: out!,
  model,
  fake: false,
  timestamp: new Date().toISOString(),
  caseIds: cases.map((c) => c.id),
  seeds: nSeeds,
  scorecard,
};
writeRunResult(result);
console.log(
  `wrote results/${out}.json — pooled ${pairs.length} reviews from ${labels.join(
    ", ",
  )} (mean $${(totalCost / pairs.length).toFixed(4)}/PR)`,
);

if (!process.argv.includes("--no-summary")) {
  regenerateSummary();
  console.log("regenerated results/summary.md");
}
