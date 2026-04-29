import { createHmac, timingSafeEqual } from "crypto";

type MobileTokenType = "access" | "refresh";

type MobileTokenPayload = {
  uid: string;
  typ: MobileTokenType;
  iat: number;
  exp: number;
};

const ACCESS_TTL_SECONDS = 60 * 60 * 24;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const MIN_SECRET_LENGTH = 32;

export function createMobileToken(userId: string, type: MobileTokenType, now = new Date()) {
  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const payload: MobileTokenPayload = {
    uid: userId,
    typ: type,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + (type === "access" ? ACCESS_TTL_SECONDS : REFRESH_TTL_SECONDS),
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signPayload(payloadBase64, getMobileSecret());
  return `${payloadBase64}.${signature}`;
}

export function verifyMobileToken(token: string, expectedType: MobileTokenType) {
  if (!token) {
    return null;
  }

  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) {
    return null;
  }

  const secret = readMobileSecret();
  if (!secret) {
    return null;
  }

  const expectedSignature = signPayload(payloadBase64, secret);
  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!isMobileTokenPayload(parsed) || parsed.typ !== expectedType) {
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

export function isMobileTokenSecretConfigured() {
  return Boolean(readMobileSecret());
}

function getMobileSecret() {
  const secret = readMobileSecret();
  if (!secret) {
    throw new Error(`SESSION_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long for mobile tokens.`);
  }
  return secret;
}

function readMobileSecret() {
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

function isMobileTokenPayload(value: unknown): value is MobileTokenPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MobileTokenPayload>;
  return (
    typeof candidate.uid === "string" &&
    candidate.uid.length > 0 &&
    (candidate.typ === "access" || candidate.typ === "refresh") &&
    typeof candidate.iat === "number" &&
    Number.isFinite(candidate.iat) &&
    typeof candidate.exp === "number" &&
    Number.isFinite(candidate.exp)
  );
}
