# faultline — evaluation summary

_12 cases · baseline model FAKE(claude-haiku-4-5-20251001) · agent model FAKE(claude-haiku-4-5-20251001) · **FAKE LLM run (plumbing only)** · generated 2026-08-28T22:40:59.602Z_

## Headline

| metric | baseline | agent | Δ |
|--------|----------|-------|---|
| **Balanced accuracy** (primary) | 91.7% | 100.0% | +8.3 pp |
| Recall (risky caught) | 100.0% | 100.0% | — |
| Specificity (clean passed) | 83.3% | 100.0% | +16.7 pp |
| Precision | 85.7% | 100.0% | +14.3 pp |
| F1 | 92.3% | 100.0% | +7.7 pp |
| Root-cause hit rate (risky) | 6/6 (100.0%) | 6/6 (100.0%) | — |
| False-alarm rate (high/clean PR) | 0.17 | 0.00 | -0.17 |
| Hard cases correct | 1/2 | 2/2 |  |
| Mean cost / PR | $0.0000 | $0.0000 |  |
| Mean time / PR | 0.0s | 0.0s |  |

## Confusion — baseline

|              | pred High | pred not-High |
|--------------|-----------|---------------|
| **risky**    | 6 (TP) | 0 (FN) |
| **clean**    | 1 (FP) | 5 (TN) |

## Confusion — agent

|              | pred High | pred not-High |
|--------------|-----------|---------------|
| **risky**    | 6 (TP) | 0 (FN) |
| **clean**    | 0 (FP) | 6 (TN) |

## Per case

| case | label | hard | baseline | agent | root cause |
|------|-------|------|----------|-------|------------|
| c01 | risky |  | High ✓ | High ✓ | hit |
| c02 | risky |  | High ✓ | High ✓ | hit |
| c03 | risky |  | High ✓ | High ✓ | hit |
| c04 | risky |  | High ✓ | High ✓ | hit |
| c05 | risky | ★ | High ✓ | High ✓ | hit |
| c06 | risky |  | High ✓ | High ✓ | hit |
| c07 | clean |  | Low ✓ | Low ✓ | — |
| c08 | clean |  | Low ✓ | Low ✓ | — |
| c09 | clean |  | Low ✓ | Low ✓ | — |
| c10 | clean |  | Low ✓ | Low ✓ | — |
| c11 | clean | ★ | High ✗ | Low ✓ | — |
| c12 | clean |  | Low ✓ | Low ✓ | — |
