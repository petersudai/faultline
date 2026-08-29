# Video script — faultline (target ≤ 5:00)

Numbers in **{{braces}}** are filled from the final `results/summary.md`. Timings
are a guide. Voice: plain, fast, no filler. Record the demo run first, then
narrate over it.

---

## 0:00–0:35 · The problem, and the framing

**[VISUAL]** Title card: `faultline — pre-merge risk triage`. Then a GitHub PR
list with ~20 open PRs.

**[VO]**
"Every team with more open pull requests than review time makes the same call:
which of these do I read carefully, and which do I wave through? Get it wrong and
a risky change ships, then comes back days later as a revert or a hotfix.

faultline is a triage step. But it doesn't ask a model 'is this code good' — an
opinion. It asks: *does this PR look like the ones that actually got reverted* —
and we check that answer against real revert history."

## 0:35–1:15 · The baseline

**[VISUAL]** Terminal: `npm run faultline -- honojs/hono 4707` (baseline, no
`--agent`). It prints a REVIEW.md.

**[VO]**
"The baseline is one model call: the PR title, description, and diff. Here it is
on a real hono PR that *was* later reverted. It flags some concerns — but rates
everything 'Medium'. Across all {{N}} test PRs the baseline's strict accuracy is
**{{baseline_strict}}%**: it finds issues — root-cause hit rate {{baseline_rc}} —
but it hedges instead of committing."

**[VISUAL]** Cut to `baseline-plus` row: "same call, plus the full changed
files." Point at the number.

**[VO]**
"Give that same single call the *full* changed files, not just the diff, and it
jumps to **{{plus_strict}}%**. That's our real bar — a strong model that has
read the code."

## 1:15–2:45 · One agent run, start to finish

**[VISUAL]** `npm run faultline -- honojs/hono 4707 --agent`. Let the trajectory
scroll. Highlight each phase as it happens.

**[VO]**
"Now the agent on the same PR. It starts with the diff, and sees the PR adds a
'fast path' to `c.json()` — a new way to do an existing operation. That's the
shape that gets reverted, so it does a **path comparison**: it reads the old code
and the new code" — *[VISUAL: the two `read_file` calls]* — "and finds the
divergence: the new path calls `Response.json()`, which sets
`Content-Type: application/json; charset=utf-8`; the old path set no charset.
An observable difference in a public API, with no test covering it.

Then a separate **verify** pass re-checks that finding against the diff and keeps
it. The risk label is not the model's vote — it's a fixed rule over the verified
findings."

**[VISUAL]** The final `REVIEW.md`: risk badge, the finding at `context.ts:{{line}}`,
the manual checklist, the calibrated risk score line.

**[VO]**
"Output a maintainer can act on: the risk level, the exact lines, and what to
check by hand."

## 2:45–3:45 · What actually moved the numbers

**[VISUAL]** `results/summary.md` headline table, all columns:
baseline → baseline-plus → abl-1-read → abl-2-callers → abl-3-tests →
abl-4-verify. Then the same on Sonnet.

**[VO]**
"The changelog is a controlled ablation — same {{N}} PRs, same metric, one
capability added at a time.

- Reading the surrounding code: {{delta_read}}.
- Tracing callers of a changed symbol: {{delta_callers}}.
- Test-gap detection: {{delta_tests}}.
- The verify pass: {{delta_verify}} — mostly **specificity**: it stops the agent
  crying wolf on clean PRs.

The single biggest contributor was **{{biggest}}**.

One experiment we removed: a second 'security specialist' agent merged in after
the generalist. Result: {{secondpass_result}} — no accuracy gain, more cost and
latency, because the verify pass already covered that ground. Cut."

## 3:45–4:30 · The honest finding + hot take

**[VISUAL]** Two big numbers side by side: cost/PR baseline-plus vs agent; and
the specificity + root-cause columns.

**[VO]**
"Here's what surprised us. A strong model with the full files is *most* of
triage — {{plus_strict}}% for about {{plus_cost}} per PR. The agent's reliable
wins are narrower: it never marks a clean PR 'High' — specificity
{{agent_spec}}% — it localizes the root cause {{agent_rc}}, and it leaves an
audit trail. It costs about {{cost_multiple}}× more per PR.

**Hot take:** we assumed more agent meant better. For this task, the diff + full
files was ~90% of the value at ~5% of the cost. Agentic investigation is worth
it when a wrong 'looks fine' is expensive and you need the *why*, not just the
verdict — not as a default."

## 4:30–5:00 · Reproducibility

**[VISUAL]** Fresh terminal, new directory:
`git clone … && cd faultline && npm ci && npm test && npm run eval:all`.
The summary table renders with matching numbers.

**[VO]**
"Everything's here. Twelve PRs frozen by commit SHA, every API response cached
and committed, deterministic scoring. From a clean clone: install, {{tests}}
tests pass, and `eval:all` reproduces every number in the report — no GitHub
token needed. Thanks for watching."

---

## Shot list / assets to capture

- [ ] Baseline run on #4707 (screen record, ~40 s, speed up 2×)
- [ ] Agent run on #4707 (screen record full trajectory, ~30 s at 2×; keep the
      two `read_file` calls and the verify phase legible)
- [ ] `results/summary.md` open in a viewer, scroll the headline table
- [ ] `CHANGELOG.md` ablation table
- [ ] Clean-clone reproduction (record `npm ci && npm test && npm run eval:all`)
- [ ] One still of a real hono revert PR + the "Revert" commit that followed it
