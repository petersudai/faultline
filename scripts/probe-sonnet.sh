#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pre-registered 1-seed Sonnet probe. Tests ONLY whether --deep (investigate ->
# verify -> classify, no critic) beats the direct call on claude-sonnet-5 —
# i.e. is "the loop degrades it" a Haiku-only finding. The adversarial critic
# stays a removed experiment regardless; probe-sonnet-critic is observational.
#
# REVERSAL thresholds (probe-sonnet-deep minus probe-sonnet-direct):
#   strict bal. acc  Δ > 1/12       recall  Δ > 1/6       AUC(derived)  Δ > 0.03
# Outcome (eval/probe-verdict.ts):
#   3/3 hold                       -> POSSIBLE REVERSAL: pre-register a 3-seed Sonnet gate
#   2/3 hold AND all 3 Δ > 0       -> PARTIAL SIGNAL: note in CHANGELOG cross-model; stop
#   otherwise                     -> NO REVERSAL at 1 seed: note in CHANGELOG cross-model; stop
#
# Split run / cost control:
#   bash scripts/probe-sonnet.sh          phase 1: direct + deep, then the verdict + cost gate
#   bash scripts/probe-sonnet.sh critic   phase 2: the observational critic run
# Phase 2 is only allowed if phase 1 reported direct+deep under ~$4 and
# --deep alone under $4.
# ---------------------------------------------------------------------------
set -e
cd "$(dirname "$0")/.."
set -a; source .env; set +a

M="claude-sonnet-5"
T="get_diff,read_file,get_related_tests"

if [ "$1" = "critic" ]; then
  echo "### Sonnet probe — phase 2: probe-sonnet-critic (observational) ###"
  npx tsx eval/run.ts --mode agent --offline --model "$M" --concurrency 3 \
      --tools "$T" --second-pass --label probe-sonnet-critic
  npx tsx eval/report.ts >/dev/null
  npx tsx eval/probe-verdict.ts
  exit 0
fi

echo "### Sonnet probe — phase 1: direct + deep (~\$3-5) ###"
npx tsx eval/run.ts --mode baseline --offline --model "$M" --label probe-sonnet-direct
npx tsx eval/run.ts --mode agent --offline --model "$M" --concurrency 3 \
    --tools "$T" --label probe-sonnet-deep

npx tsx eval/report.ts >/dev/null
npx tsx eval/probe-verdict.ts
