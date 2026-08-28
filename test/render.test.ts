import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReview } from "../src/review/render.js";
import { finding, review } from "./helpers.js";

test("renders risk badge, summary, findings, checklist", () => {
  const md = renderReview(
    review({
      risk: "High",
      summary: "Adds a null guard.",
      findings: [
        finding({ severity: "high", file: "src/a.ts", line: 42, suggestedCheck: "check callers" }),
      ],
    }),
  );
  assert.match(md, /Merge Risk: .* HIGH/);
  assert.match(md, /Adds a null guard\./);
  assert.match(md, /src\/a\.ts:42/);
  assert.match(md, /## Manual checklist/);
  assert.match(md, /- \[ \] \(high\) src\/a\.ts:42 — check callers/);
});

test("findings are ordered high -> medium -> low", () => {
  const md = renderReview(
    review({
      risk: "High",
      findings: [
        finding({ severity: "low", rationale: "LOW-ONE" }),
        finding({ severity: "high", rationale: "HIGH-ONE" }),
        finding({ severity: "medium", rationale: "MED-ONE" }),
      ],
    }),
  );
  const iHigh = md.indexOf("HIGH-ONE");
  const iMed = md.indexOf("MED-ONE");
  const iLow = md.indexOf("LOW-ONE");
  assert.ok(iHigh < iMed && iMed < iLow, "severity order");
});

test("no findings => explicit low-risk checklist", () => {
  const md = renderReview(review({ risk: "Low", findings: [] }));
  assert.match(md, /No specific concerns identified/);
  assert.match(md, /nothing flagged for special attention/);
});

test("file-level finding (null line) renders without :line", () => {
  const md = renderReview(
    review({
      risk: "Medium",
      findings: [finding({ severity: "medium", file: "src/b.ts", line: null })],
    }),
  );
  assert.match(md, /Medium — src\/b\.ts —/);
  assert.doesNotMatch(md, /src\/b\.ts:null/);
});
