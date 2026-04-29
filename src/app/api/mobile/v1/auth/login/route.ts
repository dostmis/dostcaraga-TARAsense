import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { parseRole } from "@/lib/auth/roles";
import { mobileAuthResponse, mobileError, parseJsonBody } from "@/lib/mobile/api";
import { isMobileTokenSecretConfigured } from "@/lib/mobile/token";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isMobileTokenSecretConfigured()) {
    return mobileError("Mobile authentication is not configured.", 500, "AUTH_CONFIG_ERROR");
  }

  const body = await parseJsonBody(request);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return mobileError("Email and password are required.", 400, "VALIDATION_ERROR");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      password: true,
      role: true,
      organization: true,
      assignedRegion: true,
      assignedFacility: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const role = parseRole(user?.role ?? "");
  if (!user?.password || !role || !verifyPassword(password, user.password)) {
    return mobileError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
  }

  return mobileAuthResponse({
    ...user,
    role,
  });
}
