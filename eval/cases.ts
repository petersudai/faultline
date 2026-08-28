import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const Case = z.object({
  id: z.string(),
  repo: z.string(),
  pr: z.number().int().positive(),
  title: z.string(),
  baseSha: z.string(),
  headSha: z.string(),
  label: z.enum(["risky", "clean"]),
  evidence: z.string(),
  area: z.string(),
  hard: z.boolean(),
  rootCauseFiles: z.array(z.string()),
  rootCauseHint: z.string(),
});
export type Case = z.infer<typeof Case>;

export function loadCases(opts: { ids?: string[] } = {}): Case[] {
  const path = join(process.cwd(), "eval", "dataset", "cases.jsonl");
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let cases = lines.map((line, i) => {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`cases.jsonl line ${i + 1}: not valid JSON`);
    }
    const parsed = Case.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `cases.jsonl line ${i + 1}: ${parsed.error.issues
          .map((x) => `${x.path.join(".")}: ${x.message}`)
          .join("; ")}`,
      );
    }
    return parsed.data;
  });

  if (opts.ids?.length) {
    const want = new Set(opts.ids);
    const found = cases.filter((c) => want.has(c.id));
    const missing = [...want].filter((id) => !found.some((c) => c.id === id));
    if (missing.length) throw new Error(`unknown case id(s): ${missing.join(", ")}`);
    cases = found;
  }
  return cases;
}
