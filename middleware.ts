import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_IDLE_TTL_SECONDS,
  SESSION_TOKEN_COOKIE_KEY,
} from "@/lib/auth/session-constants";
import { reissueSessionTokenEdge, verifySessionTokenEdge } from "@/lib/auth/session-token-edge";

// Avoid rewriting the cookie on every single request — only slide the window
// once the extension is worth at least this many seconds.
const COOKIE_REWRITE_THRESHOLD_SECONDS = 60;

export async function middleware(request: NextRequest) {
  // Preserve the existing legacy-path fix.
  if (request.nextUrl.pathname === "/MSME/dashboard") {
    const url = request.nextUrl.clone();
    url.pathname = "/msme/dashboard";
    return NextResponse.redirect(url, 307);
  }

  // Force HTTPS in production (behind a TLS-terminating proxy such as Nginx,
  // which sets x-forwarded-proto). Belt-and-suspenders alongside Nginx + HSTS.
  if (process.env.NODE_ENV === "production") {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (proto === "http") {
      const url = request.nextUrl.clone();
      url.protocol = "https:";
      return NextResponse.redirect(url, 308);
    }
  }

  const response = NextResponse.next();
  await slideSessionWindow(request, response);
  return response;
}

/**
 * Slide the session's inactivity window forward on activity: re-issue the token
 * with exp = min(now + idle window, absolute deadline). Token-version revocation
 * and final expiry are still enforced server-side in getCurrentSession; this
 * only keeps active users signed in and lets idle ones time out.
 */
async function slideSessionWindow(request: NextRequest, response: NextResponse) {
  const token = request.cookies.get(SESSION_TOKEN_COOKIE_KEY)?.value;
  if (!token) {
    return;
  }

  const payload = await verifySessionTokenEdge(token);
  if (!payload) {
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  // Already expired (idle or absolute) — let the server-side check log them out.
  if (payload.exp <= nowSeconds || payload.abs <= nowSeconds) {
    return;
  }

  const newExp = Math.min(nowSeconds + SESSION_IDLE_TTL_SECONDS, payload.abs);
  if (newExp - payload.exp < COOKIE_REWRITE_THRESHOLD_SECONDS) {
    return;
  }

  const reissued = await reissueSessionTokenEdge(payload, newExp);
  if (!reissued) {
    return;
  }

  response.cookies.set(SESSION_TOKEN_COOKIE_KEY, reissued, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Keep the cookie until the absolute deadline; server-side exp enforces idle.
    maxAge: payload.abs - nowSeconds,
  });
}

export const config = {
  // Run on pages and API routes, but skip Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
