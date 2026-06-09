import { prisma } from "@/lib/db";
import { DecisionType, Prisma, StudyDesign as PrismaStudyDesign } from "@prisma/client";
import { createOpenAICompatibleClient, parseJsonObjectResponse } from "@/lib/ai/openai-compatible";
import {
  compareSamples,
  computeCompactLetterDisplay,
  formatPValue,
  meanConfidenceInterval,
  type ComparisonResult,
  type ConfidenceInterval,
  type StudyDesign,
} from "@/lib/services/statistics";
import { evaluateDataQuality, type DataQualityReport } from "@/lib/services/data-quality";
import { runAdvancedAnalytics, type AdvancedAnalyticsResult } from "@/lib/services/advanced-analytics";

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
  confidenceInterval: ConfidenceInterval | null;
}

interface SampleResponseEntry {
  sampleNumber: number;
  sampleLabel?: string;
  overallLiking?: number;
  attributes: Record<string, unknown>;
  startedAt?: string;
  submittedAt?: string;
  durationSeconds?: number;
}

interface StudyResponse {
  respondentId: string;
  overallLiking?: number;
  attributes: Record<string, unknown>;
  sampleResponses?: SampleResponseEntry[];
  startedAt?: string;
  submittedAt?: string;
  durationSeconds?: number;
  attentionCheck?: { passed: boolean } | null;
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

interface AttributeLikingStats extends DescriptiveStats {
  stdError: number;
}

interface SampleAttributeLikingRow {
  attribute: string;
  stats: AttributeLikingStats;
  significanceLetter?: string | null;
}

interface SampleAnalysisBlock {
  sampleNumber: number;
  sampleLabel: string;
  overallLiking: DescriptiveStats;
  overallLikingLetter?: string | null;
  interpretation: string;
  attributeLiking: SampleAttributeLikingRow[];
  jarBreakdown: SampleJarBreakdownRow[];
  penaltyAnalysis: PenaltyResult[];
  meanDropAnalysis: SampleMeanDropRow[];
  actionableDrivers: string[];
  distribution: number[];
  attributeLikingNote?: string;
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
  async analyzeStudy(studyId: string, options?: { generateAi?: boolean }) {
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
          studyDesign: true,
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

    const studyDesign: StudyDesign = (study?.studyDesign as PrismaStudyDesign | undefined) === "MONADIC" ? "MONADIC" : "WITHIN_SUBJECT";

    const parsedResponses: StudyResponse[] = responses.map((response) => ({
      ...(response.data as unknown as Omit<StudyResponse, "respondentId">),
      respondentId: response.participantId,
      submittedAt: response.submittedAt.toISOString(),
    }));

    const sampleObservations = this.buildSampleObservations(parsedResponses);
    const expectedAttributeKeys = attributes
      .filter((attribute) => attribute.type === "JAR" || attribute.type === "ATTRIBUTE_LIKING" || attribute.type === "OVERALL_LIKING")
      .map((attribute) => attribute.name);
    const sampleNumbers = Array.from(new Set(sampleObservations.map((row) => row.sampleNumber)));
    const dataQuality = evaluateDataQuality(parsedResponses, {
      expectedSamples: sampleNumbers.length || 1,
      expectedAttributeKeys,
    });

    const overallLikingScores = parsedResponses
      .map((response) => response.overallLiking)
      .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
    const overallStats = this.computeDescriptiveStats(overallLikingScores);

    const sampleInsights = this.buildSampleInsights(sampleObservations, attributes);
    const studyOverview = this.buildStudyOverview(study, attributes, responses, sampleInsights, studyDesign);
    const comparativeAnalysis = this.buildComparativeAnalysis(sampleObservations, attributes, studyDesign);

    // Decorate per-sample blocks with compact letter display from the cross-sample comparisons.
    if (comparativeAnalysis.overallLikingComparison) {
      const overallLetters = new Map<number, string | null>();
      comparativeAnalysis.overallLikingComparison.samples.forEach((sample) => {
        overallLetters.set(sample.sampleNumber, sample.letter);
      });
      sampleInsights.bySample.forEach((sample) => {
        sample.overallLikingLetter = overallLetters.get(sample.sampleNumber) ?? null;
      });
    }
    if (comparativeAnalysis.attributeLikingComparison.length > 0) {
      const letterIndex = new Map<string, Map<number, string | null>>();
      comparativeAnalysis.attributeLikingComparison.forEach((entry) => {
        const sampleLetters = new Map<number, string | null>();
        entry.samples.forEach((sample) => sampleLetters.set(sample.sampleNumber, sample.letter));
        letterIndex.set(entry.attribute, sampleLetters);
      });
      sampleInsights.bySample.forEach((sample) => {
        sample.attributeLiking = sample.attributeLiking.map((row) => ({
          ...row,
          significanceLetter: letterIndex.get(row.attribute)?.get(sample.sampleNumber) ?? null,
        }));
        const anyLetter = sample.attributeLiking.some((row) => row.significanceLetter);
        sample.attributeLikingNote = anyLetter
          ? "Values are mean +/- SE. Samples sharing a letter for the same attribute are not significantly different across samples (p < 0.05)."
          : "Values are mean +/- SE. No significant across-sample differences detected for these attributes (p >= 0.05).";
      });
    } else {
      sampleInsights.bySample.forEach((sample) => {
        sample.attributeLikingNote = "Values are mean +/- SE.";
      });
    }
    const meanDropAnalysis = sampleInsights.bySample.flatMap((sample) =>
      sample.meanDropAnalysis.map((row) => ({
        sampleNumber: sample.sampleNumber,
        sampleLabel: sample.sampleLabel,
        ...row,
      }))
    );
    const advancedAnalytics = this.buildAdvancedAnalytics(sampleObservations, attributes);
    const automaticInterpretation = this.buildAutomaticInterpretation(
      overallStats,
      sampleInsights,
      comparativeAnalysis,
      meanDropAnalysis,
      dataQuality
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
      studyDesign,
      studyOverview,
      samplePerformance: sampleInsights.samplePerformance,
      bestSample: sampleInsights.bestSample,
      bySample: sampleInsights.bySample,
      perSampleResults: sampleInsights.bySample,
      comparativeAnalysis,
      meanDropAnalysis,
      automaticInterpretation,
      dataQuality,
      advancedAnalytics,
      jarFramework: {
        tooLow: "1-2",
        justRight: "3",
        tooHigh: "4-5",
      },
      driverRules: {
        strong: "Penalty >= 1.0 and non-JAR >= 20%",
        moderate: "Penalty 0.5-0.99 and non-JAR >= 20%",
      },
      acceptabilityThresholds: {
        highly: ">= 7.0 (Highly acceptable)",
        moderate: "5.0 to 6.99 (Moderately acceptable)",
        low: "< 5.0 (Low acceptability)",
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

    // The AI narrative is the only step that makes an external (slow) call. Callers
    // on the read path skip it so opening results never blocks on the AI provider;
    // it is generated at submission time and on explicit refresh instead.
    if (options?.generateAi !== false) {
      await this.generateAIInterpretation(studyId, {
        overallStats,
        penaltyResults,
        sampleInsights,
        comparativeAnalysis,
        dataQuality,
        automaticInterpretation,
        studyDesign,
      });
    }

    return analysis;
  }

  private computeDescriptiveStats(values: number[]): DescriptiveStats {
    if (values.length === 0) {
      return { mean: 0, stdDev: 0, n: 0, median: 0, confidenceInterval: null };
    }

    const meanValue = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / Math.max(1, values.length - 1);
    const stdDev = Math.sqrt(variance);
    const ci = meanConfidenceInterval(values, 0.95);

    return {
      mean: round2(meanValue),
      stdDev: round2(stdDev),
      n: values.length,
      median: this.calculateMedian(values),
      confidenceInterval: ci,
    };
  }

  private calculateMedian(values: number[]) {
    if (values.length === 0) return 0;
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
      if (!parsed) return;
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
      if (typeof response.overallLiking !== "number" || !Number.isFinite(response.overallLiking)) return;
      const parsed = normalizeJarValue(response.attributes[attributeName]);
      if (!parsed) return;
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

  private buildSampleInsights(
    sampleObservations: SampleObservation[],
    attributes: Array<{ name: string; type: string }>
  ): SampleInsights {
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
      const attributeLiking: SampleAttributeLikingRow[] = likingAttributeNames.map((attributeName) => {
        const values = sampleRow.responses
          .map((row) => getNumericAttributeValue(row.attributes, attributeName))
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        const stats = this.computeDescriptiveStats(values);
        const stdError = values.length > 0 ? round2(stats.stdDev / Math.sqrt(values.length)) : 0;
        return {
          attribute: attributeName,
          stats: { ...stats, stdError },
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
        distribution: overallScores,
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
      studyDesign: PrismaStudyDesign;
      createdAt: Date;
      updatedAt: Date;
    } | null,
    attributes: Array<{ name: string; type: string }>,
    responses: Array<{ submittedAt: Date }>,
    sampleInsights: SampleInsights,
    studyDesign: StudyDesign
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
      studyDesign,
      studyDesignLabel: studyDesign === "WITHIN_SUBJECT" ? "Within-subject (repeated measures)" : "Monadic (independent)",
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

  private buildComparativeAnalysis(
    sampleObservations: SampleObservation[],
    attributes: Array<{ name: string; type: string }>,
    studyDesign: StudyDesign
  ) {
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
    const jarVariableEntries = attributes
      .filter((attribute) => attribute.type === "JAR")
      .flatMap((attribute) => [
        {
          key: `__penalty__::${attribute.name}`,
          label: `${attribute.name} (penalty)`,
          type: "PENALTY" as const,
        },
        {
          key: `__meanDrop__::${attribute.name}`,
          label: `${attribute.name} (mean drop)`,
          type: "MEAN_DROP" as const,
        },
      ]);

    const variables =
      candidateVariables.length > 0
        ? [...candidateVariables, ...jarVariableEntries]
        : [
            {
              key: "overallLiking",
              label: "Overall Liking",
              type: "OVERALL_LIKING" as const,
            },
            ...jarVariableEntries,
          ];

    const sampleNumbers = Array.from(new Set(sampleObservations.map((row) => row.sampleNumber))).sort((left, right) => left - right);
    const sampleOptions = sampleNumbers.map((sampleNumber) => {
      const match = sampleObservations.find((row) => row.sampleNumber === sampleNumber);
      return {
        sampleNumber,
        sampleLabel: match?.sampleLabel ?? `Sample ${sampleNumber}`,
      };
    });

    const comparisons = variables
      .map((variable) => this.runComparisonForVariable(sampleObservations, sampleNumbers, variable, studyDesign))
      .filter((entry): entry is NonNullable<ReturnType<SensoryAnalysisEngine["runComparisonForVariable"]>> => entry !== null);

    const primaryComparison = comparisons.find((comparison) => comparison.variableType === "OVERALL_LIKING") ?? comparisons[0] ?? null;

    // Attribute-by-sample liking comparisons (one row per attribute).
    const attributeLikingNames = attributes
      .filter((attribute) => attribute.type === "ATTRIBUTE_LIKING")
      .map((attribute) => attribute.name);
    const attributeLikingComparison = attributeLikingNames
      .map((attributeName) => {
        const comparison = this.runComparisonForVariable(
          sampleObservations,
          sampleNumbers,
          { key: attributeName, label: attributeName, type: "ATTRIBUTE_LIKING" },
          studyDesign
        );
        if (!comparison) return null;
        const postHoc = comparison.statisticalComparison.postHocResults ?? [];
        const sampleLabels = comparison.samples.map((sample) => sample.sampleLabel);
        const letters = computeCompactLetterDisplay(sampleLabels, postHoc);
        return {
          attribute: attributeName,
          samples: comparison.samples.map((sample) => ({
            sampleNumber: sample.sampleNumber,
            sampleLabel: sample.sampleLabel,
            mean: sample.stats.mean,
            stdDev: sample.stats.stdDev,
            n: sample.stats.n,
            stdError: sample.stats.n > 0 ? round2(sample.stats.stdDev / Math.sqrt(sample.stats.n)) : 0,
            confidenceInterval: sample.stats.confidenceInterval,
            letter: letters.get(sample.sampleLabel) ?? null,
          })),
          statisticalComparison: comparison.statisticalComparison,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    // Overall liking comparison (single row, mirrors primary for "Overall Liking").
    const overallLikingComparison = (() => {
      const overall = comparisons.find((comparison) => comparison.variableType === "OVERALL_LIKING");
      if (!overall) return null;
      const sampleLabels = overall.samples.map((sample) => sample.sampleLabel);
      const letters = computeCompactLetterDisplay(sampleLabels, overall.statisticalComparison.postHocResults ?? []);
      return {
        samples: overall.samples.map((sample) => ({
          sampleNumber: sample.sampleNumber,
          sampleLabel: sample.sampleLabel,
          mean: sample.stats.mean,
          stdDev: sample.stats.stdDev,
          n: sample.stats.n,
          stdError: sample.stats.n > 0 ? round2(sample.stats.stdDev / Math.sqrt(sample.stats.n)) : 0,
          confidenceInterval: sample.stats.confidenceInterval,
          letter: letters.get(sample.sampleLabel) ?? null,
        })),
        statisticalComparison: overall.statisticalComparison,
      };
    })();

    // JAR distribution comparison (per JAR attribute, per sample percentages).
    const jarAttributeNames = attributes
      .filter((attribute) => attribute.type === "JAR")
      .map((attribute) => attribute.name);
    const jarDistributionComparison = jarAttributeNames.map((attributeName) => {
      const distributions = sampleNumbers.map((sampleNumber) => {
        const sampleResponses = sampleObservations
          .filter((observation) => observation.sampleNumber === sampleNumber)
          .map((observation) => ({
            respondentId: observation.respondentId,
            overallLiking: observation.overallLiking,
            attributes: observation.attributes,
          }));
        const sampleLabel =
          sampleObservations.find((observation) => observation.sampleNumber === sampleNumber)?.sampleLabel ?? `Sample ${sampleNumber}`;
        const distribution = this.calculateJARDistribution(attributeName, sampleResponses);
        return {
          sampleNumber,
          sampleLabel,
          tooLowPercent: distribution.tooLow.percent,
          justRightPercent: distribution.justRight.percent,
          tooHighPercent: distribution.tooHigh.percent,
          tooLowCount: distribution.tooLow.count,
          justRightCount: distribution.justRight.count,
          tooHighCount: distribution.tooHigh.count,
        };
      });
      return { attribute: attributeName, distributions };
    });

    // Mean JAR rating comparison (per JAR attribute): compares the mean 1-5 rating
    // across samples, mirroring the attribute-liking comparison but on the JAR scale.
    const jarRatingComparison = jarAttributeNames
      .map((attributeName) => {
        const comparison = this.runComparisonForVariable(
          sampleObservations,
          sampleNumbers,
          { key: attributeName, label: attributeName, type: "JAR_RATING" },
          studyDesign
        );
        if (!comparison) return null;
        const postHoc = comparison.statisticalComparison.postHocResults ?? [];
        const sampleLabels = comparison.samples.map((sample) => sample.sampleLabel);
        const letters = computeCompactLetterDisplay(sampleLabels, postHoc);
        return {
          attribute: attributeName,
          samples: comparison.samples.map((sample) => ({
            sampleNumber: sample.sampleNumber,
            sampleLabel: sample.sampleLabel,
            mean: sample.stats.mean,
            stdDev: sample.stats.stdDev,
            n: sample.stats.n,
            stdError: sample.stats.n > 0 ? round2(sample.stats.stdDev / Math.sqrt(sample.stats.n)) : 0,
            confidenceInterval: sample.stats.confidenceInterval,
            letter: letters.get(sample.sampleLabel) ?? null,
          })),
          statisticalComparison: comparison.statisticalComparison,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

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
      overallLikingComparison,
      attributeLikingComparison,
      jarRatingComparison,
      jarDistributionComparison,
      guardrails: [
        "Statistical tests are selected by TARAsense, not by the user.",
        "Test selection consults Shapiro-Wilk normality and Levene's variance checks before choosing parametric vs nonparametric paths.",
        "Effect sizes accompany every comparison so practical magnitude is not lost behind p-values.",
      ],
    };
  }

  private runComparisonForVariable(
    sampleObservations: SampleObservation[],
    sampleNumbers: number[],
    variable: { key: string; label: string; type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR_RATING" | "PENALTY" | "MEAN_DROP" },
    studyDesign: StudyDesign
  ) {
    const sampleInputs = sampleNumbers.map((sampleNumber) => {
      const sampleRows = sampleObservations.filter((observation) => observation.sampleNumber === sampleNumber);
      const sampleLabel = sampleRows[0]?.sampleLabel ?? `Sample ${sampleNumber}`;
      const valuesByRespondent = new Map<string, number>();
      sampleRows.forEach((observation) => {
        const value = this.extractVariableValue(observation, variable);
        if (typeof value === "number" && Number.isFinite(value)) {
          valuesByRespondent.set(observation.respondentId, value);
        }
      });
      return { sampleNumber, sampleLabel, valuesByRespondent };
    });

    const result = compareSamples(sampleInputs, { studyDesign });
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
          values,
        };
      }),
      statisticalComparison: serializeComparisonResult(result),
      graphType: this.recommendGraphType(variable.type, result.repeatedMeasures),
    };
  }

  private extractVariableValue(
    observation: SampleObservation,
    variable: { key: string; type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR_RATING" | "PENALTY" | "MEAN_DROP" }
  ): number | undefined {
    if (variable.type === "OVERALL_LIKING") {
      return variable.key === "overallLiking"
        ? observation.overallLiking
        : (typeof getNumericAttributeValue(observation.attributes, variable.key) === "number"
            ? getNumericAttributeValue(observation.attributes, variable.key)
            : observation.overallLiking);
    }
    if (variable.type === "ATTRIBUTE_LIKING") {
      return getNumericAttributeValue(observation.attributes, variable.key);
    }
    if (variable.type === "JAR_RATING") {
      // JAR attributes store a structured value; compare samples on the raw 1-5 rating.
      return normalizeJarValue(observation.attributes[variable.key])?.rawValue;
    }
    if (variable.type === "PENALTY" || variable.type === "MEAN_DROP") {
      const attributeName = variable.key.split("::")[1] ?? "";
      const jarValue = normalizeJarValue(observation.attributes[attributeName]);
      if (!jarValue || typeof observation.overallLiking !== "number") return undefined;
      // Encode as drop-from-JAR per respondent: liking when JAR vs liking when not.
      // For penalty / mean drop variables, we feed liking only for non-JAR responses
      // so that the comparison answers "does deviating from JAR cost liking?".
      return jarValue.bucket === "just_right" ? undefined : observation.overallLiking;
    }
    return undefined;
  }

  private recommendGraphType(type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR_RATING" | "PENALTY" | "MEAN_DROP", repeated: boolean) {
    if (type === "PENALTY") return "PENALTY_PLOT";
    if (type === "MEAN_DROP") return "BAR_WITH_ERROR";
    if (type === "ATTRIBUTE_LIKING") return "RADAR";
    if (type === "JAR_RATING") return "BAR_WITH_ERROR";
    return repeated ? "BAR_WITH_ERROR" : "BAR_WITH_ERROR";
  }

  private buildAdvancedAnalytics(
    sampleObservations: SampleObservation[],
    attributes: Array<{ name: string; type: string }>
  ): AdvancedAnalyticsResult {
    const attributeKeys = attributes
      .filter((attribute) => attribute.type === "ATTRIBUTE_LIKING" || attribute.type === "OVERALL_LIKING")
      .map((attribute) => attribute.name);

    const rows = sampleObservations.map((observation) => ({
      respondentId: observation.respondentId,
      sampleNumber: observation.sampleNumber,
      sampleLabel: observation.sampleLabel,
      attributes: attributeKeys.reduce<Record<string, number>>((accumulator, key) => {
        const value = getNumericAttributeValue(observation.attributes, key);
        if (typeof value === "number" && Number.isFinite(value)) accumulator[key] = value;
        return accumulator;
      }, {}),
    }));

    const likingByRespondentSample = new Map<string, number>();
    sampleObservations.forEach((observation) => {
      if (typeof observation.overallLiking === "number" && Number.isFinite(observation.overallLiking)) {
        likingByRespondentSample.set(`${observation.respondentId}::${observation.sampleNumber}`, observation.overallLiking);
      }
    });

    return runAdvancedAnalytics(rows, attributeKeys, { likingByRespondentSample });
  }

  private calculateMeanDropAnalysis(attributeName: string, responses: StudyResponse[]): SampleMeanDropRow {
    const groups = {
      just_right: [] as number[],
      too_low: [] as number[],
      too_high: [] as number[],
    };

    responses.forEach((response) => {
      if (typeof response.overallLiking !== "number" || !Number.isFinite(response.overallLiking)) return;
      const jarValue = normalizeJarValue(response.attributes[attributeName]);
      if (!jarValue) return;
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
    meanDropAnalysis: Array<SampleMeanDropRow & { sampleNumber: number; sampleLabel: string }>,
    dataQuality: DataQualityReport
  ) {
    const insights: string[] = [];
    if (sampleInsights.bestSample) {
      insights.push(
        `${sampleInsights.bestSample.sampleLabel} obtained the highest overall liking score (${sampleInsights.bestSample.meanScore}, ${sampleInsights.bestSample.interpretation}).`
      );
    }

    const comparison = comparativeAnalysis.primaryComparison?.statisticalComparison;
    if (comparison) {
      insights.push(comparison.interpretation);
      if (comparison.effectSize) {
        insights.push(
          `Effect size (${comparison.effectSize.label}) = ${comparison.effectSize.value} (${comparison.effectSize.magnitude}).`
        );
      }
    }

    const strongestDriver = [...meanDropAnalysis]
      .filter((row) => row.severity !== "NOT_ACTIONABLE" && row.meanDrop !== null)
      .sort((left, right) => (right.meanDrop ?? 0) - (left.meanDrop ?? 0))[0];
    if (strongestDriver) {
      insights.push(
        `${strongestDriver.attribute} in ${strongestDriver.sampleLabel} is the strongest actionable JAR driver with a mean drop of ${strongestDriver.meanDrop}.`
      );
    }

    if (dataQuality.findings.length > 0) {
      insights.push(`Data quality: ${dataQuality.recommendation}`);
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
        primaryEffectSize: comparison?.effectSize ?? null,
        strongestDriver: strongestDriver ?? null,
        dataQualityStatus: dataQuality.status,
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

    const metrics: Array<{
      studyId: string;
      attributeId?: string | null;
      metricType: "MEAN_LIKING" | "JAR_FREQ" | "PENALTY";
      value: Prisma.InputJsonValue;
    }> = [];

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

  private async generateAIInterpretation(
    studyId: string,
    context: {
      overallStats: DescriptiveStats;
      penaltyResults: PenaltyResult[];
      sampleInsights: SampleInsights;
      comparativeAnalysis: ReturnType<SensoryAnalysisEngine["buildComparativeAnalysis"]>;
      dataQuality: DataQualityReport;
      automaticInterpretation: ReturnType<SensoryAnalysisEngine["buildAutomaticInterpretation"]>;
      studyDesign: StudyDesign;
    }
  ) {
    const ai = await createOpenAICompatibleClient("analysis");
    if (!ai) {
      return;
    }

    const actionableIssues = context.penaltyResults.filter((penalty) => penalty.isActionable);
    const primary = context.comparativeAnalysis.primaryComparison;
    const stat = primary?.statisticalComparison;
    const checks = stat?.assumptionChecks;
    const postHoc = stat?.postHocResults ?? [];

    const samplesRanked = [...context.sampleInsights.samplePerformance]
      .sort((left, right) => right.meanScore - left.meanScore)
      .map((sample, index) => `${index + 1}. ${sample.sampleLabel} mean=${sample.meanScore} (${sample.interpretation})`)
      .join("\n");

    const dataQualityLines = context.dataQuality.findings
      .map((finding) => `- ${finding.label}: ${finding.affectedCount} respondent(s) (${finding.severity}).`)
      .join("\n");

    const prompt = `
You are a sensory analysis expert reviewing a TARAsense Phase 1 hedonic consumer test.

STUDY DESIGN: ${context.studyDesign === "WITHIN_SUBJECT" ? "Within-subject (repeated measures)" : "Monadic (independent)"}

OVERALL LIKING: mean ${context.overallStats.mean}/9.0 (n=${context.overallStats.n}, SD=${context.overallStats.stdDev}${context.overallStats.confidenceInterval ? `, 95% CI [${context.overallStats.confidenceInterval.lower}, ${context.overallStats.confidenceInterval.upper}]` : ""}).

SAMPLES RANKED:
${samplesRanked || "No sample-level data."}

PRIMARY STATISTICAL TEST:
- Variable: ${primary?.variableLabel ?? "n/a"}
- Test: ${stat?.testLabel ?? "n/a"} (${stat?.repeatedMeasures ? "repeated measures" : "independent"})
- p-value: ${stat ? formatPValue(stat.pValue) : "n/a"}
- Effect size: ${stat?.effectSize ? `${stat.effectSize.label} = ${stat.effectSize.value} (${stat.effectSize.magnitude})` : "n/a"}
- Assumption pathway: ${checks?.recommendedPathway ?? "n/a"} - ${checks?.rationale ?? ""}
${postHoc.length > 0 ? `- Post-hoc significant pairs: ${postHoc.filter((p) => p.significant).map((p) => p.pairLabel).join(", ") || "none"}` : ""}

PENALTY DRIVERS (${actionableIssues.length} actionable):
${actionableIssues
  .map(
    (penalty) =>
      `- ${penalty.attribute}: low side ${penalty.tooLowPercent}% (penalty ${penalty.tooLowPenalty}, ${penalty.tooLowLevel}); high side ${penalty.tooHighPercent}% (penalty ${penalty.tooHighPenalty}, ${penalty.tooHighLevel})`
  )
  .join("\n") || "None"}

DATA QUALITY: status=${context.dataQuality.status}; flagged respondents=${context.dataQuality.totals.flaggedRespondents}/${context.dataQuality.totals.respondents}.
${dataQualityLines || "- No data quality issues."}

Provide:
1. A maximum of 10 sentences interpretation of consumer acceptance grounded in the statistical test and effect size (avoid overclaiming if the effect size is small or if data quality warnings exist).
2. Specific product development recommendations citing the strongest JAR drivers and ranked samples.
3. A decision: NEEDS_IMPROVEMENT, CONTINUE_REFINEMENT, READY_FOR_READINESS, or READY_FOR_COMMERCIALIZATION.

Format strictly as JSON: {"interpretation": string, "recommendation": string, "decision": string}
`;

    try {
      let raw: string;

      try {
        const completion = await ai.client.chat.completions.create({
          model: ai.model,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        });
        raw = completion.choices[0]?.message?.content ?? "{}";
      } catch (error) {
        if (!shouldRetryWithoutJsonResponseFormat(error)) {
          throw error;
        }

        const completion = await ai.client.chat.completions.create({
          model: ai.model,
          messages: [{ role: "user", content: prompt }],
        });
        raw = completion.choices[0]?.message?.content ?? "{}";
      }

      const result = parseJsonObjectResponse(raw);

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
          aiInterpretation: typeof result.interpretation === "string" ? result.interpretation : null,
          aiRecommendation: typeof result.recommendation === "string" ? result.recommendation : null,
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

function shouldRetryWithoutJsonResponseFormat(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : null;
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  return (
    status === 400 &&
    (message.includes("response_format") || message.includes("json_object") || message.includes("unsupported"))
  );
}

function normalizeJarValue(value: unknown): ParsedJARValue | null {
  if (!value) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5) {
    return { rawValue: value, bucket: collapseJarBucket(value) };
  }
  if (typeof value !== "object") return null;
  const row = value as { value?: unknown; rawValue?: unknown; bucket?: unknown };
  if (typeof row.rawValue === "number" && Number.isInteger(row.rawValue) && row.rawValue >= 1 && row.rawValue <= 5) {
    return { rawValue: row.rawValue, bucket: collapseJarBucket(row.rawValue) };
  }
  if (typeof row.value === "number" && Number.isInteger(row.value) && row.value >= 1 && row.value <= 5) {
    return { rawValue: row.value, bucket: collapseJarBucket(row.value) };
  }
  if (typeof row.bucket === "string" && isJarBucket(row.bucket)) return mapLegacyBucketToRaw(row.bucket);
  if (typeof row.value === "string" && isJarBucket(row.value)) return mapLegacyBucketToRaw(row.value);
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
  if (penalty === null || nonJarPercent < 20) return "NOT_ACTIONABLE";
  if (penalty >= 1.0) return "STRONG";
  if (penalty >= 0.5) return "MODERATE";
  return "NOT_ACTIONABLE";
}

function mergeDriverLevels(left: DriverLevel, right: DriverLevel): DriverLevel {
  if (left === "STRONG" || right === "STRONG") return "STRONG";
  if (left === "MODERATE" || right === "MODERATE") return "MODERATE";
  return "NOT_ACTIONABLE";
}

function normalizeAttributeBaseName(name: string) {
  return name.replace(/\s*\(jar\)\s*$/i, "").replace(/\s*liking\s*$/i, "").trim();
}

// Acceptability thresholds aligned to the TARAsense Hedonic Workflow spec:
//   ≥ 7   = Highly acceptable (Highly liked)
//   5-6.99 = Moderately acceptable
//   < 5   = Low acceptability
export function interpretSampleMean(meanValue: number) {
  if (meanValue >= 7) return "Highly acceptable";
  if (meanValue >= 5) return "Moderately acceptable";
  return "Low acceptability";
}

function toSampleLabelMap(value: unknown) {
  const map = new Map<number, string>();
  if (!value || typeof value !== "object") return map;
  Object.entries(value as Record<string, unknown>).forEach(([key, rawLabel]) => {
    const sampleNumber = Number(key);
    if (!Number.isFinite(sampleNumber) || sampleNumber < 1) return;
    if (typeof rawLabel !== "string" || !rawLabel.trim()) return;
    map.set(Math.floor(sampleNumber), rawLabel.trim());
  });
  return map;
}

function getNumericAttributeValue(attributes: Record<string, unknown>, attributeName: string) {
  const value = attributes[attributeName];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableMean(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundNullable(value: number | null) {
  return value === null ? null : Math.round(value * 100) / 100;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function serializeComparisonResult(result: ComparisonResult) {
  return {
    test: result.test,
    testLabel: result.testLabel,
    studyDesign: result.studyDesign,
    repeatedMeasures: result.repeatedMeasures,
    pValue: result.pValue,
    formattedPValue: formatPValue(result.pValue),
    statistic: result.statistic,
    significant: result.significant,
    alpha: result.alpha,
    interpretation: result.interpretation,
    assumptions: result.assumptions,
    warnings: result.warnings,
    assumptionChecks: result.assumptionChecks,
    effectSize: result.effectSize,
    postHocResults: result.postHocResults,
  };
}
