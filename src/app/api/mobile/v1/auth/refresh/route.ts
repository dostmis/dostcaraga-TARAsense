import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { parseRole } from "@/lib/auth/roles";
import {
  enforceMobileRateLimit,
  mobileAuthResponse,
  mobileError,
  parseJsonBody,
} from "@/lib/mobile/api";
import { verifyMobileToken } from "@/lib/mobile/token";
import { REFRESH_RATE_LIMIT } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ipLimited = enforceMobileRateLimit(request, "mobile-refresh", REFRESH_RATE_LIMIT);
  if (ipLimited) {
    return ipLimited;
  }

  const body = await parseJsonBody(request);
  const refreshToken = String(body.refreshToken ?? "");
  const verified = verifyMobileToken(refreshToken, "refresh");
  if (!verified) {
    return mobileError("Refresh token is invalid or expired.", 401, "INVALID_REFRESH_TOKEN");
  }

  const userLimited = enforceMobileRateLimit(request, "mobile-refresh", REFRESH_RATE_LIMIT, verified.userId);
  if (userLimited) {
    return userLimited;
  }

  const user = await prisma.user.findUnique({
    where: { id: verified.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      organization: true,
      assignedRegion: true,
      assignedFacility: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const role = parseRole(user?.role ?? "");
  if (!user || !role) {
    return mobileError("User no longer exists.", 401, "UNAUTHORIZED");
  }

  return mobileAuthResponse({
    ...user,
    role,
  });
}
