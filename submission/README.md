# Submission index — faultline

micro1 Agentic Workflows Hackathon. The four required items:

| # | Item | Where |
|---|------|-------|
| 1 | Complete solution code + improvement changelog | this repo (`src/`, `eval/`) + [`../CHANGELOG.md`](../CHANGELOG.md) |
| 2 | Reproduction guide | [`../REPRODUCTION.md`](../REPRODUCTION.md) |
| 3 | Solution video (≤5 min) | link in the HackerEarth submission; script: [`../VIDEO_SCRIPT.md`](../VIDEO_SCRIPT.md) |
| 4 | Agent trajectories | [`trajectories/`](trajectories/) (below) |

Supporting: [`../SPEC.md`](../SPEC.md) (full design), [`../DESIGN_LOG.md`](../DESIGN_LOG.md)
(every decision, its tradeoffs, and its measured effect), [`RESULTS.md`](RESULTS.md)
(a snapshot of `results/summary.md`).

## The one-paragraph version

faultline decides how much human review a pull request needs before merging, and
is scored against **which PRs actually got reverted** — 12 merged `honojs/hono`
PRs, 6 later reverted, 6 that stuck, frozen by commit SHA. A single engineered
model call is a strong baseline (finds every root cause). Wrapping it in a
tool-driven investigation loop did **not** improve accuracy and hurt localisation.
The one step that lifted recall on reverted PRs (33% → 50–67% across two seeds)
was a second, adversarially-framed review pass. **The model wasn't short on
information — it was short on conviction; the fix was a critic, not a crawler.**

## Trajectories (item 4)

Each folder has the human-readable `TRAJECTORY.md`, the raw `trajectory.jsonl`
step stream, and the final `review.json`. All from one run of the final config
(`agent-2026-08-291553`, claude-haiku-4-5): investigate → verify → adversarial
pass → deterministic classify.

- **`c01-risky-caught/`** — hono #4707 (a fast-path added to `c.json()`, later
  reverted). The agent reads the old and new code, traces the fast-path
  conditions, notices `Response.json()` sets a different content-type than the
  old path, and rates it **High**. This is the pipeline working.
- **`c07-clean-passed/`** — a clean PR. The agent investigates and correctly
  returns **Low, no findings** — it does not manufacture concerns.
- **`c04-risky-missed/`** — hono #3171 (removed a `navigator === undefined`
  guard on a false premise; reverted). Every configuration, including this one,
  rates it **Low**: the change reads as a safe simplification and the agent has
  no signal that the premise is wrong without running the code in Cloudflare
  Pages. This is the documented main failure mode.

The three system prompts driving these agents are in
[`../src/agent/prompts.ts`](../src/agent/prompts.ts); the verifier and
adversarial-pass prompts are `VERIFIER_SYSTEM` and `SECOND_PASS_SYSTEM`.

> Coding-agent (Claude Code) transcripts for *building* faultline are provided
> separately in the HackerEarth submission per the disclosure requirement.
