import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, MODELS, LIMITS } from "../src/config.js";
import { GithubClient } from "../src/github/client.js";
import { ensureCheckout } from "../src/github/checkout.js";
import { runBaseline, type ContextFile } from "../src/baseline/run.js";
import { runAgent } from "../src/agent/loop.js";
import { LlmClient } from "../src/llm/anthropic.js";
import { FakeLlm } from "../src/llm/fake.js";
import { RunLogger } from "../src/logging.js";
import { readFile as readRepoFile } from "../src/repo/tools.js";
import { renderReview } from "../src/review/render.js";
import { type Review as TReview } from "../src/review/schema.js";
import { ALL_TOOLS, type ToolName } from "../src/agent/toolDefs.js";
import { loadCases, type Case } from "./cases.js";
import { scoreAll } from "./score.js";
import { writeRunResult, regenerateSummary, type RunResult } from "./report.js";

type Mode = "baseline" | "baseline-plus" | "agent";

interface Args {
  mode: Mode;
  label: string; // result filename + Review.meta.mode
  offline: boolean;
  fake: boolean;
  preflight: boolean;
  ids: string[] | undefined;
  model: string;
  concurrency: number;
  // agent ablation knobs
  tools: ToolName[];
  verify: boolean;
  secondPass: boolean;
  maxSteps: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const val = (f: string) => {
    const i = a.indexOf(f);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const has = (f: string) => a.includes(f);
  const mode = (val("--mode") ?? "baseline") as Mode;
  if (!["baseline", "baseline-plus", "agent"].includes(mode)) {
    throw new Error(`--mode must be baseline | baseline-plus | agent`);
  }
  const toolsArg = val("--tools");
  return {
    mode,
    label: val("--label") ?? mode,
    offline: has("--offline"),
    fake: has("--fake"),
    preflight: has("--preflight"),
    ids: val("--cases")?.split(",").map((s) => s.trim()).filter(Boolean),
    model: val("--model") ?? process.env.FAULTLINE_MODEL ?? MODELS.haiku,
    concurrency: Number(val("--concurrency") ?? "3"),
    tools: toolsArg
      ? (toolsArg.split(",").map((s) => s.trim()) as ToolName[])
      : ALL_TOOLS,
    verify: !has("--no-verify"),
    // the second (adversarial) pass is the final config — on by default
    secondPass: !has("--no-second-pass"),
    maxSteps: Number(val("--max-steps") ?? String(LIMITS.agentMaxSteps)),
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

/** Deterministic fake model output so the harness/scoring can run offline. */
function fakeReviewJson(c: Case, better: boolean): string {
  const hint = c.rootCauseHint.split(/\s+/).slice(0, 10).join(" ");
  let findings: unknown[];
  let riskScore: number;
  if (c.label === "risky") {
    riskScore = 0.85;
    findings = [
      {
        severity: "high",
        file: c.rootCauseFiles[0] ?? "src/unknown.ts",
        line: 10,
        category: "unhandled-edge-case",
        rationale: `Potential problem around: ${hint}`,
        suggestedCheck: "Verify the reverted behavior by hand.",
      },
    ];
  } else if (c.hard && !better) {
    riskScore = 0.7;
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
    riskScore = 0.1;
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
  return JSON.stringify({ summary: `Fake review of "${c.title}".`, riskScore, findings });
}

function fakeAgentLlm(c: Case): FakeLlm {
  const reviewJson = fakeReviewJson(c, true);
  return new FakeLlm(({ turn }) => {
    if (turn === 0) return { toolUses: [{ id: "t0", name: "get_diff", input: {} }] };
    return { text: reviewJson };
  });
}

async function contextFilesAt(
  dir: string,
  headSha: string,
  changed: { path: string; status: string }[],
): Promise<ContextFile[]> {
  const ctx = { dir };
  return changed
    .filter((f) => f.status !== "removed")
    .map((f) => ({
      path: f.path,
      content: readRepoFile(ctx, f.path, { ref: headSha, maxLines: 4000 }),
    }));
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

  if (args.mode === "baseline" || args.mode === "baseline-plus") {
    const diff = await getDiff();
    const llm = args.fake
      ? new FakeLlm(() => ({ text: fakeReviewJson(c, false) }))
      : undefined;
    let contextFiles: ContextFile[] | undefined;
    if (args.mode === "baseline-plus" && !args.fake) {
      const co = ensureCheckout(owner, repo, c.baseSha, c.headSha);
      contextFiles = await contextFilesAt(co.dir, c.headSha, changedFiles);
    }
    return runBaseline({
      meta,
      diff,
      model: args.model,
      mode: args.label,
      apiKey,
      llm,
      ...(contextFiles ? { contextFiles } : {}),
    });
  }

  // agent
  const checkout = args.fake
    ? null
    : ensureCheckout(owner, repo, c.baseSha, c.headSha);
  const llm = args.fake
    ? fakeAgentLlm(c)
    : new LlmClient({ apiKey: apiKey!, model: args.model });
  const logger = new RunLogger("trajectories", `${args.label}-${runStamp}`, c.id);
  return runAgent(meta, {
    llm,
    repo: checkout ? { dir: checkout.dir } : null,
    headSha: c.headSha,
    getDiff,
    changedFiles,
    logger,
    mode: args.label,
    tools: args.tools,
    verify: args.verify,
    secondPass: args.secondPass,
    maxSteps: args.maxSteps,
  });
}

const runStamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");

/** Neutral review substituted when a case errors, so scoring still runs. */
function fallbackReview(c: Case, mode: string, msg: string): TReview {
  return {
    pr: {
      repo: c.repo,
      number: c.pr,
      title: c.title,
      baseSha: c.baseSha,
      headSha: c.headSha,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
    },
    summary: `[review failed: ${msg}]`,
    findings: [],
    risk: "Low",
    modelRiskScore: 0.5,
    derivedRiskScore: 0,
    meta: {
      mode,
      model: "error",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      wallMs: 0,
      toolCalls: 0,
    },
  };
}

async function preflight(args: Args): Promise<void> {
  const cfg = loadConfig({ offline: true, needGithub: false, needAnthropic: false });
  const cases = loadCases(args.ids ? { ids: args.ids } : {});
  const gh = new GithubClient({ token: cfg.githubToken, cache: { offline: true } });
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
      if (diff.length > 250_000) problems.push(`diff very large (${diff.length}c)`);
    } catch (e) {
      problems.push(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    }
    if (!problems.length) ok++;
    console.log(`  ${c.id} ${c.label.padEnd(5)} ${problems.length ? "FAIL " + problems.join("; ") : "ok"}`);
  }
  console.log(`\n${ok}/${cases.length} ready`);
  if (ok < cases.length) process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.preflight) return preflight(args);

  const cfg = loadConfig({ offline: args.offline, needGithub: !args.offline });
  const cases = loadCases(args.ids ? { ids: args.ids } : {});

  console.error(
    `eval · label=${args.label} · mode=${args.mode} · model=${args.fake ? "FAKE" : args.model} · ` +
      `offline=${args.offline} · verify=${args.verify} · secondPass=${args.secondPass} · ` +
      `tools=[${args.tools.join(",")}] · ${cases.length} cases`,
  );

  const gh = new GithubClient({
    token: cfg.githubToken,
    cache: { offline: args.offline },
  });

  const errors: string[] = [];
  const reviews = await mapLimit(cases, args.concurrency, async (c) => {
    const t = Date.now();
    try {
      const review = await reviewCase(c, args, cfg.anthropicApiKey, gh);
      console.error(
        `  ${c.id} ${c.label.padEnd(5)} → ${review.risk.padEnd(6)} score ${review.modelRiskScore.toFixed(2)} · ` +
          `${review.findings.length} findings · ${review.meta.toolCalls} tools · ` +
          `${((Date.now() - t) / 1000).toFixed(1)}s · $${review.meta.costUsd.toFixed(4)}`,
      );
      return { c, review };
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0]! : String(e);
      errors.push(`${c.id}: ${msg}`);
      console.error(`  ${c.id} ${c.label.padEnd(5)} → ERROR ${msg}`);
      return { c, review: fallbackReview(c, args.label, msg) };
    }
  });

  const scorecard = scoreAll(reviews);

  const dir = join(process.cwd(), "results", args.label);
  mkdirSync(dir, { recursive: true });
  for (const { c, review } of reviews) {
    writeFileSync(join(dir, `${c.id}.json`), JSON.stringify(review, null, 2));
    writeFileSync(join(dir, `${c.id}.md`), renderReview(review));
  }

  const result: RunResult = {
    mode: args.label,
    model: args.fake ? `FAKE(${args.model})` : args.model,
    fake: args.fake,
    timestamp: new Date().toISOString(),
    caseIds: cases.map((c) => c.id),
    scorecard,
  };
  writeRunResult(result);
  regenerateSummary();

  console.error(
    `\n${args.label}: bal.acc ${(scorecard.balancedAccuracy * 100).toFixed(1)}% · ` +
      `recall ${(scorecard.recall * 100).toFixed(1)}% · spec ${(scorecard.specificity * 100).toFixed(1)}% · ` +
      `root-cause ${scorecard.rootCauseHits}/${scorecard.riskyCount} · ` +
      `false-alarm ${scorecard.falseAlarmRate.toFixed(2)} · ` +
      `Brier(model) ${scorecard.brierModel.toFixed(3)} · ` +
      `total $${scorecard.totalCostUsd.toFixed(4)}`,
  );
  if (errors.length) {
    console.error(`\n${errors.length} case(s) errored (scored as Low):`);
    for (const e of errors) console.error(`  ${e}`);
  }
  console.error(`wrote results/${args.label}.json and results/summary.md`);
}

main().catch((e: unknown) => {
  console.error("\neval failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
