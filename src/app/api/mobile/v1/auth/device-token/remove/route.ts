import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  enforceMobileRateLimit,
  mobileJson,
  parseJsonBody,
  requireMobileUser,
} from "@/lib/mobile/api";
import { MUTATION_RATE_LIMIT } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireMobileUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limited = enforceMobileRateLimit(request, "mobile-device-token-remove", MUTATION_RATE_LIMIT, auth.user.id);
  if (limited) {
    return limited;
  }

  const body = await parseJsonBody(request);
  const token = String(body.token ?? "").trim();

  if (token) {
    await prisma.deviceToken
      .deleteMany({
        where: {
          token,
          userId: auth.user.id,
        },
      })
      .catch((error) => {
        console.error("[push] Failed to delete device token:", error);
      });
  }

  return mobileJson({ ok: true });
}
