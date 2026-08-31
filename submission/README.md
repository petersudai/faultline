# Submission index — faultline

micro1 Agentic Workflows Hackathon. The four required items:

| # | Item | Where |
|---|------|-------|
| 1 | Complete solution code + improvement changelog | this repo (`src/`, `eval/`) + [`../CHANGELOG.md`](../CHANGELOG.md) |
| 2 | Reproduction guide | [`../REPRODUCTION.md`](../REPRODUCTION.md) |
| 3 | Solution video (≤5 min) | link in the HackerEarth submission |
| 4 | Agent trajectories | [`trajectories/`](trajectories/) (below) |

Supporting: [`../SPEC.md`](../SPEC.md) (full design), [`../DESIGN_LOG.md`](../DESIGN_LOG.md)
(every decision, its tradeoffs, and its measured effect), [`RESULTS.md`](RESULTS.md)
(a snapshot of `results/summary.md`).

## The one-paragraph version

faultline decides how much human review a pull request needs before merging, and
is scored against **which PRs actually got reverted** — 12 merged `honojs/hono`
PRs, 6 later reverted, 6 that stuck, frozen by commit SHA. The shipped product is
a **single engineered model call** whose verdict comes back as a forced
`submit_review` tool call: 66.7% strict balanced accuracy, 6/6 root-cause,
derived-score AUC 0.81, deterministic at temp 0, ~$0.006/PR. A controlled
ablation adds one capability at a time and **none of them beat it**: a tool-driven
investigation loop (`--deep`) does not improve accuracy and hurts root-cause
localisation (6/6 → 2–3/6) at ~6× cost; an adversarially-framed second pass on
top raises recall on reverts but flags a clean PR "High" on ~40% of cases and,
under a **pre-registered 3-seed gate**, fails 2 of 3 conditions. The one change
that did help cost nothing: **forcing structured tool output instead of free-text
JSON** made the baseline more decisive (5 "Medium" hedges → committed calls) and
a better ranker (AUC 0.76 → 0.81). `--deep` is kept, opt-in, for the trajectory
trace — not the verdict.

## Trajectories (item 4)

Each folder has the human-readable `TRAJECTORY.md`, the raw `trajectory.jsonl`
step stream, and the final `review.json`. All from `--offline` eval runs on
`claude-haiku-4-5`. The system prompts are in
[`../src/agent/prompts.ts`](../src/agent/prompts.ts).

- **`c02-direct-call/`** — hono #4198 (an `res.clone()` fallback added to the
  etag middleware, later reverted). **The shipped product.** One model call, no
  tools, $0.007: it names the body-consumption / data-loss risk on
  `src/middleware/etag/index.ts`, the silent catch-all, and the missing test —
  and rates it **High**. No trajectory, because there are no steps: this is
  `REVIEW.md` + `review.json` only.
- **`c01-deep/`** — hono #4707 (a fast path added to `c.json()`, later reverted).
  **`--deep`: the investigation loop.** Seven tool calls — reads the old and new
  `context.ts`, pulls the related tests, checks the fast-path guard — then a
  verify pass. The trace is thorough and readable. The verdict is **Low**: the
  loop investigates the headline revert and still does not beat the direct call.
  This is why `--deep` is kept for the record, not the decision.
- **`c11-deep-second-pass-REMOVED/`** — hono #3888 (greedy route params followed
  by static components — merged, **not** reverted). **The removed experiment.**
  The pipeline with the adversarial critic pass lands **High** on a
  confidently-worded "critical regex bug" that the revert history says is not a
  regression — and the critic, whose job is to challenge the draft's severities
  in *both* directions, ratifies the over-rating (0.72 → 0.75) instead of
  catching it. Across the pre-registered 3-seed gate the critic only ever pushes
  severity up: recall on reverts 33% → 72%, specificity 100% → 61%. It fails the
  gate; `--second-pass` reproduces it; it is not in the shipped pipeline.

> Coding-agent (Claude Code) transcripts for *building* faultline are provided
> separately in the HackerEarth submission per the disclosure requirement.
