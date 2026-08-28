# Faultline — Full Specification

> PR review triage agent for the micro1 Agentic Workflows Hackathon.
> Status: **spec frozen, pre-build**. Change this doc before changing scope.

---

## 1. Problem, user, value

**User.** A maintainer or lead reviewer on an active code repository who faces a
queue of open pull requests and has limited review time.

**Bottleneck.** Deciding *which* PRs need slow, careful human review and *what
specifically* to scrutinise in each. Under time pressure the reviewer skims,
a risky change slips through, and it surfaces later as a production regression —
which the project records as a revert or a named hotfix.

**What Faultline produces.** A triage review per PR:

1. an overall **merge-risk classification** (High / Medium / Low),
2. **specific findings** localised to `file:line` with a rationale,
3. a **manual checklist** — the exact things a human should verify before merging.

**Value.** The reviewer spends their scarce attention on the PRs that warrant it,
and starts each review already pointed at the risky lines.

**Explicit non-goals (PDF ground rules 4 & 5).** Faultline never merges, never
approves, never posts to GitHub. Output is advisory. A human makes the merge
decision. All repository access is read-only.

---

## 2. Baseline (the fair comparison)

**Baseline = a single LLM call.** Input: PR title + body + the raw unified diff.
Prompt: "You are a senior reviewer. Assess merge risk (High/Medium/Low) and list
concerns with file and line." Output parsed into the **same `Review` schema** the
agent uses, rendered by the **same renderer**, scored by the **same harness** on
the **same cases**.

This is the PDF's suggested baseline ("one direct prompt with basic
instructions"). It is fair: identical model, task, output contract, and eval set.
The only thing it lacks is tools, repository context, and verification — which is
precisely the contribution we are measuring.

---

## 3. Advanced solution — the agent

Design rule (PDF): *purposeful choices beat number of components.* Every
capability below earns its place with an expected, measured effect.

### 3.1 Tools (all read-only)

| Tool | Signature | Purpose |
|---|---|---|
| `get_pr_metadata` | `() -> {title, body, author, baseSha, headSha, labels, linkedIssues, fileCount, additions, deletions, commits}` | Frame the change |
| `list_changed_files` | `() -> [{path, status, additions, deletions}]` | Decide where to look |
| `get_diff` | `(path?) -> string` | Per-file diff; never dump a huge whole-PR diff into context |
| `read_file` | `(path, ref: "base"｜"head") -> string` | See what the diff does **not** show; windowed around changed hunks for large files |
| `find_references` | `(symbol) -> [{path, line, snippet}]` | Catch "changed a signature / contract, didn't update callers" — a common revert cause |
| `get_related_tests` | `(path) -> [{path}]` | Locate tests plausibly covering a changed file (basename / `__tests__` / `.test.` / `.spec.`) |
| `search_repo` | `(query) -> [{path, line, snippet}]` | ripgrep across the checked-out repo at base ref |

No tool performs a write, a network call (other than the GitHub API behind
`get_*`), or a shell command beyond `git`/`rg` in the cache dir.

### 3.2 Control flow

A single agent, five phases:

1. **Plan** — summarise the change; enumerate what to investigate (which files
   matter, which symbols to trace, which tests to check).
2. **Investigate** — bounded tool loop (hard cap: 14 steps). Read changed files
   in full at `head`, trace callers of changed symbols at `base`, check for
   covering tests. Append observations to a run scratchpad.
3. **Draft** — emit structured findings: `{severity, file, line, category,
   rationale, suggestedCheck}`.
4. **Verify** — a separate pass with a fresh view of the diff. For each finding:
   is it real, is the line correct, is it already handled elsewhere? Unsupported
   findings are dropped. (PDF: "verification can catch errors before they reach
   the user.")
5. **Classify** — overall risk is a **deterministic function** of the verified
   findings, not an LLM guess:
   - any `severity=high` → **High**
   - else ≥2 `severity=medium` → **Medium**
   - else → **Low**

### 3.3 Memory

Per-run scratchpad only (findings + observations carried across phases). No
cross-run memory — the task is one PR at a time and does not benefit from it.
Stated explicitly so the "why this design" story is honest.

### 3.4 Deliberately excluded

- **Multi-agent orchestration.** One agent + a verify pass is sufficient for a
  single PR. More agents = more failure surface and cost with no measured gain.
  This becomes the *removed experiment* the PDF asks for (§8).

---

## 4. Output artifacts

Per PR the CLI writes two files to `out/<owner>-<repo>-<pr>/`:

- **`REVIEW.md`** — human-facing. Risk header, 2–3 sentence summary, findings
  grouped by severity with `file:line` and a `→ Check:` line each, then a
  `## Manual checklist` of `- [ ]` items. Quality bar: a maintainer would paste
  it into the PR thread unedited.
- **`review.json`** — the validated `Review` object, for the eval harness.

---

## 5. Evaluation

### 5.1 Dataset — `eval/dataset/cases.jsonl`

12 cases (target; 8 acceptable floor), each:

```json
{
  "id": "c01",
  "repo": "owner/name",
  "pr": 12345,
  "baseSha": "…",
  "headSha": "…",
  "label": "risky | clean",
  "evidence": "reverted in #12401" | "hotfix abc1234 references this" | "untouched 90d",
  "rootCauseHint": "null not handled in parseConfig",
  "rootCauseFiles": ["src/config/parse.ts"]
}
```

- **risky (6):** the PR was reverted, or received a named follow-up fix / was
  referenced by a bug issue within ~14 days of merge.
- **clean (6):** comparable size and area, no follow-up, untouched ≥60 days.
- **1 designated hard case:** looks scary (large, many files) but was clean, or
  looks trivial but was risky.
- Frozen by commit SHA — reproducible permanently even as the repo moves on.
- **Repo choice:** one large, active project that squash-merges and writes
  `Revert` / `Fixes #` messages, in **TypeScript/JavaScript** (so
  `find_references`, the test heuristics, and the model's code understanding are
  all strongest). Selected during a time-boxed 90-minute assembly pass.

### 5.2 Metrics — same cases for baseline and agent

| Metric | Definition | Why it matters |
|---|---|---|
| **Risk accuracy** *(primary)* | correct **High vs. not-High** on the risky/clean split; reported as balanced accuracy + confusion matrix | objective, user-meaningful |
| Root-cause hit rate | for risky cases: did any finding name a `rootCauseFile` **and** describe the real issue (keyword check vs. `rootCauseHint`) | measures usefulness, not just the label |
| False-alarm rate | High-severity findings per **clean** PR | reviewer trust; crying wolf is a real failure mode |
| Cost / PR | USD, from token accounting | PDF cost row |
| Wall time / PR | seconds | PDF time row |

Scoring is **pure deterministic code** in `eval/score.ts`. Borderline
root-cause matches are logged to `results/manual-review.md` for explicit human
confirmation — documented, never silently resolved.

### 5.3 Runner

```
npm run eval -- --mode baseline            # all cases
npm run eval -- --mode agent               # all cases
npm run eval -- --mode agent --cases c01,c02   # cheap iteration
```

Writes `results/<mode>.json` and appends a table to `results/summary.md`.

---

## 6. Architecture

### 6.1 Layout

```
faultline/
  package.json  tsconfig.json  .nvmrc  .env.example  .gitignore
  README.md  REPRODUCTION.md  CHANGELOG.md  SPEC.md
  src/
    cli.ts               # `faultline <owner/repo> <pr>` → writes REVIEW.md + review.json
    config.ts            # env parsing, model ids, pricing table, hard limits
    logging.ts           # structured run logger → trajectories/
    github/
      client.ts          # Octokit wrapper: metadata, diff, files (cached)
      checkout.ts        # partial clone + fetch base/head into .cache/repos/
      cache.ts           # read-through disk cache keyed by (repo, sha, kind, arg)
    repo/
      tools.ts           # read_file / search_repo / find_references / get_related_tests
    llm/
      anthropic.ts       # thin client: token+cost accounting, retry/backoff, timeout
      types.ts
    agent/
      loop.ts            # plan → investigate → draft → verify → classify
      prompts.ts         # one prompt per phase
      toolDefs.ts        # JSON schemas + dispatch to github/ and repo/
      classify.ts        # deterministic risk rule
    review/
      schema.ts          # zod: Finding, Review
      render.ts          # Review → REVIEW.md (pure)
    baseline/
      run.ts             # single call → Review (same schema + renderer)
  eval/
    dataset/cases.jsonl
    run.ts               # orchestrates baseline|agent over cases, concurrency-limited
    score.ts             # deterministic metrics
    report.ts            # results → summary.md
  trajectories/          # captured agent logs (deliverable #4)
  results/               # eval outputs; final copies committed
  out/                   # per-PR review artifacts (gitignored)
  .cache/                # gh responses, repo checkouts, tool results (12-case cache committed)
```

### 6.2 Engineering principles (followed, not just stated)

- **Determinism where it counts.** LLM temperature 0. Risk classification is a
  rule. Dataset frozen by SHA. Eval scoring is pure code. The only nondeterminism
  is LLM free-text, averaged over N cases.
- **Separation of concerns.** `llm/` knows nothing about PRs. `repo/` and
  `github/` know nothing about the agent loop. `render.ts` is pure. Baseline and
  agent **share** the `Review` schema and renderer → the comparison cannot be
  gamed by output formatting.
- **Schema-first.** `zod` schemas for `Finding` / `Review`; any run that fails to
  produce a valid `Review` fails loudly with the validation error. Tool inputs
  validated against their JSON schema before dispatch.
- **Observability is the deliverable.** Every LLM call and tool call is written
  to `trajectories/<runId>/<caseId>/NNN-<kind>.json` with inputs, outputs,
  token counts, latency, and (for tools) the raw result. Deliverable #4 falls out
  of this for free.
- **Cost & rate safety.** Central per-run token budget with a hard abort ceiling.
  Exponential backoff on HTTP 429/529. Per-call timeout (60 s). `--cases` subset
  and Haiku default keep iteration cheap.
- **Reproducibility.** Exact-pinned dependencies, Node version in `.nvmrc` and
  `engines`, every input pinned by SHA. `.cache/` for the 12 eval cases is
  **committed**, and `--offline` replays GitHub + tool results purely from it —
  so reproducing the eval needs only `ANTHROPIC_API_KEY`, no GitHub token, no
  network to GitHub. `faultline --dry-run` validates setup and spends nothing.
- **Fail fast, legible errors.** Missing key, missing token, bad PR ref, network
  failure → one actionable line, non-zero exit. No stack-trace vomit.
- **No side effects.** Never writes to GitHub. Repo checkout is read-only under
  `.cache/`. Nothing outside the project dir is touched.

### 6.3 Pipeline efficiency

- **Checkout once per repo**, not per case: `.cache/repos/<repo>@<baseSha>`,
  reused across cases from the same repo (the dataset is one repo by design).
- **Read-through cache** for all GitHub responses and all tool results, keyed by
  `(repo, sha, kind, arg)`. `--offline` = cache only.
- **Concurrency-limited eval** (default 3 cases in flight) — fast without
  tripping rate limits. Tool calls *within* one review are sequential (the agent
  reasons between them).
- **Context discipline.** Whole-PR diff is never inlined above ~400 lines; the
  agent pulls per file. `read_file` returns a line window around changed hunks
  for large files.
- **Model tiering.** `FAULTLINE_MODEL` env. Default `claude-haiku-4-5` for
  development; `claude-sonnet-5` for scored runs. Baseline and agent always use
  the **same** model within a run.

---

## 7. Reproduction contract (`REPRODUCTION.md` will contain)

1. `nvm use` (Node version from `.nvmrc`), `npm ci`.
2. `cp .env.example .env`, add `ANTHROPIC_API_KEY`.
3. `npm run eval -- --mode baseline --offline` → expect summary table ≈ *[numbers]*.
4. `npm run eval -- --mode agent --offline` → expect summary table ≈ *[numbers]*.
5. `npm run report` → regenerates `results/summary.md`.
6. Single PR demo: `npm run faultline -- <owner/repo> <pr>` (needs `GITHUB_TOKEN`).
7. Stated: approximate runtime and USD cost for each command; model used.

---

## 8. Improvement changelog — planned experiments

Each is one `CHANGELOG.md` entry with before/after numbers on the same cases.

| Stage | Change | Expected effect |
|---|---|---|
| Baseline | single call, raw diff | establish starting numbers |
| Iter 1 | agent + `read_file` full head context | fewer misses on issues invisible in the diff |
| Iter 2 | + `find_references` caller tracing | catches signature / contract breaks |
| Iter 3 | + `get_related_tests` test-gap detection | better on "new branch, no coverage" |
| Iter 4 | + verification pass | false-alarm rate down, precision up |
| Iter 5 | + deterministic classifier (replaces LLM risk guess) | accuracy variance down, consistent labels |
| Removed | + second "security specialist" agent | no measured gain, +cost, +latency → removed; lesson recorded |
| Final | combination that scored best | identify the single biggest contributor |

Close `CHANGELOG.md` with the main failure mode observed and the **hot take**
(one failure mode → one practical lesson for building reliable agents).

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Dataset assembly overruns | Hard 90-min box; 8 cases (4/4) is an acceptable floor |
| Agent too slow / costly per PR | 14-step cap, Haiku for iteration, context windowing |
| Ground-truth noise (a "clean" PR was subtly buggy) | Precise written selection criteria; SHA-frozen + auditable; report disagreements honestly |
| Repo language mismatch | Restrict dataset to a TS/JS repo |
| Time crunch on deliverables | Video + repro guide have fixed day-3 slots, not "if time remains" |
| API throttling on the $20 plan for the *build* | Sonnet-high default in Claude Code; API-credit fallback documented |

---

## 10. Timeline (now Aug 29 → deadline ~Aug 31 15:00 UTC)

| Block | When | Output |
|---|---|---|
| 1 | Aug 29 eve (~6h) | scaffold, `llm/` + logging, `github/` + checkout, `repo/tools`, `Review` schema + renderer, `baseline/run`. Smoke-test baseline on one real PR. |
| 2 | Aug 30 AM (~4h) | assemble 12-case dataset (90-min box), `eval/run` + `score` + `report`, first baseline eval numbers. |
| 3 | Aug 30 PM (~6h) | agent `loop.ts`; run experiments Iter 1→5, updating `CHANGELOG.md` with measured deltas; capture trajectories. |
| 4 | Aug 31 AM (~5h) | freeze code; `README.md` + `REPRODUCTION.md`; final Sonnet eval for headline table; removed experiment; hot take. |
| 5 | Aug 31 midday (~3h) | record + cut ≤5-min video; assemble `trajectories/`; reproducibility check on a fresh clone; submit with buffer. |

---

## 11. Open decisions (need input before / during build)

- **Project name.** ~~`mergeguard`~~ → **`faultline`** (locked).
- **Target repo for the dataset.** Chosen during Block 2 against the §5.1 criteria; candidates to be shortlisted then.
- **`GITHUB_TOKEN`.** You'll need a read-only PAT for live single-PR runs and for Block 2 assembly. Judges won't (committed `.cache/` + `--offline`).
