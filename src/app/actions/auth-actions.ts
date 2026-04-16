"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { parseRole, ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { clearGuestSessionCookies, getCurrentSession, SESSION_KEYS } from "@/lib/auth/session";
import { createSessionToken, isSessionSecretConfigured } from "@/lib/auth/session-token";
import { notifyRole, notifyUser } from "@/lib/notifications";
import { normalizeRegionFacility } from "@/lib/facility-constants";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function login(formData: FormData) {
  if (!isSessionSecretConfigured()) {
    redirect("/login?error=Session+configuration+error.+Please+contact+an+administrator");
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=Email+and+password+are+required");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, password: true, role: true },
  });

  if (!user?.password || !verifyPassword(password, user.password)) {
    redirect("/login?error=Invalid+email+or+password");
  }

  const role = parseRole(user.role);
  if (!role) {
    redirect("/login?error=Unsupported+role+configuration");
  }

  const store = await cookies();
  try {
    setSessionCookie(store, user.id);
  } catch {
    redirect("/login?error=Session+configuration+error.+Please+contact+an+administrator");
  }
  clearLegacySessionCookies(store);
  clearGuestSessionCookies(store);

  await notifyUser(user.id, {
    title: "Login successful",
    message: "You have successfully signed in.",
    level: "SUCCESS",
    category: "AUTH",
    actionUrl: ROLE_DASHBOARD_PATH[role],
  });

  redirect(ROLE_DASHBOARD_PATH[role]);
}

export async function register(formData: FormData) {
  if (!isSessionSecretConfigured()) {
    redirect("/register?error=Session+configuration+error.+Please+contact+an+administrator");
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const organization = String(formData.get("organization") ?? "").trim();

  if (name.length < 2) {
    redirect("/register?error=Name+must+be+at+least+2+characters");
  }
  if (!email.includes("@")) {
    redirect("/register?error=Enter+a+valid+email+address");
  }
  if (password.length < 8) {
    redirect("/register?error=Password+must+be+at+least+8+characters");
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    redirect("/register?error=Email+already+registered");
  }

  const created = await prisma.user.create({
    data: {
      name,
      email,
      password: hashPassword(password),
      role: "CONSUMER",
      organization: organization || null,
    },
    select: { id: true },
  });

  const store = await cookies();
  try {
    setSessionCookie(store, created.id);
  } catch {
    redirect("/register?error=Session+configuration+error.+Please+contact+an+administrator");
  }
  clearLegacySessionCookies(store);
  clearGuestSessionCookies(store);

  await notifyUser(created.id, {
    title: "Welcome to TARAsense",
    message: "Your account is now active as a Consumer user.",
    level: "SUCCESS",
    category: "AUTH",
    actionUrl: ROLE_DASHBOARD_PATH.CONSUMER,
  });
  await notifyRole("ADMIN", {
    title: "New user registered",
    message: `${name} (${email}) created a new account.`,
    level: "INFO",
    category: "SYSTEM",
    actionUrl: "/admin/dashboard",
  });

  redirect(ROLE_DASHBOARD_PATH.CONSUMER);
}

export async function applyForRole(formData: FormData) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login?error=Please+login+to+apply");
  }

  const targetRoleInput = String(formData.get("targetRole") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const targetRole = parseRole(targetRoleInput);

  if (!targetRole || (targetRole !== "MSME" && targetRole !== "FIC")) {
    redirect("/consumer/dashboard?error=Invalid+role+application");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true },
  });
  if (!user) {
    redirect("/login?error=Session+expired");
  }
  if (user.role === targetRole) {
    redirect(`/consumer/dashboard?error=You+already+have+${targetRole}+access`);
  }

  const pending = await prisma.roleUpgradeRequest.findFirst({
    where: {
      userId: session.userId,
      targetRole,
      status: "PENDING",
    },
    select: { id: true },
  });
  if (pending) {
    redirect("/consumer/dashboard?error=You+already+have+a+pending+application+for+this+role");
  }

  const roleRequest = await prisma.roleUpgradeRequest.create({
    data: {
      userId: session.userId,
      targetRole,
      status: "PENDING",
      reason: reason || null,
    },
  });

  await notifyUser(session.userId, {
    title: "Role application submitted",
    message: `Your ${targetRole} access request is now pending admin approval.`,
    level: "INFO",
    category: "ROLE",
    actionUrl: "/consumer/dashboard",
    metadata: { requestId: roleRequest.id, targetRole },
  });
  await notifyRole("ADMIN", {
    title: "Role approval needed",
    message: `A user requested ${targetRole} access and is waiting for review.`,
    level: "WARNING",
    category: "ROLE",
    actionUrl: "/admin/dashboard",
    metadata: { requestId: roleRequest.id, targetRole },
  });

  redirect("/consumer/dashboard?message=Application+submitted+for+admin+review");
}

export async function reviewRoleApplication(formData: FormData) {
  const session = await getCurrentSession();
  if (!session || session.role !== "ADMIN") {
    redirect("/login?error=Admin+login+required");
  }

  const redirectTo = resolveAdminRedirectTarget(formData.get("redirectTo"));
  const requestId = String(formData.get("requestId") ?? "");
  const decision = String(formData.get("decision") ?? "").toUpperCase();
  if (!requestId || (decision !== "APPROVE" && decision !== "REJECT")) {
    redirect(withFeedback(redirectTo, "error", "Invalid review request"));
  }

  const request = await prisma.roleUpgradeRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      userId: true,
      targetRole: true,
      status: true,
    },
  });

  if (!request || request.status !== "PENDING") {
    redirect(withFeedback(redirectTo, "error", "Request is not pending"));
  }

  if (decision === "APPROVE") {
    const now = new Date();
    const assignment =
      request.targetRole === "FIC"
        ? normalizeRegionFacility(String(formData.get("assignedRegion") ?? ""), String(formData.get("assignedFacility") ?? ""))
        : null;

    if (request.targetRole === "FIC" && !assignment) {
      redirect(withFeedback(redirectTo, "error", "A valid region and facility assignment is required for FIC approval."));
    }

    await prisma.$transaction(async (tx) => {
      await tx.roleUpgradeRequest.update({
        where: { id: requestId },
        data: {
          status: "APPROVED",
          adminId: session.userId,
          reviewedAt: now,
        },
      });

      const previousAssignment = await tx.user.findUnique({
        where: { id: request.userId },
        select: {
          assignedRegion: true,
          assignedFacility: true,
        },
      });
      if (!previousAssignment) {
        throw new Error("Target user no longer exists.");
      }

      await tx.user.update({
        where: { id: request.userId },
        data: {
          role: request.targetRole,
          ...(assignment
            ? {
                assignedRegion: assignment.region,
                assignedFacility: assignment.facility,
                assignmentUpdatedAt: now,
                assignmentUpdatedById: session.userId,
              }
            : {}),
        },
      });

      if (assignment) {
        await tx.ficAssignmentHistory.create({
          data: {
            ficUserId: request.userId,
            changedById: session.userId,
            previousRegion: previousAssignment.assignedRegion,
            previousFacility: previousAssignment.assignedFacility,
            assignedRegion: assignment.region,
            assignedFacility: assignment.facility,
            createdAt: now,
          },
        });
      }
    });

    await notifyUser(request.userId, {
      title: "Role application approved",
      message:
        request.targetRole === "FIC" && assignment
          ? `Your request for ${request.targetRole} access has been approved. Assigned to ${assignment.facility}, ${assignment.region}.`
          : `Your request for ${request.targetRole} access has been approved.`,
      level: "SUCCESS",
      category: "ROLE",
      actionUrl: ROLE_DASHBOARD_PATH[parseRole(request.targetRole) ?? "CONSUMER"],
    });
    await notifyUser(session.userId, {
      title: "Application approved",
      message: `You approved a ${request.targetRole} access request.`,
      level: "INFO",
      category: "ROLE",
      actionUrl: redirectTo,
    });

    redirect(withFeedback(redirectTo, "message", "Application approved"));
  }

  await prisma.roleUpgradeRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      adminId: session.userId,
      reviewedAt: new Date(),
    },
  });

  await notifyUser(request.userId, {
    title: "Role application rejected",
    message: `Your request for ${request.targetRole} access was rejected by admin.`,
    level: "ERROR",
    category: "ROLE",
    actionUrl: "/consumer/dashboard",
  });
  await notifyUser(session.userId, {
    title: "Application rejected",
    message: `You rejected a ${request.targetRole} access request.`,
    level: "INFO",
    category: "ROLE",
    actionUrl: redirectTo,
  });

  redirect(withFeedback(redirectTo, "message", "Application rejected"));
}

export async function reassignFicFacility(formData: FormData) {
  const session = await getCurrentSession();
  if (!session || session.role !== "ADMIN") {
    redirect("/login?error=Admin+login+required");
  }

  const redirectTo = resolveAdminRedirectTarget(formData.get("redirectTo"));
  const ficUserId = String(formData.get("ficUserId") ?? "").trim();
  const assignment = normalizeRegionFacility(
    String(formData.get("assignedRegion") ?? ""),
    String(formData.get("assignedFacility") ?? "")
  );

  if (!ficUserId || !assignment) {
    redirect(withFeedback(redirectTo, "error", "Valid FIC user, region, and facility are required."));
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const ficUser = await tx.user.findUnique({
      where: { id: ficUserId },
      select: {
        id: true,
        role: true,
        assignedRegion: true,
        assignedFacility: true,
      },
    });

    if (!ficUser || (ficUser.role !== "FIC" && ficUser.role !== "FIC_MANAGER")) {
      return { ok: false as const, reason: "invalid-fic-user" as const };
    }

    const assignmentChanged =
      ficUser.assignedRegion !== assignment.region || ficUser.assignedFacility !== assignment.facility;

    if (!assignmentChanged) {
      return { ok: true as const, assignmentChanged: false };
    }

    await tx.user.update({
      where: { id: ficUser.id },
      data: {
        assignedRegion: assignment.region,
        assignedFacility: assignment.facility,
        assignmentUpdatedAt: now,
        assignmentUpdatedById: session.userId,
      },
    });

    await tx.ficAssignmentHistory.create({
      data: {
        ficUserId: ficUser.id,
        changedById: session.userId,
        previousRegion: ficUser.assignedRegion,
        previousFacility: ficUser.assignedFacility,
        assignedRegion: assignment.region,
        assignedFacility: assignment.facility,
        createdAt: now,
      },
    });

    return { ok: true as const, assignmentChanged: true };
  });

  if (!result.ok) {
    redirect(withFeedback(redirectTo, "error", "Selected account is not an FIC user."));
  }

  if (!result.assignmentChanged) {
    redirect(withFeedback(redirectTo, "message", "FIC assignment already matches the selected region and facility."));
  }

  await notifyUser(ficUserId, {
    title: "FIC assignment updated",
    message: `Your assignment is now ${assignment.facility}, ${assignment.region}.`,
    level: "INFO",
    category: "ROLE",
    actionUrl: "/fic/dashboard?view=dashboard",
  });

  await notifyUser(session.userId, {
    title: "FIC assignment saved",
    message: `Updated FIC assignment to ${assignment.facility}, ${assignment.region}.`,
    level: "SUCCESS",
    category: "ROLE",
    actionUrl: redirectTo,
  });

  redirect(withFeedback(redirectTo, "message", "FIC assignment updated"));
}

export async function logout() {
  const session = await getCurrentSession();
  if (session) {
    await notifyUser(session.userId, {
      title: "Logged out",
      message: "You ended your current session.",
      level: "INFO",
      category: "AUTH",
      actionUrl: "/login",
    });
  }

  const store = await cookies();
  store.delete(SESSION_KEYS.token);
  clearLegacySessionCookies(store);
  clearGuestSessionCookies(store);
  redirect("/login?message=You+have+been+logged+out");
}

function setSessionCookie(store: Awaited<ReturnType<typeof cookies>>, userId: string) {
  const token = createSessionToken(userId);
  store.set(SESSION_KEYS.token, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

function clearLegacySessionCookies(store: Awaited<ReturnType<typeof cookies>>) {
  store.delete(SESSION_KEYS.userId);
  store.delete(SESSION_KEYS.role);
}

function resolveAdminRedirectTarget(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("/admin/dashboard")) {
    return raw;
  }
  return "/admin/dashboard?view=role-requests";
}

function withFeedback(path: string, key: "error" | "message", value: string) {
  const target = new URL(path, "http://localhost");
  target.searchParams.set(key, value);
  return `${target.pathname}${target.search}`;
}
