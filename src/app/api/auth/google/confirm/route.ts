import { NextResponse, type NextRequest } from "next/server";
import { resolveBaseUrl } from "@/lib/auth/google-oauth";
import { createGoogleUser, findLinkableGoogleUser } from "@/lib/auth/google-account";
import { verifyConfirmationToken } from "@/lib/auth/confirmation-token";
import { buildSessionCookie, resolvePostLoginRedirect } from "@/lib/auth/login-session";
import { SESSION_KEYS } from "@/lib/auth/session";
import { isSessionSecretConfigured } from "@/lib/auth/session-token";
import { notifyRole, notifyUser } from "@/lib/notifications";
import { logUserUsage } from "@/lib/user-usage";

export const dynamic = "force-dynamic";

function redirectToLogin(baseUrl: string, message: string) {
  return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(message)}`);
}

/**
 * Final step of a NEW Google sign-up: the user clicked the magic link from the
 * confirmation email. Verify the signed token, create the account (or link to
 * one created meanwhile), establish the session, and route to the dashboard.
 */
export async function GET(request: NextRequest) {
  const baseUrl = resolveBaseUrl(request);

  if (!isSessionSecretConfigured()) {
    return redirectToLogin(baseUrl, "Session configuration error. Please contact an administrator.");
  }

  const token = request.nextUrl.searchParams.get("token") ?? "";
  const pending = verifyConfirmationToken(token);
  if (!pending) {
    return redirectToLogin(baseUrl, "Your confirmation link is invalid or has expired. Please sign in again.");
  }

  // Create the account now (idempotent: links to an existing user if one was
  // created between the email send and this click).
  let resolved;
  try {
    const existing = await findLinkableGoogleUser(pending);
    if (existing.status === "invalid-role") {
      return redirectToLogin(baseUrl, "Your account could not be signed in. Please contact an administrator.");
    }
    resolved = existing.status === "found" ? existing.user : await createGoogleUser(pending);
  } catch {
    return redirectToLogin(baseUrl, "Could not complete Google sign-in. Please try again.");
  }
  if (!resolved) {
    return redirectToLogin(baseUrl, "Could not create your account. Please try again.");
  }

  // The original `next` target isn't carried through the email round trip
  // (the link may even open on another device), so default to the role dashboard.
  const destination = resolvePostLoginRedirect(resolved.role, "/consumer/dashboard");
  const response = NextResponse.redirect(`${baseUrl}${destination}`);

  const sessionCookie = buildSessionCookie({
    userId: resolved.userId,
    tokenVersion: resolved.tokenVersion,
    role: resolved.role,
  });
  response.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.options);
  response.cookies.delete(SESSION_KEYS.userId);
  response.cookies.delete(SESSION_KEYS.role);
  response.cookies.delete(SESSION_KEYS.guestParticipantId);
  response.cookies.delete(SESSION_KEYS.guestStudyId);
  response.cookies.delete(SESSION_KEYS.guestCode);

  // New-account notifications + audit log (moved here from the callback, since
  // this is where the account is actually created). Never block sign-in.
  if (resolved.isNewUser) {
    try {
      await notifyUser(resolved.userId, {
        title: "Welcome to TARAsense",
        message: "Your account is now active as a Consumer user.",
        level: "SUCCESS",
        category: "AUTH",
        actionUrl: destination,
      });
      await notifyRole("ADMIN", {
        title: "New user registered",
        message: `${resolved.name} (${resolved.email}) signed up with Google.`,
        level: "INFO",
        category: "SYSTEM",
        actionUrl: "/admin/dashboard",
      });
      await logUserUsage({
        actorUserId: resolved.userId,
        actor: { name: resolved.name, email: resolved.email, role: "CONSUMER" },
        action: "USER_REGISTERED",
        entityType: "User",
        entityId: resolved.userId,
        summary: `${resolved.name} registered via Google (email confirmed).`,
        metadata: { role: "CONSUMER", provider: "google", emailConfirmed: true },
      });
    } catch {
      // Account created + session set; swallow notification/logging errors.
    }
  }

  return response;
}
