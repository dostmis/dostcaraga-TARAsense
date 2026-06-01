import { NextRequest } from "next/server";
import { mobileError, mobileJson, requireMobileUser } from "@/lib/mobile/api";
import { getConsumerStudyForm } from "@/lib/mobile/consumer";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    studyId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireMobileUser(request, ["CONSUMER"]);
  if ("response" in auth) {
    return auth.response;
  }

  const { studyId } = await context.params;

  const result = await getConsumerStudyForm(studyId);

  if (!result.success) {
    return mobileError(result.error, 400, "FORM_FETCH_FAILED");
  }

  return mobileJson(result);
}
