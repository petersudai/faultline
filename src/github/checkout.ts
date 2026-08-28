import { execFileSync } from "node:child_process";
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

/**
 * Shallow-fetch a PR's base (and head) commits of a public repo into
 * .cache/repos/<owner>-<repo>@<baseSha>. Working tree is at base; head is
 * fetched too so `git show <headSha>:<path>` works. Idempotent. Used by the
 * agent's file tools; the baseline never needs it.
 */
export function ensureCheckout(
  owner: string,
  repo: string,
  baseSha: string,
  headSha?: string,
): Checkout {
  const dir = join(REPOS_DIR, `${owner}-${repo}@${baseSha}`);
  const url = `https://github.com/${owner}/${repo}.git`;

  const fetchSha = (sha: string) => {
    try {
      git(dir, ["fetch", "-q", "--depth", "1", "origin", sha]);
    } catch {
      git(dir, ["fetch", "-q", "--depth", "100", "origin"]);
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
