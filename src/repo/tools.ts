import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

export interface RepoContext {
  dir: string;
}

export interface CodeHit {
  path: string;
  line: number;
  snippet: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function gitOut(ctx: RepoContext, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: ctx.dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    // git grep exits 1 when there are no matches — treat as empty
    if ((e as { status?: number }).status === 1) return "";
    throw e;
  }
}

/** Raw file content at a given revision, or null if it doesn't exist there. */
function getContent(ctx: RepoContext, path: string, ref?: string): string | null {
  if (!ref) {
    const full = join(ctx.dir, path);
    return existsSync(full) ? readFileSync(full, "utf8") : null;
  }
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: ctx.dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Read a file at a given revision (default: the checked-out base), with line
 * numbers. Large files are returned as windows around `around` anchor lines.
 */
export function readFile(
  ctx: RepoContext,
  path: string,
  opts: { ref?: string; around?: number[]; context?: number; maxLines?: number } = {},
): string {
  const raw = getContent(ctx, path, opts.ref);
  if (raw == null) return `(file not present at ${opts.ref ?? "base"}: ${path})`;

  const lines = raw.split("\n");
  const maxLines = opts.maxLines ?? 400;
  if (lines.length <= maxLines) {
    return lines.map((l, i) => `${i + 1}\t${l}`).join("\n");
  }

  const ctxN = opts.context ?? 40;
  const anchors = [...(opts.around ?? [1])].sort((a, b) => a - b);
  const ranges: [number, number][] = anchors.map((a) => [
    Math.max(1, a - ctxN),
    Math.min(lines.length, a + ctxN),
  ]);
  const merged: [number, number][] = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const parts: string[] = [
    `(file has ${lines.length} lines; showing ${merged.length} window(s))`,
  ];
  for (const [s, e] of merged) {
    parts.push(`\n--- lines ${s}-${e} ---`);
    for (let i = s; i <= e; i++) parts.push(`${i}\t${lines[i - 1] ?? ""}`);
  }
  return parts.join("\n");
}

function parseGrep(out: string, limit: number): CodeHit[] {
  const hits: CodeHit[] = [];
  for (const raw of out.split("\n")) {
    if (!raw) continue;
    const m = raw.match(/^(.+?):(\d+):(.*)$/);
    if (!m) continue;
    hits.push({ path: m[1]!, line: Number(m[2]), snippet: m[3]!.trim().slice(0, 240) });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Literal substring search across tracked files at the base revision. */
export function searchRepo(
  ctx: RepoContext,
  query: string,
  opts: { limit?: number } = {},
): CodeHit[] {
  const limit = opts.limit ?? 40;
  const out = gitOut(ctx, ["grep", "-n", "-I", "-F", "--", query]);
  return parseGrep(out, limit);
}

/** Whole-word references to a symbol — call sites of a changed function etc. */
export function findReferences(
  ctx: RepoContext,
  symbol: string,
  opts: { limit?: number } = {},
): CodeHit[] {
  const limit = opts.limit ?? 60;
  const out = gitOut(ctx, ["grep", "-n", "-I", "-w", "-F", "--", symbol]);
  return parseGrep(out, limit);
}

/** Heuristic: test files whose name relates to a changed source path. */
export function getRelatedTests(ctx: RepoContext, path: string): string[] {
  const all = gitOut(ctx, ["ls-files"]).split("\n").filter(Boolean);
  const stem = basename(path).replace(/\.[jt]sx?$/, "");
  if (!stem) return [];
  const s = escapeRegex(stem);
  const rx = new RegExp(
    `(^|/)${s}[.\\-_].*\\.(test|spec)\\.[jt]sx?$` +
      `|(^|/)(test|tests|__tests__|spec)/.*${s}`,
    "i",
  );
  return all.filter((f) => rx.test(f)).slice(0, 20);
}
