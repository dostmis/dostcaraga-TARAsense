import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeCodeForAccessToken,
  fetchGoogleUserInfo,
  getRedirectUri,
  isGoogleOAuthConfigured,
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  resolveBaseUrl,
  verifyOAuthState,
} from "@/lib/auth/google-oauth";
import { findLinkableGoogleUser } from "@/lib/auth/google-account";
import {
  resolvePostLoginRedirect,
  safeInternalRedirect,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/login-session";
import { SESSION_KEYS } from "@/lib/auth/session";
import { createSessionToken, isSessionSecretConfigured } from "@/lib/auth/session-token";
import { CONFIRMATION_TTL_MINUTES, createConfirmationToken } from "@/lib/auth/confirmation-token";
import { isEmailConfigured, sendMail } from "@/lib/email/mailer";
import { googleSignupConfirmationEmail } from "@/lib/email/templates";
import { checkRateLimit, AUTH_RATE_LIMIT } from "@/lib/rate-limit";
import { notifyUser } from "@/lib/notifications";
import { logUserUsage } from "@/lib/user-usage";

export const dynamic = "force-dynamic";

function redirectToLogin(baseUrl: string, message: string) {
  const response = NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(message)}`);
  clearOAuthCookies(response);
  return response;
}

function clearOAuthCookies(response: NextResponse) {
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(OAUTH_NEXT_COOKIE);
}

/**
 * Step 2 of Google sign-in: validate the state, exchange the code for the
 * Google profile, then branch on whether the account already exists:
 *   - Existing account  → establish the session immediately (normal sign-in).
 *   - Brand-new account → email a magic-link confirmation and DO NOT create the
 *     account or set a session yet; the account is created when the link is
 *     clicked (see /api/auth/google/confirm).
 */
export async function GET(request: NextRequest) {
  const baseUrl = resolveBaseUrl(request);

  if (!isGoogleOAuthConfigured() || !isSessionSecretConfigured()) {
    return redirectToLogin(baseUrl, "Google sign-in is not configured. Please contact an administrator.");
  }

  const params = request.nextUrl.searchParams;

  // The user denied consent or Google returned an error.
  const oauthError = params.get("error");
  if (oauthError) {
    const message =
      oauthError === "access_denied"
        ? "Google sign-in was cancelled."
        : "Google sign-in failed. Please try again.";
    return redirectToLogin(baseUrl, message);
  }

  const code = params.get("code") ?? "";
  const returnedState = params.get("state") ?? "";
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
  const nextPath = safeInternalRedirect(request.cookies.get(OAUTH_NEXT_COOKIE)?.value);

  if (!code) {
    return redirectToLogin(baseUrl, "Google sign-in failed. Please try again.");
  }
  if (!verifyOAuthState(returnedState, expectedState)) {
    return redirectToLogin(baseUrl, "Your Google sign-in session expired. Please try again.");
  }

  const accessToken = await exchangeCodeForAccessToken(code, getRedirectUri(baseUrl));
  if (!accessToken) {
    return redirectToLogin(baseUrl, "Could not verify your Google account. Please try again.");
  }

  const profile = await fetchGoogleUserInfo(accessToken);
  if (!profile) {
    return redirectToLogin(baseUrl, "Google did not share an email address for your account.");
  }

  let lookup;
  try {
    lookup = await findLinkableGoogleUser(profile);
  } catch {
    return redirectToLogin(baseUrl, "Could not complete Google sign-in. Please try again.");
  }

  if (lookup.status === "invalid-role") {
    return redirectToLogin(baseUrl, "Your account could not be signed in. Please contact an administrator.");
  }

  // ── New account: gate behind an email confirmation magic link ──────────────
  if (lookup.status === "not-found") {
    return startEmailConfirmation(request, baseUrl, profile.email, profile.name, profile.picture);
  }

  // ── Existing account: sign in immediately ──────────────────────────────────
  const resolved = lookup.user;
  const destination = resolvePostLoginRedirect(resolved.role, nextPath);
  const response = NextResponse.redirect(`${baseUrl}${destination}`);

  response.cookies.set(SESSION_KEYS.token, createSessionToken(resolved.userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  // Clear legacy, guest, and one-time OAuth cookies.
  response.cookies.delete(SESSION_KEYS.userId);
  response.cookies.delete(SESSION_KEYS.role);
  response.cookies.delete(SESSION_KEYS.guestParticipantId);
  response.cookies.delete(SESSION_KEYS.guestStudyId);
  response.cookies.delete(SESSION_KEYS.guestCode);
  clearOAuthCookies(response);

  // Audit/notify the login. Failures must never block sign-in.
  try {
    await notifyUser(resolved.userId, {
      title: "Login successful",
      message: "You have successfully signed in with Google.",
      level: "SUCCESS",
      category: "AUTH",
      actionUrl: destination,
    });
    await logUserUsage({
      actorUserId: resolved.userId,
      action: "LOGIN",
      entityType: "User",
      entityId: resolved.userId,
      summary: "User logged in with Google.",
      metadata: { role: resolved.storedRole, provider: "google" },
    });
  } catch {
    // Sign-in already succeeded; swallow notification/logging errors.
  }

  return response;
}

/**
 * Build + send the confirmation magic link for a brand-new Google sign-up, then
 * redirect to the "check your email" page. No user row or session is created
 * here — the magic link does that (see the confirm route).
 */
async function startEmailConfirmation(
  request: NextRequest,
  baseUrl: string,
  email: string,
  name: string | null,
  picture: string | null
) {
  if (!isEmailConfigured()) {
    return redirectToLogin(
      baseUrl,
      "Email confirmation is currently unavailable. Please contact an administrator."
    );
  }

  const normalizedEmail = email.trim().toLowerCase();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (
    !checkRateLimit(`google-confirm:${normalizedEmail}`, AUTH_RATE_LIMIT).allowed ||
    !checkRateLimit(`google-confirm-ip:${ip}`, AUTH_RATE_LIMIT).allowed
  ) {
    return redirectToLogin(baseUrl, "Too many confirmation emails. Please try again later.");
  }

  const token = createConfirmationToken({ email: normalizedEmail, name, picture });
  const confirmUrl = `${baseUrl}/api/auth/google/confirm?token=${encodeURIComponent(token)}`;
  const { subject, html, text } = googleSignupConfirmationEmail({
    name: name ?? "",
    confirmUrl,
    expiresMinutes: CONFIRMATION_TTL_MINUTES,
  });

  const sent = await sendMail({ to: normalizedEmail, subject, html, text });
  if (!sent) {
    return redirectToLogin(baseUrl, "Could not send the confirmation email. Please try again.");
  }

  const response = NextResponse.redirect(`${baseUrl}/auth/check-email?email=${encodeURIComponent(normalizedEmail)}`);
  clearOAuthCookies(response);
  return response;
}
