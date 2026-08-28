import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const CACHE_ROOT = join(process.cwd(), ".cache");

export interface CacheOptions {
  /** offline = never fetch; a miss is a hard error */
  offline: boolean;
}

function keyPath(namespace: string, parts: (string | number)[]): string {
  const raw = parts.map(String).join("|");
  const hash = createHash("sha1").update(raw).digest("hex").slice(0, 16);
  const label = parts
    .map(String)
    .join("_")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 80);
  return join(CACHE_ROOT, namespace, `${label}.${hash}.json`);
}

/**
 * Read-through disk cache. Every GitHub response and tool result flows through
 * here keyed by immutable inputs (repo, sha, pr, path...). The 12 eval cases'
 * cache is committed, so `--offline` reproduces the eval with no network.
 */
export async function cached<T>(
  namespace: string,
  parts: (string | number)[],
  opts: CacheOptions,
  fetcher: () => Promise<T>,
): Promise<T> {
  const path = keyPath(namespace, parts);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  }
  if (opts.offline) {
    throw new Error(
      `Offline cache miss: ${namespace} [${parts.join(", ")}]\n` +
        `Run once online to populate .cache/, or confirm this case is in the committed set.`,
    );
  }
  const value = await fetcher();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
  return value;
}
