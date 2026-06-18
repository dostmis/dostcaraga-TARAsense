import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { MIN_SECRET_LENGTH } from "@/lib/auth/session-constants";

/**
 * Email one-time-password (OTP) second factor for privileged (ADMIN) sign-in.
 *
 * Flow: after a correct password, an OTP is emailed and a short-lived signed
 * "MFA-pending" cookie is set referencing a single-use AdminMfaChallenge row.
 * The plaintext code is never persisted — only a salted scrypt hash (reusing
 * password.ts). The session is established only after the code is verified.
 */

export const MFA_CODE_LENGTH = 6;
export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MFA_MAX_ATTEMPTS = 5;
/** Minimum spacing between OTP (re)issues for a user, to throttle email spam. */
export const MFA_RESEND_COOLDOWN_MS = 30 * 1000;

export const MFA_PENDING_COOKIE_KEY = "tara_mfa_pending";
const MFA_PENDING_PURPOSE = "admin-mfa";
const MFA_PENDING_TTL_SECONDS = 10 * 60; // 10 minutes — must outlive the challenge

export interface IssuedMfaChallenge {
  challengeId: string;
  /** Plaintext code — returned once to email; never stored or logged. */
  code: string;
  expiresAt: Date;
}

/** Cryptographically strong, fixed-length numeric OTP. */
export function generateOtpCode(): string {
  const max = 10 ** MFA_CODE_LENGTH;
  return String(randomInt(0, max)).padStart(MFA_CODE_LENGTH, "0");
}

/**
 * Create a fresh challenge for a user, invalidating any earlier unconsumed
 * ones so only the most recent emailed code is valid.
 */
export async function createMfaChallenge(input: {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<IssuedMfaChallenge> {
  const code = generateOtpCode();
  const codeHash = hashPassword(code);
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);

  const challenge = await prisma.$transaction(async (tx) => {
    await tx.adminMfaChallenge.deleteMany({
      where: { userId: input.userId, consumedAt: null },
    });
    return tx.adminMfaChallenge.create({
      data: {
        userId: input.userId,
        codeHash,
        expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      select: { id: true },
    });
  });

  return { challengeId: challenge.id, code, expiresAt };
}

/** When the user last received an OTP, for resend cooldown enforcement. */
export async function getLastChallengeIssuedAt(userId: string): Promise<Date | null> {
  const last = await prisma.adminMfaChallenge.findFirst({
    where: { userId, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return last?.createdAt ?? null;
}

export type MfaVerifyResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "expired" | "too-many-attempts" | "invalid-code" };

/**
 * Verify a submitted OTP against a challenge. Single-use and rate-limited by
 * attempt count. The attempt counter is incremented before the comparison so a
 * brute-force run still burns attempts even on mismatches.
 */
export async function verifyMfaChallenge(input: {
  challengeId: string;
  userId: string;
  code: string;
}): Promise<MfaVerifyResult> {
  const challenge = await prisma.adminMfaChallenge.findUnique({
    where: { id: input.challengeId },
    select: {
      id: true,
      userId: true,
      codeHash: true,
      expiresAt: true,
      attempts: true,
      consumedAt: true,
    },
  });

  if (!challenge || challenge.userId !== input.userId || challenge.consumedAt) {
    return { ok: false, reason: "not-found" };
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (challenge.attempts >= MFA_MAX_ATTEMPTS) {
    return { ok: false, reason: "too-many-attempts" };
  }

  await prisma.adminMfaChallenge.update({
    where: { id: challenge.id },
    data: { attempts: { increment: 1 } },
  });

  const code = input.code.replace(/\D/g, "");
  if (code.length !== MFA_CODE_LENGTH || !verifyPassword(code, challenge.codeHash)) {
    const stillAllowed = challenge.attempts + 1 < MFA_MAX_ATTEMPTS;
    return { ok: false, reason: stillAllowed ? "invalid-code" : "too-many-attempts" };
  }

  await prisma.adminMfaChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });
  return { ok: true };
}

// ── MFA-pending cookie token (signed, short-lived) ──────────────────────────

type MfaPendingPayload = {
  cid: string;
  uid: string;
  purpose: typeof MFA_PENDING_PURPOSE;
  iat: number;
  exp: number;
};

export function createMfaPendingToken(input: { challengeId: string; userId: string }, now = new Date()): string {
  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const payload: MfaPendingPayload = {
    cid: input.challengeId,
    uid: input.userId,
    purpose: MFA_PENDING_PURPOSE,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + MFA_PENDING_TTL_SECONDS,
  };
  const payloadBase64 = base64UrlEncode(JSON.stringify(payload));
  return `${payloadBase64}.${signPayload(payloadBase64, getSecret())}`;
}

export function verifyMfaPendingToken(token: string): { challengeId: string; userId: string } | null {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payloadBase64, signature] = parts;
  const secret = readSecret();
  if (!payloadBase64 || !signature || !secret) {
    return null;
  }
  if (!safeCompare(signature, signPayload(payloadBase64, secret))) {
    return null;
  }
  const json = base64UrlDecode(payloadBase64);
  if (!json) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isMfaPendingPayload(parsed) || parsed.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  return { challengeId: parsed.cid, userId: parsed.uid };
}

function getSecret() {
  const secret = readSecret();
  if (!secret) {
    throw new Error(
      `SESSION_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long for MFA tokens.`
    );
  }
  return secret;
}

function readSecret() {
  const secret = process.env.SESSION_SECRET ?? "";
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

function signPayload(payloadBase64: string, secret: string) {
  // Namespace with the purpose so an MFA-pending token can never be replayed as
  // a session or confirmation token.
  return createHmac("sha256", secret).update(`${MFA_PENDING_PURPOSE}:${payloadBase64}`).digest("base64url");
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

function isMfaPendingPayload(value: unknown): value is MfaPendingPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<MfaPendingPayload>;
  return (
    candidate.purpose === MFA_PENDING_PURPOSE &&
    typeof candidate.cid === "string" &&
    candidate.cid.length > 0 &&
    typeof candidate.uid === "string" &&
    candidate.uid.length > 0 &&
    typeof candidate.iat === "number" &&
    Number.isFinite(candidate.iat) &&
    typeof candidate.exp === "number" &&
    Number.isFinite(candidate.exp)
  );
}
