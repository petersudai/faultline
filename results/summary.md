# faultline — evaluation summary

_12 cases · baseline=claude-haiku-4-5-20251001 · baseline-plus=claude-haiku-4-5-20251001 · agent=claude-haiku-4-5-20251001 · abl-1-read=claude-haiku-4-5-20251001 · abl-2-callers=claude-haiku-4-5-20251001 · abl-3-tests=claude-haiku-4-5-20251001 · abl-4-verify=claude-haiku-4-5-20251001 · 2026-08-30T18:49:07.542Z_

## Headline

| metric | baseline † | baseline-plus | agent † | abl-1-read | abl-2-callers | abl-3-tests | abl-4-verify † |
|--------|------|------|------|------|------|------|------|
| **Bal. accuracy — strict** (High = block) | 66.7% | 66.7% | 66.7% | 50.0% | 58.3% | 50.0% | 55.6% |
| · recall (risky → High) | 33.3% | 33.3% | 72.2% | 16.7% | 16.7% | 0.0% | 22.2% |
| · specificity (clean → not-High) | 100.0% | 100.0% | 61.1% | 83.3% | 100.0% | 100.0% | 88.9% |
| **Bal. accuracy — triage** (High/Med = look closer) | 75.0% | 58.3% | 50.0% | 50.0% | 41.7% | 50.0% | 50.0% |
| · recall (risky → flagged) | 66.7% | 100.0% | 100.0% | 50.0% | 16.7% | 33.3% | 33.3% |
| · specificity (clean → Low) | 83.3% | 16.7% | 0.0% | 50.0% | 66.7% | 66.7% | 66.7% |
| Root-cause hit rate | 18/18 (100.0%) | 6/6 (100.0%) | 18/18 (100.0%) | 5/6 (83.3%) | 2/6 (33.3%) | 4/6 (66.7%) | 7/18 (38.9%) |
| False-alarm rate (high/clean PR) | 0.00 | 0.00 | 0.56 | 0.17 | 0.00 | 0.00 | 0.11 |
| Hard cases correct | 3/6 | 1/2 | 4/6 | 2/2 | 2/2 | 1/2 | 1/6 |
| Brier — model score | 0.310 | 0.281 | 0.211 | 0.336 | 0.348 | 0.281 | 0.375 |
| Brier — derived score | 0.261 | 0.198 | 0.228 | 0.372 | 0.439 | 0.372 | 0.387 |
| AUC — model score (ranking) | 0.778 | — | 0.787 | — | — | — | 0.543 |
| AUC — derived score (ranking) | 0.806 | — | 0.690 | — | — | — | 0.571 |
| Mean cost / PR | $0.0057 | $0.0211 | $0.0423 | $0.0514 | $0.0405 | $0.0362 | $0.0407 |
| Mean time / PR | 7.9s | 10.6s | 47.8s | 34.4s | 30.5s | 26.4s | 42.9s |

_† pooled over 3 seeds (rates / Brier / AUC are seed-pooled; confusion, root-cause and hard-case counts are over seeds×12)._

## Confusion — baseline

|            | pred High | pred not-High |
|------------|-----------|---------------|
| **risky**  | 6 (TP)  | 12 (FN) |
| **clean**  | 0 (FP)  | 18 (TN) |

## Confusion — baseline-plus

|            | pred High | pred not-High |
|------------|-----------|---------------|
| **risky**  | 2 (TP)  | 4 (FN) |
| **clean**  | 0 (FP)  | 6 (TN) |

## Confusion — agent

|            | pred High | pred not-High |
|------------|-----------|---------------|
| **risky**  | 13 (TP)  | 5 (FN) |
| **clean**  | 7 (FP)  | 11 (TN) |

## Confusion — abl-1-read

|            | pred High | pred not-High |
|------------|-----------|---------------|
| **risky**  | 1 (TP)  | 5 (FN) |
| **clean**  | 1 (FP)  | 5 (TN) |

## Confusion — abl-2-callers

|            | pred High | pred not-High |
|------------|-----------|---------------|
| **risky**  | 1 (TP)  | 5 (FN) |
| **clean**  | 0 (FP)  | 6 (TN) |

## Confusion — abl-3-tests

|            | pred High | pred not-High |
|------------|-----------|---------------|
| **risky**  | 0 (TP)  | 6 (FN) |
| **clean**  | 0 (FP)  | 6 (TN) |

## Confusion — abl-4-verify

|            | pred High | pred not-High |
|------------|-----------|---------------|
| **risky**  | 4 (TP)  | 14 (FN) |
| **clean**  | 2 (FP)  | 16 (TN) |

## Calibration — model score (agent)

_A well-calibrated score has observed revert rate ≈ mean score in each row._

| score range | n | mean score | observed revert rate |
|-------------|---|-----------|----------------------|
| 0.0–0.2 | 9 | 0.15 | 0.22 |
| 0.2–0.4 | 16 | 0.32 | 0.50 |
| 0.6–0.8 | 10 | 0.70 | 0.70 |
| 0.8–1.0 | 1 | 0.80 | 1.00 |

## Per case

| case | label | hard | baseline | baseline-plus | agent | abl-1-read | abl-2-callers | abl-3-tests | abl-4-verify | root cause |
|------|-------|------|----|----|----|----|----|----|----|------------|
| c01 | risky |  | Low ✗ | Medium ✗ | Medium ✗ | Low ✗ | Low ✗ | Medium ✗ | Low ✗ | hit |
| c02 | risky |  | High ✓ | Medium ✗ | High ✓ | Medium ✗ | Low ✗ | Low ✗ | High ✓ | hit |
| c03 | risky |  | Medium ✗ | Medium ✗ | Medium ✗ | Medium ✗ | Low ✗ | Low ✗ | Low ✗ | hit |
| c04 | risky |  | Medium ✗ | High ✓ | High ✓ | Low ✗ | Low ✗ | Low ✗ | Low ✗ | hit |
| c05 | risky | ★ | Low ✗ | Medium ✗ | High ✓ | High ✓ | High ✓ | Low ✗ | Medium ✗ | hit |
| c06 | risky |  | High ✓ | High ✓ | High ✓ | Low ✗ | Low ✗ | Medium ✗ | Low ✗ | hit |
| c07 | clean |  | Low ✓ | Medium ✓ | Medium ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
| c08 | clean |  | Low ✓ | Low ✓ | Medium ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
| c09 | clean |  | Low ✓ | Medium ✓ | Medium ✓ | High ✗ | Low ✓ | Low ✓ | Low ✓ | — |
| c10 | clean |  | Low ✓ | Medium ✓ | High ✗ | Medium ✓ | Medium ✓ | Medium ✓ | Medium ✓ | — |
| c11 | clean | ★ | Medium ✓ | Medium ✓ | High ✗ | Medium ✓ | Medium ✓ | Medium ✓ | High ✗ | — |
| c12 | clean |  | Low ✓ | Medium ✓ | High ✗ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
| c01 | risky |  | Low ✗ | Medium ✗ | Medium ✗ | Low ✗ | Low ✗ | Medium ✗ | Low ✗ | hit |
| c02 | risky |  | High ✓ | Medium ✗ | High ✓ | Medium ✗ | Low ✗ | Low ✗ | High ✓ | hit |
| c03 | risky |  | Medium ✗ | Medium ✗ | Medium ✗ | Medium ✗ | Low ✗ | Low ✗ | Low ✗ | hit |
| c04 | risky |  | Medium ✗ | High ✓ | High ✓ | Low ✗ | Low ✗ | Low ✗ | Low ✗ | hit |
| c05 | risky | ★ | Low ✗ | Medium ✗ | High ✓ | High ✓ | High ✓ | Low ✗ | Medium ✗ | hit |
| c06 | risky |  | High ✓ | High ✓ | High ✓ | Low ✗ | Low ✗ | Medium ✗ | Low ✗ | hit |
| c07 | clean |  | Low ✓ | Medium ✓ | Medium ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
| c08 | clean |  | Low ✓ | Low ✓ | Medium ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
| c09 | clean |  | Low ✓ | Medium ✓ | Medium ✓ | High ✗ | Low ✓ | Low ✓ | Low ✓ | — |
| c10 | clean |  | Low ✓ | Medium ✓ | High ✗ | Medium ✓ | Medium ✓ | Medium ✓ | Medium ✓ | — |
| c11 | clean | ★ | Medium ✓ | Medium ✓ | High ✗ | Medium ✓ | Medium ✓ | Medium ✓ | High ✗ | — |
| c12 | clean |  | Low ✓ | Medium ✓ | High ✗ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
| c01 | risky |  | Low ✗ | Medium ✗ | Medium ✗ | Low ✗ | Low ✗ | Medium ✗ | Low ✗ | hit |
| c02 | risky |  | High ✓ | Medium ✗ | High ✓ | Medium ✗ | Low ✗ | Low ✗ | High ✓ | hit |
| c03 | risky |  | Medium ✗ | Medium ✗ | Medium ✗ | Medium ✗ | Low ✗ | Low ✗ | Low ✗ | hit |
| c04 | risky |  | Medium ✗ | High ✓ | High ✓ | Low ✗ | Low ✗ | Low ✗ | Low ✗ | hit |
| c05 | risky | ★ | Low ✗ | Medium ✗ | High ✓ | High ✓ | High ✓ | Low ✗ | Medium ✗ | hit |
| c06 | risky |  | High ✓ | High ✓ | High ✓ | Low ✗ | Low ✗ | Medium ✗ | Low ✗ | hit |
| c07 | clean |  | Low ✓ | Medium ✓ | Medium ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
| c08 | clean |  | Low ✓ | Low ✓ | Medium ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
| c09 | clean |  | Low ✓ | Medium ✓ | Medium ✓ | High ✗ | Low ✓ | Low ✓ | Low ✓ | — |
| c10 | clean |  | Low ✓ | Medium ✓ | High ✗ | Medium ✓ | Medium ✓ | Medium ✓ | Medium ✓ | — |
| c11 | clean | ★ | Medium ✓ | Medium ✓ | High ✗ | Medium ✓ | Medium ✓ | Medium ✓ | High ✗ | — |
| c12 | clean |  | Low ✓ | Medium ✓ | High ✗ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
