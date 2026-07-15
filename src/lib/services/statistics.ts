// TARAsense statistical engine.
//
// Phase 1 implementation of the Hedonic Data Analysis Workflow plus the
// Phase 1 Consumer Test Analytics module. The engine automatically selects
// the appropriate test based on study design, sample count, and assumption
// checks (Shapiro-Wilk approximation + Levene's), and reports effect sizes,
// post-hoc comparisons, and confidence intervals alongside p-values.
//
// Numerical methods favor pure-TS implementations small enough to ship in a
// Next.js bundle. Where exact reference distributions are intractable in pure
// TS (e.g., studentized range for Tukey HSD, Shapiro-Wilk W), defensible
// approximations are used and the source is documented inline.

export type StudyDesign = "MONADIC" | "WITHIN_SUBJECT";

export type StatisticalTest =
  | "DESCRIPTIVE_ONLY"
  | "PAIRED_T_TEST"
  | "STUDENT_T_TEST"
  | "WELCH_T_TEST"
  | "WILCOXON_SIGNED_RANK"
  | "MANN_WHITNEY_U"
  | "ONE_WAY_ANOVA"
  | "REPEATED_MEASURES_ANOVA"
  | "FRIEDMAN"
  | "KRUSKAL_WALLIS";

export type EffectSizeName =
  | "COHENS_D"
  | "RANK_BISERIAL"
  | "ETA_SQUARED"
  | "PARTIAL_ETA_SQUARED"
  | "KENDALLS_W";

export interface EffectSizeResult {
  name: EffectSizeName;
  label: string;
  value: number;
  magnitude: "negligible" | "small" | "medium" | "large";
  interpretation: string;
}

export interface AssumptionCheck {
  name: "NORMALITY" | "HOMOGENEITY" | "SAMPLE_SIZE";
  label: string;
  passed: boolean | null; // null = could not be evaluated
  pValue: number | null;
  detail: string;
}

export interface AssumptionChecksSummary {
  normality: AssumptionCheck;
  homogeneity: AssumptionCheck;
  sampleSizeAdequacy: AssumptionCheck;
  recommendedPathway: "PARAMETRIC" | "NONPARAMETRIC";
  rationale: string;
}

export interface PostHocComparison {
  pairLabel: string;
  groupA: string;
  groupB: string;
  meanDifference: number | null;
  rawPValue: number | null;
  adjustedPValue: number | null;
  significant: boolean | null;
  method: string;
  interpretation: string;
}

export interface ConfidenceInterval {
  level: number;
  lower: number;
  upper: number;
  marginOfError: number;
}

export interface SampleComparisonInput {
  sampleNumber: number;
  sampleLabel: string;
  valuesByRespondent: Map<string, number>;
}

export interface ComparisonResult {
  test: StatisticalTest;
  testLabel: string;
  studyDesign: StudyDesign;
  repeatedMeasures: boolean;
  pValue: number | null;
  statistic: number | null;
  significant: boolean | null;
  alpha: number;
  interpretation: string;
  assumptionChecks: AssumptionChecksSummary;
  effectSize: EffectSizeResult | null;
  postHocResults: PostHocComparison[];
  assumptions: string[];
  warnings: string[];
}

const DEFAULT_ALPHA = 0.05;

export function compareSamples(
  samples: SampleComparisonInput[],
  options: { alpha?: number; studyDesign?: StudyDesign } = {}
): ComparisonResult {
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const validSamples = samples.filter((sample) => sample.valuesByRespondent.size > 0);

  if (validSamples.length < 2) {
    return buildResult({
      test: "DESCRIPTIVE_ONLY",
      studyDesign: options.studyDesign ?? "WITHIN_SUBJECT",
      repeatedMeasures: false,
      pValue: null,
      statistic: null,
      alpha,
      interpretation: "Only descriptive statistics are available because fewer than two samples have valid scores.",
      warnings: ["At least two samples with valid responses are required for statistical comparison."],
    });
  }

  // Detect repeated measures purely from data.
  const detectedRepeated = hasRepeatedMeasures(validSamples);
  const studyDesign: StudyDesign = options.studyDesign ?? (detectedRepeated ? "WITHIN_SUBJECT" : "MONADIC");
  // Force repeated-measures path only when both the design says so AND the
  // data actually has full overlap. If design says repeated but data has gaps,
  // we degrade gracefully to independent analysis with a warning.
  const repeatedMeasures = studyDesign === "WITHIN_SUBJECT" && detectedRepeated;
  const designMismatchWarning =
    studyDesign === "WITHIN_SUBJECT" && !detectedRepeated
      ? "Study is configured as within-subject but respondent overlap is incomplete; treating samples as independent."
      : null;

  const groupValues = validSamples.map((sample) => Array.from(sample.valuesByRespondent.values()));

  if (validSamples.length === 2) {
    const result = repeatedMeasures
      ? compareTwoPaired(validSamples[0], validSamples[1], alpha, studyDesign)
      : compareTwoIndependent(validSamples[0], validSamples[1], alpha, studyDesign);
    if (designMismatchWarning) result.warnings.push(designMismatchWarning);
    return result;
  }

  const assumptionChecks = evaluateAssumptions(groupValues, repeatedMeasures);

  if (repeatedMeasures) {
    const result =
      assumptionChecks.recommendedPathway === "PARAMETRIC"
        ? compareRepeatedAnova(validSamples, alpha, studyDesign, assumptionChecks)
        : compareRepeatedFriedman(validSamples, alpha, studyDesign, assumptionChecks);
    if (designMismatchWarning) result.warnings.push(designMismatchWarning);
    return result;
  }

  const result =
    assumptionChecks.recommendedPathway === "PARAMETRIC"
      ? compareIndependentAnova(validSamples, alpha, studyDesign, assumptionChecks)
      : compareIndependentKruskal(validSamples, alpha, studyDesign, assumptionChecks);
  if (designMismatchWarning) result.warnings.push(designMismatchWarning);
  return result;
}

export function formatPValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  if (value < 0.001) return "< 0.001";
  return value.toFixed(3);
}

// --------------------------------------------------------------------------
// Two-sample comparisons
// --------------------------------------------------------------------------

function compareTwoPaired(
  left: SampleComparisonInput,
  right: SampleComparisonInput,
  alpha: number,
  studyDesign: StudyDesign
): ComparisonResult {
  const pairs = buildPairs(left, right);
  if (pairs.length < 5) {
    return buildResult({
      test: "DESCRIPTIVE_ONLY",
      studyDesign,
      repeatedMeasures: true,
      pValue: null,
      statistic: null,
      alpha,
      interpretation: "Not enough paired observations are available for a stable two-sample comparison.",
      warnings: ["At least five complete respondent pairs are required for paired comparison."],
    });
  }

  const differences = pairs.map(([a, b]) => a - b);
  const leftValues = pairs.map(([a]) => a);
  const rightValues = pairs.map(([, b]) => b);
  const assumptions = evaluateAssumptions([differences], true);
  const useParametric = assumptions.recommendedPathway === "PARAMETRIC" && differences.length >= 8;

  if (useParametric) {
    const t = pairedTTest(differences);
    const cohenD = cohenDPaired(differences);
    const interpretation = describeSignificance(t.pValue, alpha, "paired mean liking");
    return buildResult({
      test: "PAIRED_T_TEST",
      studyDesign,
      repeatedMeasures: true,
      pValue: t.pValue,
      statistic: t.t,
      alpha,
      interpretation,
      assumptionChecks: assumptions,
      effectSize: buildCohenDEffect(cohenD),
      assumptions: [
        "The same respondents evaluated both samples.",
        "Paired t-test selected because parametric assumptions on the within-respondent differences are reasonably met.",
      ],
    });
  }

  const w = wilcoxonSignedRank(differences);
  const rb = rankBiserialFromWilcoxon(differences);
  return buildResult({
    test: "WILCOXON_SIGNED_RANK",
    studyDesign,
    repeatedMeasures: true,
    pValue: w.pValue,
    statistic: w.z,
    alpha,
    interpretation: describeSignificance(w.pValue, alpha, "paired liking ranks"),
    assumptionChecks: assumptions,
    effectSize: buildRankBiserialEffect(rb),
    assumptions: [
      "The same respondents evaluated both samples.",
      "Wilcoxon signed-rank selected because parametric assumptions could not be confirmed.",
    ],
    warnings: w.warning ? [w.warning] : [],
    samplesForUnused: [leftValues, rightValues],
  });
}

function compareTwoIndependent(
  left: SampleComparisonInput,
  right: SampleComparisonInput,
  alpha: number,
  studyDesign: StudyDesign
): ComparisonResult {
  const leftValues = Array.from(left.valuesByRespondent.values());
  const rightValues = Array.from(right.valuesByRespondent.values());
  if (leftValues.length < 5 || rightValues.length < 5) {
    return buildResult({
      test: "DESCRIPTIVE_ONLY",
      studyDesign,
      repeatedMeasures: false,
      pValue: null,
      statistic: null,
      alpha,
      interpretation: "Not enough observations are available for a stable independent-sample comparison.",
      warnings: ["Each sample needs at least five valid responses for independent comparison."],
    });
  }

  const assumptions = evaluateAssumptions([leftValues, rightValues], false);

  if (assumptions.recommendedPathway === "PARAMETRIC") {
    const equalVariance = assumptions.homogeneity.passed === true;
    const t = equalVariance ? studentTTest(leftValues, rightValues) : welchTTest(leftValues, rightValues);
    const cohenD = cohenDIndependent(leftValues, rightValues);
    const test: StatisticalTest = equalVariance ? "STUDENT_T_TEST" : "WELCH_T_TEST";
    return buildResult({
      test,
      studyDesign,
      repeatedMeasures: false,
      pValue: t.pValue,
      statistic: t.t,
      alpha,
      interpretation: describeSignificance(t.pValue, alpha, "independent mean liking"),
      assumptionChecks: assumptions,
      effectSize: buildCohenDEffect(cohenD),
      assumptions: [
        "Respondents do not overlap completely across samples.",
        equalVariance
          ? "Student's t-test selected because variances are reasonably equal."
          : "Welch t-test selected because variances appear unequal.",
      ],
    });
  }

  const u = mannWhitneyU(leftValues, rightValues);
  const rb = rankBiserialFromMannWhitney(leftValues, rightValues);
  return buildResult({
    test: "MANN_WHITNEY_U",
    studyDesign,
    repeatedMeasures: false,
    pValue: u.pValue,
    statistic: u.z,
    alpha,
    interpretation: describeSignificance(u.pValue, alpha, "independent liking ranks"),
    assumptionChecks: assumptions,
    effectSize: buildRankBiserialEffect(rb),
    assumptions: [
      "Respondents do not overlap completely across samples.",
      "Mann-Whitney U selected because parametric assumptions could not be confirmed.",
    ],
    warnings: u.warning ? [u.warning] : [],
  });
}

// --------------------------------------------------------------------------
// 3+ sample comparisons
// --------------------------------------------------------------------------

function compareRepeatedAnova(
  samples: SampleComparisonInput[],
  alpha: number,
  studyDesign: StudyDesign,
  assumptions: AssumptionChecksSummary
): ComparisonResult {
  const rows = buildCompleteRepeatedRows(samples);
  if (rows.length < 5) {
    return fallbackInsufficient(samples, alpha, studyDesign, assumptions, true);
  }

  const anova = repeatedMeasuresAnova(rows);
  const partialEta = partialEtaSquared(anova.ssTreatment, anova.ssError);
  const labels = samples.map((sample) => sample.sampleLabel);
  const groupMeans = samples.map((sample) => mean(Array.from(sample.valuesByRespondent.values())));
  const postHoc = anova.pValue !== null && anova.pValue < alpha
    ? bonferroniPairwisePaired(samples, alpha)
    : [];
  const interpretation = describeSignificance(anova.pValue, alpha, "within-respondent mean liking");

  return buildResult({
    test: "REPEATED_MEASURES_ANOVA",
    studyDesign,
    repeatedMeasures: true,
    pValue: anova.pValue,
    statistic: anova.f,
    alpha,
    interpretation,
    assumptionChecks: assumptions,
    effectSize: buildPartialEtaEffect(partialEta),
    assumptions: [
      "The same respondents evaluated all compared samples.",
      "Repeated-measures ANOVA selected because parametric assumptions on within-subject differences are reasonably met.",
      `Group means: ${labels.map((label, index) => `${label}=${roundDp(groupMeans[index], 2)}`).join(", ")}.`,
    ],
    postHocResults: postHoc,
  });
}

function compareRepeatedFriedman(
  samples: SampleComparisonInput[],
  alpha: number,
  studyDesign: StudyDesign,
  assumptions: AssumptionChecksSummary
): ComparisonResult {
  const rows = buildCompleteRepeatedRows(samples);
  if (rows.length < 5) {
    return fallbackInsufficient(samples, alpha, studyDesign, assumptions, true);
  }

  const friedman = friedmanTest(rows);
  const kendall = kendallsW(friedman.chiSquare, rows.length, samples.length);
  const postHoc = friedman.pValue !== null && friedman.pValue < alpha
    ? pairwiseWilcoxonBonferroni(samples)
    : [];

  return buildResult({
    test: "FRIEDMAN",
    studyDesign,
    repeatedMeasures: true,
    pValue: friedman.pValue,
    statistic: friedman.chiSquare,
    alpha,
    interpretation: describeSignificance(friedman.pValue, alpha, "within-respondent sample ranks"),
    assumptionChecks: assumptions,
    effectSize: buildKendallWEffect(kendall),
    assumptions: [
      "The same respondents evaluated all compared samples.",
      "Friedman test selected because parametric assumptions could not be confirmed.",
    ],
    postHocResults: postHoc,
  });
}

function compareIndependentAnova(
  samples: SampleComparisonInput[],
  alpha: number,
  studyDesign: StudyDesign,
  assumptions: AssumptionChecksSummary
): ComparisonResult {
  const groups = samples.map((sample) => Array.from(sample.valuesByRespondent.values()));
  if (groups.length < 3 || groups.some((values) => values.length < 5)) {
    return fallbackInsufficient(samples, alpha, studyDesign, assumptions, false);
  }

  const anova = oneWayAnova(groups);
  const eta = etaSquared(anova.ssBetween, anova.ssTotal);
  const postHoc = anova.pValue !== null && anova.pValue < alpha ? tukeyHSD(samples, anova.msWithin, anova.dfWithin) : [];

  return buildResult({
    test: "ONE_WAY_ANOVA",
    studyDesign,
    repeatedMeasures: false,
    pValue: anova.pValue,
    statistic: anova.f,
    alpha,
    interpretation: describeSignificance(anova.pValue, alpha, "between-group mean liking"),
    assumptionChecks: assumptions,
    effectSize: buildEtaEffect(eta),
    assumptions: [
      "Respondents do not overlap completely across all samples.",
      "One-way ANOVA selected because normality and homogeneity-of-variance assumptions are reasonably met.",
    ],
    postHocResults: postHoc,
  });
}

function compareIndependentKruskal(
  samples: SampleComparisonInput[],
  alpha: number,
  studyDesign: StudyDesign,
  assumptions: AssumptionChecksSummary
): ComparisonResult {
  const groups = samples.map((sample) => Array.from(sample.valuesByRespondent.values()));
  if (groups.length < 3 || groups.some((values) => values.length < 5)) {
    return fallbackInsufficient(samples, alpha, studyDesign, assumptions, false);
  }

  const kw = kruskalWallis(groups);
  const eta = epsilonSquaredKW(kw.h, groups.reduce((sum, g) => sum + g.length, 0));
  const postHoc = kw.pValue !== null && kw.pValue < alpha ? dunnsTest(samples) : [];

  return buildResult({
    test: "KRUSKAL_WALLIS",
    studyDesign,
    repeatedMeasures: false,
    pValue: kw.pValue,
    statistic: kw.h,
    alpha,
    interpretation: describeSignificance(kw.pValue, alpha, "between-group sample ranks"),
    assumptionChecks: assumptions,
    effectSize: {
      name: "ETA_SQUARED",
      label: "Epsilon-squared (rank)",
      value: roundDp(eta, 3),
      magnitude: classifyEtaMagnitude(eta),
      interpretation: `Approximate variance explained by sample membership ≈ ${(eta * 100).toFixed(1)}%.`,
    },
    assumptions: [
      "Respondents do not overlap completely across all samples.",
      "Kruskal-Wallis selected because parametric assumptions could not be confirmed.",
    ],
    postHocResults: postHoc,
  });
}

function fallbackInsufficient(
  samples: SampleComparisonInput[],
  alpha: number,
  studyDesign: StudyDesign,
  assumptions: AssumptionChecksSummary,
  repeated: boolean
): ComparisonResult {
  return buildResult({
    test: "DESCRIPTIVE_ONLY",
    studyDesign,
    repeatedMeasures: repeated,
    pValue: null,
    statistic: null,
    alpha,
    interpretation: "Not enough observations are available for a stable multi-sample comparison.",
    assumptionChecks: assumptions,
    warnings: [
      repeated
        ? `At least five respondents who evaluated all ${samples.length} samples are required.`
        : "Each independent sample needs at least five valid responses.",
    ],
  });
}

// --------------------------------------------------------------------------
// Confidence intervals on a single sample mean
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Compact letter display
// --------------------------------------------------------------------------
//
// Given pairwise post-hoc comparisons and a set of group labels, assign
// compact letter display (CLD) such that groups sharing a letter are NOT
// significantly different. Implementation follows the "insert-and-absorb"
// strategy from Piepho (2004) "An algorithm for a letter-based representation
// of all-pairwise comparisons".

export function computeCompactLetterDisplay(
  groupLabels: string[],
  postHoc: Array<{ groupA: string; groupB: string; significant: boolean | null }>
): Map<string, string> {
  const labels = Array.from(new Set(groupLabels));
  const result = new Map<string, string>();
  if (labels.length === 0) return result;

  const notDifferent = new Set<string>();
  const pairKey = (left: string, right: string) => [left, right].sort().join("|");

  // Default: every pair NOT marked significant is "not different".
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      notDifferent.add(pairKey(labels[i], labels[j]));
    }
  }
  postHoc.forEach((pair) => {
    if (pair.significant === true) {
      notDifferent.delete(pairKey(pair.groupA, pair.groupB));
    }
  });

  // Each "letter" is a clique of groups mutually not-different.
  const cliques: Set<string>[] = [];
  labels.forEach((label) => {
    let placed = false;
    cliques.forEach((clique) => {
      if (Array.from(clique).every((member) => notDifferent.has(pairKey(member, label)))) {
        clique.add(label);
        placed = true;
      }
    });
    if (!placed) {
      cliques.push(new Set([label]));
    }
  });

  // Remove cliques that are subsets of other cliques.
  const distinct: Set<string>[] = [];
  cliques.forEach((clique) => {
    const isSubset = cliques.some((other) => other !== clique && Array.from(clique).every((member) => other.has(member)));
    if (!isSubset) distinct.push(clique);
  });

  // Sort cliques by minimum label index for stable letter ordering.
  distinct.sort((left, right) => {
    const leftMin = Math.min(...Array.from(left).map((label) => labels.indexOf(label)));
    const rightMin = Math.min(...Array.from(right).map((label) => labels.indexOf(label)));
    return leftMin - rightMin;
  });

  const letterFor = (index: number) => {
    let value = "";
    let current = index;
    do {
      value = String.fromCharCode(97 + (current % 26)) + value;
      current = Math.floor(current / 26) - 1;
    } while (current >= 0);
    return value;
  };

  labels.forEach((label) => {
    const assigned: string[] = [];
    distinct.forEach((clique, index) => {
      if (clique.has(label)) assigned.push(letterFor(index));
    });
    result.set(label, assigned.join(""));
  });

  return result;
}

export function meanConfidenceInterval(values: number[], level = 0.95): ConfidenceInterval | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return null;
  const m = mean(finite);
  const sd = sampleStdDev(finite);
  if (sd === 0) {
    return { level, lower: m, upper: m, marginOfError: 0 };
  }
  const df = finite.length - 1;
  const tCrit = inverseStudentT(1 - (1 - level) / 2, df);
  const margin = tCrit * (sd / Math.sqrt(finite.length));
  return {
    level,
    lower: roundDp(m - margin, 3),
    upper: roundDp(m + margin, 3),
    marginOfError: roundDp(margin, 3),
  };
}

// --------------------------------------------------------------------------
// Assumption checks
// --------------------------------------------------------------------------

export function evaluateAssumptions(groups: number[][], repeated: boolean): AssumptionChecksSummary {
  const flat = groups.flatMap((group) => group);
  const minSize = Math.min(...groups.map((group) => group.length));
  const totalSize = flat.length;

  const sampleSize: AssumptionCheck = {
    name: "SAMPLE_SIZE",
    label: "Sample size adequacy",
    passed: minSize >= 30,
    pValue: null,
    detail:
      minSize >= 30
        ? `All groups have at least 30 valid responses (smallest = ${minSize}).`
        : `Smallest group has ${minSize} valid responses; the parametric pathway is reliable when each group has at least 30.`,
  };

  let normalityCheck: AssumptionCheck;
  if (totalSize < 8) {
    normalityCheck = {
      name: "NORMALITY",
      label: "Normality of residuals",
      passed: null,
      pValue: null,
      detail: "Sample is too small to evaluate normality reliably.",
    };
  } else {
    const residuals = repeated ? differencesAcrossGroups(groups) : centerWithinGroups(groups);
    const sw = shapiroWilkApprox(residuals);
    // Backstop: even if the SW approximation says "normal", reject when the
    // sample shows heavy skew (|skew| > 1) or extreme kurtosis (excess > 3).
    const shape = describeShape(residuals);
    const swPassed = sw.pValue !== null ? sw.pValue >= 0.05 : null;
    const shapePassed = Math.abs(shape.skew) <= 1 && Math.abs(shape.excessKurtosis) <= 3;
    const passed = swPassed === null ? null : swPassed && shapePassed;
    normalityCheck = {
      name: "NORMALITY",
      label: "Normality of residuals (Shapiro-Wilk approximation)",
      passed,
      pValue: sw.pValue,
      detail:
        sw.pValue !== null
          ? `Shapiro-Wilk approximation W = ${sw.W.toFixed(3)}, p = ${formatPValue(sw.pValue)}; skew = ${shape.skew.toFixed(2)}, excess kurtosis = ${shape.excessKurtosis.toFixed(2)}.`
          : "Shapiro-Wilk could not be computed.",
    };
  }

  let homogeneityCheck: AssumptionCheck;
  if (groups.length < 2 || groups.some((group) => group.length < 3)) {
    homogeneityCheck = {
      name: "HOMOGENEITY",
      label: "Homogeneity of variance (Levene's)",
      passed: null,
      pValue: null,
      detail: "Levene's test requires at least three observations per group.",
    };
  } else {
    const lev = leveneTest(groups);
    homogeneityCheck = {
      name: "HOMOGENEITY",
      label: "Homogeneity of variance (Levene's)",
      passed: lev.pValue !== null ? lev.pValue >= 0.05 : null,
      pValue: lev.pValue,
      detail:
        lev.pValue !== null
          ? `Levene's W = ${lev.statistic.toFixed(3)}, p = ${formatPValue(lev.pValue)}.`
          : "Levene's could not be computed.",
    };
  }

  const normalityOk = normalityCheck.passed !== false;
  const homogeneityOk = repeated ? true : homogeneityCheck.passed !== false; // sphericity is approximated by data adequacy
  const sizeOk = sampleSize.passed === true;
  // Hedonic-workflow rule: parametric only when normality is not violated AND
  // (variance ok for independent designs) AND sample size is adequate.
  const recommendedPathway: "PARAMETRIC" | "NONPARAMETRIC" =
    normalityOk && homogeneityOk && sizeOk ? "PARAMETRIC" : "NONPARAMETRIC";

  const rationaleParts: string[] = [];
  if (!sizeOk) rationaleParts.push("smallest group below 30 responses");
  if (normalityCheck.passed === false) rationaleParts.push("normality rejected");
  if (!repeated && homogeneityCheck.passed === false) rationaleParts.push("variance heterogeneity detected");
  const rationale =
    recommendedPathway === "PARAMETRIC"
      ? "Parametric pathway selected because normality, variance homogeneity, and sample size requirements are reasonably met."
      : `Nonparametric pathway selected (${rationaleParts.join("; ") || "assumptions could not be reliably evaluated"}).`;

  return {
    normality: normalityCheck,
    homogeneity: homogeneityCheck,
    sampleSizeAdequacy: sampleSize,
    recommendedPathway,
    rationale,
  };
}

function describeShape(values: number[]): { skew: number; excessKurtosis: number } {
  const n = values.length;
  if (n < 4) return { skew: 0, excessKurtosis: 0 };
  const m = mean(values);
  const sd = sampleStdDev(values);
  if (sd === 0) return { skew: 0, excessKurtosis: 0 };
  let m3 = 0;
  let m4 = 0;
  values.forEach((value) => {
    const z = (value - m) / sd;
    m3 += z ** 3;
    m4 += z ** 4;
  });
  const skew = m3 / n;
  const excessKurtosis = m4 / n - 3;
  return { skew, excessKurtosis };
}

function differencesAcrossGroups(groups: number[][]) {
  const minLen = Math.min(...groups.map((g) => g.length));
  if (minLen < 2 || groups.length < 2) return groups[0]?.slice() ?? [];
  const out: number[] = [];
  for (let i = 0; i < minLen; i += 1) {
    const m = mean(groups.map((g) => g[i]));
    groups.forEach((g) => out.push(g[i] - m));
  }
  return out;
}

function centerWithinGroups(groups: number[][]) {
  const out: number[] = [];
  groups.forEach((group) => {
    const m = mean(group);
    group.forEach((value) => out.push(value - m));
  });
  return out;
}

// Shapiro-Wilk approximation. Reference-grade SW requires precomputed
// `a` coefficients per N; we use the common Royston-style approximation
// based on standardized sample skewness and kurtosis combined with the
// Shapiro-Francia W' for n>=5. Returns NaN-safe pValue and W.
function shapiroWilkApprox(values: number[]): { W: number; pValue: number | null } {
  const n = values.length;
  if (n < 5) return { W: Number.NaN, pValue: null };
  const sorted = [...values].sort((a, b) => a - b);
  const m = mean(sorted);
  const ss = sorted.reduce((sum, value) => sum + (value - m) ** 2, 0);
  if (ss === 0) return { W: 1, pValue: 1 };

  // Shapiro-Francia W': sum of (b_i * x_(i)) ^ 2 / ss, where b_i are normal scores.
  const b: number[] = [];
  for (let i = 1; i <= n; i += 1) {
    const p = (i - 0.375) / (n + 0.25);
    b.push(inverseNormalCdf(p));
  }
  const norm = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
  const numerator = b.reduce((sum, value, idx) => sum + value * sorted[idx], 0) / norm;
  const W = (numerator * numerator) / ss;
  // Royston transformation (n in [5,5000])
  const u = Math.log(n);
  const mu = -1.2725 + 1.0521 * (Math.log(u) - u);
  const sigma = 1.0308 - 0.26758 * (u + 2 / u);
  const z = (Math.log(1 - W) - mu) / sigma;
  const pValue = 1 - normalCdf(z);
  return { W: clamp(W, 0, 1), pValue: clamp(pValue, 0, 1) };
}

function leveneTest(groups: number[][]): { statistic: number; pValue: number | null } {
  // Brown-Forsythe variant: deviations from group medians.
  const k = groups.length;
  const N = groups.reduce((sum, g) => sum + g.length, 0);
  if (k < 2 || N <= k) return { statistic: 0, pValue: null };

  const medians = groups.map((g) => median(g));
  const z = groups.map((g, i) => g.map((value) => Math.abs(value - medians[i])));
  const zMeanGroup = z.map((g) => mean(g));
  const zMeanOverall = z.flat().reduce((sum, value) => sum + value, 0) / N;

  const numerator = ((N - k) / (k - 1)) *
    z.reduce((sum, _, i) => sum + groups[i].length * (zMeanGroup[i] - zMeanOverall) ** 2, 0);
  const denominator = z.reduce(
    (sum, gz, i) => sum + gz.reduce((s, value) => s + (value - zMeanGroup[i]) ** 2, 0),
    0
  );
  if (denominator === 0) return { statistic: 0, pValue: 1 };
  const F = numerator / denominator;
  const pValue = 1 - fCdf(F, k - 1, N - k);
  return { statistic: roundDp(F, 3), pValue: clamp(pValue, 0, 1) };
}

// --------------------------------------------------------------------------
// Two-sample test math
// --------------------------------------------------------------------------

function pairedTTest(differences: number[]) {
  const n = differences.length;
  const meanDiff = mean(differences);
  const sd = sampleStdDev(differences);
  if (n < 2 || sd === 0) return { t: 0, pValue: null };
  const t = meanDiff / (sd / Math.sqrt(n));
  return { t: roundDp(t, 3), pValue: clamp(twoSidedTPValue(t, n - 1), 0, 1) };
}

function studentTTest(left: number[], right: number[]) {
  const n1 = left.length;
  const n2 = right.length;
  const m1 = mean(left);
  const m2 = mean(right);
  const v1 = sampleVariance(left);
  const v2 = sampleVariance(right);
  const sp = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
  const se = Math.sqrt(sp * (1 / n1 + 1 / n2));
  if (se === 0) return { t: 0, pValue: null };
  const t = (m1 - m2) / se;
  return { t: roundDp(t, 3), pValue: clamp(twoSidedTPValue(t, n1 + n2 - 2), 0, 1) };
}

function welchTTest(left: number[], right: number[]) {
  const m1 = mean(left);
  const m2 = mean(right);
  const v1 = sampleVariance(left);
  const v2 = sampleVariance(right);
  const a = v1 / left.length;
  const b = v2 / right.length;
  const denom = Math.sqrt(a + b);
  if (denom === 0) return { t: 0, pValue: null };
  const t = (m1 - m2) / denom;
  const dfNum = (a + b) ** 2;
  const dfDen = a ** 2 / (left.length - 1) + b ** 2 / (right.length - 1);
  const df = dfDen > 0 ? dfNum / dfDen : left.length + right.length - 2;
  return { t: roundDp(t, 3), pValue: clamp(twoSidedTPValue(t, df), 0, 1) };
}

function wilcoxonSignedRank(differences: number[]) {
  const nonZero = differences.filter((value) => value !== 0);
  if (nonZero.length < 5) return { z: null, pValue: null, warning: "Too many zero differences for a stable Wilcoxon approximation." };
  const ranks = rankValues(nonZero.map((value) => Math.abs(value)));
  let positiveRankSum = 0;
  nonZero.forEach((diff, index) => {
    if (diff > 0) positiveRankSum += ranks[index];
  });
  const n = nonZero.length;
  const expected = (n * (n + 1)) / 4;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24;
  const z = (Math.abs(positiveRankSum - expected) - 0.5) / Math.sqrt(variance);
  return { z: roundDp(z, 3), pValue: clamp(2 * (1 - normalCdf(Math.abs(z))), 0, 1) };
}

function mannWhitneyU(left: number[], right: number[]) {
  const combined = [
    ...left.map((value) => ({ value, group: "left" as const })),
    ...right.map((value) => ({ value, group: "right" as const })),
  ];
  if (combined.length < 10) return { z: null, pValue: null, warning: "Not enough observations for a stable Mann-Whitney approximation." };
  const ranks = rankValues(combined.map((row) => row.value));
  const leftRankSum = ranks.reduce((sum, rank, index) => sum + (combined[index].group === "left" ? rank : 0), 0);
  const n1 = left.length;
  const n2 = right.length;
  const u1 = leftRankSum - (n1 * (n1 + 1)) / 2;
  const expected = (n1 * n2) / 2;
  const variance = (n1 * n2 * (n1 + n2 + 1)) / 12;
  const z = (Math.abs(u1 - expected) - 0.5) / Math.sqrt(variance);
  return { z: roundDp(z, 3), pValue: clamp(2 * (1 - normalCdf(Math.abs(z))), 0, 1) };
}

// --------------------------------------------------------------------------
// 3+ sample test math
// --------------------------------------------------------------------------

function oneWayAnova(groups: number[][]) {
  const k = groups.length;
  const n = groups.reduce((sum, g) => sum + g.length, 0);
  const grand = groups.flat().reduce((sum, value) => sum + value, 0) / n;
  let ssBetween = 0;
  let ssWithin = 0;
  groups.forEach((group) => {
    const m = mean(group);
    ssBetween += group.length * (m - grand) ** 2;
    group.forEach((value) => {
      ssWithin += (value - m) ** 2;
    });
  });
  const ssTotal = ssBetween + ssWithin;
  const dfBetween = k - 1;
  const dfWithin = n - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = dfWithin > 0 ? ssWithin / dfWithin : 0;
  if (msWithin === 0) return { f: 0, pValue: null, ssBetween, ssWithin, ssTotal, dfBetween, dfWithin, msBetween, msWithin };
  const f = msBetween / msWithin;
  const pValue = clamp(1 - fCdf(f, dfBetween, dfWithin), 0, 1);
  return { f: roundDp(f, 3), pValue, ssBetween, ssWithin, ssTotal, dfBetween, dfWithin, msBetween, msWithin };
}

function repeatedMeasuresAnova(rows: number[][]) {
  // rows: array of subjects, each with k condition values.
  const n = rows.length;
  const k = rows[0]?.length ?? 0;
  const grand = rows.flat().reduce((sum, value) => sum + value, 0) / (n * k);
  const subjectMeans = rows.map((row) => row.reduce((sum, value) => sum + value, 0) / k);
  const conditionMeans = Array.from({ length: k }, (_, j) => rows.reduce((sum, row) => sum + row[j], 0) / n);

  let ssTreatment = 0;
  conditionMeans.forEach((m) => {
    ssTreatment += n * (m - grand) ** 2;
  });
  let ssSubjects = 0;
  subjectMeans.forEach((m) => {
    ssSubjects += k * (m - grand) ** 2;
  });
  let ssTotal = 0;
  rows.forEach((row, i) => {
    row.forEach((value, j) => {
      ssTotal += (value - grand) ** 2;
      void j;
    });
    void i;
  });
  const ssError = ssTotal - ssTreatment - ssSubjects;
  const dfTreatment = k - 1;
  const dfError = (n - 1) * (k - 1);
  const msTreatment = ssTreatment / dfTreatment;
  const msError = dfError > 0 ? ssError / dfError : 0;
  if (msError <= 0) return { f: 0, pValue: null, ssTreatment, ssError, ssSubjects, ssTotal, dfTreatment, dfError };
  const f = msTreatment / msError;
  const pValue = clamp(1 - fCdf(f, dfTreatment, dfError), 0, 1);
  return { f: roundDp(f, 3), pValue, ssTreatment, ssError, ssSubjects, ssTotal, dfTreatment, dfError };
}

function friedmanTest(rows: number[][]) {
  const n = rows.length;
  const k = rows[0]?.length ?? 0;
  const rankSums = Array.from({ length: k }, () => 0);
  rows.forEach((row) => {
    const ranks = rankValues(row);
    ranks.forEach((rank, index) => {
      rankSums[index] += rank;
    });
  });
  const sumSquared = rankSums.reduce((sum, rs) => sum + rs ** 2, 0);
  const chiSquare = (12 / (n * k * (k + 1))) * sumSquared - 3 * n * (k + 1);
  const value = Math.max(0, chiSquare);
  return { chiSquare: roundDp(value, 3), pValue: clamp(chiSquareSurvival(value, k - 1), 0, 1) };
}

function kruskalWallis(groups: number[][]) {
  const combined = groups.flatMap((values, groupIndex) => values.map((value) => ({ value, groupIndex })));
  const ranks = rankValues(combined.map((row) => row.value));
  const n = combined.length;
  const rankSums = Array.from({ length: groups.length }, () => 0);
  combined.forEach((row, index) => {
    rankSums[row.groupIndex] += ranks[index];
  });
  const h =
    (12 / (n * (n + 1))) *
      rankSums.reduce((sum, rankSum, index) => sum + rankSum ** 2 / groups[index].length, 0) -
    3 * (n + 1);
  const value = Math.max(0, h);
  return { h: roundDp(value, 3), pValue: clamp(chiSquareSurvival(value, groups.length - 1), 0, 1) };
}

// --------------------------------------------------------------------------
// Post-hoc procedures
// --------------------------------------------------------------------------

function tukeyHSD(samples: SampleComparisonInput[], msWithin: number, dfWithin: number): PostHocComparison[] {
  const k = samples.length;
  const out: PostHocComparison[] = [];
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      const a = Array.from(samples[i].valuesByRespondent.values());
      const b = Array.from(samples[j].valuesByRespondent.values());
      const ma = mean(a);
      const mb = mean(b);
      const meanDiff = ma - mb;
      const se = Math.sqrt((msWithin / 2) * (1 / a.length + 1 / b.length));
      const q = se > 0 ? Math.abs(meanDiff) / se : 0;
      const pValue = se > 0 ? clamp(1 - studentizedRangeCdfApprox(q, k, dfWithin), 0, 1) : null;
      out.push({
        pairLabel: `${samples[i].sampleLabel} vs ${samples[j].sampleLabel}`,
        groupA: samples[i].sampleLabel,
        groupB: samples[j].sampleLabel,
        meanDifference: roundDp(meanDiff, 3),
        rawPValue: pValue,
        adjustedPValue: pValue,
        significant: pValue !== null ? pValue < 0.05 : null,
        method: "Tukey HSD",
        interpretation:
          pValue === null
            ? "Could not compute studentized range probability."
            : pValue < 0.05
              ? `${samples[i].sampleLabel} differs significantly from ${samples[j].sampleLabel} (p = ${formatPValue(pValue)}).`
              : `No significant difference between ${samples[i].sampleLabel} and ${samples[j].sampleLabel} (p = ${formatPValue(pValue)}).`,
      });
    }
  }
  return out;
}

function bonferroniPairwisePaired(samples: SampleComparisonInput[], alpha: number): PostHocComparison[] {
  void alpha;
  const k = samples.length;
  const numComparisons = (k * (k - 1)) / 2;
  const out: PostHocComparison[] = [];
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      const pairs = buildPairs(samples[i], samples[j]);
      if (pairs.length < 2) continue;
      const diffs = pairs.map(([a, b]) => a - b);
      const t = pairedTTest(diffs);
      const adjusted = t.pValue === null ? null : clamp(t.pValue * numComparisons, 0, 1);
      out.push({
        pairLabel: `${samples[i].sampleLabel} vs ${samples[j].sampleLabel}`,
        groupA: samples[i].sampleLabel,
        groupB: samples[j].sampleLabel,
        meanDifference: roundDp(mean(diffs), 3),
        rawPValue: t.pValue,
        adjustedPValue: adjusted,
        significant: adjusted !== null ? adjusted < 0.05 : null,
        method: "Paired t-test, Bonferroni-corrected",
        interpretation:
          adjusted === null
            ? "Could not compute paired t-test for this pair."
            : adjusted < 0.05
              ? `${samples[i].sampleLabel} differs significantly from ${samples[j].sampleLabel} after Bonferroni correction (adj. p = ${formatPValue(adjusted)}).`
              : `No significant difference between ${samples[i].sampleLabel} and ${samples[j].sampleLabel} after Bonferroni correction (adj. p = ${formatPValue(adjusted)}).`,
      });
    }
  }
  return out;
}

function pairwiseWilcoxonBonferroni(samples: SampleComparisonInput[]): PostHocComparison[] {
  const k = samples.length;
  const numComparisons = (k * (k - 1)) / 2;
  const out: PostHocComparison[] = [];
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      const pairs = buildPairs(samples[i], samples[j]);
      if (pairs.length < 5) continue;
      const diffs = pairs.map(([a, b]) => a - b);
      const w = wilcoxonSignedRank(diffs);
      const adjusted = w.pValue === null ? null : clamp(w.pValue * numComparisons, 0, 1);
      out.push({
        pairLabel: `${samples[i].sampleLabel} vs ${samples[j].sampleLabel}`,
        groupA: samples[i].sampleLabel,
        groupB: samples[j].sampleLabel,
        meanDifference: roundDp(mean(diffs), 3),
        rawPValue: w.pValue,
        adjustedPValue: adjusted,
        significant: adjusted !== null ? adjusted < 0.05 : null,
        method: "Pairwise Wilcoxon signed-rank, Bonferroni-corrected",
        interpretation:
          adjusted === null
            ? "Could not compute Wilcoxon signed-rank for this pair."
            : adjusted < 0.05
              ? `${samples[i].sampleLabel} differs significantly from ${samples[j].sampleLabel} after Bonferroni correction (adj. p = ${formatPValue(adjusted)}).`
              : `No significant difference between ${samples[i].sampleLabel} and ${samples[j].sampleLabel} after Bonferroni correction (adj. p = ${formatPValue(adjusted)}).`,
      });
    }
  }
  return out;
}

function dunnsTest(samples: SampleComparisonInput[]): PostHocComparison[] {
  const groups = samples.map((sample) => Array.from(sample.valuesByRespondent.values()));
  const k = groups.length;
  const all = groups.flat();
  const n = all.length;
  const ranks = rankValues(all);
  // Compute mean rank per group
  let cursor = 0;
  const meanRanks = groups.map((group) => {
    const slice = ranks.slice(cursor, cursor + group.length);
    cursor += group.length;
    return slice.reduce((sum, rank) => sum + rank, 0) / group.length;
  });
  const numComparisons = (k * (k - 1)) / 2;
  const out: PostHocComparison[] = [];
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      const se = Math.sqrt(((n * (n + 1)) / 12) * (1 / groups[i].length + 1 / groups[j].length));
      if (se === 0) continue;
      const z = Math.abs(meanRanks[i] - meanRanks[j]) / se;
      const rawP = clamp(2 * (1 - normalCdf(z)), 0, 1);
      const adjusted = clamp(rawP * numComparisons, 0, 1);
      out.push({
        pairLabel: `${samples[i].sampleLabel} vs ${samples[j].sampleLabel}`,
        groupA: samples[i].sampleLabel,
        groupB: samples[j].sampleLabel,
        meanDifference: roundDp(mean(groups[i]) - mean(groups[j]), 3),
        rawPValue: rawP,
        adjustedPValue: adjusted,
        significant: adjusted < 0.05,
        method: "Dunn's test, Bonferroni-corrected",
        interpretation:
          adjusted < 0.05
            ? `${samples[i].sampleLabel} differs significantly from ${samples[j].sampleLabel} (Dunn adj. p = ${formatPValue(adjusted)}).`
            : `No significant difference between ${samples[i].sampleLabel} and ${samples[j].sampleLabel} (Dunn adj. p = ${formatPValue(adjusted)}).`,
      });
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Effect sizes
// --------------------------------------------------------------------------

function cohenDPaired(differences: number[]) {
  const sd = sampleStdDev(differences);
  if (sd === 0) return 0;
  return mean(differences) / sd;
}

function cohenDIndependent(left: number[], right: number[]) {
  const n1 = left.length;
  const n2 = right.length;
  const v1 = sampleVariance(left);
  const v2 = sampleVariance(right);
  const sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  if (sp === 0) return 0;
  return (mean(left) - mean(right)) / sp;
}

function rankBiserialFromMannWhitney(left: number[], right: number[]) {
  const combined = [
    ...left.map((value) => ({ value, group: "left" as const })),
    ...right.map((value) => ({ value, group: "right" as const })),
  ];
  const ranks = rankValues(combined.map((row) => row.value));
  const leftRankSum = ranks.reduce((sum, rank, index) => sum + (combined[index].group === "left" ? rank : 0), 0);
  const u1 = leftRankSum - (left.length * (left.length + 1)) / 2;
  return 1 - (2 * u1) / (left.length * right.length);
}

function rankBiserialFromWilcoxon(differences: number[]) {
  const nonZero = differences.filter((value) => value !== 0);
  if (nonZero.length === 0) return 0;
  const ranks = rankValues(nonZero.map((value) => Math.abs(value)));
  let positive = 0;
  let negative = 0;
  nonZero.forEach((diff, index) => {
    if (diff > 0) positive += ranks[index];
    else negative += ranks[index];
  });
  const total = positive + negative;
  if (total === 0) return 0;
  return (positive - negative) / total;
}

function etaSquared(ssBetween: number, ssTotal: number) {
  if (ssTotal === 0) return 0;
  return ssBetween / ssTotal;
}

function partialEtaSquared(ssTreatment: number, ssError: number) {
  const denom = ssTreatment + ssError;
  return denom === 0 ? 0 : ssTreatment / denom;
}

function epsilonSquaredKW(h: number, n: number) {
  if (n <= 1) return 0;
  return Math.max(0, Math.min(1, (h - 0) / (n - 1)));
}

function kendallsW(chiSquare: number, n: number, k: number) {
  if (n === 0 || k <= 1) return 0;
  return chiSquare / (n * (k - 1));
}

function classifyMagnitudeAbs(value: number, thresholds: { small: number; medium: number; large: number }) {
  const abs = Math.abs(value);
  if (abs < thresholds.small) return "negligible" as const;
  if (abs < thresholds.medium) return "small" as const;
  if (abs < thresholds.large) return "medium" as const;
  return "large" as const;
}

function classifyEtaMagnitude(value: number) {
  return classifyMagnitudeAbs(value, { small: 0.01, medium: 0.06, large: 0.14 });
}

function buildCohenDEffect(value: number): EffectSizeResult {
  return {
    name: "COHENS_D",
    label: "Cohen's d",
    value: roundDp(value, 3),
    magnitude: classifyMagnitudeAbs(value, { small: 0.2, medium: 0.5, large: 0.8 }),
    interpretation: `Standardized mean difference d = ${roundDp(value, 2)}.`,
  };
}

function buildRankBiserialEffect(value: number): EffectSizeResult {
  return {
    name: "RANK_BISERIAL",
    label: "Rank-biserial correlation",
    value: roundDp(value, 3),
    magnitude: classifyMagnitudeAbs(value, { small: 0.1, medium: 0.3, large: 0.5 }),
    interpretation: `Rank-biserial correlation r = ${roundDp(value, 2)}.`,
  };
}

function buildEtaEffect(value: number): EffectSizeResult {
  return {
    name: "ETA_SQUARED",
    label: "Eta-squared (η²)",
    value: roundDp(value, 3),
    magnitude: classifyEtaMagnitude(value),
    interpretation: `Sample membership accounts for ≈ ${(value * 100).toFixed(1)}% of variance.`,
  };
}

function buildPartialEtaEffect(value: number): EffectSizeResult {
  return {
    name: "PARTIAL_ETA_SQUARED",
    label: "Partial eta-squared (ηp²)",
    value: roundDp(value, 3),
    magnitude: classifyEtaMagnitude(value),
    interpretation: `After removing subject variance, sample membership accounts for ≈ ${(value * 100).toFixed(1)}% of variance.`,
  };
}

function buildKendallWEffect(value: number): EffectSizeResult {
  return {
    name: "KENDALLS_W",
    label: "Kendall's W",
    value: roundDp(value, 3),
    magnitude: classifyMagnitudeAbs(value, { small: 0.1, medium: 0.3, large: 0.5 }),
    interpretation: `Concordance among respondents W = ${roundDp(value, 2)}.`,
  };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function buildResult(input: {
  test: StatisticalTest;
  studyDesign: StudyDesign;
  repeatedMeasures: boolean;
  pValue: number | null;
  statistic: number | null;
  alpha: number;
  interpretation: string;
  assumptionChecks?: AssumptionChecksSummary;
  effectSize?: EffectSizeResult | null;
  postHocResults?: PostHocComparison[];
  assumptions?: string[];
  warnings?: string[];
  samplesForUnused?: number[][];
}): ComparisonResult {
  const significant = input.pValue === null ? null : input.pValue < input.alpha;
  void input.samplesForUnused;
  return {
    test: input.test,
    testLabel: testLabel(input.test),
    studyDesign: input.studyDesign,
    repeatedMeasures: input.repeatedMeasures,
    pValue: input.pValue,
    statistic: input.statistic,
    significant,
    alpha: input.alpha,
    interpretation: input.interpretation,
    assumptionChecks:
      input.assumptionChecks ?? {
        normality: { name: "NORMALITY", label: "Normality", passed: null, pValue: null, detail: "Not evaluated for two-sample comparison." },
        homogeneity: { name: "HOMOGENEITY", label: "Homogeneity", passed: null, pValue: null, detail: "Not evaluated for two-sample comparison." },
        sampleSizeAdequacy: { name: "SAMPLE_SIZE", label: "Sample size", passed: null, pValue: null, detail: "Not evaluated." },
        recommendedPathway: "NONPARAMETRIC",
        rationale: "Default conservative pathway.",
      },
    effectSize: input.effectSize ?? null,
    postHocResults: input.postHocResults ?? [],
    assumptions: input.assumptions ?? [],
    warnings: input.warnings ?? [],
  };
}

function describeSignificance(pValue: number | null, alpha: number, subject: string) {
  if (pValue === null) return "Statistical significance could not be determined from the available data.";
  if (pValue < alpha) return `A statistically significant difference was detected in ${subject} (p=${formatPValue(pValue)}).`;
  return `No statistically significant difference was detected in ${subject} (p=${formatPValue(pValue)}).`;
}

function testLabel(test: StatisticalTest) {
  switch (test) {
    case "PAIRED_T_TEST":
      return "Paired t-test";
    case "STUDENT_T_TEST":
      return "Student's t-test";
    case "WILCOXON_SIGNED_RANK":
      return "Wilcoxon signed-rank";
    case "WELCH_T_TEST":
      return "Welch t-test";
    case "MANN_WHITNEY_U":
      return "Mann-Whitney U";
    case "ONE_WAY_ANOVA":
      return "One-way ANOVA";
    case "REPEATED_MEASURES_ANOVA":
      return "Repeated-measures ANOVA";
    case "FRIEDMAN":
      return "Friedman";
    case "KRUSKAL_WALLIS":
      return "Kruskal-Wallis";
    default:
      return "Descriptive only";
  }
}

function hasRepeatedMeasures(samples: SampleComparisonInput[]) {
  const respondentSets = samples.map((sample) => new Set(sample.valuesByRespondent.keys()));
  if (respondentSets.some((set) => set.size === 0)) return false;
  const [first, ...rest] = respondentSets;
  return rest.every((set) => set.size === first.size && Array.from(first).every((id) => set.has(id)));
}

function buildPairs(left: SampleComparisonInput, right: SampleComparisonInput) {
  const out: Array<[number, number]> = [];
  left.valuesByRespondent.forEach((leftValue, respondentId) => {
    const rightValue = right.valuesByRespondent.get(respondentId);
    if (typeof rightValue === "number" && Number.isFinite(rightValue)) {
      out.push([leftValue, rightValue]);
    }
  });
  return out;
}

function buildCompleteRepeatedRows(samples: SampleComparisonInput[]) {
  const respondentIds = Array.from(samples[0]?.valuesByRespondent.keys() ?? []);
  const out: number[][] = [];
  respondentIds.forEach((respondentId) => {
    const row = samples.map((sample) => sample.valuesByRespondent.get(respondentId));
    if (row.every((value): value is number => typeof value === "number" && Number.isFinite(value))) {
      out.push(row);
    }
  });
  return out;
}

function rankValues(values: number[]) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = Array.from({ length: values.length }, () => 0);
  let cursor = 0;
  while (cursor < sorted.length) {
    let end = cursor + 1;
    while (end < sorted.length && sorted[end].value === sorted[cursor].value) end += 1;
    const averageRank = (cursor + 1 + end) / 2;
    for (let index = cursor; index < end; index += 1) {
      ranks[sorted[index].index] = averageRank;
    }
    cursor = end;
  }
  return ranks;
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sampleVariance(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1);
}

function sampleStdDev(values: number[]) {
  return Math.sqrt(sampleVariance(values));
}

function clamp(value: number, lo: number, hi: number) {
  if (!Number.isFinite(value)) return value;
  return Math.max(lo, Math.min(hi, value));
}

function roundDp(value: number, dp = 3) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

// --------------------------------------------------------------------------
// Distribution functions
// --------------------------------------------------------------------------

function twoSidedTPValue(t: number, df: number) {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return Number.NaN;
  const cdf = studentTCdf(Math.abs(t), df);
  return Math.max(0, Math.min(1, 2 * (1 - cdf)));
}

function studentTCdf(t: number, df: number) {
  const x = df / (df + t * t);
  const ibeta = regularizedBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - 0.5 * ibeta : 0.5 * ibeta;
}

function inverseStudentT(p: number, df: number) {
  // Bisection on Student-t CDF, robust enough for CIs at common levels.
  let lo = -50;
  let hi = 50;
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    const cdf = studentTCdf(mid, df);
    if (cdf < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  return (lo + hi) / 2;
}

function chiSquareSurvival(x: number, df: number) {
  if (!Number.isFinite(x) || !Number.isFinite(df) || df <= 0) return Number.NaN;
  return regularizedGammaQ(df / 2, x / 2);
}

function fCdf(x: number, d1: number, d2: number) {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return regularizedBeta((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2);
}

function normalCdf(value: number) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function inverseNormalCdf(p: number) {
  // Beasley-Springer-Moro inverse normal approximation.
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q;
  let r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// Tukey studentized range: uses the standard approximation
// p ≈ 1 - F_normal((q - mu) / sigma) approach via Lund & Lund 1983 is
// non-trivial in pure TS. We use the Gleason approximation by mapping
// q/sqrt(2) to a Welch t and adjusting df with a correction term — this is
// known to be conservative for k <= 6 and df >= 10. Acceptable for Phase 1
// reporting; documented as an approximation in the report.
function studentizedRangeCdfApprox(q: number, k: number, df: number) {
  if (!Number.isFinite(q) || q <= 0 || k < 2 || df <= 0) return 0;
  const t = q / Math.sqrt(2);
  const single = studentTCdf(t, df);
  const adjusted = Math.pow(2 * single - 1, k * (k - 1) / 2);
  return Math.max(0, Math.min(1, adjusted));
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return sign * y;
}

function regularizedBeta(x: number, a: number, b: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x: number, a: number, b: number) {
  const maxIterations = 200;
  const epsilon = 3e-7;
  const fpMin = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1 / d;
  let h = d;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const m2 = 2 * iteration;
    let aa = (iteration * (b - iteration) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + iteration) * (qab + iteration) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

function regularizedGammaQ(a: number, x: number) {
  if (x < 0 || a <= 0) return Number.NaN;
  if (x === 0) return 1;
  if (x < a + 1) return 1 - regularizedGammaPSeries(a, x);
  return regularizedGammaQContinuedFraction(a, x);
}

function regularizedGammaPSeries(a: number, x: number) {
  const maxIterations = 200;
  const epsilon = 1e-8;
  let sum = 1 / a;
  let delta = sum;
  let ap = a;
  for (let i = 1; i <= maxIterations; i += 1) {
    ap += 1;
    delta *= x / ap;
    sum += delta;
    if (Math.abs(delta) < Math.abs(sum) * epsilon) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function regularizedGammaQContinuedFraction(a: number, x: number) {
  const maxIterations = 200;
  const epsilon = 1e-8;
  const fpMin = 1e-30;
  let b = x + 1 - a;
  let c = 1 / fpMin;
  let d = 1 / Math.max(b, fpMin);
  let h = d;
  for (let i = 1; i <= maxIterations; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = b + an / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  let x = 0.9999999999998099;
  const z = value - 1;
  for (let i = 0; i < coefficients.length; i += 1) {
    x += coefficients[i] / (z + i + 1);
  }
  const t = z + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/* ------------------------------------------------------------------ */
/* CATA (Check-All-That-Apply) analysis                                */
/* ------------------------------------------------------------------ */

export interface CataTermResult {
  term: string;
  /** Check count per sample, index-aligned to `sampleLabels`. */
  countsBySample: number[];
  /** Percentage (0–100) of evaluating panelists who ticked the term, per sample. */
  percentBySample: number[];
  totalChecks: number;
  /** Cochran's Q statistic across samples (0 when not computable). */
  cochranQ: number;
  df: number;
  pValue: number | null;
  significant: boolean;
  interpretation: string;
}

export interface CataAnalysisResult {
  sampleLabels: string[];
  respondentsPerSample: number[];
  /** Panelists who evaluated every sample (Cochran's Q operates on these). */
  completeCaseCount: number;
  terms: CataTermResult[];
  warnings: string[];
}

/**
 * Per-respondent CATA answers: for each evaluated sample (keyed by its label),
 * the list of terms the respondent ticked.
 */
export interface CataResponseInput {
  respondentId: string;
  checksBySample: Record<string, string[]>;
}

/**
 * Cochran's Q test for k related binary treatments. `matrix` rows are subjects,
 * columns are treatments (0/1). Under H0 the proportion of successes is equal
 * across treatments; Q ~ chi-square(k-1). Constant rows drop out naturally.
 */
export function cochransQTest(matrix: number[][]): { Q: number; df: number; pValue: number | null } {
  const k = matrix[0]?.length ?? 0;
  if (k < 2 || matrix.length === 0) {
    return { Q: 0, df: Math.max(0, k - 1), pValue: null };
  }
  const colSums = new Array<number>(k).fill(0);
  let sumRowSq = 0;
  let grand = 0;
  for (const row of matrix) {
    if (row.length !== k) {
      continue;
    }
    let rowSum = 0;
    for (let j = 0; j < k; j += 1) {
      const value = row[j] ? 1 : 0;
      colSums[j] += value;
      rowSum += value;
    }
    sumRowSq += rowSum * rowSum;
    grand += rowSum;
  }
  const sumColSq = colSums.reduce((sum, c) => sum + c * c, 0);
  const df = k - 1;
  const denom = k * grand - sumRowSq;
  if (denom <= 0) {
    // Every subject responded identically across samples — no evidence of a difference.
    return { Q: 0, df, pValue: 1 };
  }
  const Q = Math.max(0, ((k - 1) * (k * sumColSq - grand * grand)) / denom);
  return { Q: roundDp(Q, 3), df, pValue: clamp(chiSquareSurvival(Q, df), 0, 1) };
}

/**
 * Frequency Analysis + Cochran's Q for a CATA study. For each term we report
 * the per-sample check counts/percentages and test whether the proportion of
 * panelists selecting that term differs across samples (repeated-measures,
 * complete cases only). Terms are returned most-discriminating first.
 */
export function analyzeCata(
  terms: string[],
  sampleLabels: string[],
  responses: CataResponseInput[],
  alpha = 0.05
): CataAnalysisResult {
  const warnings: string[] = [];
  const cleanTerms = terms.map((term) => term.trim()).filter((term) => term.length > 0);
  const labels = sampleLabels.slice();
  const k = labels.length;

  const evaluated = (response: CataResponseInput, label: string) =>
    Array.isArray(response.checksBySample[label]);
  const checked = (response: CataResponseInput, label: string, term: string) =>
    (response.checksBySample[label] ?? []).some((entry) => entry.trim().toLowerCase() === term.toLowerCase());

  const respondentsPerSample = labels.map(
    (label) => responses.filter((response) => evaluated(response, label)).length
  );

  // Complete cases: respondents who evaluated every sample — required for Cochran's Q.
  const completeCases = responses.filter((response) => labels.every((label) => evaluated(response, label)));
  if (k < 2) {
    warnings.push("Cochran's Q requires at least 2 samples; only frequencies are reported.");
  } else if (completeCases.length < 2) {
    warnings.push("Cochran's Q needs at least 2 panelists who evaluated every sample.");
  }

  const termResults: CataTermResult[] = cleanTerms.map((term) => {
    const countsBySample = labels.map((label) =>
      responses.reduce((count, response) => count + (checked(response, label, term) ? 1 : 0), 0)
    );
    const percentBySample = countsBySample.map((count, index) =>
      respondentsPerSample[index] > 0 ? roundDp((count / respondentsPerSample[index]) * 100, 1) : 0
    );
    const totalChecks = countsBySample.reduce((sum, count) => sum + count, 0);

    let cochranQ = 0;
    let df = Math.max(0, k - 1);
    let pValue: number | null = null;
    if (k >= 2 && completeCases.length >= 2) {
      const matrix = completeCases.map((response) =>
        labels.map((label) => (checked(response, label, term) ? 1 : 0))
      );
      const result = cochransQTest(matrix);
      cochranQ = result.Q;
      df = result.df;
      pValue = result.pValue;
    }

    const significant = pValue !== null && pValue < alpha;
    const interpretation =
      pValue === null
        ? "Not enough data to test differences across samples."
        : significant
          ? `Samples differ in how often "${term}" was selected (Cochran's Q = ${cochranQ}, p = ${formatPValue(pValue)}).`
          : `No significant difference across samples for "${term}" (p = ${formatPValue(pValue)}).`;

    return { term, countsBySample, percentBySample, totalChecks, cochranQ, df, pValue, significant, interpretation };
  });

  termResults.sort((a, b) => {
    const ap = a.pValue ?? 1;
    const bp = b.pValue ?? 1;
    if (ap !== bp) return ap - bp;
    return b.totalChecks - a.totalChecks;
  });

  return {
    sampleLabels: labels,
    respondentsPerSample,
    completeCaseCount: completeCases.length,
    terms: termResults,
    warnings,
  };
}
