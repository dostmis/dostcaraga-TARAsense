import { NextRequest } from "next/server";
import { mobileError, mobileJson, requireMobileUser } from "@/lib/mobile/api";
import { getMobileStudyAnalysis } from "@/lib/mobile/study-analysis";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ studyId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireMobileUser(request, ["MSME", "FIC", "ADMIN"]);
  if ("response" in auth) {
    return auth.response;
  }

  const { studyId } = await context.params;
  const result = await getMobileStudyAnalysis(auth.user, studyId, {
    refresh: request.nextUrl.searchParams.get("refresh") === "1",
  });

  if (!result.ok) {
    return mobileError(result.error, result.status, result.status === 403 ? "FORBIDDEN" : "ANALYSIS_FETCH_FAILED");
  }

  return mobileJson(result.analysis);
}
