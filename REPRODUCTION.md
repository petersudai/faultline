# Reproduction guide

From a clean machine.

## Requirements

- Node ≥ 20 (`.nvmrc` pins 20), npm
- An Anthropic API key with credit (`ANTHROPIC_API_KEY` in `.env`)
- `git` on PATH. The **baseline** eval is fully offline (every PR's metadata and
  diff is committed under `.cache/gh/`). The **agent** eval additionally does a
  one-time shallow `git clone` of the target repo (`honojs/hono`, ~20 MB) so its
  file tools can read source at the base/head commits — this needs network to
  github.com but **no auth**. Setting `GITHUB_TOKEN` (any scopeless PAT) is
  recommended: it raises the git fetch rate limit from ~60/hr to 5000/hr.
- Cloning to a short path is wise on Windows (deep temp dirs + git's pack files
  can exceed MAX_PATH; the code sets `core.longpaths` but a sane path is safer).

## Setup

```bash
git clone <this repo> && cd faultline
nvm use                 # Node 20+
npm ci
cp .env.example .env     # add ANTHROPIC_API_KEY=sk-ant-...
```

## Sanity checks (no spend)

```bash
npm test                # 24 unit tests: classifier, scoring, renderer, JSON extraction
npm run preflight       # all 12 cases resolve from the committed cache
```

## Reproduce the headline comparison

```bash
npm run eval:all        # baseline (offline) + agent (offline) + report
```

Writes `results/baseline.json`, `results/agent.json`, `results/summary.md`,
per-case reviews under `results/<label>/`, and agent trajectories under
`trajectories/`.

**Expected** (claude-haiku-4-5, model default; n=12; one case ≈ 8 pp of noise):

| | strict bal. acc | recall on reverts | root-cause | runtime | cost |
|---|---|---|---|---|---|
| baseline | ~67% | ~33% | 6/6 | ~2 min | ~$0.08 |
| agent (final) | 67–75% | 50–67% | 4–5/6 | ~9 min | ~$0.55 |

The agent number varies run to run — see `CHANGELOG.md` for the two seeds we
recorded and why we report a range.

## Reproduce the full ablation

```bash
bash scripts/ablation.sh            # ~20 min, ~$2 on Haiku
bash scripts/ablation.sh claude-sonnet-5   # see the "cross-model check" caveat in CHANGELOG
```

Rebuilds every row of the `CHANGELOG.md` table into `results/summary.md`.

## Single PR, live (needs GITHUB_TOKEN)

```bash
npm run faultline -- honojs/hono 4707 --agent
```

Writes `out/honojs-hono-4707/REVIEW.md` and `review.json`, and a full
`trajectories/<...>/TRAJECTORY.md`.

## What the eval measures

- **strict** balanced accuracy — "High" = flag for blocking review
- **triage** balanced accuracy — "High or Medium" = needs a closer look
- **recall / specificity** on the strict metric
- **root-cause hit rate** — for reverted PRs, did a finding name the file that
  actually broke and describe the real issue
- **Brier score + calibration table** — how well the model's 0–1 risk score
  tracks the actual revert outcome
- **cost / time per PR**

Labels are objective: `risky` = the PR was later reverted (revert PR listed per
case in `eval/dataset/README.md`); `clean` = merged, no revert/regression
follow-up after 60+ days.

## Environment used for the committed numbers

- Node 22.15, Windows 11, npm 10.9
- Models: `claude-haiku-4-5-20251001` (headline + ablation);
  `claude-sonnet-5` attempted (see CHANGELOG "cross-model check")
- Prompt caching on; temperature 0 on Haiku, omitted on Sonnet 5
- Total spend to produce every number in `results/`: ~$12
