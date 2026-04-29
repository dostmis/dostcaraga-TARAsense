import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseRole, type AppRole } from "@/lib/auth/roles";
import { createMobileToken, verifyMobileToken } from "@/lib/mobile/token";

export type MobileUser = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  organization: string | null;
  assignedRegion?: string | null;
  assignedFacility?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function mobileJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export function mobileError(message: string, status = 400, code = "MOBILE_API_ERROR") {
  return mobileJson(
    {
      error: {
        code,
        message,
      },
    },
    { status }
  );
}

export async function parseJsonBody(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {};
    }
    return body as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function requireMobileUser(request: NextRequest, allowedRoles?: AppRole[]) {
  const token = readBearerToken(request);
  if (!token) {
    return { response: mobileError("Missing bearer token.", 401, "UNAUTHORIZED") };
  }

  const verified = verifyMobileToken(token, "access");
  if (!verified) {
    return { response: mobileError("Invalid or expired bearer token.", 401, "UNAUTHORIZED") };
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
    return { response: mobileError("User no longer exists.", 401, "UNAUTHORIZED") };
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return { response: mobileError("Your account is not allowed to access this resource.", 403, "FORBIDDEN") };
  }

  return {
    user: {
      ...user,
      role,
    },
  };
}

export function publicMobileUser(user: MobileUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organization: user.organization,
    assignedRegion: user.assignedRegion ?? null,
    assignedFacility: user.assignedFacility ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function mobileAuthResponse(user: MobileUser) {
  return mobileJson({
    user: publicMobileUser(user),
    accessToken: createMobileToken(user.id, "access"),
    refreshToken: createMobileToken(user.id, "refresh"),
    tokenType: "Bearer",
  });
}

export function readBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}
