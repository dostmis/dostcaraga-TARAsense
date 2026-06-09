import { prisma } from "@/lib/db";
import type { MobileUser } from "@/lib/mobile/api";
import { SensoryAnalysisEngine } from "@/lib/services/analysis-engine";
import { canAccessStudyByRole } from "@/lib/study-access";
import { runInBackground } from "@/lib/async-workflow";

export async function getMobileStudyAnalysis(user: MobileUser, studyId: string, options?: { refresh?: boolean }) {
  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      creatorId: true,
      location: true,
      title: true,
      productName: true,
      status: true,
      analysis: {
        select: { id: true },
      },
    },
  });

  if (!study) {
    return { ok: false as const, status: 404, error: "Study not found." };
  }

  if (
    !canAccessStudyByRole({
      role: user.role,
      userId: user.id,
      studyCreatorId: study.creatorId,
      studyLocation: study.location,
      ficAssignedFacility: user.assignedFacility,
    })
  ) {
    return { ok: false as const, status: 403, error: "You are not allowed to access this study analysis." };
  }

  const responseCount = await prisma.sensoryResponse.count({
    where: { studyId },
  });

  if (responseCount === 0 && !study.analysis) {
    return {
      ok: true as const,
      analysis: {
        study: serializeStudySummary(study),
        responseCount,
        generatedAt: new Date().toISOString(),
        studyOverview: null,
        overallLiking: {
          mean: 0,
          stdDev: 0,
          n: 0,
          median: 0,
          samplePerformance: [],
          bySample: [],
          bestSample: null,
          perSampleResults: [],
          comparativeAnalysis: null,
          meanDropAnalysis: [],
          automaticInterpretation: null,
        },
        attributeStats: [],
        penaltyAnalysis: [],
        perSampleResults: [],
        comparativeAnalysis: null,
        meanDropAnalysis: [],
        automaticInterpretation: null,
        aiInterpretation: null,
        aiRecommendation: null,
        decisionFlag: null,
      },
    };
  }

  if (!study.analysis || options?.refresh) {
    const engine = new SensoryAnalysisEngine();
    // Compute statistics synchronously but push the slow AI step to the background
    // so the read never blocks on the AI provider (avoids upstream 502s).
    await engine.analyzeStudy(studyId, { generateAi: false });
    runInBackground("mobile-study-analysis-ai", async () => {
      await new SensoryAnalysisEngine().analyzeStudy(studyId);
    });
  }

  const analysis = await prisma.studyAnalysis.findUnique({
    where: { studyId },
  });

  if (!analysis) {
    return { ok: false as const, status: 404, error: "Analysis not found." };
  }

  const extendedPayload = extractExtendedAnalysisPayload(analysis.overallLiking);

  return {
    ok: true as const,
    analysis: {
      id: analysis.id,
      studyId: analysis.studyId,
      study: serializeStudySummary(study),
      responseCount,
      generatedAt: analysis.generatedAt.toISOString(),
      updatedAt: analysis.updatedAt.toISOString(),
      overallLiking: analysis.overallLiking,
      attributeStats: analysis.attributeStats,
      penaltyAnalysis: analysis.penaltyAnalysis,
      aiInterpretation: analysis.aiInterpretation,
      aiRecommendation: analysis.aiRecommendation,
      decisionFlag: analysis.decisionFlag,
      ...extendedPayload,
    },
  };
}

function serializeStudySummary(study: {
  id: string;
  title: string;
  productName: string;
  location: string;
  status: string;
}) {
  return {
    id: study.id,
    title: study.title,
    productName: study.productName,
    location: study.location,
    status: study.status,
  };
}

function extractExtendedAnalysisPayload(overallLiking: unknown) {
  if (!overallLiking || typeof overallLiking !== "object") {
    return {
      studyOverview: null,
      perSampleResults: [],
      comparativeAnalysis: null,
      meanDropAnalysis: [],
      automaticInterpretation: null,
    };
  }

  const payload = overallLiking as {
    studyOverview?: unknown;
    perSampleResults?: unknown;
    bySample?: unknown;
    comparativeAnalysis?: unknown;
    meanDropAnalysis?: unknown;
    automaticInterpretation?: unknown;
  };

  return {
    studyOverview: payload.studyOverview ?? null,
    perSampleResults: Array.isArray(payload.perSampleResults)
      ? payload.perSampleResults
      : Array.isArray(payload.bySample)
        ? payload.bySample
        : [],
    comparativeAnalysis: payload.comparativeAnalysis ?? null,
    meanDropAnalysis: Array.isArray(payload.meanDropAnalysis) ? payload.meanDropAnalysis : [],
    automaticInterpretation: payload.automaticInterpretation ?? null,
  };
}
