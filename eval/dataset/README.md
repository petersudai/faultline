# Evaluation dataset

12 merged pull requests from [`honojs/hono`](https://github.com/honojs/hono),
frozen by commit SHA. 6 **risky**, 6 **clean**.

## How labels were assigned (objective, from project history)

**risky** — the PR was merged and then **reverted** by a later merged PR. The
revert is the project itself declaring the change bad. Several also closed a
named regression issue. No subjective "how bad was it" judgement is involved.

| id  | PR    | reverted by | also closed |
|-----|-------|-------------|-------------|
| c01 | #4707 | #4757       | —           |
| c02 | #4198 | #4200       | —           |
| c03 | #3498 | #3515       | issue #3512 |
| c04 | #3171 | #3173       | —           |
| c05 | #1560 | #1586       | issue #1584 |
| c06 | #871  | #872        | —           |

**clean** — a merged PR from Jan–Feb 2025 (>60 days old, well clear of any
follow-up window) for which a search of all later issues/PRs referencing its
number finds **no** revert, regression, "broke", or "reverts" mention.

| id  | PR    | area-paired with |
|-----|-------|------------------|
| c07 | #3800 | c01 (context)        |
| c08 | #3849 | c03 (factory types)  |
| c09 | #3885 | c04 (adapter)        |
| c10 | #3832 | c02 (etag middleware)|
| c11 | #3888 | c05 (core routing)   |
| c12 | #3833 | — (compress)         |

## Design choices

- **Area pairing.** Each clean case changes the same file/area as a risky case,
  so a classifier cannot score well just by learning "touches `context.ts` ⇒
  risky". The signal has to come from the change itself.
- **Size spread on both sides.** Risky ranges from 1 file / +14−6 (c01) to
  9 files / +126−85 (c05); clean ranges similarly. Size alone is not predictive.
- **Two designated hard cases** (`"hard": true`):
  - **c05** — a `feat` PR with tests, "Resolves #1531", 9 files: *looks* careful
    and was still reverted for a routing regression.
  - **c11** — 6 files of router internals, +138 lines: *looks* dangerous and
    held up fine.
- **Single repo, one language (TypeScript).** Keeps the checkout small for
  judges and keeps `find_references` / test-heuristics in a language the model
  reads well.

## `rootCauseFiles` / `rootCauseHint`

Present for risky cases only. Derived from the revert PR's diff and description.
Used by `eval/score.ts` for the *root-cause hit rate* secondary metric — a
finding counts as a hit if it names a `rootCauseFile` **and** its rationale
overlaps the hint's keywords. Borderline matches are logged for manual
confirmation, never auto-resolved.

## Reproducing the raw inputs

Every PR's metadata, file list, and diff for these 12 cases is committed under
`.cache/gh/`. `npm run eval -- --offline` reads only from there — no GitHub
token or network required. To rebuild the cache from scratch:
`npm run eval -- --mode baseline` (online, needs `GITHUB_TOKEN`).
