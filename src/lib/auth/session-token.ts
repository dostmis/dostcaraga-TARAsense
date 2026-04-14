import { createHmac, timingSafeEqual } from "crypto";

type SessionTokenPayload = {
  uid: string;
  iat: number;
  exp: number;
};

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MIN_SECRET_LENGTH = 32;

export const SESSION_TOKEN_COOKIE_KEY = "tara_session";

export function createSessionToken(userId: string, now = new Date()) {
  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const payload: SessionTokenPayload = {
    uid: userId,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + SESSION_TTL_SECONDS,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadBase64 = base64UrlEncode(payloadJson);
  const signature = signPayload(payloadBase64, getSessionSecret());
  return `${payloadBase64}.${signature}`;
}

export function verifySessionToken(token: string): { userId: string; expiresAt: Date } | null {
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

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.exp <= nowSeconds) {
    return null;
  }

  return {
    userId: parsed.uid,
    expiresAt: new Date(parsed.exp * 1000),
  };
}

export function isSessionSecretConfigured() {
  return Boolean(readSessionSecret());
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
    typeof candidate.iat === "number" &&
    Number.isFinite(candidate.iat) &&
    typeof candidate.exp === "number" &&
    Number.isFinite(candidate.exp)
  );
}
