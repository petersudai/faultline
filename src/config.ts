import "dotenv/config";

/** Model ids. See claude-api reference for exact strings. */
export const MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5",
} as const;

/** USD per 1M tokens. Update from console.anthropic.com if pricing changes. */
export const PRICING: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
  "claude-sonnet-5": { in: 3.0, out: 15.0 },
};

export const LIMITS = {
  /** hard cap on tool-use iterations inside one agent review */
  agentMaxSteps: 8,
  /** per LLM request */
  llmTimeoutMs: 60_000,
  llmMaxRetries: 4,
  /** abort a single review/case if token use blows past this */
  runTokenBudget: 2_000_000,
  /** never inline a whole-PR diff larger than this; force per-file reads */
  maxInlineDiffLines: 400,
  /** lines of context around each changed hunk when windowing a large file */
  fileWindowContext: 40,
  /** eval cases in flight at once */
  evalConcurrency: 3,
} as const;

export interface Config {
  anthropicApiKey: string;
  githubToken: string | undefined;
  model: string;
  offline: boolean;
}

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}

export function loadConfig(
  opts: { offline?: boolean; needGithub?: boolean; needAnthropic?: boolean } = {},
): Config {
  const anthropicApiKey =
    opts.needAnthropic === false
      ? (process.env.ANTHROPIC_API_KEY?.trim() ?? "")
      : required("ANTHROPIC_API_KEY");
  const githubToken = process.env.GITHUB_TOKEN?.trim() || undefined;
  const offline = opts.offline ?? false;

  if (opts.needGithub && !offline && !githubToken) {
    throw new Error(
      "GITHUB_TOKEN required for live GitHub access. Set it in .env, or pass --offline to use the committed cache.",
    );
  }

  const model = process.env.FAULTLINE_MODEL?.trim() || MODELS.haiku;
  if (!PRICING[model]) {
    throw new Error(
      `Unknown FAULTLINE_MODEL "${model}". Known: ${Object.keys(PRICING).join(", ")}`,
    );
  }

  return { anthropicApiKey, githubToken, model, offline };
}

export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

/** Cache-aware: cached reads bill at 0.1x input, cache writes at 1.25x. */
export function costUsdDetailed(
  model: string,
  t: { input: number; cacheRead: number; cacheWrite: number; output: number },
): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    (t.input * p.in +
      t.cacheRead * p.in * 0.1 +
      t.cacheWrite * p.in * 1.25 +
      t.output * p.out) /
    1_000_000
  );
}
