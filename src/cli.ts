import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { GithubClient } from "./github/client.js";
import { ensureCheckout } from "./github/checkout.js";
import { runBaseline } from "./baseline/run.js";
import { runAgent } from "./agent/loop.js";
import { LlmClient } from "./llm/anthropic.js";
import { RunLogger } from "./logging.js";
import { renderReview } from "./review/render.js";

interface Args {
  repo: string | undefined;
  pr: number | undefined;
  offline: boolean;
  dryRun: boolean;
  mode: "baseline" | "agent";
}

function parseArgs(argv: string[]): Args {
  const a = argv.slice(2);
  const flags = new Set(a.filter((x) => x.startsWith("--")));
  const pos = a.filter((x) => !x.startsWith("--"));
  return {
    repo: pos[0],
    pr: pos[1] ? Number(pos[1]) : undefined,
    offline: flags.has("--offline"),
    dryRun: flags.has("--dry-run"),
    mode: flags.has("--agent") ? "agent" : "baseline",
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (!args.repo || !args.pr || !/^[^/\s]+\/[^/\s]+$/.test(args.repo)) {
    console.error(
      "Usage: faultline <owner/repo> <pr-number> [--agent] [--offline] [--dry-run]",
    );
    process.exit(2);
    return;
  }

  const cfg = loadConfig({ offline: args.offline, needGithub: true });

  if (args.dryRun) {
    console.log(
      `dry-run OK · model=${cfg.model} · offline=${cfg.offline} · github=${cfg.githubToken ? "set" : "none"}`,
    );
    return;
  }

  const [owner, repo] = args.repo.split("/") as [string, string];
  const gh = new GithubClient({
    token: cfg.githubToken,
    cache: { offline: cfg.offline },
  });

  console.error(`Fetching ${args.repo}#${args.pr} …`);
  const meta = await gh.getPrMetadata(owner, repo, args.pr);
  const changedFiles = await gh.listChangedFiles(owner, repo, args.pr);
  console.error(
    `  "${meta.title}" · ${meta.changedFiles} files · +${meta.additions} −${meta.deletions} · merged=${meta.merged}`,
  );

  const getDiff = (path?: string) => gh.getDiff(owner, repo, args.pr!, path);
  let review;

  if (args.mode === "agent") {
    console.error("Checking out base + head …");
    const checkout = ensureCheckout(owner, repo, meta.baseSha, meta.headSha);
    const llm = new LlmClient({ apiKey: cfg.anthropicApiKey, model: cfg.model });
    const logger = new RunLogger(
      "trajectories",
      `${owner}-${repo}-${args.pr}-${Date.now()}`,
    );
    console.error(`Reviewing (agent, ${cfg.model}) …`);
    review = await runAgent(meta, {
      llm,
      repo: { dir: checkout.dir },
      headSha: meta.headSha,
      getDiff,
      changedFiles,
      logger,
      verify: true,
    });
  } else {
    const diff = await getDiff();
    console.error(`Reviewing (baseline, ${cfg.model}) …`);
    review = await runBaseline({
      meta,
      diff,
      model: cfg.model,
      apiKey: cfg.anthropicApiKey,
    });
  }

  const outDir = join(process.cwd(), "out", `${owner}-${repo}-${args.pr}`);
  mkdirSync(outDir, { recursive: true });
  const md = renderReview(review);
  writeFileSync(join(outDir, "REVIEW.md"), md);
  writeFileSync(join(outDir, "review.json"), JSON.stringify(review, null, 2));

  console.log("\n" + md);
  console.error(
    `Wrote out/${owner}-${repo}-${args.pr}/  ·  ` +
      `$${review.meta.costUsd.toFixed(4)} · ` +
      `${review.meta.inputTokens}+${review.meta.outputTokens} tok · ` +
      `${(review.meta.wallMs / 1000).toFixed(1)}s · ` +
      `${review.meta.toolCalls} tool calls`,
  );
}

main().catch((err: unknown) => {
  console.error("\nError:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
