import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SensoryAnalysisEngine } from "@/lib/services/analysis-engine";
import { getCurrentSession } from "@/lib/auth/session";
import { canAccessStudyByRole } from "@/lib/study-access";

type RouteContext = {
  params: Promise<{ studyId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await getCurrentSession();
    if (!session || session.role === "CONSUMER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { studyId } = await context.params;
    const url = new URL(request.url);
    const shouldRefresh = url.searchParams.get("refresh") === "1";

    const study = await prisma.study.findUnique({
      where: { id: studyId },
      select: {
        id: true,
        creatorId: true,
        location: true,
        analysis: {
          select: { id: true },
        },
      },
    });

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }
    const currentUser =
      session.role === "FIC"
        ? await prisma.user.findUnique({
            where: { id: session.userId },
            select: { assignedFacility: true },
          })
        : null;
    if (
      !canAccessStudyByRole({
        role: session.role,
        userId: session.userId,
        studyCreatorId: study.creatorId,
        studyLocation: study.location,
        ficAssignedFacility: currentUser?.assignedFacility,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const responseCount = await prisma.sensoryResponse.count({
      where: { studyId },
    });

    if (responseCount === 0 && !study.analysis) {
      return NextResponse.json({
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
      });
    }

    if (!study.analysis || shouldRefresh) {
      const engine = new SensoryAnalysisEngine();
      await engine.analyzeStudy(studyId);
    }

    const analysis = await prisma.studyAnalysis.findUnique({
      where: { studyId },
    });

    if (!analysis) {
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }

    const extendedPayload = extractExtendedAnalysisPayload(analysis.overallLiking);
    return NextResponse.json({
      ...analysis,
      ...extendedPayload,
    });
  } catch (error) {
    console.error("Failed to fetch study analysis:", error);
    return NextResponse.json({ error: "Failed to fetch analysis" }, { status: 500 });
  }
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
