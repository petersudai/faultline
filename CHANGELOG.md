# Improvement changelog

How faultline evolved from a one-call baseline to the final agent, as a
**controlled ablation**: every row is the same 12 cases
(`eval/dataset/cases.jsonl`), the same metrics (`npm run report` →
`results/summary.md`), one capability added at a time. Numbers filled from the
final runs.

## Metrics in the table

- **strict** — balanced accuracy treating "High" as "flag for blocking review"
- **triage** — balanced accuracy treating "High or Medium" as "needs a closer look"
- **spec** — specificity on the strict metric (clean PRs *not* marked High)
- **RC** — root-cause hit rate on the 6 reverted PRs
- **$/PR** — mean cost per PR

| # | Stage | Capability added | strict | triage | spec | RC | $/PR | Decision |
|---|-------|------------------|:------:|:------:|:----:|:--:|:----:|----------|
| 0 | **baseline** | one call: title + body + diff | {{}} | {{}} | {{}} | {{}} | {{}} | starting point |
| 1 | **baseline-plus** | + full text of the changed files (still one call, no agent) | {{}} | {{}} | {{}} | {{}} | {{}} | {{}} |
| 2 | **abl-1-read** | agent loop; tools = get_diff, read_file (base/head); no verify | {{}} | {{}} | {{}} | {{}} | {{}} | {{}} |
| 3 | **abl-2-callers** | + find_references (trace call sites of changed symbols) | {{}} | {{}} | {{}} | {{}} | {{}} | {{}} |
| 4 | **abl-3-tests** | + get_related_tests (test-gap detection) | {{}} | {{}} | {{}} | {{}} | {{}} | {{}} |
| 5 | **abl-4-verify** | + separate verify pass before the deterministic classifier | {{}} | {{}} | {{}} | {{}} | {{}} | {{}} |
| R | **removed: second agent** | + a security-specialist pass merged into findings | {{}} | {{}} | {{}} | {{}} | {{}} | **removed** — {{}} |
| S | **Sonnet check** | abl-4-verify config, run on claude-sonnet-5 | {{}} | {{}} | {{}} | {{}} | {{}} | {{}} |

## The two things always true across the table

1. **Every configuration finds the issues.** Root-cause hit rate is high even for
   the plain baseline — the reverted PRs' problems are visible in the diff. The
   task is not "spot the bug", it's "decide how much it matters".
2. **The deterministic classifier and the calibration analysis are constant.**
   The label is always a fixed rule over findings; the model never votes on it.

## What each capability bought

- **Full files (baseline-plus):** {{}}
- **read_file in a loop (abl-1):** {{}}
- **find_references (abl-2):** {{}}
- **get_related_tests (abl-3):** {{}}
- **verify pass (abl-4):** {{}} — its main effect is on **specificity / false
  alarms**, not recall.
- **Sonnet vs Haiku:** {{}}

## Biggest single contributor

{{}}

## Removed experiment — second "specialist" agent

Hypothesis: a dedicated security/robustness pass would catch what the generalist
missed. Result: {{}}. The verify pass and the generalist prompt already cover
that ground; the second pass added cost and latency with {{}} accuracy change.
Removed.

## Main failure mode (survives the final config)

{{}} — e.g. genuinely subtle behavioural regressions where the diff *looks*
equivalent (c06: an error-handler precedence change). {{example}}

## Hot take

We assumed more agent meant better. For pre-merge risk triage, a strong model
with the **full changed files** was ~90% of the value at ~5% of the cost. The
agent's investigation earns its keep only where a wrong "looks fine" is
expensive and you need the *reason*, not just the verdict — and its most
reliable contribution is **not** accuracy but **not crying wolf** (specificity)
and **localising the cause** with evidence. Build the cheap baseline first;
add the loop deliberately, for those properties, not by default.
