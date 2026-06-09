import type { cookies } from "next/headers";
import { AppRole, ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { clearGuestSessionCookies, SESSION_KEYS } from "@/lib/auth/session";
import { createSessionToken } from "@/lib/auth/session-token";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Shared session/redirect helpers used by both the credential server actions
 * (`auth-actions.ts`) and the Google OAuth callback route, so every sign-in
 * path establishes the session and resolves the post-login destination the
 * same way.
 */

export function setSessionCookie(store: CookieStore, userId: string) {
  const token = createSessionToken(userId);
  store.set(SESSION_KEYS.token, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearLegacySessionCookies(store: CookieStore) {
  store.delete(SESSION_KEYS.userId);
  store.delete(SESSION_KEYS.role);
}

/** Set the session cookie and clear legacy + guest cookies in one step. */
export function establishUserSession(store: CookieStore, userId: string) {
  setSessionCookie(store, userId);
  clearLegacySessionCookies(store);
  clearGuestSessionCookies(store);
}

/**
 * Where to send a user immediately after sign-in. Consumers (and MSME users
 * resuming a study start link) keep their requested destination; everyone else
 * lands on their role dashboard.
 */
export function resolvePostLoginRedirect(role: AppRole, redirectTo: string) {
  if (role === "CONSUMER") {
    return redirectTo;
  }
  if (role === "MSME" && isStudyStartPath(redirectTo)) {
    return redirectTo;
  }
  return ROLE_DASHBOARD_PATH[role];
}

function isStudyStartPath(path: string) {
  return /^\/studies\/[^/]+\/start(?:\?|$)/.test(path);
}

/** Only allow same-origin relative redirects; otherwise fall back. */
export function safeInternalRedirect(
  value: FormDataEntryValue | string | null | undefined,
  fallback: string = ROLE_DASHBOARD_PATH.CONSUMER
) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return fallback;
}
