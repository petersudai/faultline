import { execFileSync } from "node:child_process";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const REPOS_DIR = join(process.cwd(), ".cache", "repos");

export interface Checkout {
  dir: string;
  baseSha: string;
  headSha: string | undefined;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function gitRetry(cwd: string, args: string[], tries = 3): void {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      git(cwd, args);
      return;
    } catch (e) {
      lastErr = e;
      // crude sync backoff — network hiccup / unauth rate-limit
      try {
        execSync(process.platform === "win32" ? "timeout /t 3 /nobreak >nul" : "sleep 3", {
          stdio: "ignore",
        });
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr;
}

/**
 * Shallow-fetch a PR's base (and head) commits of a public repo into
 * .cache/repos/<owner>-<repo>@<baseSha>. Working tree is at base; head is
 * fetched too so `git show <headSha>:<path>` works.
 *
 * Pass `token` (a GitHub PAT, even scopeless) to authenticate the clone — it
 * lifts the fetch rate limit from ~60/hr to 5000/hr. Idempotent.
 */
export function ensureCheckout(
  owner: string,
  repo: string,
  baseSha: string,
  headSha?: string,
  token?: string,
): Checkout {
  const dir = join(REPOS_DIR, `${owner}-${repo}@${baseSha}`);
  const url = token
    ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  const fetchSha = (sha: string) => {
    try {
      gitRetry(dir, ["fetch", "-q", "--depth", "1", "origin", sha]);
    } catch {
      gitRetry(dir, ["fetch", "-q", "--depth", "100", "origin"]);
    }
  };

  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    git(dir, ["init", "-q"]);
    git(dir, ["remote", "add", "origin", url]);
    fetchSha(baseSha);
    git(dir, ["checkout", "-q", baseSha]);
  }

  if (headSha) {
    try {
      git(dir, ["cat-file", "-e", `${headSha}^{commit}`]);
    } catch {
      fetchSha(headSha);
    }
  }

  return { dir, baseSha, headSha };
}
