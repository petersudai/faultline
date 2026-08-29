import type { ToolSpec } from "../llm/types.js";
import type { RepoContext } from "../repo/tools.js";
import {
  readFile,
  searchRepo,
  findReferences,
  getRelatedTests,
} from "../repo/tools.js";
import type { ChangedFile } from "../github/client.js";

export type ToolName =
  | "get_diff"
  | "read_file"
  | "find_references"
  | "get_related_tests"
  | "search_repo";

/** Default tool set. `search_repo` is defined but off by default — in practice
 *  the agent burned calls on it for little signal; still available via --tools. */
export const ALL_TOOLS: ToolName[] = [
  "get_diff",
  "read_file",
  "find_references",
  "get_related_tests",
];

export const TOOL_NAMES: ToolName[] = [...ALL_TOOLS, "search_repo"];

export interface ToolDeps {
  repo: RepoContext | null;
  baseSha: string;
  headSha: string | undefined;
  getDiff: (path?: string) => Promise<string>;
  changedFiles: ChangedFile[];
}

const SPECS: Record<ToolName, ToolSpec> = {
  get_diff: {
    name: "get_diff",
    description:
      "Unified diff for the PR. Pass `path` for a single file's diff; omit for the whole PR.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
    },
  },
  read_file: {
    name: "read_file",
    description:
      "Read a file with line numbers. ref='base' (before the PR, default) or 'head' (after). Large files come back as windows around `around` line numbers.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        ref: { type: "string", enum: ["base", "head"] },
        around: { type: "array", items: { type: "number" } },
      },
      required: ["path"],
    },
  },
  find_references: {
    name: "find_references",
    description:
      "Whole-word search for a symbol across the repo at the base revision — find call sites of a changed function or constant.",
    input_schema: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
  get_related_tests: {
    name: "get_related_tests",
    description: "List test files whose names relate to a changed source path.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  search_repo: {
    name: "search_repo",
    description:
      "Literal substring search across the repo at the base revision.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
};

/**
 * Terminator tool. The agent ends the review by calling this with its
 * assessment as structured input — far more reliable than asking a small model
 * to emit a bare JSON object as its final text.
 */
export const SUBMIT_TOOL: ToolSpec = {
  name: "submit_review",
  description:
    "Call this exactly once, on its own, to finish. Provide your final assessment. Do not call any other tool in the same turn.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "2-3 sentences: what the PR changes and the single biggest risk, or that it looks low-risk",
      },
      riskScore: {
        type: "number",
        description:
          "0..1 — your probability that this PR needs a revert or hotfix within two weeks",
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["high", "medium", "low"] },
            file: { type: "string", description: "path from the diff or repo" },
            line: {
              type: "integer",
              description: "line in the new file; omit if unsure",
            },
            category: {
              type: "string",
              enum: [
                "missing-caller-update",
                "unhandled-edge-case",
                "breaking-change",
                "test-gap",
                "error-handling",
                "concurrency",
                "security",
                "performance",
                "data-loss",
                "api-contract",
                "other",
              ],
            },
            rationale: { type: "string" },
            suggestedCheck: { type: "string" },
          },
          required: ["severity", "file", "category", "rationale", "suggestedCheck"],
        },
      },
    },
    required: ["summary", "riskScore", "findings"],
  },
};

export interface ToolKit {
  specs: ToolSpec[];
  dispatch: (name: string, input: unknown) => Promise<unknown>;
}

export function buildToolkit(deps: ToolDeps, enabled: ToolName[]): ToolKit {
  const set = new Set(enabled);
  const specs = enabled.map((n) => SPECS[n]);

  const dispatch = async (name: string, input: unknown): Promise<unknown> => {
    const arg = (input ?? {}) as Record<string, unknown>;
    if (!set.has(name as ToolName)) return { error: `tool not enabled: ${name}` };

    switch (name as ToolName) {
      case "get_diff":
        return { diff: await deps.getDiff(arg.path as string | undefined) };

      case "read_file": {
        if (!deps.repo) return { error: "file access unavailable (no checkout)" };
        const ref =
          arg.ref === "head"
            ? deps.headSha
            : arg.ref === "base"
              ? deps.baseSha
              : undefined; // undefined = working tree (base)
        return {
          content: readFile(deps.repo, String(arg.path), {
            ...(ref ? { ref } : {}),
            ...(Array.isArray(arg.around)
              ? { around: (arg.around as unknown[]).map(Number) }
              : {}),
          }),
        };
      }

      case "find_references":
        if (!deps.repo) return { error: "unavailable (no checkout)" };
        return { hits: findReferences(deps.repo, String(arg.symbol)) };

      case "get_related_tests":
        if (!deps.repo) return { error: "unavailable (no checkout)" };
        return { tests: getRelatedTests(deps.repo, String(arg.path)) };

      case "search_repo":
        if (!deps.repo) return { error: "unavailable (no checkout)" };
        return { hits: searchRepo(deps.repo, String(arg.query)) };

      default:
        return { error: `unknown tool: ${name}` };
    }
  };

  return { specs, dispatch };
}
