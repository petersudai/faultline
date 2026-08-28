import { Octokit } from "@octokit/rest";
import { cached, type CacheOptions } from "./cache.js";

export interface PrMetadata {
  repo: string; // "owner/name"
  number: number;
  title: string;
  body: string;
  author: string;
  baseSha: string;
  headSha: string;
  labels: string[];
  state: string;
  merged: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
}

export interface ChangedFile {
  path: string;
  status: string; // added | modified | removed | renamed | ...
  additions: number;
  deletions: number;
  previousPath?: string;
  hasPatch: boolean;
}

interface RawFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  previous_filename?: string;
}

export class GithubClient {
  private readonly octokit: Octokit;
  private readonly cache: CacheOptions;

  constructor(opts: { token?: string | undefined; cache: CacheOptions }) {
    this.octokit = new Octokit({ auth: opts.token });
    this.cache = opts.cache;
  }

  async getPrMetadata(
    owner: string,
    repo: string,
    pr: number,
  ): Promise<PrMetadata> {
    const data = await cached(
      "gh",
      [`${owner}/${repo}`, "pr", pr],
      this.cache,
      async () => {
        const res = await this.octokit.pulls.get({
          owner,
          repo,
          pull_number: pr,
        });
        return res.data;
      },
    );
    return {
      repo: `${owner}/${repo}`,
      number: pr,
      title: data.title ?? "",
      body: data.body ?? "",
      author: data.user?.login ?? "unknown",
      baseSha: data.base.sha,
      headSha: data.head.sha,
      labels: (data.labels ?? [])
        .map((l) => (typeof l === "string" ? l : l.name))
        .filter((x): x is string => Boolean(x)),
      state: data.state,
      merged: Boolean(data.merged),
      additions: data.additions ?? 0,
      deletions: data.deletions ?? 0,
      changedFiles: data.changed_files ?? 0,
      commits: data.commits ?? 0,
    };
  }

  private async rawFiles(
    owner: string,
    repo: string,
    pr: number,
  ): Promise<RawFile[]> {
    return cached(
      "gh",
      [`${owner}/${repo}`, "pr-files", pr],
      this.cache,
      async () => {
        const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
          owner,
          repo,
          pull_number: pr,
          per_page: 100,
        });
        return files.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
          previous_filename: f.previous_filename,
        }));
      },
    );
  }

  async listChangedFiles(
    owner: string,
    repo: string,
    pr: number,
  ): Promise<ChangedFile[]> {
    const files = await this.rawFiles(owner, repo, pr);
    return files.map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      hasPatch: typeof f.patch === "string",
      ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
    }));
  }

  /** Unified diff for the whole PR, or a single file if `path` is given. */
  async getDiff(
    owner: string,
    repo: string,
    pr: number,
    path?: string,
  ): Promise<string> {
    const files = await this.rawFiles(owner, repo, pr);
    const wanted = path ? files.filter((f) => f.filename === path) : files;
    if (wanted.length === 0) {
      return path ? `(no such file in this PR: ${path})` : "(empty diff)";
    }
    return wanted
      .map((f) => {
        const old = f.previous_filename ?? f.filename;
        const header =
          `diff --git a/${old} b/${f.filename}\n` +
          `--- ${f.status === "added" ? "/dev/null" : "a/" + old}\n` +
          `+++ ${f.status === "removed" ? "/dev/null" : "b/" + f.filename}\n`;
        return header + (f.patch ?? "(patch omitted: binary or too large)");
      })
      .join("\n\n");
  }
}
