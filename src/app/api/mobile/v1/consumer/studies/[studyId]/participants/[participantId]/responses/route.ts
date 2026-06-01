import { NextRequest } from "next/server";
import {
  enforceMobileRateLimit,
  mobileError,
  mobileJson,
  parseJsonBody,
  requireMobileUser,
} from "@/lib/mobile/api";
import { submitMobileConsumerResponse } from "@/lib/mobile/consumer-response";
import { SUBMIT_RATE_LIMIT } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    studyId: string;
    participantId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireMobileUser(request, ["CONSUMER"]);
  if ("response" in auth) {
    return auth.response;
  }

  const limited = enforceMobileRateLimit(request, "mobile-submit-response", SUBMIT_RATE_LIMIT, auth.user.id);
  if (limited) {
    return limited;
  }

  const { studyId, participantId } = await context.params;
  const payload = await parseJsonBody(request);

  const result = await submitMobileConsumerResponse({
    userId: auth.user.id,
    studyId,
    participantId,
    payload,
  });

  if (!result.success) {
    return mobileError(result.error, 400, "RESPONSE_SUBMIT_FAILED");
  }

  return mobileJson(result, { status: result.alreadySubmitted ? 200 : 201 });
}
