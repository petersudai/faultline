#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
set -a; source .env; set +a
AGENT_TOOLS="get_diff,read_file,find_references,get_related_tests"

echo "### Haiku: full agent (post submit_review fix) + removed experiment ###"
npx tsx eval/run.ts --mode agent --offline --label abl-4-verify   --tools $AGENT_TOOLS
npx tsx eval/run.ts --mode agent --offline --label abl-R-second    --tools $AGENT_TOOLS --second-pass

echo "### Sonnet: baseline + full agent (the crossover check) ###"
npx tsx eval/run.ts --mode baseline --offline --model claude-sonnet-5 --label baseline-sonnet
npx tsx eval/run.ts --mode agent    --offline --model claude-sonnet-5 --label agent-sonnet --tools $AGENT_TOOLS

npx tsx eval/report.ts
echo "### done — results/summary.md ###"
