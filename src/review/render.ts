import type { Review, Finding, RiskLevel, Severity } from "./schema.js";

const RISK_BADGE: Record<RiskLevel, string> = {
  High: "\u{1F534} HIGH",
  Medium: "\u{1F7E1} MEDIUM",
  Low: "\u{1F7E2} LOW",
};

const SEV_DOT: Record<Severity, string> = {
  high: "\u{1F534}",
  medium: "\u{1F7E1}",
  low: "\u{1F7E2}",
};

const SEV_ORDER: Severity[] = ["high", "medium", "low"];

function cap(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function loc(f: Finding): string {
  return f.line == null ? f.file : `${f.file}:${f.line}`;
}

function renderFinding(f: Finding): string {
  return [
    `### ${SEV_DOT[f.severity]} ${cap(f.severity)} — ${loc(f)} — ${f.category}`,
    "",
    f.rationale.trim(),
    "",
    `→ Check: ${f.suggestedCheck.trim()}`,
  ].join("\n");
}

/** Pure: Review -> human-facing Markdown. No IO. */
export function renderReview(r: Review): string {
  const { pr } = r;
  const sorted = [...r.findings].sort(
    (a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity),
  );

  const out: string[] = [];
  out.push(`# Merge Risk: ${RISK_BADGE[r.risk]} — ${pr.repo} PR #${pr.number}`);
  out.push(`_${JSON.stringify(pr.title)}_`);
  out.push("");
  out.push(
    `base \`${pr.baseSha.slice(0, 10)}\` → head \`${pr.headSha.slice(0, 10)}\` · ` +
      `${pr.filesChanged} file${pr.filesChanged === 1 ? "" : "s"} · +${pr.additions} −${pr.deletions}`,
  );
  out.push("");
  out.push("## Summary");
  out.push(r.summary.trim());
  out.push("");

  out.push(`## Findings (${sorted.length})`);
  if (sorted.length === 0) {
    out.push("");
    out.push("_No specific concerns identified._");
  } else {
    for (const f of sorted) {
      out.push("");
      out.push(renderFinding(f));
    }
  }
  out.push("");

  out.push("## Manual checklist");
  if (sorted.length === 0) {
    out.push("- [ ] Standard review — nothing flagged for special attention");
  } else {
    for (const f of sorted) {
      out.push(`- [ ] (${f.severity}) ${loc(f)} — ${f.suggestedCheck.trim()}`);
    }
  }
  out.push("");
  out.push("---");
  out.push(
    `<sub>faultline · ${r.meta.mode} · ${r.meta.model} · ` +
      `${r.meta.toolCalls} tool calls · ${(r.meta.wallMs / 1000).toFixed(1)}s · ` +
      `$${r.meta.costUsd.toFixed(4)}</sub>`,
  );
  out.push("");
  return out.join("\n");
}
