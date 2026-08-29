# Design log

A running record of every non-trivial decision: the options, the choice, the
tradeoff accepted, and the effect once measured. Source material for
`CHANGELOG.md`, the reproduction guide, and the video script.

Legend: **Effect** is filled in once a run exists; until then it's a hypothesis.

---

## D1 — Problem choice: pre-merge risk triage, scored against revert history

**Options.** (A) PR review triage — rate merge risk, localise concerns.
(B) Release-notes generation from merged PRs. (C) JD↔CV fit report.

**Choice.** A.

**Why.** It is built from things a web developer already knows (diffs, GitHub,
call graphs); it sits in micro1's stated zone of interest (their reference
example #1 is "is this repository actually good?"); and — the deciding factor —
its correctness can be checked against an **objective label that already exists
in the wild**: a PR that was later *reverted* is a PR that should have been
flagged. No hand-grading, no invented rubric.

**Tradeoff.** "AI reviews PRs" is the most common agent demo, so the concept
reads as generic. We accept that and win on rigour: a real labelled set,
deterministic scoring, and a controlled ablation (see D8).

**Effect.** TBD.

---

## D2 — Baseline definition: one model call on the diff

**Options.** (A) One prompt, title + body + raw diff. (B) A general-purpose
agent with basic tools. (C) The manual process (a human skims the diff).

**Choice.** A, and later *also* a second baseline (D9).

**Why.** The hackathon brief names "one direct prompt with basic instructions" as
a fair baseline. It shares the exact output contract, renderer, and scorer with
the agent, so the only variable is the agentic machinery.

**Tradeoff.** A single call on the diff is a *weak* baseline — which risks making
the improvement look inflated. D9 adds a stronger one to control for that.

**Effect.** TBD.

---

## D3 — Deterministic risk label, not a model vote

**Options.** (A) Ask the model for "High/Medium/Low" directly. (B) Compute the
label from the verified findings with a fixed rule.

**Choice.** B. `any high → High; any medium → Medium; else Low`
(`src/review/classify.ts`).

**Why.** The label is what a reviewer acts on, so it must be consistent
run-to-run and explainable ("High because finding #2 is high-severity"). Letting
the model name the label directly reintroduces the variance we are trying to
remove, and makes the number un-auditable.

**Tradeoff.** The rule is blunt — a single medium finding forces "Medium" even if
context makes it benign. Mitigated by the verify pass (D6) pruning weak findings
before the rule runs. Tunable in one place if the eval shows over-flagging.

**Effect.** TBD.

---

## D4 — Five read-only tools, no writes, no shell beyond git

**Tools.** `get_diff`, `read_file` (base|head), `find_references`,
`get_related_tests`, `search_repo`.

**Why.** These cover the questions that decide a triage: *what changed* (diff),
*what the diff doesn't show* (read_file at head), *who else is affected*
(find_references), *is it tested* (get_related_tests). All read-only — the tool
can never mutate a repo or hit the network beyond the GitHub API. Matches
ground rule 4 (consequential actions stay sandboxed).

**Tradeoff.** No type-checker, no test *execution*, no LSP. The agent reasons
about callers from text, not a real call graph, so it can miss dynamic dispatch.
Accepted: running a foreign repo's toolchain per PR is slow, fragile, and a
security surface. Text-level investigation is enough for triage.

**Effect.** TBD — the ablation (D8) measures how much each tool contributes.

---

## D5 — Windows CRLF bug in the tool layer *(fixed pre-launch)*

**What happened.** `git` on Windows emits `\r\n`. The tools split on `"\n"`,
leaving a trailing `\r` that broke every `$`-anchored regex — `git grep` parsing
and `get_related_tests` both silently returned nothing.

**Fix.** Split on `/\r?\n/` everywhere; rewrote `get_related_tests` with a
sensible priority (sibling `<name>.test.ts` > same-dir for generic names like
`index.ts` > basename match). Verified against four real hono paths.

**Lesson (candidate hot take).** An agent whose tools fail *silently* is worse
than one with no tools — it investigates, gets empty results, and concludes
"nothing to see". Tool failures must be loud. This shaped D10 (findings whose
file can't be resolved are pruned and logged, not trusted).

---

## D6 — Separate verify pass before the label

**Choice.** After the investigator drafts findings, a second model call with no
tools re-checks each finding against the diff and drops the unsupported ones.
Then the deterministic rule runs on what survives.

**Why.** Precision matters more than recall for triage — a false alarm that
reaches a human costs their trust and trains them to ignore the tool. A cheap
dedicated pass whose only job is "is this defensible?" should raise specificity.

**Tradeoff.** One extra model call per PR (~15–20% more cost) and a risk the
verifier over-prunes and drops a real issue. Measured as its own ablation row.

**Effect.** TBD.

---

## D7 — Prompt design: severity rubric + "most PRs are fine"

**Choice.** The system prompt defines high/medium/low concretely (high = "would
plausibly break production or a documented contract as-is"), forbids style/nit
findings, tells the model most PRs are safe and an empty findings list is a
correct answer, and caps effort at 4–7 tool calls.

**Why.** Severity drives the label (D3), so an uncalibrated notion of "high"
poisons the primary metric. The "most PRs are fine" framing counteracts the
strong prior LLMs have toward finding *something* to say.

**Tradeoff.** Telling the model to relax could suppress real issues on subtle
PRs. The dataset is 50/50 risky/clean specifically to catch that failure in
both directions.

**Effect.** TBD.

---

## D8 — The changelog is a controlled ablation, by design

**Choice.** Each `CHANGELOG.md` row adds exactly one capability
(read_file → find_references → get_related_tests → verify → deterministic
classifier), measured on the same 12 cases with the same metric. One row
*removes* a capability that didn't help (D-R).

**Why.** The 30-point "Agent Solution & Engineering" criterion asks "which
design choices helped the agent?" An ablation answers that with data instead of
a narrative. It also tells *us* what to keep.

**Tradeoff.** More eval runs (≈5 Haiku passes over 12 cases ≈ $4–5). Worth it —
it is the core evidence.

**Effect.** TBD — this is where the headline improvement number comes from.

---

## D9 — Second baseline: diff + full changed files, still no agent

**Choice.** A `baseline-plus` mode: one model call, same prompt, but the full
content of every changed file (at head) is included alongside the diff. No
tools, no loop, no verify.

**Why.** Pre-empts the obvious critique of D2 — "your agent just has more
context than the baseline, that isn't an agentic win." With `baseline-plus` we
can decompose the improvement: *context alone* buys X, *agentic investigation +
verification* buys a further Y on top. The 15-point "Measured Improvement"
criterion is explicitly about tying each gain to evidence.

**Tradeoff.** A third eval column and ~$0.50 more spend. Cheap insurance on the
credibility of the headline number.

**Effect.** TBD.

---

## D10 — Calibrated risk score alongside the label

**Choice.** Every review carries two 0–1 scores in addition to the High/Med/Low
label:
- `modelRiskScore` — the model states its own probability that this PR will need
  a revert or hotfix.
- `derivedRiskScore` — a fixed formula over the findings:
  `1 − ∏(1 − w)` with `w = {high: 0.55, medium: 0.25, low: 0.05}`.

Scoring adds **Brier score** for each and a **calibration table** (bucket
predictions, show the observed revert rate per bucket).

**Why.** The hackathon brief explicitly names calibration as a valid primary
metric ("a forecasting team may focus on calibration"). Almost no entrant will
measure it. It costs **zero extra eval spend** — the same runs, scored richer —
and it produces a real finding either way: if `modelRiskScore` is well
calibrated, that's a strong result; if it's overconfident (the likely outcome),
that *is* the hot take, and `derivedRiskScore` from the mechanical aggregation
is the more trustworthy signal.

**Tradeoff.** The label stays primary; calibration is a secondary analysis, not
the headline. Extra ~1h of scoring code. A model asked for a probability may
anchor on round numbers (0.5, 0.8) — the calibration table will show that.

**Effect.** TBD.

---

## D-R — Removed experiment: a second "specialist" agent

**Choice.** Built but expected to be removed. After the generalist investigation,
a second model call as a "security & robustness specialist" adds findings the
generalist missed; they're merged (deduped) before verify.

**Hypothesis.** No measurable accuracy gain, higher cost and latency, more false
alarms — because the verify pass and the generalist prompt already cover the
same ground. The brief asks for one experiment we tried and dropped; this is it.

**Effect.** TBD.

---

## D11 — Shake-out run (hono #4707, agent, Haiku) — findings

First live run of the full loop. It worked end to end (10 tool calls →
verify → classify → render, real checkout, calibration score emitted). Two
problems surfaced, both worth fixing before any at-scale spend:

**P1 — cost per PR is 2× the estimate.** $0.225 for one small PR (1 file,
+14−6): **213 K input tokens** across 10 tool calls. The agent loop re-sends the
whole growing transcript every turn, and nothing is cached. At this rate a
12-case agent eval is ~$2.70 and five ablation passes ~$13.50 — the entire
budget, before Sonnet.
→ **Fix (D12): prompt caching + tighter loop.**

**P2 — it marked a reverted PR "Low".** On c01 — our headline example — the
agent reproduced the original author's reasoning ("only affects the common case,
backward compatible") and missed the subtlety that got it reverted (the
`Response.json()` fast path diverges from `#newResponse()` on content-type
handling). This is a genuine signal about task difficulty, not necessarily a
bug: the baseline will likely miss it too, and the improvement story is
"catches *more* than the baseline", not "catches everything". Watch whether
Haiku is systematically too shallow — if so, the agent may need Sonnet even
though the baseline stays on Haiku (a fair-comparison question to resolve
explicitly).

---

## D12 — Prompt caching + loop tightening (response to P1)

**Choice.**
- Mark the system prompt and tool definitions with `cache_control` (they are
  byte-identical every call).
- Put a moving `cache_control` breakpoint on the last message each turn, so
  turn N reads turns 1…N−1 from cache instead of re-billing them.
- Cache-aware cost: bill `cache_read` at 0.1× and `cache_creation` at 1.25×
  input rate, from `usage.cache_*` fields.
- Lower default `agentMaxSteps` 14 → 8; strengthen the "4–6 calls" language;
  the investigator is told which files it has already read so it stops
  re-reading them.

**Why.** In an agent loop the stable prefix dominates the token bill. Caching it
is the standard fix and typically cuts input cost 70–90%. The step cut removes
the long tail of low-value calls Haiku was making on a one-file diff.

**Tradeoff.** Caching adds a 5-minute TTL dependency (fine — a single review
finishes in <60 s) and a small write premium on the first call. Fewer steps
could miss something on a large PR; mitigated by keeping the hard cap reachable
via `--max-steps`.

**Effect (measured).** hono #4707 agent run: **$0.225 → $0.064** (−72%). Regular
input tokens 213 K → 6.6 K; the rest served from cache at 0.1×. 10 → 8 tool
calls. Projected full budget now ~$12 of $15.

Bonus: the tighter, cache-cheaper run also flagged the real root cause
(content-type divergence in the fast path) as **Medium** — the first run found
nothing. Severity was under-rated (should arguably be High for a reverted PR);
whether to loosen the "high" bar or accept "Medium = correctly routed to a
human" is an open tuning question for the ablation. Note also: two runs at
temperature 0 produced different tool-call sequences and different findings —
single-run noise is real; decide during the eval whether to average 2 seeds.

---

## D13 — Baseline result (Haiku, 12 cases): the model hedges

| metric | baseline |
|---|---|
| balanced accuracy | 58.3% |
| recall (reverted → High) | 16.7% (1/6) |
| specificity (clean → not-High) | 100% |
| root-cause hit rate | **6/6** |
| Brier (model score) | 0.316 |
| cost (12 cases) | $0.072 |

**Reading.** The baseline *identifies* the real problems — root-cause 6/6, and
its findings land on the right files — but it rates almost everything **Medium**
and its self-reported risk score sits near 0.15 regardless of outcome. Under the
strict "High vs not-High" metric that is near-random.

**Consequence for the thesis.** The improvement we need from the agent is not
"find more issues" (the baseline already finds them) — it is **investigate
enough to commit**: turn the Medium hedge into a defensible High on the genuinely
risky PRs and a clean Low on the safe ones. That is exactly what tools +
verification are for, so the ablation should show it.

**Open question flagged.** If the agent also hedges, the honest fix may be to
report a second framing — {High, Medium} vs Low ("needs more than a glance") —
alongside the strict one. Decide after seeing the agent numbers; do not add
metrics to flatter a weak result.

---

## D14 — First agent run was *worse* than the baseline; two causes

**Raw numbers, full 12-case agent run (Haiku, all tools + verify):**
almost every case → **Low, 0 findings**. recall ≈ 0. Strictly worse than
baseline-plus (66.7%).

**Cause 1 — a broken tool starved the investigator.** `read_file` only windowed
around `around:[...]` when the file exceeded the max-line cap. For a 779-line
file (under the 1600 cap) it dumped the whole file, which the 14 K tool-result
clip then truncated at ~line 450 — so every `read_file(around:[710])` returned
the file header, not the code. The agent burned 3–5 calls fighting this and
never saw the method it was reviewing.
→ **Fix:** `around` is now *always* honoured (window regardless of size);
whole-file cap 1600 → 450; tool-result clip 14 K → 22 K. Verified: a windowed
read of `context.ts` now returns the fast-path code in 3.7 K chars.

**Cause 2 — the loop found weak findings and the verifier killed them.** With
the tool fixed, the investigator still (a) spent most of its 8-step budget
rummaging in the test file for coverage instead of comparing old vs new
behaviour, and (b) produced a weak proxy finding ("`Response.json()` is a
recent API") instead of the real divergence (charset in the content-type). The
verifier — told "DROP is the default, be strict" — then correctly dropped the
weak finding, leaving nothing.
→ **Fix (iterating):** investigator prompt restructured around an explicit
**path-comparison** step as the primary lens for "PR changes how X is done"
(the common revert shape); test-coverage demoted to one optional late call.
`agentMaxSteps` 8 → 11. Verifier softened: keep any finding naming a concrete
behavioural difference / un-updated caller / missing test even if the fix is
uncertain; drop only clearly-wrong or intent-restating findings.

**Note for the write-up.** This is the ablation working as intended — it caught
that "more agent" was initially *negative* and forced a design fix. The
standalone shake-out on the same PR *did* find the charset issue, so Haiku is
capable but inconsistent; if the probe still misses it, the agent moves to
Sonnet while the baseline is also re-run on Sonnet for a fair final comparison
(Haiku numbers kept as a "cheap-model" secondary point).

---

## D15 — Sonnet probe + the pivot to the real thesis

**Sonnet agent probe (4 cases):** c01 → **High ✓** (Haiku said Medium),
c06 → Medium (still hedged), c07 → Low ✓, c11 → Medium. Strict bal.acc 75% vs
Haiku-agent ~50% vs baseline-plus-Haiku 67%. Root-cause 2/2. **Cost: $0.35 per
case** (21 tool calls, 166 s on c01) — a full 12-case Sonnet agent run is ~$4.2.

**What the numbers actually say.** Feeding a capable model the diff *plus the
full changed files* (baseline-plus) already does most of triage: 67% strict,
6/6 root-cause, ~$0.02/PR. The agent loop adds real cost (10–20×) and, on the
strict "block the merge?" metric, only a modest accuracy gain that needs the
expensive model to show up at all.

**The pivot (chosen with the user).** Stop chasing "agent >> baseline on raw
accuracy" — the data doesn't support it and the budget can't fund the search.
Report the honest finding instead:

> A strong model with the full changed files is a hard baseline for PR-risk
> triage. Agentic investigation buys three things it does *not*: (a) it does not
> cry wolf — specificity stays at 100% on the strict metric where the baseline
> leaks; (b) it localises the root cause with evidence a reviewer can act on
> (root-cause hit rate); (c) it leaves a readable audit trail (the trajectory).
> It costs 15–20× more per PR. Here is exactly which parts of the machinery earn
> that cost, and when the trade is worth it.

This fits the rubric ("improvement in reliability / engineering quality"), gives
a genuine hot take ("we assumed more agent = better; diff+files was ~90 % of the
value at ~5 % of the cost"), and keeps the ablation meaningful — it now measures
*which capability drives (a)/(b)/(c)*, not a raw-accuracy race.

**Plan.** Haiku ablation (6 configs, `scripts/ablation.sh`) for the
capability-contribution evidence; one Sonnet pair (baseline-plus + full agent)
for the "holds on a strong model" data point; frame improvement as
triage-metric accuracy + specificity + explanation quality with honest cost
accounting. Vite holdout cut for budget.

---

## D16 — Haiku ablation result + the reliability bug

**Full Haiku ablation (12 cases each):**

| config | strict | triage | RC | $/PR | errors |
|---|---|---|---|---|---|
| baseline (one engineered call) | **66.7%** | **66.7%** | 6/6 | $0.007 | 0 |
| baseline-plus (+ full files) | 66.7% | 58.3% | 6/6 | $0.021 | 0 |
| abl-1-read | 50.0% | 50.0% | 5/6 | $0.051 | 0 |
| abl-2-callers | 58.3% | 41.7% | 2/6 | $0.041 | 1* |
| abl-3-tests | 50.0% | 50.0% | 4/6 | $0.036 | 2* |
| abl-4-verify (full) | 50.0% | 33.3% | 2/6 | $0.019 | 4* |

\* JSON-parse failures — see the reliability bug below; abl-4 was re-run clean.

**Reading.** On Haiku the tool loop is *net-negative*: it investigates, then
argues itself into "looks fine". Every agent config is worse than the plain
baseline on strict accuracy, worse on triage recall, worse on root-cause
localisation, and 3–7× the cost. Adding the full changed files to the baseline
(`baseline-plus`) also does *not* help once the prompt is good — the diff alone
was enough. So neither "more context" nor "more agent" is the lever on a cheap
model; the lever is the model's willingness to *commit* to a label.

**Reliability bug (D-fix).** ~1/3 of agent cases errored with "no parseable JSON
in model response" — Haiku could not reliably emit a bare JSON object as its
final turn after a long tool-use transcript. Fix: the agent now finishes by
**calling a `submit_review` tool** whose typed input *is* the assessment; the
text-JSON parse is kept only as a fallback. Re-probe on the 4 previously-failing
cases: **0 errors**, and the numbers rose (subset strict 50% → 66.7%). The
failures had been deflating every agent row — but not enough to change the
conclusion that the agent ≈ / < baseline on Haiku.

**Decision (with the user):** spend the rest on the Sonnet crossover check
(`baseline-sonnet` + `agent-sonnet`, 12 cases) plus a clean Haiku `abl-4` and
the removed-experiment row, keeping a $2.5 buffer. Write up honestly whichever
way Sonnet lands.

---

## D17 — The result flips: the pass we planned to remove is the win

Clean Haiku runs (0 errors), 12 cases:

| config | strict | recall | spec | triage | RC | Brier(model) | $/PR |
|---|---|---|---|---|---|---|---|
| baseline (one engineered call) | 66.7% | 33% | 100% | 66.7% | 6/6 | 0.303 | $0.007 |
| + investigation loop (read/callers/tests/verify) | 66.7% | 33% | 100% | 58.3% | 3/6 | 0.330 | $0.046 |
| **+ adversarial second pass** | **75.0%** | **66.7%** | 83.3% | **75.0%** | 5/6 | **0.227** | $0.038 |

**Finding.** Wrapping the baseline in a tool-driven investigation loop does not
improve triage accuracy (flat), costs 7×, and *degrades* root-cause
localisation (6/6 → 3/6 — the model spends attention on tool output instead of
the change). The single change that helps is a second review pass, framed
adversarially ("what did the first pass miss, how bad is it *really*"). It
**doubles recall on reverted PRs (33 → 67%)**, lifts strict balanced accuracy to
75%, and — notably — *improves calibration* (Brier 0.30 → 0.23). Cost: one
false alarm on a clean PR (spec 100 → 83%) and ~$0.04/PR.

**Mechanism / hot take.** For triage the model is not short on *information* —
the plain baseline already finds every root cause (6/6). It is short on
*conviction*: left alone it hedges everything to "Medium". A second pass that
argues with the first is what breaks the hedge. The lesson: when an agent is
under-committing, add a critic, not more tools.

**Removed experiments (honest).**
- `baseline-plus` — feeding the model the full changed files on top of the diff:
  no accuracy gain over the diff alone once the prompt is good; dropped.
- `find_references` (caller tracing): root-cause hit rate fell 5/6 → 2/6 — it
  pulled the model off the actual change; dropped from the default tool set.

**Sonnet check — inconclusive, bug-contaminated.** `baseline-sonnet` hit 5/12
JSON-parse failures (the baseline emits JSON as text; Sonnet 5 wraps it);
`agent-sonnet` hit 3/12 "never submitted" and cost $0.12/PR. Hardened
`extractJson` (try every balanced object, longest first) and re-ran
`baseline-sonnet`; did not pursue `agent-sonnet` further — the Haiku result was
already a positive, and the budget was spent. Cross-model generalisation is
named as a limitation, not claimed.

## D18 — n=12 variance caught us; report ranges

Re-ran the winning config (`abl-R-second`) unchanged as `agent`. It dropped
8 points: strict 75.0% → 66.7%, recall 67% → 50%, RC 5/6 → 4/6, Brier 0.23 →
0.31. Same code, same 12 cases, same model — Haiku's sampling swings one case,
and one case is 8 pp here. The "75%" in D17 was one lucky seed.

**Correction to the claims.** What holds across both seeds:
- the adversarial second pass raises recall on reverted PRs (33% → 50–67%) in
  every run, and is the *only* step that does (abl-4-verify, the same pipeline
  without it, stays at 33%);
- it costs exactly one clean-PR false alarm (spec 100% → 83%) every run;
- cost ~5–8× the baseline.
What does **not** hold: a specific strict-accuracy number, or the calibration
improvement (0.23 was the good seed; 0.31 the other).

**This is a finding, not an embarrassment.** A 12-case eval on a cheap model
cannot support a tight point estimate. The honest report is a direction plus a
range plus "more cases / more seeds is the fix we didn't have budget for". That
rigor is worth more than a flattering single number.

**Final config (shipped):** baseline prompt → investigation loop (get_diff,
read_file, get_related_tests; 8-step cap) → verify pass → **adversarial second
pass** → deterministic classifier + calibrated score. The loop is kept for the
localisation and the audit trail; the accuracy comes from the second pass.

---

## Metrics glossary (for the video and methodology guide)

| Metric | Meaning | Why it's the right one |
|---|---|---|
| **Balanced accuracy** (primary) | mean of recall (risky caught) and specificity (clean passed) | the classes are both important and the real-world base rate is skewed; plain accuracy would reward a "flag nothing" model |
| Recall | of the reverted PRs, how many we marked High | missing a revert is the expensive error |
| Specificity | of the clean PRs, how many we left as not-High | crying wolf trains reviewers to ignore the tool |
| Root-cause hit rate | of risky PRs, how often a finding named the file that actually broke *and* described the real issue | measures usefulness, not just the label |
| False-alarm rate | mean High-severity findings per clean PR | reviewer-trust proxy |
| Brier score (model / derived) | mean squared error of the 0–1 risk score vs the 0/1 outcome | lower = better calibrated; compares the model's self-estimate to the mechanical one |
| Cost / time per PR | USD and seconds | the brief's efficiency rows; triage has to be cheap to be worth running |

## Video beats (accumulating)

1. The hook: "We don't ask an LLM if code is good. We ask whether a PR looks
   like the ones that got reverted — and we check that answer against history."
2. Show one real reverted PR (c01, hono #4707) and the baseline missing it.
3. Show the agent investigating: reads the diff, traces `#useFastPath` callers,
   checks the test file, flags it High with the right file:line.
4. The ablation table: which capability moved the number, which didn't (D-R).
5. Calibration: the model's confidence vs. reality — the hot take.
6. Reproducibility: `git clone && npm ci && npm run eval:all --offline`.
