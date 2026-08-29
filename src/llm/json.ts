import { z } from "zod";

/**
 * Pull a JSON object out of a model response that may wrap it in ```json fences
 * or surround it with prose. Returns the first balanced {...} span that parses.
 */
/** every balanced {...} span at any position, ignoring braces inside strings */
function balancedObjects(text: string): string[] {
  const spans: string[] = [];
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        spans.push(text.slice(start, i + 1));
        break;
      }
    }
  }
  return spans;
}

export function extractJson(text: string): unknown {
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (m[1]) candidates.push(m[1].trim());
  }
  // longest balanced object first — the real payload is usually the biggest
  candidates.push(
    ...balancedObjects(text).sort((a, b) => b.length - a.length),
  );

  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  throw new Error("No parseable JSON object found in model response");
}

export function parseWith<T>(schema: z.ZodType<T>, text: string): T {
  const raw = extractJson(text);
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Model output failed schema validation:\n${result.error.issues
        .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n")}`,
    );
  }
  return result.data;
}
