# faultline

**Pre-merge risk triage for pull requests.** Point it at a PR; it tells you how
much careful human review the change needs, and where to look — scored against
which PRs *actually got reverted*.

```bash
faultline honojs/hono 4707            # the review: one engineered model call
faultline honojs/hono 4707 --deep     # + investigation loop & verify pass; full trajectory in trajectories/
```

Output is a `REVIEW.md`: a risk level (High / Medium / Low), findings pinned to
`file:line` with a rationale, a manual checklist, and a calibrated 0–1 risk
score.

---

## Who has this problem

A maintainer or lead reviewer with more open PRs than review time. They must
decide which PRs to read slowly and which to wave through. Skim-review merges a
risky change; it comes back as a revert or a hotfix.

## Why the framing is different

faultline does not ask a model "is this code good" — an opinion. It asks
**"does this PR look like the ones that got reverted"**, and every number in
this repo is checked against real revert history: 12 merged `honojs/hono` PRs,
6 that were later reverted, 6 that stuck, frozen by commit SHA
(`eval/dataset/README.md`).

## What we found

n=12, revert-labelled (6 reverted / 6 clean), frozen by SHA. Scored on strict
"High = block" balanced accuracy, recall on the 6 reverts, root-cause
localisation, and **AUC of a 0–1 risk score** — can it rank reverted above
clean, threshold-free. One case ≈ 8 pp, so the deciding comparison ran as a
**3-seed pre-registered gate** (`scripts/gate.sh`); details in `CHANGELOG.md`.

| config (Haiku 4.5, 12 cases, mean of 3 seeds) | strict acc | recall on reverts | AUC (derived risk score) | root-cause | $/PR |
|---|---|---|---|---|---|
| **direct call — one engineered prompt** | **66.7%** | 33% | **0.76** | **6/6** | **$0.007** |
| + investigation loop + verify pass (`--deep`) | 55.6% | 22% | 0.57 | 2–3/6 | $0.041 |
| + adversarial critic pass (removed) | 66.7% | 72% | 0.69 | 6/6 | $0.042 |

**The single engineered call is the best config.** Wrapping it in a tool-driven
investigation loop did not improve triage accuracy, cost ~6×, and *hurt*
root-cause localisation (6/6 → 2–3/6) — attention goes to tool output instead of
the change. An adversarial critic on top raises recall on reverts (33% → 72%),
but in lockstep flags a clean PR "High" on ~40% of cases (specificity
100% → 61%), and its model-score AUC — 0.78 on average — swings 0.61–0.97 across
seeds, one below the direct call's 0.63. It **failed the pre-registered gate**
and is not in the shipped pipeline.

**Hot take:** for triage on this data the model was never short on information —
one call finds every root cause (6/6). Nothing added on top sorted PRs more
dependably: the direct call's derived risk score is a fixed formula over that
one call (AUC 0.76, ±0.02 across seeds), and the adversarial critic only trades
specificity for recall about one for one. When an agent under-commits, a louder
critic changes *where* you sit on the ROC curve, not *which* curve you're on.
The honest agentic win here is the trajectory, not the verdict. See
`CHANGELOG.md` for the full ablation and `DESIGN_LOG.md` for every decision.

## `--deep`: the investigation loop (opt-in)

1. **Investigate** — a bounded tool loop (get_diff, read_file at base/head,
   get_related_tests; 8-step cap). Every model and tool call is written to
   `trajectories/` as it happens — that trace is the reason to use `--deep`.
2. **Verify** — a no-tools pass that drops findings not supported by the diff.
3. **Classify** — risk level is a deterministic rule over the surviving findings
   (`src/review/classify.ts`), never the model's vote. A separate 0–1 score is
   kept for calibration (Brier) and ranking (AUC).

On this dataset `--deep` did not beat the direct call — strict 56% vs 67%,
recall 22% vs 33%, root-cause 2–3/6 vs 6/6 — at ~6× the cost. Run it when you
need the worked record: to show a reviewer why a PR was flagged, or to keep an
audit trail. `--deep --second-pass` adds the removed-experiment critic pass; see
`CHANGELOG.md`.

## Reproduce

```bash
npm ci
npm test                              # unit tests
npm run preflight                     # 12/12 cases resolve from the committed cache
cp .env.example .env                  # add ANTHROPIC_API_KEY (no GitHub token needed offline)
npm run eval:all                      # direct call + --deep + report, from cache
```

Full steps, expected numbers, runtime and cost: `REPRODUCTION.md`.

## Layout

```
src/
  cli.ts            faultline <owner/repo> <pr> [--deep]
  baseline/run.ts   the default: one engineered call (the product)
  agent/loop.ts     --deep: investigate → verify → classify  (+ critic via --second-pass, removed)
  agent/prompts.ts  the system prompts
  review/           schema (zod), deterministic classifier, Markdown renderer
  llm/, github/, repo/   client (caching, cost), PR data + cache, file tools
eval/
  dataset/cases.jsonl   12 labelled PRs, frozen by SHA
  run.ts score.ts report.ts gate.ts aggregate.ts
scripts/ablation.sh     reproduces the CHANGELOG table
scripts/gate.sh         reproduces the 3-seed critic gate
```
