import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { extractJson, parseWith } from "../src/llm/json.js";

test("bare object", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test("fenced json", () => {
  assert.deepEqual(
    extractJson('here you go:\n```json\n{"a":[1,2]}\n```\nthanks'),
    { a: [1, 2] },
  );
});

test("prose around object", () => {
  assert.deepEqual(
    extractJson('The review is {"summary":"x","findings":[]} — done.'),
    { summary: "x", findings: [] },
  );
});

test("braces inside strings do not confuse the scanner", () => {
  assert.deepEqual(
    extractJson('{"rationale":"handles the `{ ... }` case","n":2}'),
    { rationale: "handles the `{ ... }` case", n: 2 },
  );
});

test("nested objects", () => {
  assert.deepEqual(extractJson('x {"a":{"b":{"c":1}},"d":2} y'), {
    a: { b: { c: 1 } },
    d: 2,
  });
});

test("throws when no object present", () => {
  assert.throws(() => extractJson("no json here"));
});

test("parseWith surfaces schema errors", () => {
  const schema = z.object({ n: z.number() });
  assert.throws(
    () => parseWith(schema, '{"n":"not a number"}'),
    /schema validation/i,
  );
  assert.deepEqual(parseWith(schema, '{"n":5}'), { n: 5 });
});
