import { NextRequest } from "next/server";
import {
  enforceMobileRateLimit,
  mobileError,
  mobileJson,
  parseJsonBody,
  requireMobileUser,
} from "@/lib/mobile/api";
import { joinStudy } from "@/lib/mobile/consumer";
import { MUTATION_RATE_LIMIT } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    studyId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireMobileUser(request, ["CONSUMER"]);
  if ("response" in auth) {
    return auth.response;
  }

  const limited = enforceMobileRateLimit(request, "mobile-join-study", MUTATION_RATE_LIMIT, auth.user.id);
  if (limited) {
    return limited;
  }

  const { studyId } = await context.params;
  const payload = (await parseJsonBody(request)) as {
    requestedSessionAt?: string;
  };

  const result = await joinStudy(auth.user.id, studyId, payload?.requestedSessionAt);

  if (!result.success) {
    return mobileError(result.error, 400, "JOIN_STUDY_FAILED");
  }

  return mobileJson(result, { status: 201 });
}
