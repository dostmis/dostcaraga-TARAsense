import { NextResponse, type NextRequest } from "next/server";
import {
  buildGoogleAuthUrl,
  createOAuthState,
  getRedirectUri,
  isGoogleOAuthConfigured,
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  resolveBaseUrl,
} from "@/lib/auth/google-oauth";
import { safeInternalRedirect } from "@/lib/auth/login-session";
import { isSessionSecretConfigured } from "@/lib/auth/session-token";
import { checkRateLimit, AUTH_RATE_LIMIT } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function loginError(baseUrl: string, message: string) {
  return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(message)}`);
}

/**
 * Step 1 of Google sign-in: validate configuration, mint an anti-CSRF state,
 * remember the post-login destination, and bounce the browser to Google's
 * consent screen.
 */
export async function GET(request: NextRequest) {
  const baseUrl = resolveBaseUrl(request);

  if (!isGoogleOAuthConfigured()) {
    return loginError(baseUrl, "Google sign-in is not configured. Please contact an administrator.");
  }
  if (!isSessionSecretConfigured()) {
    return loginError(baseUrl, "Session configuration error. Please contact an administrator.");
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`google-oauth:${ip}`, AUTH_RATE_LIMIT).allowed) {
    return loginError(baseUrl, "Too many sign-in attempts. Please try again later.");
  }

  const next = safeInternalRedirect(request.nextUrl.searchParams.get("next"));
  const state = createOAuthState();
  const authUrl = buildGoogleAuthUrl({ redirectUri: getRedirectUri(baseUrl), state });

  const response = NextResponse.redirect(authUrl);
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  };
  response.cookies.set(OAUTH_STATE_COOKIE, state, cookieOptions);
  response.cookies.set(OAUTH_NEXT_COOKIE, next, cookieOptions);
  return response;
}
