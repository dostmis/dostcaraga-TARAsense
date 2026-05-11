export type StatisticalTest =
  | "DESCRIPTIVE_ONLY"
  | "PAIRED_T_TEST"
  | "WILCOXON_SIGNED_RANK"
  | "WELCH_T_TEST"
  | "MANN_WHITNEY_U"
  | "FRIEDMAN"
  | "KRUSKAL_WALLIS";

export interface SampleComparisonInput {
  sampleNumber: number;
  sampleLabel: string;
  valuesByRespondent: Map<string, number>;
}

export interface ComparisonResult {
  test: StatisticalTest;
  testLabel: string;
  repeatedMeasures: boolean;
  pValue: number | null;
  statistic: number | null;
  significant: boolean | null;
  alpha: number;
  interpretation: string;
  assumptions: string[];
  warnings: string[];
}

const DEFAULT_ALPHA = 0.05;

export function compareSamples(samples: SampleComparisonInput[], alpha = DEFAULT_ALPHA): ComparisonResult {
  const validSamples = samples.filter((sample) => sample.valuesByRespondent.size > 0);
  if (validSamples.length < 2) {
    return buildComparisonResult({
      test: "DESCRIPTIVE_ONLY",
      repeatedMeasures: false,
      pValue: null,
      statistic: null,
      alpha,
      interpretation: "Only descriptive statistics are available because fewer than two samples have valid scores.",
      warnings: ["At least two samples with valid responses are required for statistical comparison."],
    });
  }

  const repeatedMeasures = hasRepeatedMeasures(validSamples);
  if (validSamples.length === 2) {
    return repeatedMeasures
      ? compareTwoPairedSamples(validSamples[0], validSamples[1], alpha)
      : compareTwoIndependentSamples(validSamples[0], validSamples[1], alpha);
  }

  return repeatedMeasures ? compareRepeatedSamples(validSamples, alpha) : compareIndependentSamples(validSamples, alpha);
}

export function formatPValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }
  if (value < 0.001) {
    return "< 0.001";
  }
  return value.toFixed(3);
}

function compareTwoPairedSamples(
  left: SampleComparisonInput,
  right: SampleComparisonInput,
  alpha: number
): ComparisonResult {
  const pairs = buildPairedValues(left, right);
  if (pairs.length < 5) {
    return buildComparisonResult({
      test: "DESCRIPTIVE_ONLY",
      repeatedMeasures: true,
      pValue: null,
      statistic: null,
      alpha,
      interpretation: "Not enough paired observations are available for a stable two-sample comparison.",
      warnings: ["At least five complete respondent pairs are required for paired comparison."],
    });
  }

  const differences = pairs.map(([leftValue, rightValue]) => leftValue - rightValue);
  const useParametric = differences.length >= 30;
  if (useParametric) {
    const result = pairedTTest(differences);
    return buildComparisonResult({
      test: "PAIRED_T_TEST",
      repeatedMeasures: true,
      pValue: result.pValue,
      statistic: result.t,
      alpha,
      interpretation: buildSignificanceInterpretation(result.pValue, alpha, "paired mean liking"),
      assumptions: [
        "The same respondents evaluated both samples.",
        "Paired t-test selected because at least 30 complete paired observations are available.",
      ],
    });
  }

  const result = wilcoxonSignedRank(differences);
  return buildComparisonResult({
    test: "WILCOXON_SIGNED_RANK",
    repeatedMeasures: true,
    pValue: result.pValue,
    statistic: result.z,
    alpha,
    interpretation: buildSignificanceInterpretation(result.pValue, alpha, "paired liking ranks"),
    assumptions: [
      "The same respondents evaluated both samples.",
      "Wilcoxon signed-rank selected as the conservative default for fewer than 30 paired observations.",
    ],
    warnings: result.warning ? [result.warning] : [],
  });
}

function compareTwoIndependentSamples(
  left: SampleComparisonInput,
  right: SampleComparisonInput,
  alpha: number
): ComparisonResult {
  const leftValues = Array.from(left.valuesByRespondent.values());
  const rightValues = Array.from(right.valuesByRespondent.values());
  if (leftValues.length < 5 || rightValues.length < 5) {
    return buildComparisonResult({
      test: "DESCRIPTIVE_ONLY",
      repeatedMeasures: false,
      pValue: null,
      statistic: null,
      alpha,
      interpretation: "Not enough observations are available for a stable independent-sample comparison.",
      warnings: ["Each sample needs at least five valid responses for independent comparison."],
    });
  }

  if (leftValues.length >= 30 && rightValues.length >= 30) {
    const result = welchTTest(leftValues, rightValues);
    return buildComparisonResult({
      test: "WELCH_T_TEST",
      repeatedMeasures: false,
      pValue: result.pValue,
      statistic: result.t,
      alpha,
      interpretation: buildSignificanceInterpretation(result.pValue, alpha, "independent mean liking"),
      assumptions: [
        "Respondent overlap was not complete across samples.",
        "Welch t-test selected for larger independent groups without assuming equal variance.",
      ],
    });
  }

  const result = mannWhitneyU(leftValues, rightValues);
  return buildComparisonResult({
    test: "MANN_WHITNEY_U",
    repeatedMeasures: false,
    pValue: result.pValue,
    statistic: result.z,
    alpha,
    interpretation: buildSignificanceInterpretation(result.pValue, alpha, "independent liking ranks"),
    assumptions: [
      "Respondent overlap was not complete across samples.",
      "Mann-Whitney U selected as the conservative default for smaller independent groups.",
    ],
    warnings: result.warning ? [result.warning] : [],
  });
}

function compareRepeatedSamples(samples: SampleComparisonInput[], alpha: number): ComparisonResult {
  const completeRows = buildCompleteRepeatedRows(samples);
  if (completeRows.length < 5) {
    return buildComparisonResult({
      test: "DESCRIPTIVE_ONLY",
      repeatedMeasures: true,
      pValue: null,
      statistic: null,
      alpha,
      interpretation: "Not enough complete respondent blocks are available for repeated-measures comparison.",
      warnings: ["At least five respondents with all selected samples are required for Friedman comparison."],
    });
  }

  const result = friedmanTest(completeRows);
  return buildComparisonResult({
    test: "FRIEDMAN",
    repeatedMeasures: true,
    pValue: result.pValue,
    statistic: result.chiSquare,
    alpha,
    interpretation: buildSignificanceInterpretation(result.pValue, alpha, "within-respondent sample ranks"),
    assumptions: [
      "The same respondents evaluated all compared samples.",
      "Friedman test selected as the Phase 1 conservative default for three or more repeated samples.",
    ],
  });
}

function compareIndependentSamples(samples: SampleComparisonInput[], alpha: number): ComparisonResult {
  const groups = samples.map((sample) => Array.from(sample.valuesByRespondent.values())).filter((values) => values.length > 0);
  if (groups.length < 3 || groups.some((values) => values.length < 5)) {
    return buildComparisonResult({
      test: "DESCRIPTIVE_ONLY",
      repeatedMeasures: false,
      pValue: null,
      statistic: null,
      alpha,
      interpretation: "Not enough observations are available for stable independent multi-sample comparison.",
      warnings: ["Each sample needs at least five valid responses for independent multi-sample comparison."],
    });
  }

  const result = kruskalWallis(groups);
  return buildComparisonResult({
    test: "KRUSKAL_WALLIS",
    repeatedMeasures: false,
    pValue: result.pValue,
    statistic: result.h,
    alpha,
    interpretation: buildSignificanceInterpretation(result.pValue, alpha, "independent sample ranks"),
    assumptions: [
      "Respondent overlap was not complete across all samples.",
      "Kruskal-Wallis selected as the conservative default for independent multi-sample comparison.",
    ],
  });
}

function hasRepeatedMeasures(samples: SampleComparisonInput[]) {
  const respondentSets = samples.map((sample) => new Set(sample.valuesByRespondent.keys()));
  if (respondentSets.some((set) => set.size === 0)) {
    return false;
  }

  const [firstSet, ...restSets] = respondentSets;
  return restSets.every((set) => set.size === firstSet.size && Array.from(firstSet).every((id) => set.has(id)));
}

function buildPairedValues(left: SampleComparisonInput, right: SampleComparisonInput) {
  const pairs: Array<[number, number]> = [];
  left.valuesByRespondent.forEach((leftValue, respondentId) => {
    const rightValue = right.valuesByRespondent.get(respondentId);
    if (typeof rightValue === "number" && Number.isFinite(rightValue)) {
      pairs.push([leftValue, rightValue]);
    }
  });
  return pairs;
}

function buildCompleteRepeatedRows(samples: SampleComparisonInput[]) {
  const respondentIds = Array.from(samples[0]?.valuesByRespondent.keys() ?? []);
  const rows: number[][] = [];
  respondentIds.forEach((respondentId) => {
    const row = samples.map((sample) => sample.valuesByRespondent.get(respondentId));
    if (row.every((value): value is number => typeof value === "number" && Number.isFinite(value))) {
      rows.push(row);
    }
  });
  return rows;
}

function pairedTTest(differences: number[]) {
  const n = differences.length;
  const meanDiff = mean(differences);
  const sd = sampleStdDev(differences);
  if (n < 2 || sd === 0) {
    return { t: 0, pValue: null };
  }
  const t = meanDiff / (sd / Math.sqrt(n));
  return { t: round(t), pValue: roundP(twoSidedTTestPValue(t, n - 1)) };
}

function welchTTest(left: number[], right: number[]) {
  const leftMean = mean(left);
  const rightMean = mean(right);
  const leftVar = sampleVariance(left);
  const rightVar = sampleVariance(right);
  const leftTerm = leftVar / left.length;
  const rightTerm = rightVar / right.length;
  const denominator = Math.sqrt(leftTerm + rightTerm);
  if (denominator === 0) {
    return { t: 0, pValue: null };
  }
  const t = (leftMean - rightMean) / denominator;
  const dfNumerator = (leftTerm + rightTerm) ** 2;
  const dfDenominator = leftTerm ** 2 / (left.length - 1) + rightTerm ** 2 / (right.length - 1);
  const df = dfDenominator > 0 ? dfNumerator / dfDenominator : left.length + right.length - 2;
  return { t: round(t), pValue: roundP(twoSidedTTestPValue(t, df)) };
}

function wilcoxonSignedRank(differences: number[]) {
  const nonZero = differences.filter((value) => value !== 0);
  if (nonZero.length < 5) {
    return { z: null, pValue: null, warning: "Too many zero differences for a stable Wilcoxon approximation." };
  }

  const ranks = rankValues(nonZero.map((value) => Math.abs(value)));
  let positiveRankSum = 0;
  nonZero.forEach((difference, index) => {
    if (difference > 0) {
      positiveRankSum += ranks[index];
    }
  });

  const n = nonZero.length;
  const expected = (n * (n + 1)) / 4;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24;
  const z = (Math.abs(positiveRankSum - expected) - 0.5) / Math.sqrt(variance);
  return { z: round(z), pValue: roundP(2 * (1 - normalCdf(Math.abs(z)))) };
}

function mannWhitneyU(left: number[], right: number[]) {
  const combined = [
    ...left.map((value) => ({ value, group: "left" as const })),
    ...right.map((value) => ({ value, group: "right" as const })),
  ];
  if (combined.length < 10) {
    return { z: null, pValue: null, warning: "Not enough observations for a stable Mann-Whitney approximation." };
  }

  const ranks = rankValues(combined.map((row) => row.value));
  const leftRankSum = ranks.reduce((sum, rank, index) => sum + (combined[index].group === "left" ? rank : 0), 0);
  const n1 = left.length;
  const n2 = right.length;
  const u1 = leftRankSum - (n1 * (n1 + 1)) / 2;
  const expected = (n1 * n2) / 2;
  const variance = (n1 * n2 * (n1 + n2 + 1)) / 12;
  const z = (Math.abs(u1 - expected) - 0.5) / Math.sqrt(variance);
  return { z: round(z), pValue: roundP(2 * (1 - normalCdf(Math.abs(z)))) };
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

  const sumSquaredRanks = rankSums.reduce((sum, rankSum) => sum + rankSum ** 2, 0);
  const chiSquare = (12 / (n * k * (k + 1))) * sumSquaredRanks - 3 * n * (k + 1);
  return { chiSquare: round(Math.max(0, chiSquare)), pValue: roundP(chiSquareSurvival(Math.max(0, chiSquare), k - 1)) };
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
  return { h: round(Math.max(0, h)), pValue: roundP(chiSquareSurvival(Math.max(0, h), groups.length - 1)) };
}

function buildComparisonResult(input: {
  test: StatisticalTest;
  repeatedMeasures: boolean;
  pValue: number | null;
  statistic: number | null;
  alpha: number;
  interpretation: string;
  assumptions?: string[];
  warnings?: string[];
}): ComparisonResult {
  const significant = input.pValue === null ? null : input.pValue < input.alpha;
  return {
    test: input.test,
    testLabel: testLabel(input.test),
    repeatedMeasures: input.repeatedMeasures,
    pValue: input.pValue,
    statistic: input.statistic,
    significant,
    alpha: input.alpha,
    interpretation: input.interpretation,
    assumptions: input.assumptions ?? [],
    warnings: input.warnings ?? [],
  };
}

function buildSignificanceInterpretation(pValue: number | null, alpha: number, subject: string) {
  if (pValue === null) {
    return "Statistical significance could not be determined from the available data.";
  }
  if (pValue < alpha) {
    return `A statistically significant difference was detected in ${subject} (p=${formatPValue(pValue)}).`;
  }
  return `No statistically significant difference was detected in ${subject} (p=${formatPValue(pValue)}).`;
}

function testLabel(test: StatisticalTest) {
  switch (test) {
    case "PAIRED_T_TEST":
      return "Paired t-test";
    case "WILCOXON_SIGNED_RANK":
      return "Wilcoxon signed-rank";
    case "WELCH_T_TEST":
      return "Welch t-test";
    case "MANN_WHITNEY_U":
      return "Mann-Whitney U";
    case "FRIEDMAN":
      return "Friedman";
    case "KRUSKAL_WALLIS":
      return "Kruskal-Wallis";
    default:
      return "Descriptive only";
  }
}

function rankValues(values: number[]) {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks = Array.from({ length: values.length }, () => 0);

  let cursor = 0;
  while (cursor < sorted.length) {
    let end = cursor + 1;
    while (end < sorted.length && sorted[end].value === sorted[cursor].value) {
      end += 1;
    }
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

function sampleVariance(values: number[]) {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

function sampleStdDev(values: number[]) {
  return Math.sqrt(sampleVariance(values));
}

function twoSidedTTestPValue(t: number, df: number) {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) {
    return Number.NaN;
  }
  const cdf = studentTCdf(Math.abs(t), df);
  return Math.max(0, Math.min(1, 2 * (1 - cdf)));
}

function studentTCdf(t: number, df: number) {
  const x = df / (df + t * t);
  const ibeta = regularizedBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - 0.5 * ibeta : 0.5 * ibeta;
}

function chiSquareSurvival(x: number, df: number) {
  if (!Number.isFinite(x) || !Number.isFinite(df) || df <= 0) {
    return Number.NaN;
  }
  return regularizedGammaQ(df / 2, x / 2);
}

function normalCdf(value: number) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
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
  const maxIterations = 100;
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
    if (Math.abs(delta - 1) < epsilon) {
      break;
    }
  }
  return h;
}

function regularizedGammaQ(a: number, x: number) {
  if (x < 0 || a <= 0) return Number.NaN;
  if (x === 0) return 1;
  if (x < a + 1) {
    return 1 - regularizedGammaPSeries(a, x);
  }
  return regularizedGammaQContinuedFraction(a, x);
}

function regularizedGammaPSeries(a: number, x: number) {
  const maxIterations = 100;
  const epsilon = 1e-8;
  let sum = 1 / a;
  let delta = sum;
  let ap = a;
  for (let index = 1; index <= maxIterations; index += 1) {
    ap += 1;
    delta *= x / ap;
    sum += delta;
    if (Math.abs(delta) < Math.abs(sum) * epsilon) {
      break;
    }
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function regularizedGammaQContinuedFraction(a: number, x: number) {
  const maxIterations = 100;
  const epsilon = 1e-8;
  const fpMin = 1e-30;
  let b = x + 1 - a;
  let c = 1 / fpMin;
  let d = 1 / Math.max(b, fpMin);
  let h = d;

  for (let index = 1; index <= maxIterations; index += 1) {
    const an = -index * (index - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = b + an / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) {
      break;
    }
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
  for (let index = 0; index < coefficients.length; index += 1) {
    x += coefficients[index] / (z + index + 1);
  }
  const t = z + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function roundP(value: number) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, Math.round(value * 1000000) / 1000000));
}
