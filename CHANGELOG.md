# Improvement changelog

The story of how faultline went from a one-call baseline to the final agent.
Every row is measured on the **same 12 cases** (`eval/dataset/cases.jsonl`) with
the **same metric** (`npm run report` → `results/summary.md`). Numbers are filled
in as each experiment runs.

| # | Stage | What was tried, and why | Evidence | Decision |
|---|-------|--------------------------|----------|----------|
| 0 | **Baseline** | One model call: PR title + body + raw diff → risk + findings. The "one direct prompt with basic instructions" comparison point. | bal.acc _[TBD]_ · root-cause _[TBD]_ · false-alarm _[TBD]_ | starting point |
| 1 | + read the surrounding code | Give the investigator `read_file` (base + head) so it can see what the diff omits — other branches, full function bodies. Hypothesis: fewer missed risky PRs where the bug isn't visible in the hunk. | _[TBD]_ | _[TBD]_ |
| 2 | + trace callers | Add `find_references`. Signature/contract changes with un-updated callers are a top revert cause. | _[TBD]_ | _[TBD]_ |
| 3 | + test-gap check | Add `get_related_tests`. Hypothesis: better on "new branch, no coverage". | _[TBD]_ | _[TBD]_ |
| 4 | + verify pass | A second no-tools model call re-checks each finding against the diff and drops unsupported ones. Hypothesis: false-alarm rate down, specificity up. | _[TBD]_ | _[TBD]_ |
| 5 | deterministic classifier | Replace "model picks the risk label" with a rule over verified findings (`classify.ts`). Hypothesis: consistent labels, less run-to-run variance. | _[TBD]_ | _[TBD]_ |
| R | **removed:** second reviewer agent | Tried a separate "security specialist" agent merged into the findings. | _[TBD]_ | expected: removed — cost/latency up, no measurable gain |
| F | **Final** | The combination that scored best. | _[TBD]_ | biggest single contributor: _[TBD]_ |

## Main failure mode

_[TBD — the one that survived: where the agent is still wrong, with an example case.]_

## Hot take

_[TBD — one observed failure mode turned into a rule for building reliable agents.]_
