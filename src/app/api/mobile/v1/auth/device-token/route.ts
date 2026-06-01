import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  enforceMobileRateLimit,
  mobileError,
  mobileJson,
  parseJsonBody,
  requireMobileUser,
} from "@/lib/mobile/api";
import { MUTATION_RATE_LIMIT } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ALLOWED_PLATFORMS = new Set(["android", "ios", "web"]);
const MAX_TOKEN_LENGTH = 4096;

export async function POST(request: NextRequest) {
  const auth = await requireMobileUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limited = enforceMobileRateLimit(request, "mobile-device-token", MUTATION_RATE_LIMIT, auth.user.id);
  if (limited) {
    return limited;
  }

  const body = await parseJsonBody(request);
  const token = String(body.token ?? "").trim();
  const platform = String(body.platform ?? "").trim().toLowerCase();

  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return mobileError("A valid FCM token is required.", 400, "VALIDATION_ERROR");
  }
  if (!ALLOWED_PLATFORMS.has(platform)) {
    return mobileError("platform must be one of: android, ios, web.", 400, "VALIDATION_ERROR");
  }

  const record = await prisma.deviceToken.upsert({
    where: { token },
    create: {
      token,
      platform,
      userId: auth.user.id,
    },
    update: {
      userId: auth.user.id,
      platform,
    },
    select: {
      id: true,
      platform: true,
      updatedAt: true,
    },
  });

  return mobileJson({
    ok: true,
    deviceToken: {
      id: record.id,
      platform: record.platform,
      updatedAt: record.updatedAt.toISOString(),
    },
  });
}
