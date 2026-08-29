import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreOne, scoreAll } from "../eval/score.js";
import { finding, review, testCase } from "./helpers.js";

test("scoreOne: correct High on a risky case", () => {
  const s = scoreOne(testCase({ label: "risky" }), review({ risk: "High" }));
  assert.equal(s.predictedHigh, true);
  assert.equal(s.correct, true);
});

test("scoreOne: Medium on a risky case counts as a miss (not High)", () => {
  const s = scoreOne(testCase({ label: "risky" }), review({ risk: "Medium" }));
  assert.equal(s.predictedHigh, false);
  assert.equal(s.correct, false);
});

test("scoreOne: root-cause hit needs file match AND hint keyword overlap", () => {
  const c = testCase({
    label: "risky",
    rootCauseFiles: ["src/config/parse.ts"],
    rootCauseHint: "null guard missing in parseConfig for empty input",
  });

  const hit = scoreOne(
    c,
    review({
      risk: "High",
      findings: [
        finding({
          file: "src/config/parse.ts",
          severity: "high",
          rationale: "parseConfig lacks a null guard for empty input",
        }),
      ],
    }),
  );
  assert.equal(hit.rootCauseHit, true);
  assert.equal(hit.rootCauseBorderline, false);

  const borderline = scoreOne(
    c,
    review({
      risk: "High",
      findings: [
        finding({
          file: "src/config/parse.ts",
          severity: "high",
          rationale: "the formatting here is inconsistent",
        }),
      ],
    }),
  );
  assert.equal(borderline.rootCauseHit, false);
  assert.equal(borderline.rootCauseBorderline, true);

  const miss = scoreOne(
    c,
    review({
      risk: "High",
      findings: [finding({ file: "src/other.ts", rationale: "null guard missing" })],
    }),
  );
  assert.equal(miss.rootCauseHit, false);
  assert.equal(miss.rootCauseBorderline, false);
});

test("scoreOne: clean case has null rootCauseHit", () => {
  const s = scoreOne(testCase({ label: "clean" }), review({ risk: "Low" }));
  assert.equal(s.rootCauseHit, null);
});

test("scoreAll: confusion matrix + balanced accuracy", () => {
  const pairs = [
    // 3 risky: 2 High (TP), 1 Low (FN)
    { c: testCase({ id: "r1", label: "risky" }), review: review({ risk: "High" }) },
    { c: testCase({ id: "r2", label: "risky" }), review: review({ risk: "High" }) },
    { c: testCase({ id: "r3", label: "risky" }), review: review({ risk: "Low" }) },
    // 3 clean: 1 High (FP), 2 Low (TN)
    { c: testCase({ id: "n1", label: "clean" }), review: review({ risk: "High" }) },
    { c: testCase({ id: "n2", label: "clean" }), review: review({ risk: "Low" }) },
    { c: testCase({ id: "n3", label: "clean" }), review: review({ risk: "Low" }) },
  ];
  const s = scoreAll(pairs);
  assert.deepEqual(s.confusion, { tp: 2, fp: 1, tn: 2, fn: 1 });
  assert.equal(s.recall, 2 / 3);
  assert.equal(s.specificity, 2 / 3);
  assert.equal(s.balancedAccuracy, 2 / 3);
  assert.equal(s.accuracy, 4 / 6);
});

test("scoreAll: false-alarm rate = mean high findings per clean PR", () => {
  const pairs = [
    {
      c: testCase({ id: "n1", label: "clean" }),
      review: review({
        risk: "High",
        findings: [finding({ severity: "high" }), finding({ severity: "high" })],
      }),
    },
    {
      c: testCase({ id: "n2", label: "clean" }),
      review: review({ risk: "Low", findings: [finding({ severity: "low" })] }),
    },
  ];
  assert.equal(scoreAll(pairs).falseAlarmRate, 1); // (2 + 0) / 2
});

test("scoreAll: hard-case tally", () => {
  const pairs = [
    { c: testCase({ id: "h1", label: "risky", hard: true }), review: review({ risk: "High" }) },
    { c: testCase({ id: "h2", label: "clean", hard: true }), review: review({ risk: "High" }) },
  ];
  const s = scoreAll(pairs);
  assert.equal(s.hardTotal, 2);
  assert.equal(s.hardCorrect, 1);
});

test("scoreAll: Brier score rewards calibrated scores", () => {
  const confident = [
    { c: testCase({ id: "r", label: "risky" }), review: review({ risk: "High", modelRiskScore: 1 }) },
    { c: testCase({ id: "n", label: "clean" }), review: review({ risk: "Low", modelRiskScore: 0 }) },
  ];
  const wrong = [
    { c: testCase({ id: "r", label: "risky" }), review: review({ risk: "High", modelRiskScore: 0 }) },
    { c: testCase({ id: "n", label: "clean" }), review: review({ risk: "Low", modelRiskScore: 1 }) },
  ];
  assert.equal(scoreAll(confident).brierModel, 0);
  assert.equal(scoreAll(wrong).brierModel, 1);
});

test("scoreAll: calibration bins report observed revert rate", () => {
  const pairs = [
    { c: testCase({ id: "a", label: "risky" }), review: review({ risk: "High", modelRiskScore: 0.9 }) },
    { c: testCase({ id: "b", label: "clean" }), review: review({ risk: "High", modelRiskScore: 0.9 }) },
  ];
  const bin = scoreAll(pairs).calibrationModel.find((b) => b.lo === 0.8);
  assert.ok(bin);
  assert.equal(bin!.n, 2);
  assert.equal(bin!.observedRiskyRate, 0.5); // 1 of 2 in the 0.8+ bin was risky
});
