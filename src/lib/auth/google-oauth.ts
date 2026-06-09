import { randomBytes, timingSafeEqual } from "crypto";

/**
 * Minimal Google OAuth 2.0 (Authorization Code) helper for TARAsense's custom,
 * cookie-based auth system. We do not use NextAuth here — the callback route
 * exchanges the code, reads the Google profile, and then hands off to the
 * existing session/role logic in `login-session.ts`.
 *
 * Required env vars (see .env.example):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   NEXTAUTH_URL (or NEXT_PUBLIC_APP_URL) — used to build the exact callback URL
 *
 * Authorized redirect URI to register in Google Cloud Console:
 *   <base-url>/api/auth/google/callback
 */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/auth/google/callback";

/** Short-lived cookies used to defend against CSRF on the OAuth round-trip. */
export const OAUTH_STATE_COOKIE = "tara_oauth_state";
export const OAUTH_NEXT_COOKIE = "tara_oauth_next";
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes

export type GoogleUserInfo = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

function getClientId() {
  return (process.env.GOOGLE_CLIENT_ID ?? "").trim();
}

function getClientSecret() {
  return (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(getClientId() && getClientSecret());
}

/**
 * Resolve the app's external base URL. Prefer an explicit env var so the
 * redirect_uri exactly matches what is registered in Google Cloud Console;
 * fall back to forwarded request headers for local/dev convenience.
 */
export function resolveBaseUrl(request: Request): string {
  const fromEnv = (process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (fromEnv) {
    return fromEnv;
  }

  const url = new URL(request.url);
  const proto = (request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "")).split(",")[0]!.trim();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export function getRedirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${GOOGLE_OAUTH_CALLBACK_PATH}`;
}

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time comparison of the returned state against the cookie value. */
export function verifyOAuthState(received: string, expected: string): boolean {
  if (!received || !expected) {
    return false;
  }
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function buildGoogleAuthUrl(params: { redirectUri: string; state: string }): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", getClientId());
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("access_type", "online");
  url.searchParams.set("include_granted_scopes", "true");
  // Always show the account chooser so users can switch Google accounts.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/** Exchange the authorization code for an access token. Returns null on failure. */
export async function exchangeCodeForAccessToken(code: string, redirectUri: string): Promise<string | null> {
  const body = new URLSearchParams({
    code,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  try {
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

/** Fetch the verified Google profile for the access token. Returns null on failure or when no email is present. */
export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      name?: string;
      picture?: string;
    };
    const email = (json.email ?? "").trim().toLowerCase();
    if (!email) {
      return null;
    }
    return {
      sub: json.sub ?? "",
      email,
      emailVerified: json.email_verified === true || json.email_verified === "true",
      name: json.name?.trim() || null,
      picture: json.picture?.trim() || null,
    };
  } catch {
    return null;
  }
}
