import { NextRequest } from "next/server";
import { getMobileProfile, updateMobileProfile } from "@/lib/mobile/profile";
import {
  enforceMobileRateLimit,
  mobileError,
  mobileJson,
  parseJsonBody,
  requireMobileUser,
} from "@/lib/mobile/api";
import { MUTATION_RATE_LIMIT } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireMobileUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  return mobileJson(await getMobileProfile(auth.user));
}

export async function PATCH(request: NextRequest) {
  const auth = await requireMobileUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limited = enforceMobileRateLimit(request, "mobile-profile-update", MUTATION_RATE_LIMIT, auth.user.id);
  if (limited) {
    return limited;
  }

  const payload = await parseJsonBody(request);
  const result = await updateMobileProfile(auth.user, payload);
  if (!result.ok) {
    return mobileError(result.error, 400, "PROFILE_UPDATE_FAILED");
  }

  return mobileJson(await getMobileProfile({
    ...auth.user,
    ...result.user,
  }));
}
