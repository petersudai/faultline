import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Structured run logging. Every LLM call and tool call is written here, which is
 * exactly deliverable #4 (agent trajectories): one JSON file per step, plus a
 * trajectory.jsonl stream for easy diffing / replay.
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
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export class RunLogger implements Logger {
  private seq = 0;
  private ensured = false;
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
    const name = `${String(seq).padStart(3, "0")}-${s.kind}-${slug(s.label)}.json`;
    writeFileSync(join(this.dir, name), JSON.stringify(rec, null, 2));
    appendFileSync(join(this.dir, "trajectory.jsonl"), JSON.stringify(rec) + "\n");
  }

  /** Write an arbitrary artifact next to the trajectory (e.g. the final REVIEW.md). */
  artifact(name: string, content: string): void {
    this.ensure();
    writeFileSync(join(this.dir, name), content);
  }
}

/** Discards everything. Used by the baseline and by unit-style runs. */
export const nullLogger: Logger = {
  step() {},
  artifact() {},
};
