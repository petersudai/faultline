import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const REPOS_DIR = join(process.cwd(), ".cache", "repos");
// keep every git subcommand short-path-safe on Windows
const LONGPATHS = ["-c", "core.longpaths=true"];

export interface Checkout {
  dir: string;
  baseSha: string;
  headSha: string | undefined;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", [...LONGPATHS, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function tryGit(cwd: string, args: string[]): boolean {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

function hasCommit(dir: string, sha: string): boolean {
  return existsSync(join(dir, ".git")) && tryGit(dir, ["cat-file", "-e", `${sha}^{commit}`]);
}

function sleep(sec: number): void {
  try {
    execSync(process.platform === "win32" ? `ping -n ${sec + 1} 127.0.0.1 >NUL` : `sleep ${sec}`, {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    /* best effort */
  }
}

function fetchWithRetry(dir: string, sha: string, tries = 3): void {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      git(dir, ["fetch", "-q", "--depth", "1", "origin", sha]);
      return;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) sleep(3);
    }
  }
  throw new Error(
    `git fetch of ${sha.slice(0, 10)} failed after ${tries} tries: ${
      (lastErr as { stderr?: string })?.stderr || (lastErr as Error)?.message
    }`,
  );
}

/**
 * Shallow-fetch a PR's base (and head) commits of a public repo into a short
 * path under .cache/repos/. Working tree is at base; head is fetched too so
 * `git show <headSha>:<path>` works.
 *
 * Pass `token` (a GitHub PAT, even scopeless) to authenticate — it lifts the
 * fetch rate limit from ~60/hr to 5000/hr. Idempotent, self-heals a directory
 * left half-built by a previous failed run, and stays inside Windows MAX_PATH
 * via short dir names + core.longpaths.
 */
export function ensureCheckout(
  owner: string,
  repo: string,
  baseSha: string,
  headSha?: string,
  token?: string,
): Checkout {
  const slug =
    repo.slice(0, 12) +
    "-" +
    createHash("sha1").update(`${owner}/${repo}@${baseSha}`).digest("hex").slice(0, 10);
  const dir = join(REPOS_DIR, slug);
  const url =
    token && token.trim()
      ? `https://x-access-token:${token.trim()}@github.com/${owner}/${repo}.git`
      : `https://github.com/${owner}/${repo}.git`;

  if (!hasCommit(dir, baseSha)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    git(dir, ["init", "-q"]);
    git(dir, ["remote", "add", "origin", url]);
    fetchWithRetry(dir, baseSha);
    git(dir, ["checkout", "-q", baseSha]);
  }

  if (headSha && !hasCommit(dir, headSha)) {
    fetchWithRetry(dir, headSha);
  }

  return { dir, baseSha, headSha };
}
