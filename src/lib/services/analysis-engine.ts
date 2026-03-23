import { prisma } from "@/lib/db";
import { DecisionType, Prisma } from "@prisma/client";

interface JARResponse {
  value: "too_low" | "just_right" | "too_high";
}

interface StudyResponse {
  overallLiking: number;
  attributes: Record<string, number | JARResponse>;
}

interface PenaltyResult {
  attribute: string;
  tooLowPenalty: number | null;
  tooHighPenalty: number | null;
  tooLowPercent: number;
  tooHighPercent: number;
  jarMean: number;
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
      .filter((score): score is number => typeof score === "number");
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
          .filter((value): value is number => typeof value === "number");

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
    const counts = { too_low: 0, just_right: 0, too_high: 0 };
    let total = 0;

    responses.forEach((response) => {
      const attribute = response.attributes[attributeName] as JARResponse | undefined;
      if (!attribute?.value) {
        return;
      }

      counts[attribute.value] += 1;
      total += 1;
    });

    if (total === 0) {
      return {
        tooLow: { count: 0, percent: 0 },
        justRight: { count: 0, percent: 0 },
        tooHigh: { count: 0, percent: 0 },
      };
    }

    return {
      tooLow: { count: counts.too_low, percent: Math.round((counts.too_low / total) * 100) },
      justRight: { count: counts.just_right, percent: Math.round((counts.just_right / total) * 100) },
      tooHigh: { count: counts.too_high, percent: Math.round((counts.too_high / total) * 100) },
    };
  }

  private calculatePenaltyAnalysis(attributeName: string, responses: StudyResponse[]): PenaltyResult {
    const groups = {
      just_right: [] as number[],
      too_low: [] as number[],
      too_high: [] as number[],
    };

    responses.forEach((response) => {
      const attribute = response.attributes[attributeName] as JARResponse | undefined;
      if (!attribute?.value) {
        return;
      }
      groups[attribute.value].push(response.overallLiking);
    });

    const jarMean =
      groups.just_right.length > 0
        ? groups.just_right.reduce((a, b) => a + b, 0) / groups.just_right.length
        : 0;
    const tooLowMean =
      groups.too_low.length > 0 ? groups.too_low.reduce((a, b) => a + b, 0) / groups.too_low.length : 0;
    const tooHighMean =
      groups.too_high.length > 0 ? groups.too_high.reduce((a, b) => a + b, 0) / groups.too_high.length : 0;

    const totalN = responses.length;
    const tooLowPercent = totalN > 0 ? (groups.too_low.length / totalN) * 100 : 0;
    const tooHighPercent = totalN > 0 ? (groups.too_high.length / totalN) * 100 : 0;

    const tooLowPenalty = groups.too_low.length > 0 ? jarMean - tooLowMean : null;
    const tooHighPenalty = groups.too_high.length > 0 ? jarMean - tooHighMean : null;

    const isSignificant =
      (tooLowPercent >= 20 && (tooLowPenalty ?? 0) >= 1.0) || (tooHighPercent >= 20 && (tooHighPenalty ?? 0) >= 1.0);

    return {
      attribute: attributeName,
      tooLowPenalty: tooLowPenalty !== null ? Math.round(tooLowPenalty * 100) / 100 : null,
      tooHighPenalty: tooHighPenalty !== null ? Math.round(tooHighPenalty * 100) / 100 : null,
      tooLowPercent: Math.round(tooLowPercent),
      tooHighPercent: Math.round(tooHighPercent),
      jarMean: Math.round(jarMean * 100) / 100,
      isSignificant,
    };
  }

  private async generateAIInterpretation(studyId: string, overallStats: Record<string, number>, penalties: PenaltyResult[]) {
    if (!process.env.OPENAI_API_KEY) {
      return;
    }

    const significantIssues = penalties.filter((penalty) => penalty.isSignificant);

    const prompt = `
You are a sensory analysis expert interpreting results from a consumer taste test.
Overall Liking: Mean ${overallStats.mean}/9.0 (n=${overallStats.n})

Penalty Analysis Results:
${significantIssues
  .map(
    (penalty) =>
      `- ${penalty.attribute}: ${penalty.tooHighPercent}% found it too high (penalty: -${penalty.tooHighPenalty} points), ${penalty.tooLowPercent}% too low (penalty: -${penalty.tooLowPenalty} points)`
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
