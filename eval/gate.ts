/**
 * Pre-registered pass/fail gate for the adversarial critic pass (the rebuilt
 * SECOND_PASS_SYSTEM). Reads the 9 result files written by scripts/gate.sh
 * (baseline / abl-4-verify / agent, 3 Haiku seeds each) and decides whether the
 * critic earns its place or gets relabelled a removed experiment.
 *
 * The rules are fixed BEFORE the run (see scripts/gate.sh header). This file
 * only reports them — it does not tune anything.
 *
 *   C1  recall on reverts (strict, risky -> High)
 *         mean(agent) >= mean(abl4) + 0.10  AND  mean(agent) > mean(baseline)
 *         AND no agent seed below mean(abl4) or mean(baseline)
 *   C2  AUC of modelRiskScore (threshold-free ranking of risky vs clean)
 *         mean(agent) > mean(baseline) + 0.03 and > mean(abl4) + 0.03
 *         AND no agent seed below mean(abl4) or mean(baseline)
 *   C3  specificity (strict, clean -> not-High)
 *         every agent seed >= mean(abl4) - 1/6   (within one clean-PR false alarm)
 *         AND every agent seed >= 0.6667          (absolute backstop)
 *
 *   PASS = C1 and C2 and C3.  Any miss -> FAIL: relabel as a removed experiment
 *   and drop the "critic, not a crawler" framing. No tuning past that.
 *
 * AUC of derivedRiskScore is reported alongside as a stable cross-check, not gated.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "./report.js";

const RESULTS_DIR = join(process.cwd(), "results", "gate");

const RECALL_MARGIN = 0.1; // agent mean recall must clear abl4 mean by this
const AUC_MARGIN = 0.03;
const SPEC_ABS_FLOOR = 2 / 3; // >= 0.6667 every seed
const SPEC_SLACK = 1 / 6; // one clean PR out of six

const CONFIGS = {
  baseline: ["gate-baseline-s1", "gate-baseline-s2", "gate-baseline-s3"],
  abl4: ["gate-abl4-s1", "gate-abl4-s2", "gate-abl4-s3"],
  agent: ["gate-agent-s1", "gate-agent-s2", "gate-agent-s3"],
} as const;

interface SeedMetrics {
  label: string;
  recall: number;
  specificity: number;
  aucModel: number;
  aucDerived: number;
  costUsd: number;
}

function load(label: string): RunResult {
  const p = join(RESULTS_DIR, `${label}.json`);
  if (!existsSync(p)) {
    throw new Error(
      `missing ${p} — run scripts/gate.sh first (it writes results/gate/*.json)`,
    );
  }
  return JSON.parse(readFileSync(p, "utf8")) as RunResult;
}

function seedMetrics(label: string): SeedMetrics {
  const s = load(label).scorecard;
  if (s.aucModel == null) {
    throw new Error(
      `${label}.json predates the AUC metric — re-run it through the updated eval`,
    );
  }
  return {
    label,
    recall: s.recall,
    specificity: s.specificity,
    aucModel: s.aucModel,
    aucDerived: s.aucDerived,
    costUsd: s.meanCostUsd,
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const min = (xs: number[]) => Math.min(...xs);
const f3 = (x: number) => x.toFixed(3);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function main(): void {
  const baseline = CONFIGS.baseline.map(seedMetrics);
  const abl4 = CONFIGS.abl4.map(seedMetrics);
  const agent = CONFIGS.agent.map(seedMetrics);

  const col = (m: SeedMetrics[], pick: (x: SeedMetrics) => number) =>
    m.map(pick);

  const meanRecall = {
    baseline: mean(col(baseline, (x) => x.recall)),
    abl4: mean(col(abl4, (x) => x.recall)),
    agent: mean(col(agent, (x) => x.recall)),
  };
  const meanAuc = {
    baseline: mean(col(baseline, (x) => x.aucModel)),
    abl4: mean(col(abl4, (x) => x.aucModel)),
    agent: mean(col(agent, (x) => x.aucModel)),
  };
  const meanSpec = {
    baseline: mean(col(baseline, (x) => x.specificity)),
    abl4: mean(col(abl4, (x) => x.specificity)),
    agent: mean(col(agent, (x) => x.specificity)),
  };
  const meanAucDerived = {
    baseline: mean(col(baseline, (x) => x.aucDerived)),
    abl4: mean(col(abl4, (x) => x.aucDerived)),
    agent: mean(col(agent, (x) => x.aucDerived)),
  };
  const meanCost = {
    baseline: mean(col(baseline, (x) => x.costUsd)),
    abl4: mean(col(abl4, (x) => x.costUsd)),
    agent: mean(col(agent, (x) => x.costUsd)),
  };

  const agentRecalls = col(agent, (x) => x.recall);
  const agentAucs = col(agent, (x) => x.aucModel);
  const agentSpecs = col(agent, (x) => x.specificity);

  // ---- C1: recall ---------------------------------------------------------
  const c1meanUp =
    meanRecall.agent >= meanRecall.abl4 + RECALL_MARGIN - 1e-9 &&
    meanRecall.agent > meanRecall.baseline;
  const c1noReg =
    min(agentRecalls) >= meanRecall.abl4 &&
    min(agentRecalls) >= meanRecall.baseline;
  const c1 = c1meanUp && c1noReg;

  // ---- C2: AUC(modelRiskScore) -----------------------------------------
  const c2meanUp =
    meanAuc.agent > meanAuc.baseline + AUC_MARGIN &&
    meanAuc.agent > meanAuc.abl4 + AUC_MARGIN;
  const c2noReg =
    min(agentAucs) >= meanAuc.abl4 && min(agentAucs) >= meanAuc.baseline;
  const c2 = c2meanUp && c2noReg;

  // ---- C3: specificity floor -------------------------------------------
  const specRelFloor = meanSpec.abl4 - SPEC_SLACK;
  const c3rel = agentSpecs.every((v) => v >= specRelFloor - 1e-9);
  const c3abs = agentSpecs.every((v) => v >= SPEC_ABS_FLOOR - 1e-9);
  const c3 = c3rel && c3abs;

  const pass = c1 && c2 && c3;

  // ---- report -----------------------------------------------------------
  const line = "─".repeat(72);
  console.log(`\n${line}`);
  console.log("CRITIC GATE — pre-registered, Haiku, 12 cases, 3 seeds each");
  console.log(line);

  const perSeedTable = (name: string, m: SeedMetrics[]) => {
    console.log(`\n${name}`);
    console.log("  seed          recall   spec    AUC(model)  AUC(derived)  $/PR");
    for (const x of m) {
      console.log(
        `  ${x.label.padEnd(13)} ${pct(x.recall).padStart(6)}  ${pct(
          x.specificity,
        ).padStart(6)}   ${f3(x.aucModel).padStart(6)}      ${f3(
          x.aucDerived,
        ).padStart(6)}     $${x.costUsd.toFixed(4)}`,
      );
    }
  };
  perSeedTable("baseline", baseline);
  perSeedTable("abl-4-verify (no critic)", abl4);
  perSeedTable("agent (with critic)", agent);

  console.log("\nmeans");
  console.log(
    `  recall        baseline ${pct(meanRecall.baseline)}   abl4 ${pct(
      meanRecall.abl4,
    )}   agent ${pct(meanRecall.agent)}`,
  );
  console.log(
    `  AUC(model)    baseline ${f3(meanAuc.baseline)}    abl4 ${f3(
      meanAuc.abl4,
    )}    agent ${f3(meanAuc.agent)}`,
  );
  console.log(
    `  AUC(derived)  baseline ${f3(meanAucDerived.baseline)}    abl4 ${f3(
      meanAucDerived.abl4,
    )}    agent ${f3(meanAucDerived.agent)}   (report only)`,
  );
  console.log(
    `  specificity   baseline ${pct(meanSpec.baseline)}   abl4 ${pct(
      meanSpec.abl4,
    )}   agent ${pct(meanSpec.agent)}`,
  );
  console.log(
    `  $/PR          baseline $${meanCost.baseline.toFixed(
      4,
    )}   abl4 $${meanCost.abl4.toFixed(4)}   agent $${meanCost.agent.toFixed(4)}`,
  );

  const mark = (b: boolean) => (b ? "PASS" : "FAIL");
  console.log(`\n${line}`);
  console.log(
    `C1 recall      ${mark(c1)}  mean(agent) >= abl4+${RECALL_MARGIN} & > baseline: ${mark(
      c1meanUp,
    )}  no-seed-regression: ${mark(c1noReg)}`,
  );
  console.log(
    `               agent mean ${pct(meanRecall.agent)} vs abl4 ${pct(
      meanRecall.abl4,
    )} (+${RECALL_MARGIN} = ${pct(meanRecall.abl4 + RECALL_MARGIN)}) / baseline ${pct(
      meanRecall.baseline,
    )}; min agent seed ${pct(min(agentRecalls))}`,
  );
  console.log(
    `C2 AUC(model)  ${mark(c2)}  mean up by >${AUC_MARGIN}: ${mark(
      c2meanUp,
    )}  no-seed-regression: ${mark(c2noReg)}`,
  );
  console.log(
    `               agent mean ${f3(meanAuc.agent)} vs abl4 ${f3(
      meanAuc.abl4,
    )} / baseline ${f3(meanAuc.baseline)}; min agent seed ${f3(min(agentAucs))}`,
  );
  console.log(
    `C3 specificity ${mark(c3)}  rel floor (abl4-1/6 = ${f3(
      specRelFloor,
    )}): ${mark(c3rel)}  abs floor (${f3(SPEC_ABS_FLOOR)}): ${mark(c3abs)}`,
  );
  console.log(
    `               agent seeds ${agentSpecs.map(pct).join(", ")}`,
  );
  console.log(line);
  console.log(pass ? "\nGATE: PASS — critic stays; keep the framing.\n" : "");
  if (!pass) {
    console.log(
      "\nGATE: FAIL — relabel the critic pass as a removed experiment and drop the",
    );
    console.log('"critic, not a crawler" framing. No tuning past this point.\n');
    process.exit(1);
  }
}

main();
