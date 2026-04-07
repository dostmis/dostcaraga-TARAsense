"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppRole, parseRole, ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { clearGuestSessionCookies, getCurrentSession, SESSION_KEYS } from "@/lib/auth/session";
import { notifyRole, notifyUser } from "@/lib/notifications";

const DEFAULT_ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@tarasense.local";
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin12345";

export async function login(formData: FormData) {
  await ensureAdminAccount();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=Email+and+password+are+required");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, password: true },
  });

  if (!user || !user.password || !verifyPassword(password, user.password)) {
    redirect("/login?error=Invalid+email+or+password");
  }

  const store = await cookies();
  clearGuestSessionCookies(store);
  applySessionCookies(store, user.id, user.role);

  const role = parseRole(user.role);
  if (!role) {
    redirect("/login?error=Unsupported+role+configuration");
  }

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
  await ensureAdminAccount();

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

  const exists = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (exists) {
    redirect("/register?error=Email+already+registered");
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashPassword(password),
      role: "CONSUMER",
      organization: organization || null,
    },
    select: { id: true, role: true },
  });

  const store = await cookies();
  clearGuestSessionCookies(store);
  applySessionCookies(store, user.id, "CONSUMER");

  await notifyUser(user.id, {
    title: "Welcome to TARAsense",
    message: "Your account is now active as a Consumer user.",
    level: "SUCCESS",
    category: "AUTH",
    actionUrl: "/consumer/dashboard",
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
  const userId = session.userId;
  const targetRoleInput = String(formData.get("targetRole") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const targetRole = parseRole(targetRoleInput);
  if (!userId || !targetRole || (targetRole !== "MSME" && targetRole !== "FIC")) {
    redirect("/consumer/dashboard?error=Invalid+role+application");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
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
      userId,
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
      userId,
      targetRole,
      status: "PENDING",
      reason: reason || null,
    },
  });

  await notifyUser(userId, {
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

  const requestId = String(formData.get("requestId") ?? "");
  const decision = String(formData.get("decision") ?? "").toUpperCase();
  const adminId = session.userId;

  if (!requestId || !adminId || (decision !== "APPROVE" && decision !== "REJECT")) {
    redirect("/admin/dashboard?error=Invalid+review+request");
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
    redirect("/admin/dashboard?error=Request+is+not+pending");
  }

  if (decision === "APPROVE") {
    await prisma.$transaction([
      prisma.roleUpgradeRequest.update({
        where: { id: requestId },
        data: {
          status: "APPROVED",
          adminId,
          reviewedAt: new Date(),
        },
      }),
      prisma.user.update({
        where: { id: request.userId },
        data: {
          role: request.targetRole,
        },
      }),
    ]);

    await notifyUser(request.userId, {
      title: "Role application approved",
      message: `Your request for ${request.targetRole} access has been approved.`,
      level: "SUCCESS",
      category: "ROLE",
      actionUrl: ROLE_DASHBOARD_PATH[parseRole(request.targetRole) ?? "CONSUMER"],
    });
    await notifyUser(adminId, {
      title: "Application approved",
      message: `You approved a ${request.targetRole} access request.`,
      level: "INFO",
      category: "ROLE",
      actionUrl: "/admin/dashboard",
    });

    redirect("/admin/dashboard?message=Application+approved");
  }

  await prisma.roleUpgradeRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      adminId,
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
  await notifyUser(adminId, {
    title: "Application rejected",
    message: `You rejected a ${request.targetRole} access request.`,
    level: "INFO",
    category: "ROLE",
    actionUrl: "/admin/dashboard",
  });

  redirect("/admin/dashboard?message=Application+rejected");
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
  store.delete(SESSION_KEYS.userId);
  store.delete(SESSION_KEYS.role);
  clearGuestSessionCookies(store);
  redirect("/login?message=You+have+been+logged+out");
}

async function ensureAdminAccount() {
  const existingAdmin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, password: true },
  });

  if (existingAdmin) {
    if (!existingAdmin.password) {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { password: hashPassword(DEFAULT_ADMIN_PASSWORD) },
      });
    }
    return;
  }

  await prisma.user.upsert({
    where: { email: DEFAULT_ADMIN_EMAIL.toLowerCase() },
    update: {
      role: "ADMIN",
      password: hashPassword(DEFAULT_ADMIN_PASSWORD),
    },
    create: {
      email: DEFAULT_ADMIN_EMAIL.toLowerCase(),
      name: "System Admin",
      role: "ADMIN",
      password: hashPassword(DEFAULT_ADMIN_PASSWORD),
    },
  });
}

function applySessionCookies(store: Awaited<ReturnType<typeof cookies>>, userId: string, role: AppRole | string) {
  const normalizedRole = parseRole(String(role));
  if (!normalizedRole) {
    return;
  }

  store.set(SESSION_KEYS.userId, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  store.set(SESSION_KEYS.role, normalizedRole, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}
