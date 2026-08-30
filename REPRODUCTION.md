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
npm test                # unit tests: classifier, scoring (incl. AUC), renderer, JSON extraction
npm run preflight       # all 12 cases resolve from the committed cache
```

## Reproduce the headline comparison

```bash
npm run eval:all        # direct call (offline) + --deep (offline) + report
```

Writes `results/baseline.json`, `results/agent.json`, `results/summary.md`,
per-case reviews under `results/<label>/`, and `--deep` trajectories under
`trajectories/`.

**Expected** (claude-haiku-4-5, model default; n=12):

| | strict bal. acc | recall on reverts | AUC (derived) | root-cause | runtime | cost |
|---|---|---|---|---|---|---|
| direct call (shipped) | 66.7% | 33% | 0.81 | 6/6 | ~1 min | ~$0.07 |
| `--deep` (loop + verify) | ~56% | ~22% | ~0.57 | 2–3/6 | ~8 min | ~$0.50 |

The direct call is **deterministic at temp 0** (forced structured output) — it
reproduces exactly. `--deep` varies run to run by ±1 case; `results/*.json` are
3-seed pooled aggregates from `scripts/gate.sh`. The removed adversarial-critic
experiment (`results/agent.json`) is reproduced by `bash scripts/gate.sh` or
`bash scripts/ablation.sh` (row R).

## Reproduce the full ablation

```bash
bash scripts/ablation.sh            # ~20 min, ~$2 on Haiku (rows 0–5 + the removed critic, row R)
bash scripts/gate.sh               # the pre-registered 3-seed critic gate (~30–40 min, ~$4)
```

Rebuilds the `CHANGELOG.md` table into `results/summary.md`.

## Single PR, live (needs GITHUB_TOKEN)

```bash
npm run faultline -- honojs/hono 4707            # the review (direct call)
npm run faultline -- honojs/hono 4707 --deep     # + investigation loop, full trajectory
```

Writes `out/honojs-hono-4707/REVIEW.md` and `review.json`, and a full
`trajectories/<...>/TRAJECTORY.md`.

## What the eval measures

- **strict** balanced accuracy — "High" = flag for blocking review
- **triage** balanced accuracy — "High or Medium" = needs a closer look
- **recall / specificity** on the strict metric
- **root-cause hit rate** — for reverted PRs, did a finding name the file that
  actually broke and describe the real issue
- **Brier score + calibration table** — how well the 0–1 risk score tracks the
  actual revert outcome
- **AUC** — ranking quality of the 0–1 risk score: P(a reverted PR scores above
  a clean one), threshold-free
- **cost / time per PR**

Labels are objective: `risky` = the PR was later reverted (revert PR listed per
case in `eval/dataset/README.md`); `clean` = merged, no revert/regression
follow-up after 60+ days.

## Environment used for the committed numbers

- Node 22.15, Windows 11, npm 10.9
- Model: `claude-haiku-4-5-20251001` — every number in `results/` and the docs.
  `claude-sonnet-5` runs the direct call (forced structured output; spot-checked
  on the previously-failing cases, not fully evaluated — see CHANGELOG
  "Cross-model check"). `--deep` on Sonnet is not verified.
- Prompt caching on; temperature 0 on Haiku. The direct call is deterministic at
  temp 0 (structured tool output) and reproduces the committed
  `results/baseline.json` exactly; `--deep` has ±1 case of run-to-run noise.
- Total spend to produce every number in `results/`: ~$20 (adds the 3-seed gate
  and the Sonnet probe over the original ablation).
