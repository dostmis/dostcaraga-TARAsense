import { NextRequest } from "next/server";
import { setFicAvailability } from "@/lib/mobile/fic";
import {
  enforceMobileRateLimit,
  mobileError,
  mobileJson,
  parseJsonBody,
  requireMobileUser,
} from "@/lib/mobile/api";
import { MUTATION_RATE_LIMIT } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ date: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireMobileUser(request, ["FIC", "ADMIN"]);
  if ("response" in auth) {
    return auth.response;
  }

  const limited = enforceMobileRateLimit(request, "mobile-fic-availability", MUTATION_RATE_LIMIT, auth.user.id);
  if (limited) {
    return limited;
  }

  const { date } = await context.params;
  const payload = await parseJsonBody(request);
  const result = await setFicAvailability(auth.user, date, payload.isAvailable);
  if (!result.ok) {
    return mobileError(result.error, result.status, "AVAILABILITY_UPDATE_FAILED");
  }

  return mobileJson(result.availability);
}
