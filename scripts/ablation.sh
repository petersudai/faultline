#!/usr/bin/env bash
# The controlled ablation: same 12 cases, same metric, one capability at a time.
# Usage:  bash scripts/ablation.sh [model]
set -e
cd "$(dirname "$0")/.."
set -a; source .env; set +a
MODEL="${1:-claude-haiku-4-5-20251001}"
C="--offline --model $MODEL --no-second-pass"   # second pass added only at the last step
T4="get_diff,read_file,find_references,get_related_tests"

echo "### ablation on $MODEL ###"
npx tsx eval/run.ts --mode baseline      --offline --model "$MODEL" --label baseline
npx tsx eval/run.ts --mode baseline-plus --offline --model "$MODEL" --label baseline-plus
npx tsx eval/run.ts --mode agent $C --label abl-1-read     --no-verify --tools get_diff,read_file
npx tsx eval/run.ts --mode agent $C --label abl-2-callers  --no-verify --tools get_diff,read_file,find_references
npx tsx eval/run.ts --mode agent $C --label abl-3-tests    --no-verify --tools "$T4"
npx tsx eval/run.ts --mode agent $C --label abl-4-verify               --tools "$T4"
npx tsx eval/run.ts --mode agent --offline --model "$MODEL" --label agent --tools "$T4"   # + adversarial 2nd pass (default) = final
npx tsx eval/report.ts
echo "### done — results/summary.md ###"
