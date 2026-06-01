import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { parseRole } from "@/lib/auth/roles";
import { mobileAuthResponse, mobileError, parseJsonBody } from "@/lib/mobile/api";
import { isMobileTokenSecretConfigured } from "@/lib/mobile/token";
import { checkRateLimit, AUTH_RATE_LIMIT } from "@/lib/rate-limit";
import { logUserUsage } from "@/lib/user-usage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isMobileTokenSecretConfigured()) {
    return mobileError("Mobile authentication is not configured.", 500, "AUTH_CONFIG_ERROR");
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitResult = checkRateLimit(`mobile-register:${ip}`, AUTH_RATE_LIMIT);
  if (!rateLimitResult.allowed) {
    return mobileError("Too many registration attempts. Please try again later.", 429, "RATE_LIMITED");
  }

  const body = await parseJsonBody(request);
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const organization = String(body.organization ?? "").trim();

  if (name.length < 2) {
    return mobileError("Name must be at least 2 characters.", 400, "VALIDATION_ERROR");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return mobileError("Enter a valid email address.", 400, "VALIDATION_ERROR");
  }
  if (password.length < 8) {
    return mobileError("Password must be at least 8 characters.", 400, "VALIDATION_ERROR");
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return mobileError("Email already registered.", 409, "EMAIL_EXISTS");
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashPassword(password),
      role: "CONSUMER",
      organization: organization || null,
    },
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

  const role = parseRole(user.role);
  if (!role) {
    return mobileError("Unsupported role configuration.", 500, "ROLE_CONFIG_ERROR");
  }
  await logUserUsage({
    actorUserId: user.id,
    actor: { name: user.name, email: user.email, role },
    action: "USER_REGISTERED",
    entityType: "User",
    entityId: user.id,
    summary: `${user.name} registered a new mobile account.`,
    metadata: { channel: "mobile", role, organization: user.organization },
  });

  return mobileAuthResponse({
    ...user,
    role,
  });
}
