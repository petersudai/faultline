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

/** git on Windows emits CRLF; normalise before any line work. */
function splitLines(s: string): string[] {
  return s.split(/\r?\n/);
}

function gitOut(ctx: RepoContext, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: ctx.dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    // git grep exits 1 when there are no matches — treat as empty
    if ((e as { status?: number }).status === 1) return "";
    throw e;
  }
}

/** Raw file content at a revision, or null if absent there. */
function getContent(ctx: RepoContext, path: string, ref?: string): string | null {
  const clean = path.replace(/^\.?\//, "");
  if (!ref) {
    const full = join(ctx.dir, clean);
    return existsSync(full) ? readFileSync(full, "utf8") : null;
  }
  try {
    return execFileSync("git", ["show", `${ref}:${clean}`], {
      cwd: ctx.dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

const DEFAULT_MAX_LINES = 450; // a whole-file dump must fit the tool-result budget
const HEAD_LINES = 180;
const TAIL_LINES = 50;
const WINDOW_CONTEXT = 55;

function numbered(lines: string[], from: number): string {
  return lines.map((l, i) => `${from + i}\t${l}`).join("\n");
}

function windows(lines: string[], anchors: number[], ctxN: number): string {
  const ranges: [number, number][] = [...anchors]
    .sort((a, b) => a - b)
    .map((a) => [Math.max(1, a - ctxN), Math.min(lines.length, a + ctxN)]);
  const merged: [number, number][] = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const parts = [`(${lines.length} lines total; showing ${merged.length} window(s))`];
  for (const [s, e] of merged) {
    parts.push(`\n--- lines ${s}-${e} ---`);
    parts.push(numbered(lines.slice(s - 1, e), s));
  }
  return parts.join("\n");
}

/**
 * Read a file at a revision (default: checked-out base) with line numbers.
 *  - `around` given: ALWAYS windowed to ±context around those lines (this is the
 *    agent explicitly asking for a region — honour it regardless of file size)
 *  - no `around`, file <= maxLines: whole file
 *  - no `around`, larger: head + tail with an elision marker
 */
export function readFile(
  ctx: RepoContext,
  path: string,
  opts: {
    ref?: string;
    around?: number[];
    context?: number;
    maxLines?: number;
  } = {},
): string {
  const raw = getContent(ctx, path, opts.ref);
  if (raw == null) return `(file not present at ${opts.ref ?? "base"}: ${path})`;

  const lines = splitLines(raw);

  if (opts.around && opts.around.length) {
    return windows(lines, opts.around, opts.context ?? WINDOW_CONTEXT);
  }

  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  if (lines.length <= maxLines) return numbered(lines, 1);

  const head = numbered(lines.slice(0, HEAD_LINES), 1);
  const tailStart = lines.length - TAIL_LINES + 1;
  const tail = numbered(lines.slice(tailStart - 1), tailStart);
  return (
    `(${lines.length} lines; showing first ${HEAD_LINES} and last ${TAIL_LINES} — ` +
    `call again with { around: [lineNumbers] } to see a specific region)\n` +
    head +
    `\n… ${lines.length - HEAD_LINES - TAIL_LINES} lines omitted …\n` +
    tail
  );
}

function parseGrep(out: string, limit: number): CodeHit[] {
  const hits: CodeHit[] = [];
  for (const raw of splitLines(out)) {
    if (!raw) continue;
    const m = raw.match(/^(.+?):(\d+):(.*)$/);
    if (!m) continue;
    hits.push({
      path: m[1]!,
      line: Number(m[2]),
      snippet: m[3]!.trim().slice(0, 240),
    });
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
  return parseGrep(
    gitOut(ctx, ["grep", "-n", "-I", "-F", "--", query]),
    opts.limit ?? 40,
  );
}

/** Whole-word references to a symbol — call sites of a changed function etc. */
export function findReferences(
  ctx: RepoContext,
  symbol: string,
  opts: { limit?: number } = {},
): CodeHit[] {
  return parseGrep(
    gitOut(ctx, ["grep", "-n", "-I", "-w", "-F", "--", symbol]),
    opts.limit ?? 60,
  );
}

const IS_TEST = /\.(test|spec)\.[jt]sx?$/i;
const GENERIC_STEMS = new Set([
  "index", "mod", "main", "types", "utils", "util", "helper", "helpers",
]);

function dirOf(p: string): string {
  const c = p.replace(/^\.?\//, "");
  return c.includes("/") ? c.slice(0, c.lastIndexOf("/")) : "";
}
function testStem(f: string): string {
  return basename(f)
    .replace(IS_TEST, "")
    .replace(/\.[jt]sx?$/, "")
    .toLowerCase();
}

/**
 * Test files related to a changed source path. Priority:
 *  1. a sibling `<name>.test.*` in the same directory
 *  2. if the name is generic (index/mod/...), every test file in that directory
 *  3. otherwise, any test file with a matching base name
 */
export function getRelatedTests(ctx: RepoContext, path: string): string[] {
  const all = splitLines(gitOut(ctx, ["ls-files"])).filter(Boolean);
  const dir = dirOf(path);
  const stem = basename(path).replace(/\.[jt]sx?$/, "").toLowerCase();
  if (!stem) return [];

  const inDir = (f: string) => dirOf(f) === dir;

  const siblings = all.filter(
    (f) => IS_TEST.test(f) && inDir(f) && testStem(f) === stem,
  );
  if (siblings.length) return siblings.slice(0, 20);

  if (GENERIC_STEMS.has(stem) && dir) {
    return all.filter((f) => IS_TEST.test(f) && inDir(f)).slice(0, 20);
  }

  return all
    .filter((f) => IS_TEST.test(f) && testStem(f) === stem)
    .slice(0, 10);
}
