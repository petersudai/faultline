import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRisk } from "../src/review/classify.js";
import { finding } from "./helpers.js";

test("any high finding => High", () => {
  assert.equal(classifyRisk([finding({ severity: "high" })]), "High");
  assert.equal(
    classifyRisk([finding({ severity: "low" }), finding({ severity: "high" })]),
    "High",
  );
});

test("at least one medium, no high => Medium", () => {
  assert.equal(classifyRisk([finding({ severity: "medium" })]), "Medium");
  assert.equal(
    classifyRisk([finding({ severity: "medium" }), finding({ severity: "medium" })]),
    "Medium",
  );
});

test("only low or empty => Low", () => {
  assert.equal(classifyRisk([]), "Low");
  assert.equal(classifyRisk([finding({ severity: "low" })]), "Low");
});
