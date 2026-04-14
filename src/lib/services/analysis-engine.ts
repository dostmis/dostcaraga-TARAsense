import { prisma } from "@/lib/db";
import { DecisionType, Prisma } from "@prisma/client";

type JarBucket = "too_low" | "just_right" | "too_high";
type DriverLevel = "STRONG" | "MODERATE" | "NOT_ACTIONABLE";

interface ParsedJARValue {
  rawValue: number;
  bucket: JarBucket;
}

interface StudyResponse {
  overallLiking?: number;
  attributes: Record<string, unknown>;
}

interface PenaltyResult {
  attribute: string;
  tooLowPenalty: number | null;
  tooHighPenalty: number | null;
  tooLowPercent: number;
  tooHighPercent: number;
  jarMean: number;
  tooLowLevel: DriverLevel;
  tooHighLevel: DriverLevel;
  driverLevel: DriverLevel;
  isActionable: boolean;
  isSignificant: boolean;
}

export class SensoryAnalysisEngine {
  async analyzeStudy(studyId: string) {
    const responses = await prisma.sensoryResponse.findMany({
      where: { studyId },
      include: { participant: true },
    });

    const parsedResponses: StudyResponse[] = responses.map((r: { data: unknown }) => r.data as StudyResponse);

    const overallLikingScores = parsedResponses
      .map((response) => response.overallLiking)
      .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
    const overallStats = this.computeDescriptiveStats(overallLikingScores);

    const attributes = await prisma.sensoryAttribute.findMany({
      where: { studyId },
      orderBy: { order: "asc" },
    });

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

    const analysis = await prisma.studyAnalysis.upsert({
      where: { studyId },
      update: {
        overallLiking: overallStats,
        attributeStats: attributeStatsJson,
        penaltyAnalysis: penaltyStatsJson,
      },
      create: {
        studyId,
        overallLiking: overallStats,
        attributeStats: attributeStatsJson,
        penaltyAnalysis: penaltyStatsJson,
      },
    });

    await this.writeDerivedMetrics(studyId, overallStats, attributeResults, penaltyResults);
    await this.generateAIInterpretation(studyId, overallStats, penaltyResults);

    return analysis;
  }

  private computeDescriptiveStats(values: number[]) {
    if (values.length === 0) {
      return { mean: 0, stdDev: 0, n: 0, median: 0 };
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
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

    const jarMean =
      groups.just_right.length > 0
        ? groups.just_right.reduce((a, b) => a + b, 0) / groups.just_right.length
        : 0;

    const tooLowMean =
      groups.too_low.length > 0 ? groups.too_low.reduce((a, b) => a + b, 0) / groups.too_low.length : 0;
    const tooHighMean =
      groups.too_high.length > 0 ? groups.too_high.reduce((a, b) => a + b, 0) / groups.too_high.length : 0;

    const tooLowPercent = totalValidJar > 0 ? (groups.too_low.length / totalValidJar) * 100 : 0;
    const tooHighPercent = totalValidJar > 0 ? (groups.too_high.length / totalValidJar) * 100 : 0;

    const tooLowPenalty = groups.too_low.length > 0 && groups.just_right.length > 0 ? jarMean - tooLowMean : null;
    const tooHighPenalty =
      groups.too_high.length > 0 && groups.just_right.length > 0 ? jarMean - tooHighMean : null;

    const tooLowLevel = classifyDriverLevel(tooLowPenalty, tooLowPercent);
    const tooHighLevel = classifyDriverLevel(tooHighPenalty, tooHighPercent);
    const driverLevel = mergeDriverLevels(tooLowLevel, tooHighLevel);

    return {
      attribute: attributeName,
      tooLowPenalty: tooLowPenalty !== null ? Math.round(tooLowPenalty * 100) / 100 : null,
      tooHighPenalty: tooHighPenalty !== null ? Math.round(tooHighPenalty * 100) / 100 : null,
      tooLowPercent: Math.round(tooLowPercent),
      tooHighPercent: Math.round(tooHighPercent),
      jarMean: Math.round(jarMean * 100) / 100,
      tooLowLevel,
      tooHighLevel,
      driverLevel,
      isActionable: driverLevel !== "NOT_ACTIONABLE",
      isSignificant: driverLevel === "STRONG",
    };
  }

  private async writeDerivedMetrics(
    studyId: string,
    overallStats: Record<string, number>,
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

  private async generateAIInterpretation(studyId: string, overallStats: Record<string, number>, penalties: PenaltyResult[]) {
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
