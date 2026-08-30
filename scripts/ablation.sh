#!/usr/bin/env bash
# The controlled ablation: same 12 cases, same metric, one capability at a time.
# Usage:  bash scripts/ablation.sh [model]
#
# Rows 0-5 are the per-capability exploration (single seed, directional; rows
# 2-4 predate the submit_review reliability fix). The AUTHORITATIVE numbers for
# the shipped config (row 5, abl-4-verify) and for the removed critic experiment
# (row 6) come from scripts/gate.sh — 3 seeds, pooled into results/{abl-4-verify,
# agent}.json. Re-running this script overwrites those with single-seed values;
# run scripts/gate.sh to restore them.
set -e
cd "$(dirname "$0")/.."
set -a; source .env; set +a
MODEL="${1:-claude-haiku-4-5-20251001}"
C="--offline --model $MODEL"
T4="get_diff,read_file,find_references,get_related_tests"

echo "### ablation on $MODEL ###"
npx tsx eval/run.ts --mode baseline      --offline --model "$MODEL" --label baseline
npx tsx eval/run.ts --mode baseline-plus --offline --model "$MODEL" --label baseline-plus
npx tsx eval/run.ts --mode agent $C --label abl-1-read     --no-verify --tools get_diff,read_file
npx tsx eval/run.ts --mode agent $C --label abl-2-callers  --no-verify --tools get_diff,read_file,find_references
npx tsx eval/run.ts --mode agent $C --label abl-3-tests    --no-verify --tools "$T4"
npx tsx eval/run.ts --mode agent $C --label abl-4-verify               --tools "$T4"   # row 5 = shipped pipeline (investigate -> verify -> classify)
npx tsx eval/run.ts --mode agent $C --label abl-R-critic   --second-pass --tools "$T4" # row 6 = critic (REMOVED EXPERIMENT — failed scripts/gate.sh)
npx tsx eval/report.ts
echo "### done — results/summary.md ###"
