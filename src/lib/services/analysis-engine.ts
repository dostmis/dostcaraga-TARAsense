import { prisma } from "@/lib/db";
import { DecisionType, Prisma } from "@prisma/client";
import { compareSamples, formatPValue, type ComparisonResult } from "@/lib/services/statistics";

type JarBucket = "too_low" | "just_right" | "too_high";
type DriverLevel = "STRONG" | "MODERATE" | "NOT_ACTIONABLE";

interface ParsedJARValue {
  rawValue: number;
  bucket: JarBucket;
}

interface DescriptiveStats {
  mean: number;
  stdDev: number;
  n: number;
  median: number;
}

interface SampleResponseEntry {
  sampleNumber: number;
  sampleLabel?: string;
  overallLiking?: number;
  attributes: Record<string, unknown>;
}

interface StudyResponse {
  respondentId: string;
  overallLiking?: number;
  attributes: Record<string, unknown>;
  sampleResponses?: SampleResponseEntry[];
  importMeta?: {
    sampleLabelByNumber?: Record<string, unknown>;
  };
}

interface PenaltyResult {
  attribute: string;
  tooLowPenalty: number | null;
  tooHighPenalty: number | null;
  tooLowPercent: number;
  tooHighPercent: number;
  jarMean: number | null;
  tooLowLevel: DriverLevel;
  tooHighLevel: DriverLevel;
  driverLevel: DriverLevel;
  isActionable: boolean;
  isSignificant: boolean;
}

interface SamplePerformanceRow {
  sampleNumber: number;
  sampleLabel: string;
  meanScore: number;
  n: number;
  interpretation: string;
}

interface SampleJarBreakdownRow {
  attribute: string;
  tooLowPercent: number;
  justRightPercent: number;
  tooHighPercent: number;
  tooLowCount: number;
  justRightCount: number;
  tooHighCount: number;
  tooLowPenalty: number | null;
  tooHighPenalty: number | null;
  driverLevel: DriverLevel;
}

interface SampleMeanDropRow {
  attribute: string;
  jarCount: number;
  nonJarCount: number;
  jarPercent: number;
  tooLowPercent: number;
  tooHighPercent: number;
  jarMean: number | null;
  nonJarMean: number | null;
  tooLowMean: number | null;
  tooHighMean: number | null;
  meanDrop: number | null;
  tooLowMeanDrop: number | null;
  tooHighMeanDrop: number | null;
  severity: DriverLevel;
}

interface SampleAnalysisBlock {
  sampleNumber: number;
  sampleLabel: string;
  overallLiking: DescriptiveStats;
  interpretation: string;
  attributeLiking: Array<{ attribute: string; stats: DescriptiveStats }>;
  jarBreakdown: SampleJarBreakdownRow[];
  penaltyAnalysis: PenaltyResult[];
  meanDropAnalysis: SampleMeanDropRow[];
  actionableDrivers: string[];
}

interface SampleInsights {
  samplePerformance: SamplePerformanceRow[];
  bySample: SampleAnalysisBlock[];
  bestSample: SamplePerformanceRow | null;
}

interface SampleObservation {
  respondentId: string;
  sampleNumber: number;
  sampleLabel: string;
  overallLiking?: number;
  attributes: Record<string, unknown>;
}

export class SensoryAnalysisEngine {
  async analyzeStudy(studyId: string) {
    const [study, responses, attributes] = await Promise.all([
      prisma.study.findUnique({
        where: { id: studyId },
        select: {
          id: true,
          title: true,
          productName: true,
          sampleSize: true,
          targetDemographics: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.sensoryResponse.findMany({
        where: { studyId },
        select: {
          participantId: true,
          data: true,
          submittedAt: true,
        },
        orderBy: { submittedAt: "asc" },
      }),
      prisma.sensoryAttribute.findMany({
        where: { studyId },
        orderBy: { order: "asc" },
      }),
    ]);

    const parsedResponses: StudyResponse[] = responses.map((response) => ({
      ...(response.data as unknown as Omit<StudyResponse, "respondentId">),
      respondentId: response.participantId,
    }));
    const sampleObservations = this.buildSampleObservations(parsedResponses);

    const overallLikingScores = parsedResponses
      .map((response) => response.overallLiking)
      .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
    const overallStats = this.computeDescriptiveStats(overallLikingScores);
    const sampleInsights = this.buildSampleInsights(
      sampleObservations,
      attributes
    );
    const studyOverview = this.buildStudyOverview(study, attributes, responses, sampleInsights);
    const comparativeAnalysis = this.buildComparativeAnalysis(sampleObservations, attributes);
    const meanDropAnalysis = sampleInsights.bySample.flatMap((sample) =>
      sample.meanDropAnalysis.map((row) => ({
        sampleNumber: sample.sampleNumber,
        sampleLabel: sample.sampleLabel,
        ...row,
      }))
    );
    const automaticInterpretation = this.buildAutomaticInterpretation(
      overallStats,
      sampleInsights,
      comparativeAnalysis,
      meanDropAnalysis
    );

    const attributeResults: Array<Record<string, unknown>> = [];
    const penaltyResults: PenaltyResult[] = [];

    for (const attr of attributes) {
      if (attr.type === "JAR") {
        const penalty = this.calculatePenaltyAnalysis(attr.name, parsedResponses);
        penaltyResults.push(penalty);

        attributeResults.push({
          name: attr.name,
          type: "JAR",
          distribution: this.calculateJARDistribution(attr.name, parsedResponses),
          penalty,
        });
        continue;
      }

      if (attr.type === "ATTRIBUTE_LIKING" || attr.type === "OVERALL_LIKING") {
        const scores = parsedResponses
          .map((response) => response.attributes[attr.name])
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

        attributeResults.push({
          name: attr.name,
          type: "LIKING",
          stats: this.computeDescriptiveStats(scores),
        });
      }
    }

    const attributeStatsJson = JSON.parse(JSON.stringify(attributeResults)) as Prisma.InputJsonValue;
    const penaltyStatsJson = JSON.parse(JSON.stringify(penaltyResults)) as Prisma.InputJsonValue;
    const overallLikingPayload = {
      ...overallStats,
      studyOverview,
      samplePerformance: sampleInsights.samplePerformance,
      bestSample: sampleInsights.bestSample,
      bySample: sampleInsights.bySample,
      perSampleResults: sampleInsights.bySample,
      comparativeAnalysis,
      meanDropAnalysis,
      automaticInterpretation,
      jarFramework: {
        tooLow: "1-2",
        justRight: "3",
        tooHigh: "4-5",
      },
      driverRules: {
        strong: "Penalty >= 1.0 and non-JAR >= 20%",
        moderate: "Penalty 0.5-0.99 and non-JAR >= 20%",
      },
    };
    const overallLikingJson = JSON.parse(JSON.stringify(overallLikingPayload)) as Prisma.InputJsonValue;

    const analysis = await prisma.studyAnalysis.upsert({
      where: { studyId },
      update: {
        overallLiking: overallLikingJson,
        attributeStats: attributeStatsJson,
        penaltyAnalysis: penaltyStatsJson,
      },
      create: {
        studyId,
        overallLiking: overallLikingJson,
        attributeStats: attributeStatsJson,
        penaltyAnalysis: penaltyStatsJson,
      },
    });

    await this.writeDerivedMetrics(studyId, overallLikingPayload, attributeResults, penaltyResults);
    await this.generateAIInterpretation(studyId, overallStats, penaltyResults);

    return analysis;
  }

  private computeDescriptiveStats(values: number[]): DescriptiveStats {
    if (values.length === 0) {
      return { mean: 0, stdDev: 0, n: 0, median: 0 };
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
    const stdDev = Math.sqrt(variance);

    return {
      mean: Math.round(mean * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      n: values.length,
      median: this.calculateMedian(values),
    };
  }

  private calculateMedian(values: number[]) {
    if (values.length === 0) {
      return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private calculateJARDistribution(attributeName: string, responses: StudyResponse[]) {
    const rawCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const collapsedCounts: Record<JarBucket, number> = { too_low: 0, just_right: 0, too_high: 0 };
    let total = 0;

    responses.forEach((response) => {
      const parsed = normalizeJarValue(response.attributes[attributeName]);
      if (!parsed) {
        return;
      }

      rawCounts[parsed.rawValue as 1 | 2 | 3 | 4 | 5] += 1;
      collapsedCounts[parsed.bucket] += 1;
      total += 1;
    });

    if (total === 0) {
      return {
        raw5pt: {
          muchTooLow: { count: 0, percent: 0 },
          slightlyTooLow: { count: 0, percent: 0 },
          jar: { count: 0, percent: 0 },
          slightlyTooHigh: { count: 0, percent: 0 },
          muchTooHigh: { count: 0, percent: 0 },
        },
        tooLow: { count: 0, percent: 0 },
        justRight: { count: 0, percent: 0 },
        tooHigh: { count: 0, percent: 0 },
      };
    }

    return {
      raw5pt: {
        muchTooLow: { count: rawCounts[1], percent: Math.round((rawCounts[1] / total) * 100) },
        slightlyTooLow: { count: rawCounts[2], percent: Math.round((rawCounts[2] / total) * 100) },
        jar: { count: rawCounts[3], percent: Math.round((rawCounts[3] / total) * 100) },
        slightlyTooHigh: { count: rawCounts[4], percent: Math.round((rawCounts[4] / total) * 100) },
        muchTooHigh: { count: rawCounts[5], percent: Math.round((rawCounts[5] / total) * 100) },
      },
      tooLow: { count: collapsedCounts.too_low, percent: Math.round((collapsedCounts.too_low / total) * 100) },
      justRight: { count: collapsedCounts.just_right, percent: Math.round((collapsedCounts.just_right / total) * 100) },
      tooHigh: { count: collapsedCounts.too_high, percent: Math.round((collapsedCounts.too_high / total) * 100) },
    };
  }

  private calculatePenaltyAnalysis(attributeName: string, responses: StudyResponse[]): PenaltyResult {
    const groups = {
      just_right: [] as number[],
      too_low: [] as number[],
      too_high: [] as number[],
    };

    let totalValidJar = 0;
    responses.forEach((response) => {
      if (typeof response.overallLiking !== "number" || !Number.isFinite(response.overallLiking)) {
        return;
      }

      const parsed = normalizeJarValue(response.attributes[attributeName]);
      if (!parsed) {
        return;
      }

      groups[parsed.bucket].push(response.overallLiking);
      totalValidJar += 1;
    });

    const jarMean = nullableMean(groups.just_right);
    const tooLowMean = nullableMean(groups.too_low);
    const tooHighMean = nullableMean(groups.too_high);

    const tooLowPercent = totalValidJar > 0 ? (groups.too_low.length / totalValidJar) * 100 : 0;
    const tooHighPercent = totalValidJar > 0 ? (groups.too_high.length / totalValidJar) * 100 : 0;

    const tooLowPenalty = jarMean !== null && tooLowMean !== null ? jarMean - tooLowMean : null;
    const tooHighPenalty = jarMean !== null && tooHighMean !== null ? jarMean - tooHighMean : null;

    const tooLowLevel = classifyDriverLevel(tooLowPenalty, tooLowPercent);
    const tooHighLevel = classifyDriverLevel(tooHighPenalty, tooHighPercent);
    const driverLevel = mergeDriverLevels(tooLowLevel, tooHighLevel);

    return {
      attribute: attributeName,
      tooLowPenalty: roundNullable(tooLowPenalty),
      tooHighPenalty: roundNullable(tooHighPenalty),
      tooLowPercent: Math.round(tooLowPercent),
      tooHighPercent: Math.round(tooHighPercent),
      jarMean: roundNullable(jarMean),
      tooLowLevel,
      tooHighLevel,
      driverLevel,
      isActionable: driverLevel !== "NOT_ACTIONABLE",
      isSignificant: driverLevel === "STRONG",
    };
  }

  private buildSampleObservations(parsedResponses: StudyResponse[]): SampleObservation[] {
    const observations: SampleObservation[] = [];
    parsedResponses.forEach((response) => {
      const labelMap = toSampleLabelMap(response.importMeta?.sampleLabelByNumber);
      const sampleRows =
        Array.isArray(response.sampleResponses) && response.sampleResponses.length > 0
          ? response.sampleResponses
          : [
              {
                sampleNumber: 1,
                sampleLabel: labelMap.get(1) ?? "Sample 1",
                overallLiking: response.overallLiking,
                attributes: response.attributes,
              },
            ];

      sampleRows.forEach((sample) => {
        const normalizedSampleNumber =
          typeof sample.sampleNumber === "number" && Number.isFinite(sample.sampleNumber) && sample.sampleNumber > 0
            ? Math.floor(sample.sampleNumber)
            : 1;
        const sampleLabel =
          sample.sampleLabel?.trim() || labelMap.get(normalizedSampleNumber) || `Sample ${normalizedSampleNumber}`;

        observations.push({
          respondentId: response.respondentId,
          sampleNumber: normalizedSampleNumber,
          sampleLabel,
          overallLiking:
            typeof sample.overallLiking === "number" && Number.isFinite(sample.overallLiking)
              ? sample.overallLiking
              : response.overallLiking,
          attributes: sample.attributes,
        });
      });
    });

    return observations;
  }

  private buildSampleInsights(sampleObservations: SampleObservation[], attributes: Array<{ name: string; type: string }>): SampleInsights {
    const jarAttributeNames = attributes.filter((attribute) => attribute.type === "JAR").map((attribute) => attribute.name);
    const likingAttributeNames = attributes
      .filter((attribute) => attribute.type === "ATTRIBUTE_LIKING" || attribute.type === "OVERALL_LIKING")
      .map((attribute) => attribute.name);
    const buckets = new Map<number, { sampleNumber: number; sampleLabel: string; responses: StudyResponse[] }>();

    sampleObservations.forEach((observation) => {
      const bucket = buckets.get(observation.sampleNumber) ?? {
        sampleNumber: observation.sampleNumber,
        sampleLabel: observation.sampleLabel,
        responses: [],
      };
      bucket.sampleLabel = bucket.sampleLabel || observation.sampleLabel;
      bucket.responses.push({
        respondentId: observation.respondentId,
        overallLiking: observation.overallLiking,
        attributes: observation.attributes,
      });
      buckets.set(observation.sampleNumber, bucket);
    });

    const sampleRows = Array.from(buckets.values()).sort((left, right) => left.sampleNumber - right.sampleNumber);
    const bySample: SampleAnalysisBlock[] = sampleRows.map((sampleRow) => {
      const overallScores = sampleRow.responses
        .map((row) => row.overallLiking)
        .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
      const stats = this.computeDescriptiveStats(overallScores);
      const attributeLiking = likingAttributeNames.map((attributeName) => {
        const values = sampleRow.responses
          .map((row) => getNumericAttributeValue(row.attributes, attributeName))
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

        return {
          attribute: attributeName,
          stats: this.computeDescriptiveStats(values),
        };
      });
      const penalties = jarAttributeNames.map((attributeName) =>
        this.calculatePenaltyAnalysis(attributeName, sampleRow.responses)
      );
      const meanDropAnalysis = jarAttributeNames.map((attributeName) =>
        this.calculateMeanDropAnalysis(attributeName, sampleRow.responses)
      );
      const jarBreakdown: SampleJarBreakdownRow[] = jarAttributeNames.map((attributeName) => {
        const distribution = this.calculateJARDistribution(attributeName, sampleRow.responses);
        const penalty = penalties.find((row) => row.attribute === attributeName);
        return {
          attribute: attributeName,
          tooLowPercent: distribution.tooLow.percent,
          justRightPercent: distribution.justRight.percent,
          tooHighPercent: distribution.tooHigh.percent,
          tooLowCount: distribution.tooLow.count,
          justRightCount: distribution.justRight.count,
          tooHighCount: distribution.tooHigh.count,
          tooLowPenalty: penalty?.tooLowPenalty ?? null,
          tooHighPenalty: penalty?.tooHighPenalty ?? null,
          driverLevel: penalty?.driverLevel ?? "NOT_ACTIONABLE",
        };
      });
      const actionableDrivers = penalties.filter((row) => row.isActionable).map((row) => row.attribute);

      return {
        sampleNumber: sampleRow.sampleNumber,
        sampleLabel: sampleRow.sampleLabel,
        overallLiking: stats,
        interpretation: interpretSampleMean(stats.mean),
        attributeLiking,
        jarBreakdown,
        penaltyAnalysis: penalties,
        meanDropAnalysis,
        actionableDrivers,
      };
    });

    const samplePerformance: SamplePerformanceRow[] = bySample.map((sample) => ({
      sampleNumber: sample.sampleNumber,
      sampleLabel: sample.sampleLabel,
      meanScore: sample.overallLiking.mean,
      n: sample.overallLiking.n,
      interpretation: sample.interpretation,
    }));

    const bestSample =
      samplePerformance.length > 0
        ? [...samplePerformance].sort((left, right) => {
            if (right.meanScore !== left.meanScore) return right.meanScore - left.meanScore;
            return left.sampleNumber - right.sampleNumber;
          })[0]
        : null;

    return {
      samplePerformance,
      bySample,
      bestSample,
    };
  }

  private buildStudyOverview(
    study: {
      title: string;
      productName: string;
      sampleSize: number;
      targetDemographics: Prisma.JsonValue;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    } | null,
    attributes: Array<{ name: string; type: string }>,
    responses: Array<{ submittedAt: Date }>,
    sampleInsights: SampleInsights
  ) {
    const submittedDates = responses.map((response) => response.submittedAt.getTime()).filter(Number.isFinite);
    const conductedAt = submittedDates.length > 0 ? new Date(Math.max(...submittedDates)).toISOString() : null;
    const hedonicScale = attributes.some(
      (attribute) => attribute.type === "OVERALL_LIKING" || attribute.type === "ATTRIBUTE_LIKING"
    )
      ? "9-point hedonic scale"
      : "Not configured";
    const jarScale = attributes.some((attribute) => attribute.type === "JAR") ? "5-point JAR scale" : null;

    return {
      title: study?.title ?? "Untitled study",
      productName: study?.productName ?? "",
      status: study?.status ?? "UNKNOWN",
      numberOfConsumers: responses.length,
      targetConsumers: study?.sampleSize ?? 0,
      numberOfSamples: sampleInsights.samplePerformance.length,
      attributesEvaluated: attributes.map((attribute) => ({
        name: attribute.name,
        type: attribute.type,
      })),
      hedonicScale,
      jarScale,
      dateConducted: conductedAt,
      generatedAt: new Date().toISOString(),
      workflow: "Raw Consumer Data > Data Validation > Sample-Based Summary > Comparative Analysis > Graph Output",
    };
  }

  private buildComparativeAnalysis(sampleObservations: SampleObservation[], attributes: Array<{ name: string; type: string }>) {
    const candidateVariables = [
      ...attributes
        .filter((attribute) => attribute.type === "OVERALL_LIKING")
        .map((attribute) => ({
          key: attribute.name,
          label: attribute.name,
          type: "OVERALL_LIKING" as const,
        })),
      ...attributes
        .filter((attribute) => attribute.type === "ATTRIBUTE_LIKING")
        .map((attribute) => ({
          key: attribute.name,
          label: attribute.name,
          type: "ATTRIBUTE_LIKING" as const,
        })),
    ];

    const variables =
      candidateVariables.length > 0
        ? candidateVariables
        : [
            {
              key: "overallLiking",
              label: "Overall Liking",
              type: "OVERALL_LIKING" as const,
            },
          ];

    const sampleNumbers = Array.from(new Set(sampleObservations.map((row) => row.sampleNumber))).sort((left, right) => left - right);
    const sampleOptions = sampleNumbers.map((sampleNumber) => {
      const match = sampleObservations.find((row) => row.sampleNumber === sampleNumber);
      return {
        sampleNumber,
        sampleLabel: match?.sampleLabel ?? `Sample ${sampleNumber}`,
      };
    });

    const comparisons = variables.map((variable) => {
      const sampleInputs = sampleOptions.map((sample) => {
        const valuesByRespondent = new Map<string, number>();
        sampleObservations
          .filter((observation) => observation.sampleNumber === sample.sampleNumber)
          .forEach((observation) => {
            const value =
              variable.key === "overallLiking"
                ? observation.overallLiking
                : getNumericAttributeValue(observation.attributes, variable.key);
            if (typeof value === "number" && Number.isFinite(value)) {
              valuesByRespondent.set(observation.respondentId, value);
            }
          });

        return {
          sampleNumber: sample.sampleNumber,
          sampleLabel: sample.sampleLabel,
          valuesByRespondent,
        };
      });

      const result = compareSamples(sampleInputs);
      return {
        variableKey: variable.key,
        variableLabel: variable.label,
        variableType: variable.type,
        sampleSelection: "ALL_SAMPLES",
        sampleCount: sampleInputs.length,
        samples: sampleInputs.map((sample) => {
          const values = Array.from(sample.valuesByRespondent.values());
          return {
            sampleNumber: sample.sampleNumber,
            sampleLabel: sample.sampleLabel,
            stats: this.computeDescriptiveStats(values),
          };
        }),
        statisticalComparison: serializeComparisonResult(result),
        graphType: result.repeatedMeasures ? "Repeated-measures bar chart with paired comparison" : "Independent-group bar chart",
      };
    });

    const primaryComparison = comparisons.find((comparison) => comparison.variableType === "OVERALL_LIKING") ?? comparisons[0] ?? null;

    return {
      sampleOptions,
      variableOptions: variables.map((variable) => ({
        key: variable.key,
        label: variable.label,
        type: variable.type,
      })),
      defaultSampleSelection: "ALL_SAMPLES",
      defaultVariableKey: primaryComparison?.variableKey ?? null,
      primaryComparison,
      comparisons,
      guardrails: [
        "Statistical tests are selected by TARAsense, not by the user.",
        "Complete respondent overlap is treated as repeated-measures data.",
        "Rank-based tests are used as conservative Phase 1 defaults for small or ordinal-like hedonic datasets.",
      ],
    };
  }

  private calculateMeanDropAnalysis(attributeName: string, responses: StudyResponse[]): SampleMeanDropRow {
    const groups = {
      just_right: [] as number[],
      too_low: [] as number[],
      too_high: [] as number[],
    };

    responses.forEach((response) => {
      if (typeof response.overallLiking !== "number" || !Number.isFinite(response.overallLiking)) {
        return;
      }
      const jarValue = normalizeJarValue(response.attributes[attributeName]);
      if (!jarValue) {
        return;
      }
      groups[jarValue.bucket].push(response.overallLiking);
    });

    const jarMean = nullableMean(groups.just_right);
    const tooLowMean = nullableMean(groups.too_low);
    const tooHighMean = nullableMean(groups.too_high);
    const nonJarValues = [...groups.too_low, ...groups.too_high];
    const nonJarMean = nullableMean(nonJarValues);
    const total = groups.just_right.length + nonJarValues.length;
    const tooLowPercent = total > 0 ? (groups.too_low.length / total) * 100 : 0;
    const tooHighPercent = total > 0 ? (groups.too_high.length / total) * 100 : 0;
    const meanDrop = jarMean !== null && nonJarMean !== null ? jarMean - nonJarMean : null;
    const tooLowMeanDrop = jarMean !== null && tooLowMean !== null ? jarMean - tooLowMean : null;
    const tooHighMeanDrop = jarMean !== null && tooHighMean !== null ? jarMean - tooHighMean : null;
    const severity = mergeDriverLevels(
      classifyDriverLevel(tooLowMeanDrop, tooLowPercent),
      classifyDriverLevel(tooHighMeanDrop, tooHighPercent)
    );

    return {
      attribute: attributeName,
      jarCount: groups.just_right.length,
      nonJarCount: nonJarValues.length,
      jarPercent: total > 0 ? Math.round((groups.just_right.length / total) * 100) : 0,
      tooLowPercent: Math.round(tooLowPercent),
      tooHighPercent: Math.round(tooHighPercent),
      jarMean: roundNullable(jarMean),
      nonJarMean: roundNullable(nonJarMean),
      tooLowMean: roundNullable(tooLowMean),
      tooHighMean: roundNullable(tooHighMean),
      meanDrop: roundNullable(meanDrop),
      tooLowMeanDrop: roundNullable(tooLowMeanDrop),
      tooHighMeanDrop: roundNullable(tooHighMeanDrop),
      severity,
    };
  }

  private buildAutomaticInterpretation(
    overallStats: DescriptiveStats,
    sampleInsights: SampleInsights,
    comparativeAnalysis: ReturnType<SensoryAnalysisEngine["buildComparativeAnalysis"]>,
    meanDropAnalysis: Array<SampleMeanDropRow & { sampleNumber: number; sampleLabel: string }>
  ) {
    const insights: string[] = [];
    if (sampleInsights.bestSample) {
      insights.push(
        `${sampleInsights.bestSample.sampleLabel} obtained the highest overall liking score (${sampleInsights.bestSample.meanScore}).`
      );
    }

    const comparison = comparativeAnalysis.primaryComparison?.statisticalComparison;
    if (comparison) {
      insights.push(comparison.interpretation);
    }

    const strongestDriver = [...meanDropAnalysis]
      .filter((row) => row.severity !== "NOT_ACTIONABLE" && row.meanDrop !== null)
      .sort((left, right) => (right.meanDrop ?? 0) - (left.meanDrop ?? 0))[0];
    if (strongestDriver) {
      insights.push(
        `${strongestDriver.attribute} in ${strongestDriver.sampleLabel} is the strongest actionable JAR driver with a mean drop of ${strongestDriver.meanDrop}.`
      );
    }

    if (insights.length === 0) {
      insights.push(`Overall liking averaged ${overallStats.mean}, with no actionable JAR driver detected from current data.`);
    }

    return {
      summary: insights,
      decisionSupport: {
        bestSample: sampleInsights.bestSample,
        primaryPValue: comparison?.pValue ?? null,
        formattedPrimaryPValue: formatPValue(comparison?.pValue ?? null),
        hasSignificantDifference: comparison?.significant ?? null,
        strongestDriver: strongestDriver ?? null,
      },
    };
  }

  private async writeDerivedMetrics(
    studyId: string,
    overallStats: Record<string, unknown>,
    attributeResults: Array<Record<string, unknown>>,
    penalties: PenaltyResult[]
  ) {
    const coreAttributes = await prisma.coreAttribute.findMany({
      where: { studyId },
      select: { id: true, attributeName: true },
    });

    const attributeIdByName = new Map<string, string>(
      coreAttributes.map((attribute) => [attribute.attributeName.toLowerCase(), attribute.id])
    );

    const metrics: Array<{ studyId: string; attributeId?: string | null; metricType: "MEAN_LIKING" | "JAR_FREQ" | "PENALTY"; value: Prisma.InputJsonValue }> = [];

    metrics.push({
      studyId,
      attributeId: null,
      metricType: "MEAN_LIKING",
      value: JSON.parse(JSON.stringify(overallStats)) as Prisma.InputJsonValue,
    });

    attributeResults
      .filter((row) => row.type === "JAR")
      .forEach((row) => {
        const name = typeof row.name === "string" ? row.name : "";
        const normalizedName = normalizeAttributeBaseName(name).toLowerCase();
        const attributeId = attributeIdByName.get(normalizedName) ?? null;

        metrics.push({
          studyId,
          attributeId,
          metricType: "JAR_FREQ",
          value: JSON.parse(JSON.stringify({
            attribute: name,
            distribution: row.distribution,
          })) as Prisma.InputJsonValue,
        });
      });

    penalties.forEach((penalty) => {
      const normalizedName = normalizeAttributeBaseName(penalty.attribute).toLowerCase();
      const attributeId = attributeIdByName.get(normalizedName) ?? null;
      metrics.push({
        studyId,
        attributeId,
        metricType: "PENALTY",
        value: JSON.parse(JSON.stringify(penalty)) as Prisma.InputJsonValue,
      });
    });

    await prisma.$transaction(async (tx) => {
      await tx.derivedMetric.deleteMany({ where: { studyId } });
      if (metrics.length > 0) {
        await tx.derivedMetric.createMany({ data: metrics });
      }
    });
  }

  private async generateAIInterpretation(studyId: string, overallStats: DescriptiveStats, penalties: PenaltyResult[]) {
    if (!process.env.OPENAI_API_KEY) {
      return;
    }

    const actionableIssues = penalties.filter((penalty) => penalty.isActionable);

    const prompt = `
You are a sensory analysis expert interpreting results from a consumer taste test.
Overall Liking: Mean ${overallStats.mean}/9.0 (n=${overallStats.n})

Penalty Analysis Results:
${actionableIssues
  .map(
    (penalty) =>
      `- ${penalty.attribute}: low side ${penalty.tooLowPercent}% (penalty ${penalty.tooLowPenalty}, level ${penalty.tooLowLevel}); high side ${penalty.tooHighPercent}% (penalty ${penalty.tooHighPenalty}, level ${penalty.tooHighLevel})`
  )
  .join("\n")}

Provide:
1. A 2-sentence interpretation of consumer acceptance
2. Specific product development recommendations
3. A decision: NEEDS_IMPROVEMENT, CONTINUE_REFINEMENT, READY_FOR_READINESS, or READY_FOR_COMMERCIALIZATION

Format as JSON: {"interpretation": string, "recommendation": string, "decision": string}
`;

    try {
      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      const result = JSON.parse(raw) as {
        interpretation?: string;
        recommendation?: string;
        decision?: string;
      };

      const validDecisions = new Set<DecisionType>([
        "NEEDS_IMPROVEMENT",
        "CONTINUE_REFINEMENT",
        "READY_FOR_READINESS",
        "READY_FOR_COMMERCIALIZATION",
      ]);

      const decisionValue = result.decision as DecisionType | undefined;

      await prisma.studyAnalysis.update({
        where: { studyId },
        data: {
          aiInterpretation: result.interpretation ?? null,
          aiRecommendation: result.recommendation ?? null,
          decisionFlag: decisionValue && validDecisions.has(decisionValue) ? decisionValue : null,
        },
      });
    } catch (error) {
      console.error("AI generation failed:", error);
      try {
        await prisma.studyAnalysis.update({
          where: { studyId },
          data: {
            aiInterpretation: null,
            aiRecommendation: null,
            decisionFlag: null,
          },
        });
      } catch {
        // Best-effort clear; do not re-throw so analysis pipeline continues.
      }
    }
  }
}

function normalizeJarValue(value: unknown): ParsedJARValue | null {
  if (!value) {
    return null;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5) {
    return {
      rawValue: value,
      bucket: collapseJarBucket(value),
    };
  }

  if (typeof value !== "object") {
    return null;
  }

  const row = value as { value?: unknown; rawValue?: unknown; bucket?: unknown };

  if (typeof row.rawValue === "number" && Number.isInteger(row.rawValue) && row.rawValue >= 1 && row.rawValue <= 5) {
    return {
      rawValue: row.rawValue,
      bucket: collapseJarBucket(row.rawValue),
    };
  }

  if (typeof row.value === "number" && Number.isInteger(row.value) && row.value >= 1 && row.value <= 5) {
    return {
      rawValue: row.value,
      bucket: collapseJarBucket(row.value),
    };
  }

  if (typeof row.bucket === "string" && isJarBucket(row.bucket)) {
    return mapLegacyBucketToRaw(row.bucket);
  }
  if (typeof row.value === "string" && isJarBucket(row.value)) {
    return mapLegacyBucketToRaw(row.value);
  }

  return null;
}

function mapLegacyBucketToRaw(bucket: JarBucket) {
  if (bucket === "too_low") return { rawValue: 2, bucket: "too_low" as const };
  if (bucket === "just_right") return { rawValue: 3, bucket: "just_right" as const };
  return { rawValue: 4, bucket: "too_high" as const };
}

function isJarBucket(value: string): value is JarBucket {
  return value === "too_low" || value === "just_right" || value === "too_high";
}

function collapseJarBucket(rawValue: number): JarBucket {
  if (rawValue <= 2) return "too_low";
  if (rawValue === 3) return "just_right";
  return "too_high";
}

function classifyDriverLevel(penalty: number | null, nonJarPercent: number): DriverLevel {
  if (penalty === null || nonJarPercent < 20) {
    return "NOT_ACTIONABLE";
  }
  if (penalty >= 1.0) {
    return "STRONG";
  }
  if (penalty >= 0.5) {
    return "MODERATE";
  }
  return "NOT_ACTIONABLE";
}

function mergeDriverLevels(left: DriverLevel, right: DriverLevel): DriverLevel {
  if (left === "STRONG" || right === "STRONG") {
    return "STRONG";
  }
  if (left === "MODERATE" || right === "MODERATE") {
    return "MODERATE";
  }
  return "NOT_ACTIONABLE";
}

function normalizeAttributeBaseName(name: string) {
  return name
    .replace(/\s*\(jar\)\s*$/i, "")
    .replace(/\s*liking\s*$/i, "")
    .trim();
}

function interpretSampleMean(mean: number) {
  if (mean >= 7.5) {
    return "Highly liked";
  }
  if (mean >= 6.5) {
    return "Generally liked";
  }
  if (mean >= 5.5) {
    return "Acceptable but weak";
  }
  return "Low liking";
}

function toSampleLabelMap(value: unknown) {
  const map = new Map<number, string>();
  if (!value || typeof value !== "object") {
    return map;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, rawLabel]) => {
    const sampleNumber = Number(key);
    if (!Number.isFinite(sampleNumber) || sampleNumber < 1) {
      return;
    }
    if (typeof rawLabel !== "string" || !rawLabel.trim()) {
      return;
    }
    map.set(Math.floor(sampleNumber), rawLabel.trim());
  });
  return map;
}

function getNumericAttributeValue(attributes: Record<string, unknown>, attributeName: string) {
  const value = attributes[attributeName];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableMean(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundNullable(value: number | null) {
  return value === null ? null : Math.round(value * 100) / 100;
}

function serializeComparisonResult(result: ComparisonResult) {
  return {
    test: result.test,
    testLabel: result.testLabel,
    repeatedMeasures: result.repeatedMeasures,
    pValue: result.pValue,
    formattedPValue: formatPValue(result.pValue),
    statistic: result.statistic,
    significant: result.significant,
    alpha: result.alpha,
    interpretation: result.interpretation,
    assumptions: result.assumptions,
    warnings: result.warnings,
  };
}
