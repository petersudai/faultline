# Improvement changelog

How faultline evolved, run as a **controlled ablation**: same 12 cases
(`eval/dataset/cases.jsonl`), same metrics, one capability added at a time.
Reproduce with `bash scripts/ablation.sh`; numbers below are from the committed
`results/`.

## Metrics

- **strict** — balanced accuracy, "High" = flag for blocking review
- **triage** — balanced accuracy, "High or Medium" = needs a closer look
- **recall** — of the 6 reverted PRs, how many were marked High (strict)
- **spec** — of the 6 clean PRs, how many were *not* marked High
- **RC** — root-cause hit rate on the 6 reverted PRs
- **Brier** — calibration error of the model's 0–1 risk score (lower better)
- **AUC** — ranking quality of the 0–1 risk score: P(a reverted PR scores above
  a clean one); 0.5 = chance, threshold-free
- **$/PR** — mean cost per PR (Haiku 4.5)

## Read this first: what n=12 can and cannot tell us

We re-ran the then-final config unchanged and it moved **8 points** (strict
75.0% → 66.7%, recall 67% → 50%). On a 12-case set, one case ≈ 8 pp, and Haiku's
sampling adds ±1 case of noise. So we report **ranges over seeds**, not point
estimates, and settled the deciding comparison with a **pre-registered 3-seed
gate** (`scripts/gate.sh`). The n=12 caution was warranted: the critic pass's
apparent recall win did not survive that gate — see *Removed experiments* and
`DESIGN_LOG.md` D20.

## The ablation (claude-haiku-4-5)

| # | Stage | Capability added | strict | triage | recall | spec | RC | $/PR |
|---|-------|------------------|:------:|:------:|:------:|:----:|:--:|:----:|
| 0 | **baseline — the shipped product** | one call: PR title + body + diff → findings + risk score via forced `submit_review` tool call; deterministic label | 66.7% | 75.0% | 33% | 100% | 6/6 | $0.006 |
| 1 | baseline-plus | + full text of the changed files (still one call) | 66.7% | 58.3% | 33% | 100% | 6/6 | $0.021 |
| 2 | abl-1-read † | agent loop; tools: get_diff, read_file; no verify | 50.0% | 50.0% | 17% | 83% | 5/6 | $0.051 |
| 3 | abl-2-callers † | + find_references | 58.3% | 41.7% | 17% | 100% | 2/6 | $0.041 |
| 4 | abl-3-tests † | + get_related_tests | 50.0% | 50.0% | 0% | 100% | 4/6 | $0.036 |
| 5 | **abl-4-verify — shipped `--deep`** | + separate verify pass, then the classifier | 55.6% | 50.0% | 22% | 89% | 2–3/6 | $0.041 |
| R | critic — **removed experiment** | + adversarial critic pass over the verified draft | 66.7% | 50.0% | 72% | 61% | 6/6 | $0.042 |

Rows **0, 5, R** are the pre-registered 3-seed gate (`scripts/gate.sh`, mean of
3 seeds, pooled into `results/`). Row 1 is a single `baseline-plus` run.
† rows 2–4 predate the `submit_review` reliability fix, had 0–2 JSON-parse
failures each (scored Low), and are directional only.

The shipped pipeline is **row 0** (the direct call); **row 5** is available as
`--deep` for the trajectory trace. **Row R** — the adversarial critic — failed
the gate: recall passed (+50 pp over row 5), but specificity fell 89% → 61% and
the model-score AUC (0.78 mean) swung 0.61–0.97 across the 3 seeds — level with
the direct call's 0.78 on the mean, worst seed far below. Details under *Removed
experiments*; the reversal of the earlier "second pass is the win" claim in
`DESIGN_LOG.md` D20.

## What each capability bought

- **Full files (row 1):** nothing on strict accuracy — the diff alone is enough
  once the prompt is good. Dropped from the design.
- **The investigation loop (rows 2–5):** no strict-accuracy gain over the
  baseline — worse, on the 3-seed gate (55.6% vs 66.7%) — at 5–7× the cost, and
  it *hurt* root-cause localisation (6/6 → 2–3/6) as the model spent attention
  on tool output instead of the change. `find_references` was the worst
  offender (RC 5/6 → 2/6) and is out of the default tool set.
- **The adversarial critic pass (row R):** raises recall on reverts (22% → 72%
  vs row 5) but raises clean-PR false alarms in step (specificity 89% → 61%),
  and its model-score AUC — 0.78 mean — swings 0.61–0.97 across the 3 gate
  seeds, level with the direct call's mean and worst seed far below. Failed the
  pre-registered gate; not shipped.
- **critic-only** (adversarial pass with no investigation loop) scored 50% /
  RC 2/6 — see *Removed experiments* #3.

## What the ablation showed

No single capability is a clean win.
- **The direct call (row 0) is strong** — 66.7% strict, 6/6 root-cause, AUC 0.81
  on the derived risk score (deterministic at temp 0), $0.006/PR. Forcing
  structured tool output instead of free-text JSON — same prompt — improved its
  risk-score separation (derived AUC 0.76 → 0.81, triage 66.7 → 75%): of 5
  "Medium" hedges it dropped to "Low", 3 were clean cases committing correctly
  and 2 were risky cases neither config catches (no regression). At no cost.
- **The investigation loop (rows 2–5) degrades it** — flat-to-worse on strict
  accuracy, ~6× the cost, and root-cause localisation drops (6/6 → 2–3/6) as
  attention shifts to tool output. Kept as `--deep` for the trajectory only.
- **The critic (row R) shifts the operating point, it doesn't lift the curve** —
  +39 pp recall / −39 pp specificity vs the direct call, roughly one for one,
  and its risk score ranks PRs no better than the direct call's (AUC 0.78 mean,
  level). Removed.

## Removed experiments

1. **baseline-plus** — full changed files alongside the diff. No accuracy gain;
   removed.
2. **find_references** (caller tracing) — dropped root-cause hit rate from 5/6
   to 2/6 by pulling the model off the actual change; removed from the default
   tool set (still available via `--tools`).
3. **critic-only** (adversarial pass with no investigation) — 50% / RC 2/6;
   confirmed the two parts are only useful together.
4. **adversarial critic pass** — a second reviewer that re-judges the verified
   draft finding by finding, biased against hedging to "Medium", and rewrites
   the severities and the risk score (replaces the draft, not a merge; runs
   after verify). Built as the step D17–D18 credited with the recall lift, then
   held to a **pre-registered gate** (`scripts/gate.sh`, `eval/gate.ts`): Haiku,
   12 cases, 3 seeds; pass only if the full pipeline beats *both* the direct
   call and the loop-without-critic on recall **and** ranking AUC, every seed,
   without losing more than one clean PR of specificity.

   **Result — FAIL (2 of 3).** Mean of 3 seeds (range in parens):

   | | strict acc | recall (revert→High) | specificity | AUC model | AUC derived | $/PR |
   |---|---|---|---|---|---|---|
   | direct call | 66.7% | 33% | 100% | 0.78 | 0.81 | $0.006 |
   | loop, no critic (shipped `--deep`) | 55.6% | 22% | 89% | 0.55 | 0.57 | $0.041 |
   | loop + critic | 66.7% (58–75) | **72%** (67–83) | 61% (50–67) | 0.78 (0.61–0.97) | 0.69 (0.61–0.81) | $0.042 |

   - **C1 recall — pass.** +50 pp over the loop, worst seed 67%.
   - **C2 ranking — fail.** The critic's model-score AUC (0.78 mean) no longer
     clears the ported direct call's — also 0.78, and deterministic — and its
     worst seed (0.61) sits far below it. The direct call's *derived* score is a
     fixed formula over one temperature-0 structured call: 0.81, identical
     across seeds. Not a more dependable ranker, and no longer a better one on
     average.
   - **C3 specificity — fail**, both floors: 61% mean, a clean PR flagged "High"
     on ~40% of cases.

   Measured against the shipped direct call the critic trades one for one:
   +39 pp recall, −39 pp specificity. It moves the operating point, it does not
   add discrimination. Kept in the tree, off by default; `--second-pass` (or
   `scripts/ablation.sh` row R) reproduces it.

   _Numbers are the mean of the 3 per-seed scorecards (what `scripts/gate.sh`
   prints); `results/summary.md` pools all 36 observations and lands within
   0.01._

## Cross-model check — output-format bug fixed; 1-seed probe

The first attempt stalled on reliability: the direct call emitted its answer as
free-text JSON, which Sonnet 5 wraps past what `extractJson` recovers (5/12
errored), and the Sonnet agent failed to terminate on 2–3/12. The direct call
now emits via a forced `submit_review` tool call (D21) — a 5-case Sonnet smoke
test on the previously-failing cases returned 5/5 valid reviews.

A pre-registered 1-seed Sonnet probe (`scripts/probe-sonnet.sh`, direct vs
`--deep`, `eval/probe-verdict.ts` for the decision) is the cross-model data
point. **Result: _(pending — one line, whatever the verdict; no 3-seed gate)_.**
Generalisation to a stronger model remains a **stated limitation**, not a claim.

## Main failure mode (survives the final config)

Genuinely subtle behavioural regressions where the diff *looks* equivalent.
Example: **c04** (hono #3171) removed a `navigator === undefined` guard on the
premise that `navigator` is undefined in Cloudflare Pages production — it isn't;
the PR was reverted. The change reads as a safe simplification and every
configuration, including the final one, rates it Low. Localised via the revert's
own description; the agent has no signal that the premise is false without
running the code in that environment.

## Hot take

**Forcing the one-call baseline to emit its verdict as a structured tool call
instead of free-text JSON — same prompt, zero extra cost — improved its
risk-score separation: derived-score AUC 0.76 → 0.81, triage accuracy
66.7 → 75%, and it's now deterministic at temp 0. (Of 5 "Medium" hedges it
dropped to "Low", 3 were clean cases committing correctly; the other 2 were
risky cases neither config catches — no regression.) If a small model hedges,
fix the output channel before adding machinery.** The machinery didn't earn its
keep: the investigation loop doesn't beat the direct call, and the adversarial
critic only trades specificity for recall about one for one (+39 pp / −39 pp)
while ranking PRs no better on average (AUC 0.78, worst seed 0.61, vs the direct
call's deterministic 0.78). A louder critic changes *where* you sit on the ROC
curve, not *which* curve you're on.
