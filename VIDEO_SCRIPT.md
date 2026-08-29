# Video script — faultline (target ≤ 5:00)

Voice: plain, fast, no filler. Record the two demo runs first, then narrate over
them. Every number below is in `results/summary.md` / `CHANGELOG.md`.

---

## 0:00–0:30 · The problem, and the framing

**[VISUAL]** A GitHub PR queue, ~20 open.

**[VO]** "Every team with more open pull requests than review time makes the
same call: which do I read carefully, which do I wave through? Get it wrong and
a risky change ships, then comes back as a revert.

faultline is a triage step. It doesn't ask a model 'is this code good' — an
opinion. It asks whether a PR *looks like the ones that actually got reverted* —
and every number I'll show is checked against real revert history: twelve merged
Hono PRs, six later reverted, six that stuck, frozen by commit SHA."

## 0:30–1:10 · The baseline

**[VISUAL]** `npm run faultline -- honojs/hono 4707` (no `--agent`). REVIEW.md prints.

**[VO]** "The baseline is one model call — title, description, diff. On this PR,
which *was* reverted, it flags concerns but rates everything 'Medium'. Across all
twelve it scores 67% balanced accuracy. Here's the important part: its
root-cause hit rate is 6 out of 6. It *finds* every real problem. It just won't
commit — it hedges to Medium instead of High."

## 1:10–2:40 · One agent run, start to finish

**[VISUAL]** `npm run faultline -- honojs/hono 4707 --agent`. Let the trajectory
scroll; keep the base-vs-head `read_file` calls and the second-pass phase legible.

**[VO]** "Now the full pipeline on the same PR. It sees the change adds a 'fast
path' to `c.json()` — a new way to do an existing operation, which is the shape
that gets reverted. So it does a path comparison: reads the old code and the new
code" — *[VISUAL: the two read_file calls]* — "and finds it: the new path calls
`Response.json()`, which sets `Content-Type: application/json; charset=utf-8`;
the old path set no charset. An observable API difference, no test covering it.

A verify pass keeps that finding. Then a second reviewer" — *[VISUAL: the
second-pass phase]* — "challenges it adversarially — 'how bad is this really' —
and that's what pushes the label from Medium to **High**. The risk level itself
is a fixed rule over the findings, not the model's vote."

**[VISUAL]** Final REVIEW.md: High badge, finding at `context.ts:712`, checklist,
the `risk score: model / derived` line.

## 2:40–3:40 · What actually moved the numbers

**[VISUAL]** `CHANGELOG.md` ablation table on screen.

**[VO]** "This is a controlled ablation — same twelve PRs, one capability added
at a time.

- Feeding the model the full changed files instead of just the diff: no change.
- The whole investigation loop — reading code, tracing callers, checking tests:
  **no accuracy gain over the baseline**, five to seven times the cost, and it
  made root-cause localisation *worse*. Tracing callers was the worst — it
  pulled the model off the actual change.
- The one thing that helped was the adversarial second pass. Recall on reverted
  PRs went from 33% to between 50 and 67%.

Between 50 and 67 — because when I re-ran the exact same config, it moved eight
points. Twelve cases, cheap model: one case *is* eight points. So I report the
range, not a number I can't defend. More cases and more seeds is the fix I
didn't have budget for.

One experiment I removed: the second pass *without* the investigation loop —
50%, back to baseline. The two only work together: the loop gathers the context,
the critic makes the model act on it."

## 3:40–4:25 · The honest finding + hot take

**[VO]** "So — the model was never short on *information*. The plain baseline
finds every root cause. It's short on *conviction*: left alone it hedges every
risky PR to Medium. And more tools made that worse, not better.

**Hot take: when an agent is under-committing, add a critic, not a crawler.**

The failure that survives: subtle regressions where the diff *looks* equivalent.
One reverted PR removed a `navigator === undefined` check on a false premise —
every configuration, including the final one, calls it safe, because you can't
see the premise is wrong without running the code in that environment."

## 4:25–5:00 · Reproducibility

**[VISUAL]** Fresh terminal, new directory: `git clone … && npm ci && npm test
&& npm run eval:all`. Summary table renders.

**[VO]** "All of it reproduces. Twelve PRs frozen by SHA, every API response
cached and committed, deterministic scoring, 24 unit tests. From a clean clone:
install, test, and `eval:all` rebuilds every number — no GitHub token needed.
Thanks for watching."

---

## Shot list

- [ ] `faultline honojs/hono 4707` (baseline) — screen record, ~40 s, 2× speed
- [ ] `faultline honojs/hono 4707 --agent` — full trajectory; keep base/head
      read_file + second-pass phase readable
- [ ] `CHANGELOG.md` ablation table (scroll)
- [ ] `results/summary.md` headline table
- [ ] fresh-clone `npm ci && npm test && npm run eval:all`
- [ ] a still of hono #4707 + the "Revert #4707" PR that followed it
