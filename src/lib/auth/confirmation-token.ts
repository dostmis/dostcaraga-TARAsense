import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, short-lived token that carries a pending Google sign-up across the
 * email-confirmation round trip. Mirrors the HMAC mechanics of
 * `session-token.ts` (base64url payload + HMAC-SHA256 + constant-time compare)
 * and is signed with the same SESSION_SECRET.
 *
 * The token holds the verified Google profile so the account can be created
 * only when the magic link is clicked — no DB row is created beforehand. A
 * distinct `purpose` field (and a different payload shape than the session
 * token) prevents cross-use between the two token types.
 */

const CONFIRMATION_PURPOSE = "google-signup";
const CONFIRMATION_TTL_SECONDS = 30 * 60; // 30 minutes
const MIN_SECRET_LENGTH = 32;

export const CONFIRMATION_TTL_MINUTES = CONFIRMATION_TTL_SECONDS / 60;

export type PendingGoogleSignup = {
  email: string;
  name: string | null;
  picture: string | null;
};

type ConfirmationPayload = PendingGoogleSignup & {
  purpose: typeof CONFIRMATION_PURPOSE;
  iat: number;
  exp: number;
};

export function createConfirmationToken(profile: PendingGoogleSignup, now = new Date()): string {
  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const payload: ConfirmationPayload = {
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
    purpose: CONFIRMATION_PURPOSE,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + CONFIRMATION_TTL_SECONDS,
  };

  const payloadBase64 = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadBase64, getSecret());
  return `${payloadBase64}.${signature}`;
}

export function verifyConfirmationToken(token: string): PendingGoogleSignup | null {
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

  const secret = readSecret();
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

  if (!isConfirmationPayload(parsed)) {
    return null;
  }

  if (parsed.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return { email: parsed.email, name: parsed.name, picture: parsed.picture };
}

function getSecret() {
  const secret = readSecret();
  if (!secret) {
    throw new Error(
      `SESSION_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long for confirmation tokens.`
    );
  }
  return secret;
}

function readSecret() {
  const secret = process.env.SESSION_SECRET ?? "";
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

function signPayload(payloadBase64: string, secret: string) {
  // Namespace with the purpose so a confirmation token can never collide with a
  // session token even if payload shapes ever overlap.
  return createHmac("sha256", secret).update(`${CONFIRMATION_PURPOSE}:${payloadBase64}`).digest("base64url");
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

function isConfirmationPayload(value: unknown): value is ConfirmationPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ConfirmationPayload>;
  return (
    candidate.purpose === CONFIRMATION_PURPOSE &&
    typeof candidate.email === "string" &&
    candidate.email.length > 0 &&
    (candidate.name === null || typeof candidate.name === "string") &&
    (candidate.picture === null || typeof candidate.picture === "string") &&
    typeof candidate.iat === "number" &&
    Number.isFinite(candidate.iat) &&
    typeof candidate.exp === "number" &&
    Number.isFinite(candidate.exp)
  );
}
