import { createHmac, timingSafeEqual } from "crypto";
import {
  ADMIN_SESSION_TTL_SECONDS,
  MIN_SECRET_LENGTH,
  REMEMBER_SESSION_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  SESSION_TOKEN_COOKIE_KEY,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session-constants";

// Re-export so existing `from "@/lib/auth/session-token"` imports keep working.
export {
  ADMIN_SESSION_TTL_SECONDS,
  REMEMBER_SESSION_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  SESSION_TOKEN_COOKIE_KEY,
  SESSION_TTL_SECONDS,
};

type SessionTokenPayload = {
  uid: string;
  /** Token version snapshot — must match User.tokenVersion or the token is revoked. */
  tv: number;
  /** Issued-at (unix seconds) — set once at login, preserved across idle re-issues. */
  iat: number;
  /** Absolute expiry (unix seconds) — hard deadline, never extended. */
  abs: number;
  /** Effective expiry (unix seconds) — slides forward on activity, capped at abs. */
  exp: number;
};

export interface CreateSessionTokenOptions {
  now?: Date;
  /** Absolute lifetime in seconds (defaults to SESSION_TTL_SECONDS). */
  absoluteTtlSeconds?: number;
  /** Idle window in seconds (defaults to SESSION_IDLE_TTL_SECONDS). */
  idleTtlSeconds?: number;
}

export function createSessionToken(
  userId: string,
  tokenVersion: number,
  options: CreateSessionTokenOptions = {}
) {
  const now = options.now ?? new Date();
  const absoluteTtl = options.absoluteTtlSeconds ?? SESSION_TTL_SECONDS;
  const idleTtl = options.idleTtlSeconds ?? SESSION_IDLE_TTL_SECONDS;
  const iat = Math.floor(now.getTime() / 1000);
  const abs = iat + absoluteTtl;
  const payload: SessionTokenPayload = {
    uid: userId,
    tv: Number.isFinite(tokenVersion) ? tokenVersion : 0,
    iat,
    abs,
    exp: Math.min(iat + idleTtl, abs),
  };

  return encodeSignedPayload(payload);
}

export interface VerifiedSessionToken {
  userId: string;
  tokenVersion: number;
  issuedAt: Date;
  absoluteExpiresAt: Date;
  expiresAt: Date;
}

export function verifySessionToken(token: string): VerifiedSessionToken | null {
  const parsed = decodeAndVerify(token);
  if (!parsed) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.exp <= nowSeconds || parsed.abs <= nowSeconds) {
    return null;
  }

  return {
    userId: parsed.uid,
    tokenVersion: parsed.tv,
    issuedAt: new Date(parsed.iat * 1000),
    absoluteExpiresAt: new Date(parsed.abs * 1000),
    expiresAt: new Date(parsed.exp * 1000),
  };
}

export function isSessionSecretConfigured() {
  return Boolean(readSessionSecret());
}

function encodeSignedPayload(payload: SessionTokenPayload) {
  const payloadBase64 = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadBase64, getSessionSecret());
  return `${payloadBase64}.${signature}`;
}

/** Verify the signature + structure of a token without enforcing expiry. */
function decodeAndVerify(token: string): SessionTokenPayload | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payloadBase64, signature] = parts;
  if (!payloadBase64 || !signature) {
    return null;
  }

  const secret = readSessionSecret();
  if (!secret) {
    return null;
  }

  const expectedSignature = signPayload(payloadBase64, secret);
  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  const payloadJson = base64UrlDecode(payloadBase64);
  if (!payloadJson) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (!isSessionPayload(parsed)) {
    return null;
  }

  return parsed;
}

function getSessionSecret() {
  const secret = readSessionSecret();
  if (!secret) {
    throw new Error(
      `SESSION_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long for secure session handling.`
    );
  }
  return secret;
}

function readSessionSecret() {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length >= MIN_SECRET_LENGTH) {
    return secret;
  }
  return null;
}

function signPayload(payloadBase64: string, secret: string) {
  return createHmac("sha256", secret).update(payloadBase64).digest("base64url");
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function isSessionPayload(value: unknown): value is SessionTokenPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SessionTokenPayload>;
  return (
    typeof candidate.uid === "string" &&
    candidate.uid.length > 0 &&
    typeof candidate.tv === "number" &&
    Number.isFinite(candidate.tv) &&
    typeof candidate.iat === "number" &&
    Number.isFinite(candidate.iat) &&
    typeof candidate.abs === "number" &&
    Number.isFinite(candidate.abs) &&
    typeof candidate.exp === "number" &&
    Number.isFinite(candidate.exp)
  );
}
