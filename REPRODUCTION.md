# Reproduction guide

Written for someone starting from a clean machine. Numbers marked _[TBD]_ are
filled in from the final scored run.

## Requirements

- Node ≥ 20 (`.nvmrc` pins 20), npm
- `git` on PATH (the agent shallow-clones the target repo for its file tools)
- An Anthropic API key with credit. **No GitHub token needed** for the offline
  eval — every PR's metadata and diff for the 12 cases is committed under
  `.cache/gh/`.

## Setup

```bash
git clone <this repo> && cd faultline
nvm use            # or: node --version  → must be >= 20
npm ci
cp .env.example .env
#   edit .env → ANTHROPIC_API_KEY=sk-ant-...
#   (GITHUB_TOKEN only needed for live single-PR runs, not the eval)
```

## Sanity checks (no spend)

```bash
npm test              # 21 unit tests: classifier, scoring, renderer, JSON extraction
npm run preflight     # all 12 cases resolve from the committed cache
```

## Run the evaluation

Everything at once (baseline → agent → report):

```bash
npm run eval:all
```

…or step by step. Baseline — one model call per PR on the diff:

```bash
npm run eval -- --mode baseline --offline
```

Expected: `results/baseline.json`, `results/summary.md`.
Balanced accuracy ≈ _[TBD]_ · runtime ≈ _[TBD]_ · cost ≈ _[TBD]_.

Agent — investigate + verify + deterministic classify:

```bash
npm run eval -- --mode agent --offline
```

Expected: `results/agent.json`, updated `results/summary.md`, trajectories under
`trajectories/eval-*/`.
Balanced accuracy ≈ _[TBD]_ · runtime ≈ _[TBD]_ · cost ≈ _[TBD]_.

Regenerate the comparison table at any time:

```bash
npm run report        # rewrites results/summary.md from the two result files
```

### Options

| flag | effect |
|---|---|
| `--cases c01,c05` | run a subset (cheap iteration) |
| `--model claude-sonnet-5` | override the model (default: `claude-haiku-4-5-20251001`) |
| `--concurrency 3` | cases in flight at once |
| (omit `--offline`) | fetch PR data live; needs `GITHUB_TOKEN`, repopulates `.cache/gh/` |

## What the eval measures

- **Balanced accuracy** (primary): correct `High` vs `not-High` against the
  risky/clean label, averaged over the two classes.
- **Root-cause hit rate**: for risky PRs, did a finding land on the file that
  actually broke, and describe the real issue.
- **False-alarm rate**: `High`-severity findings per clean PR.
- **Cost / time per PR**.

Labels are objective: `risky` = the PR was later reverted (see
`eval/dataset/README.md` for the revert PR of each case); `clean` = a merged PR
with no revert/regression follow-up after 60+ days.

## Single PR (live)

```bash
#   needs GITHUB_TOKEN in .env
npm run faultline -- honojs/hono 5274 --agent
```

Writes `out/honojs-hono-5274/REVIEW.md` and `review.json`.

## Environment used for the reported numbers

- Node _[TBD]_ · OS _[TBD]_
- Model: `claude-haiku-4-5-20251001` for iteration, `claude-sonnet-5` for the
  scored run _[confirm]_
- Total eval cost (baseline + agent, 12 cases): ≈ _[TBD]_
