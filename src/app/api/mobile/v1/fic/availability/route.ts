import { NextRequest } from "next/server";
import { bulkSetFicAvailability, getFicAvailability } from "@/lib/mobile/fic";
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
  const auth = await requireMobileUser(request, ["FIC", "ADMIN"]);
  if ("response" in auth) {
    return auth.response;
  }

  const range = getDateRange(request);
  const result = await getFicAvailability(auth.user, range.startDate, range.endDate);
  if (!result.ok) {
    return mobileError(result.error, result.status, "VALIDATION_ERROR");
  }

  return mobileJson(result);
}

export async function POST(request: NextRequest) {
  const auth = await requireMobileUser(request, ["FIC", "ADMIN"]);
  if ("response" in auth) {
    return auth.response;
  }

  const limited = enforceMobileRateLimit(request, "mobile-fic-availability-bulk", MUTATION_RATE_LIMIT, auth.user.id);
  if (limited) {
    return limited;
  }

  const payload = await parseJsonBody(request);
  const result = await bulkSetFicAvailability(auth.user, payload.dates);
  if (!result.ok) {
    return mobileError(result.error, result.status, "AVAILABILITY_UPDATE_FAILED");
  }

  return mobileJson(result);
}

function getDateRange(request: NextRequest) {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  return {
    startDate: request.nextUrl.searchParams.get("startDate") ?? formatDateKey(startOfMonth),
    endDate: request.nextUrl.searchParams.get("endDate") ?? formatDateKey(endOfMonth),
  };
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
