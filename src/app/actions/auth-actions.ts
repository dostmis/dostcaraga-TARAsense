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
import {
  createMfaChallenge,
  createMfaPendingToken,
  getLastChallengeIssuedAt,
  MFA_CHALLENGE_TTL_MS,
  MFA_PENDING_COOKIE_KEY,
  MFA_RESEND_COOLDOWN_MS,
  verifyMfaChallenge,
  verifyMfaPendingToken,
} from "@/lib/auth/mfa";
import { isEmailConfigured, sendMail } from "@/lib/email/mailer";
import { adminOtpEmail } from "@/lib/email/templates";
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
    select: { id: true, password: true, role: true, name: true, email: true, tokenVersion: true },
  });

  if (!user?.password || !verifyPassword(password, user.password)) {
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Invalid email or password"));
  }

  const role = parseRole(user.role);
  if (!role) {
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Unsupported role configuration"));
  }

  // Privileged accounts require a second factor (email OTP) before a session is
  // created. The password being correct is necessary but not sufficient.
  if (role === "ADMIN") {
    await startAdminMfa({ userId: user.id, name: user.name, email: user.email }, requestHeaders, redirectTo);
    // startAdminMfa always redirects; this is unreachable.
    return;
  }

  // "Remember this device": longer-lived session with no idle timeout. Admins
  // never reach here — they always go through the short-lived MFA flow above.
  const remember = formData.get("remember") === "on";
  const store = await cookies();
  try {
    setSessionCookie(store, { userId: user.id, tokenVersion: user.tokenVersion, role }, { remember });
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

const MFA_PENDING_COOKIE_MAX_AGE = 10 * 60; // 10 minutes — outlives the OTP itself

function mfaPendingCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MFA_PENDING_COOKIE_MAX_AGE,
  };
}

/**
 * Issue an email OTP challenge for a privileged sign-in: create the challenge,
 * email the code, set the signed MFA-pending cookie, and redirect to the verify
 * page. Always redirects (success or failure) and never establishes a session.
 * If email is not configured, admin sign-in is blocked rather than bypassed.
 */
async function startAdminMfa(
  principal: { userId: string; name: string; email: string },
  requestHeaders: Awaited<ReturnType<typeof headers>>,
  redirectTo: string
): Promise<never> {
  if (!isEmailConfigured()) {
    redirect(
      authRouteWithFeedback(
        "/login",
        redirectTo,
        "error",
        "Admin verification is unavailable because email is not configured. Contact an administrator."
      )
    );
  }

  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = requestHeaders.get("user-agent") ?? null;

  const challenge = await createMfaChallenge({ userId: principal.userId, ipAddress: ip, userAgent });
  const { subject, html, text } = adminOtpEmail({
    name: principal.name,
    code: challenge.code,
    expiresMinutes: Math.round(MFA_CHALLENGE_TTL_MS / 60000),
  });

  const sent = await sendMail({ to: principal.email, subject, html, text });
  if (!sent) {
    redirect(
      authRouteWithFeedback("/login", redirectTo, "error", "Could not send your verification code. Please try again.")
    );
  }

  const store = await cookies();
  store.set(
    MFA_PENDING_COOKIE_KEY,
    createMfaPendingToken({ challengeId: challenge.challengeId, userId: principal.userId }),
    mfaPendingCookieOptions()
  );

  await logUserUsage({
    actorUserId: principal.userId,
    action: "MFA_CHALLENGE_ISSUED",
    entityType: "User",
    entityId: principal.userId,
    summary: "Admin sign-in second-factor code issued.",
    metadata: { channel: "email" },
  });

  redirect(verifyRouteWithFeedback(redirectTo, "message", "We emailed you a 6-digit verification code."));
}

/** Second step of admin sign-in: verify the emailed OTP and open the session. */
export async function verifyAdminOtp(formData: FormData) {
  const redirectTo = safeInternalRedirect(formData.get("redirectTo"));
  const code = String(formData.get("code") ?? "").trim();

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`mfa-verify:${ip}`, AUTH_RATE_LIMIT).allowed) {
    redirect(verifyRouteWithFeedback(redirectTo, "error", "Too many attempts. Please wait and try again."));
  }

  const store = await cookies();
  const pending = verifyMfaPendingToken(store.get(MFA_PENDING_COOKIE_KEY)?.value ?? "");
  if (!pending) {
    store.delete(MFA_PENDING_COOKIE_KEY);
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Your verification session expired. Please sign in again."));
  }

  const result = await verifyMfaChallenge({
    challengeId: pending.challengeId,
    userId: pending.userId,
    code,
  });

  if (!result.ok) {
    await logUserUsage({
      actorUserId: pending.userId,
      action: "MFA_FAILED",
      entityType: "User",
      entityId: pending.userId,
      summary: "Admin second-factor verification failed.",
      metadata: { reason: result.reason },
    });

    // Recoverable on the same page only for a wrong code; otherwise restart.
    if (result.reason === "invalid-code") {
      redirect(verifyRouteWithFeedback(redirectTo, "error", "That code is incorrect. Please try again."));
    }
    store.delete(MFA_PENDING_COOKIE_KEY);
    const message =
      result.reason === "expired"
        ? "Your verification code expired. Please sign in again."
        : result.reason === "too-many-attempts"
          ? "Too many incorrect codes. Please sign in again."
          : "Your verification session is no longer valid. Please sign in again.";
    redirect(authRouteWithFeedback("/login", redirectTo, "error", message));
  }

  const user = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: { id: true, role: true, tokenVersion: true },
  });
  const role = user ? parseRole(user.role) : null;
  if (!user || !role) {
    store.delete(MFA_PENDING_COOKIE_KEY);
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Your account could not be signed in. Please contact an administrator."));
  }

  try {
    setSessionCookie(store, { userId: user.id, tokenVersion: user.tokenVersion, role });
  } catch {
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Session configuration error. Please contact an administrator"));
  }
  clearLegacySessionCookies(store);
  clearGuestSessionCookies(store);
  store.delete(MFA_PENDING_COOKIE_KEY);

  const postLoginPath = resolvePostLoginRedirect(role, redirectTo);
  await logUserUsage({
    actorUserId: user.id,
    action: "LOGIN",
    entityType: "User",
    entityId: user.id,
    summary: "Admin logged in (password + email OTP).",
    metadata: { role, mfa: "email" },
  });
  redirect(postLoginPath);
}

/** Re-send a fresh admin OTP, throttled by a per-user cooldown + IP rate limit. */
export async function resendAdminOtp(formData: FormData) {
  const redirectTo = safeInternalRedirect(formData.get("redirectTo"));

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`mfa-resend:${ip}`, AUTH_RATE_LIMIT).allowed) {
    redirect(verifyRouteWithFeedback(redirectTo, "error", "Too many requests. Please wait and try again."));
  }

  const store = await cookies();
  const pending = verifyMfaPendingToken(store.get(MFA_PENDING_COOKIE_KEY)?.value ?? "");
  if (!pending) {
    store.delete(MFA_PENDING_COOKIE_KEY);
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Your verification session expired. Please sign in again."));
  }

  const lastIssuedAt = await getLastChallengeIssuedAt(pending.userId);
  if (lastIssuedAt && Date.now() - lastIssuedAt.getTime() < MFA_RESEND_COOLDOWN_MS) {
    redirect(verifyRouteWithFeedback(redirectTo, "error", "Please wait a moment before requesting another code."));
  }

  const user = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user || parseRole(user.role) !== "ADMIN") {
    store.delete(MFA_PENDING_COOKIE_KEY);
    redirect(authRouteWithFeedback("/login", redirectTo, "error", "Your verification session is no longer valid. Please sign in again."));
  }

  await startAdminMfa({ userId: user.id, name: user.name, email: user.email }, requestHeaders, redirectTo);
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
    // Newly registered accounts are always CONSUMER with tokenVersion 0.
    setSessionCookie(store, { userId: created.id, tokenVersion: 0, role: "CONSUMER" });
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

function verifyRouteWithFeedback(redirectTo: string, key: "error" | "message", value: string) {
  const target = new URL("/login/verify", "http://localhost");
  target.searchParams.set("next", redirectTo);
  target.searchParams.set(key, value);
  return `${target.pathname}${target.search}`;
}

function withFeedback(path: string, key: "error" | "message", value: string) {
  const target = new URL(path, "http://localhost");
  target.searchParams.set(key, value);
  return `${target.pathname}${target.search}`;
}
