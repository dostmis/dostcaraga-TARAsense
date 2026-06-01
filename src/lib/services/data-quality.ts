// Runtime data-quality validation for sensory analysis.
//
// Inspects the parsed sensory responses just before statistical analysis and
// reports anomalies that could distort the results: missing scores, duplicate
// rows, incomplete evaluations, suspiciously fast respondents, attention-check
// failures, straight-lining, and outliers.

export type DataQualitySeverity = "INFO" | "WARNING" | "BLOCKING";

export interface DataQualityFinding {
  code:
    | "MISSING_LIKING"
    | "MISSING_RESPONSES"
    | "DUPLICATE_RESPONSE"
    | "INCOMPLETE_EVALUATION"
    | "FAST_RESPONDENT"
    | "ATTENTION_CHECK_FAIL"
    | "STRAIGHT_LINING"
    | "OUTLIER";
  label: string;
  severity: DataQualitySeverity;
  message: string;
  affectedCount: number;
  affectedRespondents: string[];
}

export interface DataQualityReport {
  status: "PASSED" | "PASSED_WITH_WARNINGS" | "BLOCKED";
  findings: DataQualityFinding[];
  totals: {
    respondents: number;
    samplesEvaluated: number;
    expectedSamples: number;
    incompleteRespondents: number;
    flaggedRespondents: number;
  };
  recommendation: string;
}

interface SampleResponseLike {
  sampleNumber?: number;
  sampleLabel?: string;
  overallLiking?: number;
  attributes?: Record<string, unknown>;
  startedAt?: string;
  submittedAt?: string;
  durationSeconds?: number;
}

export interface DataQualityInput {
  respondentId: string;
  overallLiking?: number;
  attributes?: Record<string, unknown>;
  sampleResponses?: SampleResponseLike[];
  startedAt?: string | Date;
  submittedAt?: string | Date;
  durationSeconds?: number;
  attentionCheck?: { passed: boolean } | null;
}

export interface DataQualityOptions {
  expectedSamples: number;
  expectedAttributeKeys: string[];
  minDurationSeconds?: number; // anything under this is "fast"
  outlierZ?: number;            // z-score threshold (default 3)
  straightLiningWindowVar?: number; // variance threshold within respondent
}

export function evaluateDataQuality(
  inputs: DataQualityInput[],
  options: DataQualityOptions
): DataQualityReport {
  const findings: DataQualityFinding[] = [];
  const flaggedRespondents = new Set<string>();
  let incompleteRespondents = 0;
  let samplesEvaluated = 0;

  const minDuration = options.minDurationSeconds ?? 5;
  const outlierZ = options.outlierZ ?? 3;
  const straightLineThreshold = options.straightLiningWindowVar ?? 0.05;

  // Track duplicates by respondentId
  const seenRespondents = new Map<string, number>();
  const missingLiking: string[] = [];
  const missingResponses: string[] = [];
  const duplicateRespondents: string[] = [];
  const incompleteRespondentIds: string[] = [];
  const fastRespondents: string[] = [];
  const attentionFailures: string[] = [];
  const straightLiners: string[] = [];

  inputs.forEach((input) => {
    const id = input.respondentId;
    if (id) {
      const existing = seenRespondents.get(id) ?? 0;
      seenRespondents.set(id, existing + 1);
      if (existing >= 1) {
        duplicateRespondents.push(id);
        flaggedRespondents.add(id);
      }
    }

    const sampleRows =
      Array.isArray(input.sampleResponses) && input.sampleResponses.length > 0
        ? input.sampleResponses
        : [
            {
              sampleNumber: 1,
              overallLiking: input.overallLiking,
              attributes: input.attributes,
            } as SampleResponseLike,
          ];

    samplesEvaluated += sampleRows.length;

    if (sampleRows.length === 0) {
      missingResponses.push(id);
      flaggedRespondents.add(id);
      return;
    }

    if (sampleRows.length < options.expectedSamples) {
      incompleteRespondents += 1;
      incompleteRespondentIds.push(id);
      flaggedRespondents.add(id);
    }

    const likingValuesAcrossSamples: number[] = [];
    sampleRows.forEach((sample) => {
      const liking = typeof sample.overallLiking === "number" && Number.isFinite(sample.overallLiking) ? sample.overallLiking : null;
      if (liking === null) {
        missingLiking.push(id);
        flaggedRespondents.add(id);
      } else {
        likingValuesAcrossSamples.push(liking);
      }

      const attrs = sample.attributes ?? {};
      const presentAttrKeys = Object.keys(attrs).filter((key) => attrs[key] !== null && attrs[key] !== undefined);
      const missingExpected = options.expectedAttributeKeys.filter((key) => !presentAttrKeys.includes(key));
      if (options.expectedAttributeKeys.length > 0 && missingExpected.length > 0) {
        if (!incompleteRespondentIds.includes(id)) {
          incompleteRespondentIds.push(id);
          incompleteRespondents += 1;
        }
        flaggedRespondents.add(id);
      }
    });

    const duration = input.durationSeconds ?? deriveDurationSeconds(input.startedAt, input.submittedAt);
    if (typeof duration === "number" && duration > 0 && duration < minDuration) {
      fastRespondents.push(id);
      flaggedRespondents.add(id);
    }

    if (input.attentionCheck && input.attentionCheck.passed === false) {
      attentionFailures.push(id);
      flaggedRespondents.add(id);
    }

    if (likingValuesAcrossSamples.length >= 3) {
      const variance = computeVariance(likingValuesAcrossSamples);
      if (variance < straightLineThreshold) {
        straightLiners.push(id);
        flaggedRespondents.add(id);
      }
    } else {
      // Look at attribute responses within a single sample for straight-lining.
      sampleRows.forEach((sample) => {
        const attrs = sample.attributes ?? {};
        const numericAttrValues = Object.values(attrs)
          .map((value) => (typeof value === "number" ? value : null))
          .filter((value): value is number => value !== null);
        if (numericAttrValues.length >= 4) {
          const variance = computeVariance(numericAttrValues);
          if (variance < straightLineThreshold && !straightLiners.includes(id)) {
            straightLiners.push(id);
            flaggedRespondents.add(id);
          }
        }
      });
    }
  });

  // Outlier detection: per sample, flag respondents whose liking is > z * sd.
  const allLikingBySample = new Map<number, Array<{ respondentId: string; value: number }>>();
  inputs.forEach((input) => {
    const rows =
      Array.isArray(input.sampleResponses) && input.sampleResponses.length > 0
        ? input.sampleResponses
        : [
            {
              sampleNumber: 1,
              overallLiking: input.overallLiking,
            } as SampleResponseLike,
          ];
    rows.forEach((sample) => {
      if (typeof sample.overallLiking !== "number" || !Number.isFinite(sample.overallLiking)) return;
      const num = typeof sample.sampleNumber === "number" ? sample.sampleNumber : 1;
      if (!allLikingBySample.has(num)) allLikingBySample.set(num, []);
      allLikingBySample.get(num)!.push({ respondentId: input.respondentId, value: sample.overallLiking });
    });
  });

  const outlierRespondents = new Set<string>();
  allLikingBySample.forEach((rows) => {
    if (rows.length < 5) return;
    const values = rows.map((row) => row.value);
    const m = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / Math.max(1, values.length - 1));
    if (sd === 0) return;
    rows.forEach((row) => {
      const z = Math.abs(row.value - m) / sd;
      if (z > outlierZ) {
        outlierRespondents.add(row.respondentId);
        flaggedRespondents.add(row.respondentId);
      }
    });
  });

  pushIfAny(findings, {
    code: "MISSING_LIKING",
    label: "Missing overall liking score(s)",
    severity: "WARNING",
    message: "Some sample evaluations are missing an overall liking score and were excluded from descriptive statistics.",
    affectedRespondents: dedupe(missingLiking),
  });

  pushIfAny(findings, {
    code: "MISSING_RESPONSES",
    label: "Respondents with no sample evaluations",
    severity: "WARNING",
    message: "Some respondents submitted no usable sample evaluations.",
    affectedRespondents: dedupe(missingResponses),
  });

  pushIfAny(findings, {
    code: "DUPLICATE_RESPONSE",
    label: "Duplicate respondent submissions",
    severity: "WARNING",
    message: "The same respondent appears more than once in the dataset.",
    affectedRespondents: dedupe(duplicateRespondents),
  });

  pushIfAny(findings, {
    code: "INCOMPLETE_EVALUATION",
    label: "Incomplete evaluations",
    severity: "WARNING",
    message: "Some respondents did not evaluate every sample or attribute expected by the study design.",
    affectedRespondents: dedupe(incompleteRespondentIds),
  });

  pushIfAny(findings, {
    code: "FAST_RESPONDENT",
    label: "Unusually fast respondents",
    severity: "WARNING",
    message: `Respondents that submitted in under ${minDuration} seconds may not have engaged with the questionnaire.`,
    affectedRespondents: dedupe(fastRespondents),
  });

  pushIfAny(findings, {
    code: "ATTENTION_CHECK_FAIL",
    label: "Failed attention checks",
    severity: "WARNING",
    message: "These respondents failed an attention check item; consider excluding them from analysis.",
    affectedRespondents: dedupe(attentionFailures),
  });

  pushIfAny(findings, {
    code: "STRAIGHT_LINING",
    label: "Straight-lining detected",
    severity: "WARNING",
    message: "These respondents produced near-identical scores across samples or attributes, which often indicates rushed responses.",
    affectedRespondents: dedupe(straightLiners),
  });

  pushIfAny(findings, {
    code: "OUTLIER",
    label: "Statistical outliers",
    severity: "INFO",
    message: `Liking scores more than ${outlierZ}σ from the per-sample mean were observed.`,
    affectedRespondents: Array.from(outlierRespondents),
  });

  const blocking = findings.some((finding) => finding.severity === "BLOCKING");
  const status: DataQualityReport["status"] = blocking
    ? "BLOCKED"
    : findings.length === 0
      ? "PASSED"
      : "PASSED_WITH_WARNINGS";

  const recommendation = buildRecommendation(status, findings, flaggedRespondents.size, inputs.length);

  return {
    status,
    findings,
    totals: {
      respondents: inputs.length,
      samplesEvaluated,
      expectedSamples: options.expectedSamples,
      incompleteRespondents,
      flaggedRespondents: flaggedRespondents.size,
    },
    recommendation,
  };
}

function pushIfAny(
  findings: DataQualityFinding[],
  finding: Omit<DataQualityFinding, "affectedCount"> & { affectedRespondents: string[] }
) {
  if (finding.affectedRespondents.length === 0) return;
  findings.push({ ...finding, affectedCount: finding.affectedRespondents.length });
}

function buildRecommendation(
  status: DataQualityReport["status"],
  findings: DataQualityFinding[],
  flaggedRespondents: number,
  totalRespondents: number
) {
  if (status === "PASSED") {
    return "No data quality issues detected. Analysis ran on the full dataset.";
  }
  if (status === "BLOCKED") {
    return "One or more blocking data quality issues were detected. Resolve them before relying on the analysis output.";
  }
  const ratio = totalRespondents > 0 ? Math.round((flaggedRespondents / totalRespondents) * 100) : 0;
  if (findings.length === 1) {
    return `Analysis proceeded with ${flaggedRespondents} flagged respondent(s) (~${ratio}%). Review the data quality findings before publishing the report.`;
  }
  return `Analysis proceeded with caution: ${flaggedRespondents} respondent(s) flagged across ${findings.length} categories (~${ratio}%). Review the data quality panel before publishing the report.`;
}

function dedupe(values: string[]) {
  return Array.from(new Set(values));
}

function computeVariance(values: number[]) {
  const m = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / Math.max(1, values.length - 1);
}

function deriveDurationSeconds(start?: string | Date, end?: string | Date) {
  if (!start || !end) return undefined;
  const s = start instanceof Date ? start.getTime() : new Date(start).getTime();
  const e = end instanceof Date ? end.getTime() : new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return undefined;
  return Math.round((e - s) / 1000);
}
