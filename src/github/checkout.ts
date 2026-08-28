import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const REPOS_DIR = join(process.cwd(), ".cache", "repos");

export interface Checkout {
  dir: string;
  sha: string;
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
 * Shallow-fetch one commit of a public repo into
 * .cache/repos/<owner>-<repo>@<sha>. Idempotent. Used by the agent's file tools;
 * the baseline never needs it.
 */
export function ensureCheckout(
  owner: string,
  repo: string,
  sha: string,
): Checkout {
  const dir = join(REPOS_DIR, `${owner}-${repo}@${sha}`);
  if (existsSync(join(dir, ".git"))) return { dir, sha };
  mkdirSync(dir, { recursive: true });

  const url = `https://github.com/${owner}/${repo}.git`;
  git(dir, ["init", "-q"]);
  git(dir, ["remote", "add", "origin", url]);
  try {
    git(dir, ["fetch", "-q", "--depth", "1", "origin", sha]);
  } catch {
    // some servers refuse a bare-sha want; fall back to shallow history
    git(dir, ["fetch", "-q", "--depth", "100", "origin"]);
  }
  git(dir, ["checkout", "-q", sha]);
  return { dir, sha };
}
