# faultline

**Pre-merge risk triage for pull requests.** Point it at a PR; it tells you how
much careful human review the change needs, and where to look — scored against
which PRs *actually got reverted*.

```bash
faultline honojs/hono 4707            # baseline: one model call
faultline honojs/hono 4707 --agent    # full pipeline: investigate → verify → adversarial pass
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

n=12, 2 seeds. One case ≈ 8 pp, so we report ranges — see `CHANGELOG.md`.

| config (Haiku 4.5, 12 cases) | strict acc | recall on reverts | $/PR |
|---|---|---|---|
| baseline — one engineered call | 66.7% | 33% | $0.007 |
| + investigation loop (read code, trace callers, check tests) | 66.7% | 33% | $0.046 |
| **+ adversarial second pass** | 66.7–75.0% | **50–67%** | $0.04–0.06 |

**The investigation loop did not improve accuracy** — it cost 5–7× and *hurt*
root-cause localisation (6/6 → 3/6). The one step that lifted recall on reverted
PRs in *every* run was a second review pass, framed adversarially ("what did the
first pass miss, how bad is it really") — at a fixed cost of one false alarm on
a clean PR.

**Hot take:** for triage the model was never short on information — the plain
baseline finds every root cause. It is short on *conviction*. More tools made it
worse. The fix was a critic, not a crawler. See `CHANGELOG.md` for the full
ablation (and an honest note on n=12 variance) and `DESIGN_LOG.md` for every
decision and its cost.

## The final pipeline (`--agent`)

1. **Investigate** — a bounded tool loop (get_diff, read_file at base/head,
   get_related_tests; 8-step cap). Gathers context; kept for the localisation
   and the audit trail, not for the accuracy.
2. **Verify** — a no-tools pass that drops findings not supported by the diff.
3. **Adversarial pass** — a second reviewer that challenges the findings and
   forces a committed severity. *This is the step that matters.*
4. **Classify** — risk level is a deterministic rule over the surviving
   findings (`src/review/classify.ts`), never the model's vote. A separate 0–1
   score is scored for calibration.

Every model and tool call is written to `trajectories/` as it happens.

## Reproduce

```bash
npm ci
npm test                              # 24 unit tests
npm run preflight                     # 12/12 cases resolve from the committed cache
cp .env.example .env                  # add ANTHROPIC_API_KEY (no GitHub token needed offline)
npm run eval:all                      # baseline + agent + report, from cache
```

Full steps, expected numbers, runtime and cost: `REPRODUCTION.md`.

## Layout

```
src/
  cli.ts            faultline <owner/repo> <pr> [--agent]
  agent/loop.ts     investigate → verify → adversarial pass → classify
  agent/prompts.ts  the three system prompts
  baseline/run.ts   the one-call comparison point
  review/           schema (zod), deterministic classifier, Markdown renderer
  llm/, github/, repo/   client (caching, cost), PR data + cache, file tools
eval/
  dataset/cases.jsonl   12 labelled PRs, frozen by SHA
  run.ts score.ts report.ts
scripts/ablation.sh     reproduces the CHANGELOG table
```
