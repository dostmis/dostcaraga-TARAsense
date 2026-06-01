import { NextRequest } from "next/server";
import { createStudyFromBuilder } from "@/app/actions/study-builder-actions";
import {
  enforceMobileRateLimit,
  mobileError,
  mobileJson,
  parseJsonBody,
  requireMobileUser,
} from "@/lib/mobile/api";
import { MUTATION_RATE_LIMIT } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireMobileUser(request, ["MSME", "ADMIN"]);
  if ("response" in auth) {
    return auth.response;
  }

  const limited = enforceMobileRateLimit(request, "mobile-create-study", MUTATION_RATE_LIMIT, auth.user.id);
  if (limited) {
    return limited;
  }

  const payload = await parseJsonBody(request);
  const result = await createStudyFromBuilder(payload, {
    userId: auth.user.id,
    role: auth.user.role,
  });

  if (!result.success) {
    return mobileError(result.error ?? "Failed to create study.", 400, "STUDY_CREATE_FAILED");
  }

  return mobileJson(result, { status: 201 });
}
