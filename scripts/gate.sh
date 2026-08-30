#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pre-registered gate for the rebuilt adversarial critic pass.
# Run BEFORE reading results. The pass/fail rules are fixed here and in
# eval/gate.ts; this script only produces the numbers they consume.
#
# Configs (Haiku, 12 cases, --offline, 3 independent seeds each):
#   gate-baseline-s{1,2,3}  one engineered call ("direct call")
#   gate-abl4-s{1,2,3}      investigate -> verify -> classify        (shipped --deep)
#   gate-agent-s{1,2,3}     investigate -> verify -> CRITIC -> classify  (--second-pass)
# abl4 and agent use the SAME tool set (TOOLS = the shipped default, no
# find_references) so the ONLY variable is the critic.
#
# After the runs: seed files move to results/gate/, the 3 seeds of abl4 and of
# agent are pooled into results/abl-4-verify.json / results/agent.json (one row
# each in results/summary.md), and eval/gate.ts prints the verdict.
#
# GATE (all three must hold; see eval/gate.ts for exact expressions):
#   C1 recall on reverts   mean(agent) >= mean(abl4) + 0.10  AND  > mean(baseline),
#                          and no agent seed below mean(abl4) or mean(baseline)
#   C2 AUC(modelRiskScore) mean(agent) > mean(baseline)+0.03 and > mean(abl4)+0.03,
#                          and no agent seed below either mean
#   C3 specificity         every agent seed >= mean(abl4) - 1/6  AND  >= 0.6667
#   AUC(derivedRiskScore)  reported alongside as a cross-check, NOT gated.
#
# Miss any -> FAIL: the shipped `--deep` is investigate -> verify -> classify;
# the critic is documented as a removed experiment with this 3-seed evidence.
# No tuning past that.
# ---------------------------------------------------------------------------
set -e
cd "$(dirname "$0")/.."
set -a; source .env; set +a

MODEL="claude-haiku-4-5-20251001"
TOOLS="get_diff,read_file,get_related_tests"   # the shipped default (ALL_TOOLS)
COMMON="--offline --model $MODEL --concurrency 3 --tools $TOOLS"

echo "### critic gate on $MODEL — 9 runs (~30-40 min, ~\$4) ###"

for S in 1 2 3; do
  echo "--- seed $S ---"
  npx tsx eval/run.ts --mode baseline --offline --model "$MODEL" --concurrency 3 \
      --label "gate-baseline-s$S"
  npx tsx eval/run.ts --mode agent $COMMON \
      --label "gate-abl4-s$S"                       # shipped: no critic
  npx tsx eval/run.ts --mode agent $COMMON --second-pass \
      --label "gate-agent-s$S"                      # + critic (removed experiment)
done

# park the 9 seed runs under results/gate/ so summary.md stays the clean set
mkdir -p results/gate
mv results/gate-*.json results/gate/ 2>/dev/null || true
for d in results/gate-baseline-s? results/gate-abl4-s? results/gate-agent-s?; do
  [ -d "$d" ] && mv "$d" results/gate/
done

# pooled single-row results for summary.md (regenerates summary.md too)
npx tsx eval/aggregate.ts --labels gate/gate-abl4-s1,gate/gate-abl4-s2,gate/gate-abl4-s3   --out abl-4-verify --no-summary
npx tsx eval/aggregate.ts --labels gate/gate-agent-s1,gate/gate-agent-s2,gate/gate-agent-s3 --out agent

echo
npx tsx eval/gate.ts
