# faultline

**Pre-merge risk triage for pull requests.** Point it at a PR; it tells you how
much careful human review the change needs and *where* to look.

```bash
faultline honojs/hono 5274            # baseline: one model call on the diff
faultline honojs/hono 5274 --agent    # agent: reads surrounding code, verifies, then rates
```

Output is a `REVIEW.md`: a risk level (High / Medium / Low), findings pinned to
`file:line` with a rationale, and a manual checklist a reviewer can work through.

---

## Who has this problem

A maintainer or lead reviewer on an active repository with more open PRs than
review time. They must decide which PRs to read slowly and which to wave through.

## The bottleneck

That decision is made by skimming. A change that *looks* small but breaks a
contract two files away gets merged, and resurfaces days later as a revert or a
hotfix. The reviewer had the information — it just wasn't in front of them.

## Why solving it is valuable

Triage puts the reviewer's scarce attention on the PRs that warrant it, and
starts each review already pointing at the risky lines. The measurable claim of
this project: **an agent that looks past the diff catches more of the changes
that later got reverted, without crying wolf on the safe ones**, versus a single
model call on the diff alone.

---

## The four questions (hackathon rubric)

| Question | Answer |
|---|---|
| Who has this problem? | Maintainers / lead reviewers triaging a PR queue. |
| What bottleneck makes it worth solving? | Skim-review merges risky changes; reverts and hotfixes are the cost. |
| Does the agent solve it well? | Measured on 12 real `honojs/hono` PRs (6 reverted, 6 clean) — see `results/summary.md`. |
| Can another person reproduce it? | `npm ci && npm run eval -- --offline` from a clean clone. See `REPRODUCTION.md`. |

## How the agent works

1. **Investigate** — a tool loop (hard cap 14 steps). Tools: `get_diff`,
   `read_file` (base or head), `find_references`, `get_related_tests`,
   `search_repo`. The model reads the diff, then checks the code the diff
   doesn't show — callers of changed symbols, other branches of touched
   conditionals, whether a test covers the new path.
2. **Verify** — a separate model pass with no tools re-checks every draft
   finding against the diff and drops the unsupported ones.
3. **Classify** — risk level is a deterministic rule over the verified findings
   (`src/review/classify.ts`), not a model guess.

Every model call and tool call is written to `trajectories/` as it happens.

## Layout

```
src/
  cli.ts              entry: faultline <owner/repo> <pr> [--agent]
  config.ts           env, model ids, pricing, hard limits
  llm/                Anthropic client (cost accounting, budget, backoff) + test double
  github/             PR metadata / diff / files (disk-cached) + shallow checkout
  repo/tools.ts       read_file / search_repo / find_references / get_related_tests
  agent/              loop.ts (investigate → verify → classify), prompts, tool defs
  baseline/run.ts     the one-call comparison point
  review/             schema (zod), deterministic classifier, Markdown renderer
eval/
  dataset/cases.jsonl 12 labelled PRs, frozen by SHA
  run.ts score.ts report.ts
```

See `CHANGELOG.md` for how the solution evolved and `SPEC.md` for the full design.
