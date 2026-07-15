// Statistical engine smoke tests.
//
// We exercise the routing logic — assumption checks → parametric vs
// nonparametric — and validate the math on a handful of small fixtures.
//
// To run: `npm run test:stats` (compiles statistics.ts then invokes
// `node --test`).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareSamples,
  meanConfidenceInterval,
  evaluateAssumptions,
  formatPValue,
  computeCompactLetterDisplay,
  cochransQTest,
  analyzeCata,
} from "./dist/statistics.js";

function buildSample(sampleNumber, label, valuesByRespondentObj) {
  const map = new Map(Object.entries(valuesByRespondentObj));
  return {
    sampleNumber,
    sampleLabel: label,
    valuesByRespondent: map,
  };
}

test("two repeated-measures samples with normal differences picks paired t-test", () => {
  const left = buildSample(1, "A", Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(i), 7])));
  const right = buildSample(2, "B", Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(i), 7 + (i % 2 === 0 ? 0.4 : -0.3)])));
  const result = compareSamples([left, right], { studyDesign: "WITHIN_SUBJECT" });
  assert.equal(result.repeatedMeasures, true);
  assert.ok(["PAIRED_T_TEST", "WILCOXON_SIGNED_RANK"].includes(result.test));
  assert.ok(result.assumptionChecks);
});

test("two independent samples, large groups, equal variance → Student's t", () => {
  const left = buildSample(1, "A", Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`L${i}`, 6 + (i % 4) * 0.2])));
  const right = buildSample(2, "B", Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`R${i}`, 7 + (i % 4) * 0.2])));
  const result = compareSamples([left, right], { studyDesign: "MONADIC" });
  assert.equal(result.repeatedMeasures, false);
  assert.ok(["STUDENT_T_TEST", "WELCH_T_TEST"].includes(result.test));
  assert.ok(result.effectSize, "Cohen's d should be returned");
  assert.equal(result.effectSize?.name, "COHENS_D");
});

test("two independent samples, small N → falls back to Mann-Whitney", () => {
  const left = buildSample(1, "A", { a: 6, b: 7, c: 6, d: 5, e: 6 });
  const right = buildSample(2, "B", { f: 7, g: 8, h: 8, i: 7, j: 8 });
  const result = compareSamples([left, right], { studyDesign: "MONADIC" });
  assert.equal(result.test, "MANN_WHITNEY_U");
  assert.equal(result.effectSize?.name, "RANK_BISERIAL");
});

test("three+ within-subject normal samples uses repeated-measures ANOVA when assumptions pass", () => {
  const respondents = Array.from({ length: 40 }, (_, i) => `R${i}`);
  const a = buildSample(1, "A", Object.fromEntries(respondents.map((r, i) => [r, 6 + (i % 5) * 0.2])));
  const b = buildSample(2, "B", Object.fromEntries(respondents.map((r, i) => [r, 7 + (i % 5) * 0.2])));
  const c = buildSample(3, "C", Object.fromEntries(respondents.map((r, i) => [r, 6.5 + (i % 5) * 0.2])));
  const result = compareSamples([a, b, c], { studyDesign: "WITHIN_SUBJECT" });
  assert.ok(["REPEATED_MEASURES_ANOVA", "FRIEDMAN"].includes(result.test));
  assert.equal(result.repeatedMeasures, true);
  if (result.test === "REPEATED_MEASURES_ANOVA") {
    assert.equal(result.effectSize?.name, "PARTIAL_ETA_SQUARED");
  }
});

test("three+ within-subject samples with significant separation triggers post-hoc results", () => {
  // Pseudo-random subject noise so error variance > 0 and the design has
  // both between-condition signal and within-subject noise.
  const respondents = Array.from({ length: 40 }, (_, i) => `R${i}`);
  const noise = (i, salt) => Math.sin(i * 12.9898 + salt * 78.233) * 0.4;
  const a = buildSample(1, "A", Object.fromEntries(respondents.map((r, i) => [r, 6 + noise(i, 1)])));
  const b = buildSample(2, "B", Object.fromEntries(respondents.map((r, i) => [r, 8 + noise(i, 2)])));
  const c = buildSample(3, "C", Object.fromEntries(respondents.map((r, i) => [r, 7 + noise(i, 3)])));
  const result = compareSamples([a, b, c], { studyDesign: "WITHIN_SUBJECT" });
  assert.ok(result.pValue !== null, `Expected non-null p-value, got ${result.pValue}`);
  assert.ok((result.pValue ?? 1) < 0.05, `Expected significant result, got p=${result.pValue}`);
  assert.ok(result.postHocResults.length >= 1);
});

test("three+ independent samples with non-normal data falls back to Kruskal-Wallis + Dunn's", () => {
  const a = buildSample(1, "A", Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`a${i}`, [1, 1, 9, 9, 1, 9, 1, 9][i]])));
  const b = buildSample(2, "B", Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`b${i}`, [9, 9, 9, 9, 9, 9, 9, 9][i]])));
  const c = buildSample(3, "C", Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`c${i}`, [1, 1, 1, 1, 1, 1, 1, 1][i]])));
  const result = compareSamples([a, b, c], { studyDesign: "MONADIC" });
  assert.equal(result.test, "KRUSKAL_WALLIS");
  assert.ok(result.postHocResults.length >= 1);
  assert.equal(result.postHocResults[0].method, "Dunn's test, Bonferroni-corrected");
});

test("descriptive-only path when only one sample is provided", () => {
  const a = buildSample(1, "A", { x: 7, y: 8, z: 6 });
  const result = compareSamples([a], { studyDesign: "MONADIC" });
  assert.equal(result.test, "DESCRIPTIVE_ONLY");
  assert.equal(result.pValue, null);
});

test("design mismatch (within-subject configured, partial overlap) emits warning", () => {
  const left = buildSample(1, "A", { a: 6, b: 7, c: 8, d: 7, e: 6 });
  const right = buildSample(2, "B", { a: 6, b: 7, c: 8, f: 7, g: 6 });
  const result = compareSamples([left, right], { studyDesign: "WITHIN_SUBJECT" });
  assert.equal(result.repeatedMeasures, false);
  assert.ok(result.warnings.some((message) => /within-subject/i.test(message)));
});

test("evaluateAssumptions reports nonparametric when normality clearly fails", () => {
  const skewed = Array.from({ length: 40 }, (_, i) => (i < 35 ? 9 : 1));
  const summary = evaluateAssumptions([skewed], false);
  assert.equal(summary.recommendedPathway, "NONPARAMETRIC");
});

test("meanConfidenceInterval returns sensible CI for trivial data", () => {
  const ci = meanConfidenceInterval([7, 7, 7, 7], 0.95);
  assert.deepEqual(ci, { level: 0.95, lower: 7, upper: 7, marginOfError: 0 });
});

test("formatPValue rounds and clamps small probabilities", () => {
  assert.equal(formatPValue(0.0009), "< 0.001");
  assert.equal(formatPValue(0.04321), "0.043");
  assert.equal(formatPValue(null), "N/A");
});

test("compact letter display: all-equal samples get the same letter", () => {
  const letters = computeCompactLetterDisplay(["A", "B", "C"], [
    { groupA: "A", groupB: "B", significant: false },
    { groupA: "A", groupB: "C", significant: false },
    { groupA: "B", groupB: "C", significant: false },
  ]);
  assert.equal(letters.get("A"), "a");
  assert.equal(letters.get("B"), "a");
  assert.equal(letters.get("C"), "a");
});

test("compact letter display: A and B differ but C overlaps both", () => {
  const letters = computeCompactLetterDisplay(["A", "B", "C"], [
    { groupA: "A", groupB: "B", significant: true },
    { groupA: "A", groupB: "C", significant: false },
    { groupA: "B", groupB: "C", significant: false },
  ]);
  assert.equal(letters.get("A"), "a");
  assert.equal(letters.get("B"), "b");
  assert.equal(letters.get("C"), "ab");
});

test("post-hoc empty when ANOVA is not significant", () => {
  const respondents = Array.from({ length: 30 }, (_, i) => `R${i}`);
  const a = buildSample(1, "A", Object.fromEntries(respondents.map((r) => [r, 7])));
  const b = buildSample(2, "B", Object.fromEntries(respondents.map((r) => [r, 7])));
  const c = buildSample(3, "C", Object.fromEntries(respondents.map((r) => [r, 7])));
  const result = compareSamples([a, b, c], { studyDesign: "WITHIN_SUBJECT" });
  assert.equal(result.postHocResults.length, 0);
});

test("Cochran's Q: strong across-sample difference is significant", () => {
  // 5 subjects check the term for sample A but never for B or C.
  const matrix = Array.from({ length: 5 }, () => [1, 0, 0]);
  const { Q, df, pValue } = cochransQTest(matrix);
  assert.equal(Q, 10);
  assert.equal(df, 2);
  assert.ok(pValue !== null && pValue < 0.05, `expected significant, got p=${pValue}`);
});

test("Cochran's Q: all-constant rows yield Q=0, p=1", () => {
  const matrix = [
    [1, 1, 1],
    [0, 0, 0],
    [1, 1, 1],
  ];
  const { Q, pValue } = cochransQTest(matrix);
  assert.equal(Q, 0);
  assert.equal(pValue, 1);
});

test("Cochran's Q: fewer than 2 samples is not computable", () => {
  const { pValue } = cochransQTest([[1], [0], [1]]);
  assert.equal(pValue, null);
});

test("analyzeCata: frequencies and percentages are correct", () => {
  const result = analyzeCata(
    ["Sweet", "Bitter"],
    ["A", "B"],
    [
      { respondentId: "r1", checksBySample: { A: ["Sweet"], B: ["Bitter"] } },
      { respondentId: "r2", checksBySample: { A: ["Sweet"], B: [] } },
      { respondentId: "r3", checksBySample: { A: ["Sweet"], B: ["Bitter"] } },
    ]
  );
  assert.deepEqual(result.respondentsPerSample, [3, 3]);
  assert.equal(result.completeCaseCount, 3);
  const sweet = result.terms.find((t) => t.term === "Sweet");
  const bitter = result.terms.find((t) => t.term === "Bitter");
  assert.deepEqual(sweet.countsBySample, [3, 0]);
  assert.deepEqual(sweet.percentBySample, [100, 0]);
  assert.deepEqual(bitter.countsBySample, [0, 2]);
  // Every term gets a Cochran's Q p-value in [0, 1] when complete cases exist.
  for (const term of result.terms) {
    assert.ok(term.pValue !== null && term.pValue >= 0 && term.pValue <= 1);
  }
});
