# faultline — evaluation summary

_12 cases · baseline=claude-haiku-4-5-20251001 · baseline-plus=claude-haiku-4-5-20251001 · agent=claude-haiku-4-5-20251001 · abl-1-read=claude-haiku-4-5-20251001 · abl-2-callers=claude-haiku-4-5-20251001 · abl-3-tests=claude-haiku-4-5-20251001 · abl-4-verify=claude-haiku-4-5-20251001 · abl-R-second=claude-haiku-4-5-20251001 · 2026-08-29T15:57:26.333Z_

## Headline

| metric | baseline | baseline-plus | agent | abl-1-read | abl-2-callers | abl-3-tests | abl-4-verify | abl-R-second |
|--------|------|------|------|------|------|------|------|------|
| **Bal. accuracy — strict** (High = block) | 66.7% | 66.7% | 66.7% | 50.0% | 58.3% | 50.0% | 66.7% | 75.0% |
| · recall (risky → High) | 33.3% | 33.3% | 50.0% | 16.7% | 16.7% | 0.0% | 33.3% | 66.7% |
| · specificity (clean → not-High) | 100.0% | 100.0% | 83.3% | 83.3% | 100.0% | 100.0% | 100.0% | 83.3% |
| **Bal. accuracy — triage** (High/Med = look closer) | 66.7% | 58.3% | 66.7% | 50.0% | 41.7% | 50.0% | 58.3% | 75.0% |
| · recall (risky → flagged) | 100.0% | 100.0% | 66.7% | 50.0% | 16.7% | 33.3% | 50.0% | 83.3% |
| · specificity (clean → Low) | 33.3% | 16.7% | 66.7% | 50.0% | 66.7% | 66.7% | 66.7% | 66.7% |
| Root-cause hit rate | 6/6 (100.0%) | 6/6 (100.0%) | 4/6 (66.7%) | 5/6 (83.3%) | 2/6 (33.3%) | 4/6 (66.7%) | 3/6 (50.0%) | 5/6 (83.3%) |
| False-alarm rate (high/clean PR) | 0.00 | 0.00 | 0.33 | 0.17 | 0.00 | 0.00 | 0.00 | 0.33 |
| Hard cases correct | 1/2 | 1/2 | 1/2 | 2/2 | 2/2 | 1/2 | 2/2 | 1/2 |
| Brier — model score | 0.303 | 0.281 | 0.308 | 0.336 | 0.348 | 0.281 | 0.330 | 0.227 |
| Brier — derived score | 0.194 | 0.198 | 0.280 | 0.372 | 0.439 | 0.372 | 0.340 | 0.219 |
| Mean cost / PR | $0.0068 | $0.0211 | $0.0605 | $0.0514 | $0.0405 | $0.0362 | $0.0462 | $0.0383 |
| Mean time / PR | 9.0s | 10.6s | 47.3s | 34.4s | 30.5s | 26.4s | 39.4s | 45.8s |

## Confusion — baseline

|            | pred High | pred not-High |
|------------|-----------|---------------|
| **risky**  | 2 (TP)  | 4 (FN) |
| **clean**  | 0 (FP)  | 6 (TN) |

## Confusion — baseline-plus

|            | pred High | pred not-High |
|------------|-----------|---------------|
| **risky**  | 2 (TP)  | 4 (FN) |
| **clean**  | 0 (FP)  | 6 (TN) |

## Confusion — agent

|            | pred High | pred not-High |
|------------|-----------|---------------|
| **risky**  | 3 (TP)  | 3 (FN) |
| **clean**  | 1 (FP)  | 5 (TN) |

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
| **risky**  | 2 (TP)  | 4 (FN) |
| **clean**  | 0 (FP)  | 6 (TN) |

## Confusion — abl-R-second

|            | pred High | pred not-High |
|------------|-----------|---------------|
| **risky**  | 4 (TP)  | 2 (FN) |
| **clean**  | 1 (FP)  | 5 (TN) |

## Calibration — model score (agent)

_A well-calibrated score has observed revert rate ≈ mean score in each row._

| score range | n | mean score | observed revert rate |
|-------------|---|-----------|----------------------|
| 0.0–0.2 | 6 | 0.05 | 0.33 |
| 0.2–0.4 | 3 | 0.34 | 0.67 |
| 0.4–0.6 | 1 | 0.45 | 1.00 |
| 0.6–0.8 | 2 | 0.64 | 0.50 |

## Per case

| case | label | hard | baseline | baseline-plus | agent | abl-1-read | abl-2-callers | abl-3-tests | abl-4-verify | abl-R-second | root cause |
|------|-------|------|----|----|----|----|----|----|----|----|------------|
| c01 | risky |  | Medium ✗ | Medium ✗ | High ✓ | Low ✗ | Low ✗ | Medium ✗ | Medium ✗ | High ✓ | hit |
| c02 | risky |  | High ✓ | Medium ✗ | Medium ✗ | Medium ✗ | Low ✗ | Low ✗ | Low ✗ | High ✓ | hit |
| c03 | risky |  | Medium ✗ | Medium ✗ | Low ✗ | Medium ✗ | Low ✗ | Low ✗ | Low ✗ | Low ✗ | hit |
| c04 | risky |  | Medium ✗ | High ✓ | Low ✗ | Low ✗ | Low ✗ | Low ✗ | Low ✗ | Medium ✗ | hit |
| c05 | risky | ★ | Medium ✗ | Medium ✗ | High ✓ | High ✓ | High ✓ | Low ✗ | High ✓ | High ✓ | hit |
| c06 | risky |  | High ✓ | High ✓ | High ✓ | Low ✗ | Low ✗ | Medium ✗ | High ✓ | High ✓ | hit |
| c07 | clean |  | Medium ✓ | Medium ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
| c08 | clean |  | Low ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
| c09 | clean |  | Medium ✓ | Medium ✓ | Low ✓ | High ✗ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
| c10 | clean |  | Medium ✓ | Medium ✓ | Medium ✓ | Medium ✓ | Medium ✓ | Medium ✓ | Medium ✓ | Medium ✓ | — |
| c11 | clean | ★ | Medium ✓ | Medium ✓ | High ✗ | Medium ✓ | Medium ✓ | Medium ✓ | Medium ✓ | High ✗ | — |
| c12 | clean |  | Low ✓ | Medium ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | Low ✓ | — |
