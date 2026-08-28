import type { Review, Finding, RiskLevel } from "../src/review/schema.js";
import type { Case } from "../eval/cases.js";

export function finding(p: Partial<Finding> = {}): Finding {
  return {
    severity: "medium",
    file: "src/x.ts",
    line: 10,
    category: "other",
    rationale: "something",
    suggestedCheck: "check it",
    ...p,
  };
}

export function review(p: {
  risk: RiskLevel;
  findings?: Finding[];
  summary?: string;
  mode?: "baseline" | "agent";
}): Review {
  return {
    pr: {
      repo: "acme/x",
      number: 1,
      title: "t",
      baseSha: "b".repeat(12),
      headSha: "h".repeat(12),
      filesChanged: 1,
      additions: 1,
      deletions: 1,
    },
    summary: p.summary ?? "s",
    findings: p.findings ?? [],
    risk: p.risk,
    meta: {
      mode: p.mode ?? "agent",
      model: "test",
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.001,
      wallMs: 1234,
      toolCalls: 2,
    },
  };
}

export function testCase(p: Partial<Case> = {}): Case {
  return {
    id: "c00",
    repo: "acme/x",
    pr: 1,
    title: "t",
    baseSha: "b",
    headSha: "h",
    label: "risky",
    evidence: "reverted",
    area: "core",
    hard: false,
    rootCauseFiles: ["src/config/parse.ts"],
    rootCauseHint: "null guard missing in parseConfig for empty input",
    ...p,
  };
}
