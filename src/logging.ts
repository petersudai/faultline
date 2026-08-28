import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Structured run logging. Every LLM call and tool call is written here, which is
 * exactly deliverable #4 (agent trajectories): one JSON file per step, a
 * trajectory.jsonl stream, and a human-readable TRAJECTORY.md on finalize().
 */
export interface TrajectoryStep {
  seq: number;
  kind: "phase" | "llm" | "tool" | "error";
  label: string;
  input?: unknown;
  output?: unknown;
  meta?: Record<string, unknown>;
  ts: string;
}

export interface Logger {
  step(s: Omit<TrajectoryStep, "seq" | "ts">): void;
  artifact(name: string, content: string): void;
  finalize(): void;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function truncate(v: unknown, max = 1200): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  if (s == null) return "";
  return s.length > max ? s.slice(0, max) + `\n… (+${s.length - max} chars)` : s;
}

export function renderTrajectoryMd(
  steps: TrajectoryStep[],
  title = "Agent trajectory",
): string {
  const out: string[] = [`# ${title}`, ""];
  for (const s of steps) {
    if (s.kind === "phase") {
      out.push(`\n## [${s.seq}] ▸ ${s.label}`);
      if (s.meta) out.push("```json\n" + JSON.stringify(s.meta, null, 2) + "\n```");
      if (s.output) out.push("```json\n" + truncate(s.output, 600) + "\n```");
    } else if (s.kind === "llm") {
      const o = (s.output ?? {}) as { text?: string; toolUses?: unknown[] };
      out.push(`\n### [${s.seq}] model · ${s.label}`);
      if (s.meta) out.push(`_${JSON.stringify(s.meta)}_`);
      if (o.text) out.push("> " + truncate(o.text, 1500).replace(/\n/g, "\n> "));
      if (o.toolUses?.length)
        out.push("calls: `" + JSON.stringify(o.toolUses) + "`");
    } else if (s.kind === "tool") {
      out.push(`\n### [${s.seq}] tool · ${s.label}`);
      out.push("input: `" + JSON.stringify(s.input) + "`");
      out.push("```\n" + truncate(s.output, 1600) + "\n```");
    } else {
      out.push(`\n### [${s.seq}] ⚠ ${s.label}`);
      out.push("```\n" + truncate(s.output, 800) + "\n```");
    }
  }
  out.push("");
  return out.join("\n");
}

export class RunLogger implements Logger {
  private seq = 0;
  private ensured = false;
  private readonly steps: TrajectoryStep[] = [];
  readonly dir: string;
  readonly runId: string;

  constructor(baseDir: string, runId: string, caseId?: string) {
    this.runId = runId;
    this.dir = caseId ? join(baseDir, runId, caseId) : join(baseDir, runId);
  }

  private ensure(): void {
    if (!this.ensured) {
      mkdirSync(this.dir, { recursive: true });
      this.ensured = true;
    }
  }

  step(s: Omit<TrajectoryStep, "seq" | "ts">): void {
    this.ensure();
    const seq = ++this.seq;
    const rec: TrajectoryStep = { ...s, seq, ts: new Date().toISOString() };
    this.steps.push(rec);
    const name = `${String(seq).padStart(3, "0")}-${s.kind}-${slug(s.label)}.json`;
    writeFileSync(join(this.dir, name), JSON.stringify(rec, null, 2));
    appendFileSync(join(this.dir, "trajectory.jsonl"), JSON.stringify(rec) + "\n");
  }

  artifact(name: string, content: string): void {
    this.ensure();
    writeFileSync(join(this.dir, name), content);
  }

  finalize(): void {
    if (!this.steps.length) return;
    this.artifact("TRAJECTORY.md", renderTrajectoryMd(this.steps, `Trajectory ${this.runId}`));
  }
}

/** Discards everything. */
export const nullLogger: Logger = {
  step() {},
  artifact() {},
  finalize() {},
};
