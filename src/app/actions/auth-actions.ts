"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import type { DietaryPref } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { parseRole, ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { clearGuestSessionCookies, getCurrentSession, SESSION_KEYS } from "@/lib/auth/session";
import { isSessionSecretConfigured } from "@/lib/auth/session-token";
import {
  clearLegacySessionCookies,
  resolvePostLoginRedirect,
  safeInternalRedirect,
  setSessionCookie,
} from "@/lib/auth/login-session";
import { checkRateLimit, AUTH_RATE_LIMIT } from "@/lib/rate-limit";
import { notifyRole, notifyUser } from "@/lib/notifications";
import { normalizeRegionFacility } from "@/lib/facility-constants";
import { logUserUsage } from "@/lib/user-usage";
import { validateLocationConsistency } from "@/lib/locations/psgc-queries";
import { deleteFicIdFile, saveFicIdFile } from "@/lib/uploads";
import { validateFicApplicationInput } from "@/lib/fic-facility";

const FIC_APPLICATIONS_REDIRECT = "/consumer/dashboard?view=applications";

const ALLOWED_LIFESTYLES = new Set(["student", "athlete", "office_worker"]);
const ALLOWED_DIETARY_PREFS = new Set<DietaryPref>(["VEGETARIAN", "VEGAN", "GLUTEN_FREE"]);

export async function login(formData: FormData) {
  const redirectTo = safeInternalRedirect(formData.get("redirectTo"));
  if (!isSessionSecretConfigured()) {
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Session configuration error. Please contact an administrator"));
  }

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitResult = checkRateLimit(`login:${ip}`, AUTH_RATE_LIMIT);
  if (!rateLimitResult.allowed) {
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Too many login attempts. Please try again later."));
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Email and password are required"));
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, password: true, role: true },
  });

  if (!user?.password || !verifyPassword(password, user.password)) {
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Invalid email or password"));
  }

  const role = parseRole(user.role);
  if (!role) {
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Unsupported role configuration"));
  }

  const store = await cookies();
  try {
    setSessionCookie(store, user.id);
  } catch {
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Session configuration error. Please contact an administrator"));
  }
  clearLegacySessionCookies(store);
  clearGuestSessionCookies(store);

  const postLoginPath = resolvePostLoginRedirect(role, redirectTo);
  await notifyUser(user.id, {
    title: "Login successful",
    message: "You have successfully signed in.",
    level: "SUCCESS",
    category: "AUTH",
    actionUrl: postLoginPath,
  });
  await logUserUsage({
    actorUserId: user.id,
    action: "LOGIN",
    entityType: "User",
    entityId: user.id,
    summary: "User logged in.",
    metadata: { role },
  });

  redirect(postLoginPath);
}

export async function register(formData: FormData) {
  const redirectTo = safeInternalRedirect(formData.get("redirectTo"));
  if (!isSessionSecretConfigured()) {
    redirect(authRouteWithFeedback("/register", redirectTo, "error", "Session configuration error. Please contact an administrator"));
  }

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitResult = checkRateLimit(`register:${ip}`, AUTH_RATE_LIMIT);
  if (!rateLimitResult.allowed) {
    redirect(authRouteWithFeedback("/register", redirectTo, "error", "Too many registration attempts. Please try again later."));
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const organization = String(formData.get("organization") ?? "").trim();
  const lifestyles = formData
    .getAll("lifestyle")
    .map((value) => String(value).trim().toLowerCase())
    .filter((value) => ALLOWED_LIFESTYLES.has(value));
  const dietaryPrefs = formData
    .getAll("dietaryPrefs")
    .map((value) => String(value).trim().toUpperCase() as DietaryPref)
    .filter((value) => ALLOWED_DIETARY_PREFS.has(value));
  const coffeeDrinker = formData.get("coffeeDrinker") === "on";
  const snackConsumer = formData.get("snackConsumer") === "on";
  const energyDrinkConsumer = formData.get("energyDrinkConsumer") === "on";

  if (name.length < 2) {
    redirect(authRouteWithFeedback("/register", redirectTo, "error", "Name must be at least 2 characters"));
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect(authRouteWithFeedback("/register", redirectTo, "error", "Enter a valid email address"));
  }
  if (password.length < 8) {
    redirect(authRouteWithFeedback("/register", redirectTo, "error", "Password must be at least 8 characters"));
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    redirect(authRouteWithFeedback("/register", redirectTo, "error", "Email already registered"));
  }

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        password: hashPassword(password),
        role: "CONSUMER",
        organization: organization || null,
      },
      select: { id: true },
    });

    const panelistData = {
      userId: user.id,
      name,
      email,
      age: 25,
      gender: "PREFER_NOT_SAY" as const,
      location: "Unspecified",
      occupation: "Consumer",
      lifestyle: lifestyles,
      dietaryPrefs,
      consumptionHabits: {
        coffeeDrinker,
        snackConsumer,
        energyDrinkConsumer,
        snacks: snackConsumer ? "daily" : "weekly",
      },
      isActive: true,
    };

    const existingPanelist = await tx.panelist.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingPanelist) {
      await tx.panelist.update({
        where: { id: existingPanelist.id },
        data: panelistData,
      });
    } else {
      await tx.panelist.create({
        data: panelistData,
      });
    }

    return user;
  });

  const store = await cookies();
  try {
    setSessionCookie(store, created.id);
  } catch {
    redirect(authRouteWithFeedback("/register", redirectTo, "error", "Session configuration error. Please contact an administrator"));
  }
  clearLegacySessionCookies(store);
  clearGuestSessionCookies(store);

  await notifyUser(created.id, {
    title: "Welcome to TARAsense",
    message: "Your account is now active as a Consumer user.",
    level: "SUCCESS",
    category: "AUTH",
    actionUrl: redirectTo,
  });
  await notifyRole("ADMIN", {
    title: "New user registered",
    message: `${name} (${email}) created a new account.`,
    level: "INFO",
    category: "SYSTEM",
    actionUrl: "/admin/dashboard",
  });
  await logUserUsage({
    actorUserId: created.id,
    actor: { name, email, role: "CONSUMER" },
    action: "USER_REGISTERED",
    entityType: "User",
    entityId: created.id,
    summary: `${name} registered a new account.`,
    metadata: { role: "CONSUMER", organization: organization || null },
  });

  redirect(redirectTo);
}

export async function applyForRole(formData: FormData) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login?error=Please+login+to+apply");
  }

  const targetRoleInput = String(formData.get("targetRole") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const targetRole = parseRole(targetRoleInput);

  // FIC upgrades go through applyForFicRole (facility application). This path
  // only handles MSME requests.
  if (!targetRole || targetRole !== "MSME") {
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
  await logUserUsage({
    actorUserId: session.userId,
    action: "ROLE_REQUEST_SUBMITTED",
    entityType: "RoleUpgradeRequest",
    entityId: roleRequest.id,
    summary: `User requested ${targetRole} access.`,
    metadata: { targetRole },
  });

  redirect("/consumer/dashboard?message=Application+submitted+for+admin+review");
}

export async function applyForFicRole(formData: FormData) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login?error=Please+login+to+apply");
  }

  const redirectTo = FIC_APPLICATIONS_REDIRECT;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true },
  });
  if (!user) {
    redirect("/login?error=Session+expired");
  }
  // Guard: already an FIC account.
  if (user.role === "FIC" || user.role === "FIC_MANAGER") {
    redirect(withFeedback(redirectTo, "error", "You already have FIC access."));
  }

  // Guard: a pending FIC application already exists.
  const pending = await prisma.roleUpgradeRequest.findFirst({
    where: { userId: session.userId, targetRole: "FIC", status: "PENDING" },
    select: { id: true },
  });
  if (pending) {
    redirect(withFeedback(redirectTo, "error", "You already have a pending FIC application awaiting review."));
  }

  const validation = validateFicApplicationInput({
    facilityName: String(formData.get("facilityName") ?? ""),
    institutionName: String(formData.get("institutionName") ?? ""),
    regionId: String(formData.get("regionId") ?? ""),
    provinceId: String(formData.get("provinceId") ?? ""),
    cityId: String(formData.get("cityId") ?? ""),
    physicalAddress: String(formData.get("physicalAddress") ?? ""),
    website: String(formData.get("website") ?? ""),
    directorName: String(formData.get("directorName") ?? ""),
    position: String(formData.get("position") ?? ""),
    officialEmail: String(formData.get("officialEmail") ?? ""),
    contactNumber: String(formData.get("contactNumber") ?? ""),
    facilityType: String(formData.get("facilityType") ?? ""),
    facilityTypeOther: String(formData.get("facilityTypeOther") ?? ""),
    sensoryCapabilities: formData.getAll("sensoryCapabilities").map((value) => String(value)),
  });
  if (!validation.ok) {
    redirect(withFeedback(redirectTo, "error", validation.error));
  }
  const data = validation.data;

  // Confirm the PSGC IDs are real and consistent (province in region, city in province).
  const consistency = await validateLocationConsistency({
    regionId: data.regionId,
    provinceId: data.provinceId,
    cityId: data.cityId,
  });
  if (!consistency.ok) {
    redirect(withFeedback(redirectTo, "error", consistency.error));
  }

  const existingProfile = await prisma.ficFacilityProfile.findUnique({
    where: { userId: session.userId },
    select: { id: true, govIdPath: true },
  });

  // Government ID: a new upload replaces any prior one; a rejected re-applicant
  // may keep their previously uploaded ID if they don't attach a new file.
  const fileEntry = formData.get("govId");
  const hasNewFile = fileEntry instanceof File && fileEntry.size > 0;
  let govIdPath = existingProfile?.govIdPath ?? null;
  let savedNewPath: string | null = null;

  if (hasNewFile) {
    const saved = await saveFicIdFile(fileEntry);
    if (!saved.ok) {
      redirect(withFeedback(redirectTo, "error", saved.error));
    }
    savedNewPath = saved.storedPath;
    govIdPath = saved.storedPath;
  } else if (!govIdPath) {
    redirect(withFeedback(redirectTo, "error", "Government-issued ID upload is required."));
  }

  const snapshot = {
    ...data,
    govIdProvided: Boolean(govIdPath),
    submittedAt: new Date().toISOString(),
  };

  const profileData = {
    facilityName: data.facilityName,
    institutionName: data.institutionName,
    regionId: data.regionId,
    provinceId: data.provinceId,
    cityId: data.cityId,
    physicalAddress: data.physicalAddress,
    website: data.website,
    directorName: data.directorName,
    position: data.position,
    officialEmail: data.officialEmail,
    contactNumber: data.contactNumber,
    facilityType: data.facilityType,
    facilityTypeOther: data.facilityTypeOther,
    sensoryCapabilities: data.sensoryCapabilities,
    govIdPath,
    status: "PENDING" as const,
  };

  let roleRequestId: string;
  try {
    roleRequestId = await prisma.$transaction(async (tx) => {
      await tx.ficFacilityProfile.upsert({
        where: { userId: session.userId },
        create: { userId: session.userId, ...profileData },
        update: profileData,
      });

      const roleRequest = await tx.roleUpgradeRequest.create({
        data: {
          userId: session.userId,
          targetRole: "FIC",
          status: "PENDING",
          reason: null,
          applicationData: snapshot as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return roleRequest.id;
    });
  } catch {
    // Roll back the freshly stored file so we don't orphan it.
    if (savedNewPath) {
      await deleteFicIdFile(savedNewPath);
    }
    redirect(withFeedback(redirectTo, "error", "Could not submit your FIC application. Please try again."));
  }

  // Replaced an older ID file — remove it after a successful commit.
  if (hasNewFile && existingProfile?.govIdPath && existingProfile.govIdPath !== govIdPath) {
    await deleteFicIdFile(existingProfile.govIdPath);
  }

  await notifyUser(session.userId, {
    title: "FIC application submitted",
    message: "Your FIC facility application is now pending admin approval.",
    level: "INFO",
    category: "ROLE",
    actionUrl: redirectTo,
    metadata: { requestId: roleRequestId, targetRole: "FIC" },
  });
  await notifyRole("ADMIN", {
    title: "FIC application needs review",
    message: `${data.facilityName} submitted an FIC facility application awaiting review.`,
    level: "WARNING",
    category: "ROLE",
    actionUrl: "/admin/dashboard?view=role-requests",
    metadata: { requestId: roleRequestId, targetRole: "FIC" },
  });
  await logUserUsage({
    actorUserId: session.userId,
    action: "ROLE_REQUEST_SUBMITTED",
    entityType: "RoleUpgradeRequest",
    entityId: roleRequestId,
    summary: "User submitted an FIC facility application.",
    metadata: {
      targetRole: "FIC",
      facilityName: data.facilityName,
      facilityType: data.facilityType,
    },
  });

  redirect(withFeedback(redirectTo, "message", "FIC application submitted for admin review"));
}

export async function saveFicFacilityProfile(formData: FormData) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login?error=Please+login+to+update+your+facility");
  }

  const redirectTo = safeInternalRedirect(formData.get("redirectTo"), "/fic/dashboard?view=profile");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true },
  });
  if (!user) {
    redirect("/login?error=Session+expired");
  }
  // Only approved FIC accounts manage a facility profile here; applicants use applyForFicRole.
  if (user.role !== "FIC" && user.role !== "FIC_MANAGER") {
    redirect(withFeedback(redirectTo, "error", "Only FIC accounts can edit a facility profile."));
  }

  const validation = validateFicApplicationInput({
    facilityName: String(formData.get("facilityName") ?? ""),
    institutionName: String(formData.get("institutionName") ?? ""),
    regionId: String(formData.get("regionId") ?? ""),
    provinceId: String(formData.get("provinceId") ?? ""),
    cityId: String(formData.get("cityId") ?? ""),
    physicalAddress: String(formData.get("physicalAddress") ?? ""),
    website: String(formData.get("website") ?? ""),
    directorName: String(formData.get("directorName") ?? ""),
    position: String(formData.get("position") ?? ""),
    officialEmail: String(formData.get("officialEmail") ?? ""),
    contactNumber: String(formData.get("contactNumber") ?? ""),
    facilityType: String(formData.get("facilityType") ?? ""),
    facilityTypeOther: String(formData.get("facilityTypeOther") ?? ""),
    sensoryCapabilities: formData.getAll("sensoryCapabilities").map((value) => String(value)),
  });
  if (!validation.ok) {
    redirect(withFeedback(redirectTo, "error", validation.error));
  }
  const data = validation.data;

  const consistency = await validateLocationConsistency({
    regionId: data.regionId,
    provinceId: data.provinceId,
    cityId: data.cityId,
  });
  if (!consistency.ok) {
    redirect(withFeedback(redirectTo, "error", consistency.error));
  }

  const existingProfile = await prisma.ficFacilityProfile.findUnique({
    where: { userId: session.userId },
    select: { govIdPath: true },
  });

  const fileEntry = formData.get("govId");
  const hasNewFile = fileEntry instanceof File && fileEntry.size > 0;
  let govIdPath = existingProfile?.govIdPath ?? null;
  let savedNewPath: string | null = null;

  if (hasNewFile) {
    const saved = await saveFicIdFile(fileEntry);
    if (!saved.ok) {
      redirect(withFeedback(redirectTo, "error", saved.error));
    }
    savedNewPath = saved.storedPath;
    govIdPath = saved.storedPath;
  }

  const profileData = {
    facilityName: data.facilityName,
    institutionName: data.institutionName,
    regionId: data.regionId,
    provinceId: data.provinceId,
    cityId: data.cityId,
    physicalAddress: data.physicalAddress,
    website: data.website,
    directorName: data.directorName,
    position: data.position,
    officialEmail: data.officialEmail,
    contactNumber: data.contactNumber,
    facilityType: data.facilityType,
    facilityTypeOther: data.facilityTypeOther,
    sensoryCapabilities: data.sensoryCapabilities,
    govIdPath,
  };

  try {
    // Do not change `status` here — an approved FIC stays approved while editing.
    await prisma.ficFacilityProfile.upsert({
      where: { userId: session.userId },
      create: { userId: session.userId, ...profileData, status: "APPROVED" },
      update: profileData,
    });
  } catch {
    if (savedNewPath) {
      await deleteFicIdFile(savedNewPath);
    }
    redirect(withFeedback(redirectTo, "error", "Could not save your facility profile. Please try again."));
  }

  if (hasNewFile && existingProfile?.govIdPath && existingProfile.govIdPath !== govIdPath) {
    await deleteFicIdFile(existingProfile.govIdPath);
  }

  await notifyUser(session.userId, {
    title: "Facility profile updated",
    message: "Your FIC facility profile details were saved.",
    level: "SUCCESS",
    category: "SYSTEM",
    actionUrl: redirectTo,
  });
  await logUserUsage({
    actorUserId: session.userId,
    action: "FIC_FACILITY_PROFILE_UPDATED",
    entityType: "FicFacilityProfile",
    entityId: session.userId,
    summary: "FIC updated their facility profile.",
    metadata: { facilityName: data.facilityName, facilityType: data.facilityType },
  });

  redirect(withFeedback(redirectTo, "message", "Facility profile updated"));
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

      // Mark the self-reported facility profile approved (FIC requests only).
      if (request.targetRole === "FIC") {
        await tx.ficFacilityProfile.updateMany({
          where: { userId: request.userId },
          data: { status: "APPROVED" },
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
    await logUserUsage({
      actorUserId: session.userId,
      action: "ROLE_REQUEST_APPROVED",
      entityType: "RoleUpgradeRequest",
      entityId: request.id,
      summary: `Admin approved ${request.targetRole} access request.`,
      metadata: {
        targetUserId: request.userId,
        targetRole: request.targetRole,
        assignedRegion: assignment?.region ?? null,
        assignedFacility: assignment?.facility ?? null,
      },
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

  // Mark the self-reported facility profile rejected (FIC requests only); the
  // applicant may edit it and re-apply.
  if (request.targetRole === "FIC") {
    await prisma.ficFacilityProfile.updateMany({
      where: { userId: request.userId },
      data: { status: "REJECTED" },
    });
  }

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
  await logUserUsage({
    actorUserId: session.userId,
    action: "ROLE_REQUEST_REJECTED",
    entityType: "RoleUpgradeRequest",
    entityId: request.id,
    summary: `Admin rejected ${request.targetRole} access request.`,
    metadata: { targetUserId: request.userId, targetRole: request.targetRole },
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
  await logUserUsage({
    actorUserId: session.userId,
    action: "FIC_ASSIGNMENT_UPDATED",
    entityType: "User",
    entityId: ficUserId,
    summary: `Admin updated FIC assignment to ${assignment.facility}, ${assignment.region}.`,
    metadata: {
      ficUserId,
      assignedRegion: assignment.region,
      assignedFacility: assignment.facility,
    },
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
    await logUserUsage({
      actorUserId: session.userId,
      action: "LOGOUT",
      entityType: "User",
      entityId: session.userId,
      summary: "User logged out.",
      metadata: { role: session.role },
    });
  }

  const store = await cookies();
  store.delete(SESSION_KEYS.token);
  clearLegacySessionCookies(store);
  clearGuestSessionCookies(store);
  redirect("/login?message=You+have+been+logged+out");
}

function resolveAdminRedirectTarget(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("/admin/dashboard")) {
    return raw;
  }
  return "/admin/dashboard?view=role-requests";
}

function authRouteWithFeedback(path: "/login" | "/register", redirectTo: string, key: "error" | "message", value: string) {
  const target = new URL(path, "http://localhost");
  target.searchParams.set("next", redirectTo);
  target.searchParams.set(key, value);
  return `${target.pathname}${target.search}`;
}

function withFeedback(path: string, key: "error" | "message", value: string) {
  const target = new URL(path, "http://localhost");
  target.searchParams.set(key, value);
  return `${target.pathname}${target.search}`;
}
