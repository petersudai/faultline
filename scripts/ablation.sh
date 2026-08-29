#!/usr/bin/env bash
# The controlled ablation: same 12 cases, same metric, one capability added per step.
# Usage:  bash scripts/ablation.sh [model]
set -e
cd "$(dirname "$0")/.."
set -a; source .env; set +a
MODEL="${1:-claude-haiku-4-5-20251001}"
COMMON="--offline --model $MODEL"

echo "### ablation on $MODEL ###"
npx tsx eval/run.ts --mode baseline       $COMMON --label baseline
npx tsx eval/run.ts --mode baseline-plus  $COMMON --label baseline-plus
npx tsx eval/run.ts --mode agent $COMMON --label abl-1-read     --no-verify --tools get_diff,read_file
npx tsx eval/run.ts --mode agent $COMMON --label abl-2-callers  --no-verify --tools get_diff,read_file,find_references
npx tsx eval/run.ts --mode agent $COMMON --label abl-3-tests    --no-verify --tools get_diff,read_file,find_references,get_related_tests
npx tsx eval/run.ts --mode agent $COMMON --label abl-4-verify               --tools get_diff,read_file,find_references,get_related_tests
npx tsx eval/report.ts
echo "### done — see results/summary.md ###"
