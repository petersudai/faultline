import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, MODELS } from "../src/config.js";
import { GithubClient } from "../src/github/client.js";
import { ensureCheckout } from "../src/github/checkout.js";
import { runBaseline } from "../src/baseline/run.js";
import { runAgent } from "../src/agent/loop.js";
import { LlmClient } from "../src/llm/anthropic.js";
import { FakeLlm } from "../src/llm/fake.js";
import { RunLogger } from "../src/logging.js";
import { renderReview } from "../src/review/render.js";
import { type Review as TReview } from "../src/review/schema.js";
import { loadCases, type Case } from "./cases.js";
import { scoreAll } from "./score.js";
import { writeRunResult, regenerateSummary, type RunResult } from "./report.js";

interface Args {
  mode: "baseline" | "agent";
  offline: boolean;
  fake: boolean;
  preflight: boolean;
  ids: string[] | undefined;
  model: string;
  concurrency: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const val = (flag: string): string | undefined => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const has = (flag: string) => a.includes(flag);
  const modeRaw = val("--mode") ?? "baseline";
  if (modeRaw !== "baseline" && modeRaw !== "agent") {
    throw new Error(`--mode must be baseline|agent, got ${modeRaw}`);
  }
  return {
    mode: modeRaw,
    offline: has("--offline"),
    fake: has("--fake"),
    preflight: has("--preflight"),
    ids: val("--cases")?.split(",").map((s) => s.trim()).filter(Boolean),
    model: val("--model") ?? process.env.FAULTLINE_MODEL ?? MODELS.haiku,
    concurrency: Number(val("--concurrency") ?? "3"),
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (x: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return out;
}

/** Deterministic fake model output, so the harness/scoring can run offline. */
function fakeReviewJson(c: Case, better: boolean): string {
  const hintWords = c.rootCauseHint.split(/\s+/).slice(0, 10).join(" ");
  let findings: unknown[];
  if (c.label === "risky") {
    findings = [
      {
        severity: "high",
        file: c.rootCauseFiles[0] ?? "src/unknown.ts",
        line: 10,
        category: "unhandled-edge-case",
        rationale: `Potential problem around: ${hintWords}`,
        suggestedCheck: "Verify the reverted behavior by hand.",
      },
    ];
  } else if (c.hard && !better) {
    // baseline over-flags the scary-looking clean PR
    findings = [
      {
        severity: "high",
        file: "src/router/trie-router/node.ts",
        line: 5,
        category: "other",
        rationale: "Large change to router internals looks dangerous.",
        suggestedCheck: "Review carefully.",
      },
    ];
  } else {
    findings = [
      {
        severity: "low",
        file: "src/minor.ts",
        line: 1,
        category: "other",
        rationale: "Minor stylistic note.",
        suggestedCheck: "None.",
      },
    ];
  }
  return JSON.stringify({ summary: `Fake review of "${c.title}".`, findings });
}

/**
 * Scripted fake for the agent loop:
 *   turn 0 → call get_diff
 *   turn 1 → emit the draft review JSON
 *   turn 2 → (verify pass) echo the review back unchanged
 * Exercises the full investigate → verify → classify path offline.
 */
function fakeAgentLlm(c: Case): FakeLlm {
  const reviewJson = fakeReviewJson(c, true);
  return new FakeLlm(({ turn }) => {
    if (turn === 0) return { toolUses: [{ id: "t0", name: "get_diff", input: {} }] };
    return { text: reviewJson };
  });
}

async function reviewCase(
  c: Case,
  args: Args,
  apiKey: string | undefined,
  gh: GithubClient,
): Promise<TReview> {
  const [owner, repo] = c.repo.split("/") as [string, string];
  const meta = await gh.getPrMetadata(owner, repo, c.pr);
  const changedFiles = await gh.listChangedFiles(owner, repo, c.pr);
  const getDiff = (path?: string) => gh.getDiff(owner, repo, c.pr, path);

  if (args.mode === "baseline") {
    const diff = await getDiff();
    const llm = args.fake
      ? new FakeLlm(() => ({ text: fakeReviewJson(c, false) }))
      : undefined;
    return runBaseline({ meta, diff, model: args.model, apiKey, llm });
  }

  // agent mode
  const checkout = args.fake
    ? null
    : ensureCheckout(owner, repo, c.baseSha, c.headSha);
  const llm: LlmClient | FakeLlm = args.fake
    ? fakeAgentLlm(c)
    : new LlmClient({ apiKey: apiKey!, model: args.model });
  const logger = new RunLogger(
    "trajectories",
    `eval-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`,
    c.id,
  );
  return runAgent(meta, {
    llm,
    repo: checkout ? { dir: checkout.dir } : null,
    headSha: c.headSha,
    getDiff,
    changedFiles,
    logger,
    verify: true,
  });
}

async function preflight(args: Args): Promise<void> {
  const cfg = loadConfig({ offline: true, needGithub: false });
  const cases = loadCases(args.ids ? { ids: args.ids } : {});
  const gh = new GithubClient({
    token: cfg.githubToken,
    cache: { offline: true },
  });
  let ok = 0;
  console.log(`preflight · ${cases.length} cases · offline cache only\n`);
  for (const c of cases) {
    const [o, r] = c.repo.split("/") as [string, string];
    const problems: string[] = [];
    try {
      const meta = await gh.getPrMetadata(o, r, c.pr);
      if (meta.baseSha !== c.baseSha) problems.push("baseSha mismatch");
      const files = await gh.listChangedFiles(o, r, c.pr);
      if (!files.length) problems.push("no changed files");
      const diff = await gh.getDiff(o, r, c.pr);
      if (diff.length < 20) problems.push("empty diff");
      if (diff.length > 200_000) problems.push(`diff very large (${diff.length}c)`);
    } catch (e) {
      problems.push(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    }
    const status = problems.length ? `FAIL ${problems.join("; ")}` : "ok";
    if (!problems.length) ok++;
    console.log(`  ${c.id} ${c.label.padEnd(5)} ${status}`);
  }
  console.log(`\n${ok}/${cases.length} ready`);
  if (ok < cases.length) process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.preflight) {
    await preflight(args);
    return;
  }

  const cfg = loadConfig({ offline: args.offline, needGithub: !args.offline });
  const cases = loadCases(args.ids ? { ids: args.ids } : {});

  console.error(
    `eval · mode=${args.mode} · model=${args.fake ? "FAKE" : args.model} · ` +
      `offline=${args.offline} · ${cases.length} cases`,
  );

  const gh = new GithubClient({
    token: cfg.githubToken,
    cache: { offline: args.offline },
  });

  const reviews = await mapLimit(cases, args.concurrency, async (c) => {
    const started = Date.now();
    const review = await reviewCase(c, args, cfg.anthropicApiKey, gh);
    console.error(
      `  ${c.id} ${c.label.padEnd(5)} → ${review.risk.padEnd(6)} ` +
        `${review.findings.length} findings · ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return { c, review };
  });

  const scorecard = scoreAll(reviews);

  // dump full per-case reviews for inspection
  const dir = join(process.cwd(), "results", args.mode);
  mkdirSync(dir, { recursive: true });
  for (const { c, review } of reviews) {
    writeFileSync(join(dir, `${c.id}.json`), JSON.stringify(review, null, 2));
    writeFileSync(join(dir, `${c.id}.md`), renderReview(review));
  }

  const result: RunResult = {
    mode: args.mode,
    model: args.fake ? `FAKE(${args.model})` : args.model,
    fake: args.fake,
    timestamp: new Date().toISOString(),
    caseIds: cases.map((c) => c.id),
    scorecard,
  };
  writeRunResult(result);
  regenerateSummary();

  console.error("");
  console.error(
    `balanced accuracy ${(scorecard.balancedAccuracy * 100).toFixed(1)}% · ` +
      `recall ${(scorecard.recall * 100).toFixed(1)}% · ` +
      `specificity ${(scorecard.specificity * 100).toFixed(1)}% · ` +
      `root-cause ${scorecard.rootCauseHits}/${scorecard.riskyCount} · ` +
      `false-alarm ${scorecard.falseAlarmRate.toFixed(2)} · ` +
      `$${scorecard.totalCostUsd.toFixed(4)}`,
  );
  console.error(`wrote results/${args.mode}.json and results/summary.md`);
}

main().catch((e: unknown) => {
  console.error("\neval failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
