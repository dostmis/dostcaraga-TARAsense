import type { cookies } from "next/headers";
import { AppRole, parseRole, ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { clearGuestSessionCookies, SESSION_KEYS } from "@/lib/auth/session";
import {
  ADMIN_SESSION_TTL_SECONDS,
  createSessionToken,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session-token";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/** @deprecated kept for compatibility; prefer sessionAbsoluteTtlSeconds(role). */
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_SECONDS;

/** Who we are issuing a session for; tokenVersion is embedded for revocation. */
export interface SessionPrincipal {
  userId: string;
  tokenVersion: number;
  /** Effective app role; ADMIN sessions get a shorter absolute lifetime. */
  role?: AppRole | string | null;
}

/**
 * Shared session/redirect helpers used by both the credential server actions
 * (`auth-actions.ts`) and the Google OAuth routes, so every sign-in path
 * establishes the session and resolves the post-login destination the same way.
 */

/** Absolute session lifetime by role — privileged roles expire sooner. */
export function sessionAbsoluteTtlSeconds(role?: AppRole | string | null): number {
  return parseRole(String(role ?? "")) === "ADMIN"
    ? ADMIN_SESSION_TTL_SECONDS
    : SESSION_TTL_SECONDS;
}

/** Build the signed session token + matching cookie options for a principal. */
export function buildSessionCookie(principal: SessionPrincipal) {
  const maxAge = sessionAbsoluteTtlSeconds(principal.role);
  const value = createSessionToken(principal.userId, principal.tokenVersion, {
    absoluteTtlSeconds: maxAge,
  });
  return {
    name: SESSION_KEYS.token,
    value,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge,
    },
  };
}

export function setSessionCookie(store: CookieStore, principal: SessionPrincipal) {
  const { name, value, options } = buildSessionCookie(principal);
  store.set(name, value, options);
}

export function clearLegacySessionCookies(store: CookieStore) {
  store.delete(SESSION_KEYS.userId);
  store.delete(SESSION_KEYS.role);
}

/** Set the session cookie and clear legacy + guest cookies in one step. */
export function establishUserSession(store: CookieStore, principal: SessionPrincipal) {
  setSessionCookie(store, principal);
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
