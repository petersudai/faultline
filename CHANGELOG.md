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
- **$/PR** — mean cost per PR (Haiku 4.5)

## Read this first: what n=12 can and cannot tell us

We re-ran the final config unchanged and it moved **8 points** (strict 75.0% →
66.7%, recall 67% → 50%). On a 12-case set, one case ≈ 8 pp, and Haiku's
sampling adds ±1 case of noise. So we report **ranges over 2 seeds**, not point
estimates. Anyone quoting a tight number off 12 cases — us included, first time
round — is fooling themselves. With more budget the fix is more cases and more
seeds; the direction below held across both runs, the magnitude did not pin
down.

## The ablation (claude-haiku-4-5)

| # | Stage | Capability added | strict | triage | recall | spec | RC | $/PR |
|---|-------|------------------|:------:|:------:|:------:|:----:|:--:|:----:|
| 0 | **baseline** | one call: PR title + body + diff → findings + risk score; deterministic label | 66.7% | 66.7% | 33% | 100% | 6/6 | $0.007 |
| 1 | baseline-plus | + full text of the changed files (still one call) | 66.7% | 58.3% | 33% | 100% | 6/6 | $0.021 |
| 2 | abl-1-read † | agent loop; tools: get_diff, read_file; no verify | 50.0% | 50.0% | 17% | 83% | 5/6 | $0.051 |
| 3 | abl-2-callers † | + find_references | 58.3% | 41.7% | 17% | 100% | 2/6 | $0.041 |
| 4 | abl-3-tests † | + get_related_tests | 50.0% | 50.0% | 0% | 100% | 4/6 | $0.036 |
| 5 | abl-4-verify | + separate verify pass, then the classifier | 66.7% | 58.3% | 33% | 100% | 3/6 | $0.046 |
| 6 | **agent (final)** — seed A / seed B | + **adversarial second pass** | 66.7% / 75.0% | 66.7% / 75.0% | **50% / 67%** | 83% / 83% | 4/6 / 5/6 | $0.04–0.06 |

† rows 2–4 predate the `submit_review` reliability fix and each had 0–2
JSON-parse failures (scored Low). Directional only; rows 0, 1, 5, 6 are clean.

**What survives across both seeds of the final config:**
- recall on reverted PRs **50–67%**, always above baseline's 33% and above
  abl-4's 33% (verify without the adversarial pass) — the second pass is the
  only step that lifts recall, in every run;
- specificity drops 100% → 83% (one clean PR flagged High) in every run;
- cost ~5–8× the baseline.

## What each capability bought

- **Full files (row 1):** nothing on strict accuracy — the diff alone is enough
  once the prompt is good. Dropped from the design.
- **The investigation loop (rows 2–5):** no strict-accuracy gain over the
  baseline (66.7% → 66.7%), 5–7× the cost, and it *hurt* root-cause localisation
  (6/6 → 3/6) — the model spent attention on tool output instead of the change.
  `find_references` was the worst offender (RC 5/6 → 2/6) and is off by default.
- **The adversarial second pass (row 6):** the only step that lifts recall on
  reverted PRs — 33% → 50–67% across two seeds — and the only step where the
  model's calibration improved on its best run (Brier 0.33 → 0.23; ~0.31 on the
  other seed). Cost: one clean PR flagged High (spec 100 → 83%), every run.
- **Investigation + critic is interactive, not additive.** A run with the critic
  but *no* investigation loop (`--tools get_diff --second-pass`) scored 50% /
  RC 2/6; the loop without the critic scored 66.7% / recall 33%. Each piece is
  inert alone.

## Biggest single contributor

The adversarial second pass (row 5 → 6): the only capability that raised recall
on reverted PRs in every run (+17–34 pp), at a fixed cost of one false alarm.

## Removed experiments

1. **baseline-plus** — full changed files alongside the diff. No accuracy gain;
   removed.
2. **find_references** (caller tracing) — dropped root-cause hit rate from 5/6
   to 2/6 by pulling the model off the actual change; removed from the default
   tool set (still available via `--tools`).
3. **critic-only** (adversarial pass with no investigation) — 50% / RC 2/6;
   confirmed the two parts are only useful together.

## Cross-model check — not completed

`baseline-sonnet` and `agent-sonnet` (claude-sonnet-5) hit reliability issues we
ran out of budget to fix: the baseline path emits its answer as text JSON, which
Sonnet 5 wraps in a way that defeats extraction (5/12 parse failures); the
Sonnet agent also failed to terminate on 3/12 and cost $0.12/PR. Generalisation
to a stronger model is a **stated limitation**, not a claim.

## Main failure mode (survives the final config)

Genuinely subtle behavioural regressions where the diff *looks* equivalent.
Example: **c04** (hono #3171) removed a `navigator === undefined` guard on the
premise that `navigator` is undefined in Cloudflare Pages production — it isn't;
the PR was reverted. The change reads as a safe simplification and every
configuration, including the final one, rates it Low. Localised via the revert's
own description; the agent has no signal that the premise is false without
running the code in that environment.

## Hot take

For pre-merge triage the model was never short on **information** — the plain
baseline already finds every root cause (6/6). It is short on **conviction**:
left alone it hedges every risky PR to "Medium". More tools made this *worse*.
The fix that worked was a second pass that argues with the first. **When an
agent is under-committing, add a critic, not a crawler.**
