/**
 * Edge-runtime session token verifier/re-issuer.
 *
 * The Next.js middleware runs in the Edge runtime where `node:crypto` is not
 * available, so this module reimplements the HMAC-SHA256 sign/verify of
 * `session-token.ts` using Web Crypto. The wire format (base64url payload +
 * "." + base64url signature) is identical, so tokens are fully interchangeable
 * between the Node helpers and this one.
 */

import { MIN_SECRET_LENGTH } from "@/lib/auth/session-constants";

export interface EdgeSessionPayload {
  uid: string;
  tv: number;
  iat: number;
  abs: number;
  exp: number;
}

export function readSessionSecretEdge(): string | null {
  const secret = process.env.SESSION_SECRET ?? "";
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

/** Verify signature + structure. Does NOT enforce expiry — the caller decides. */
export async function verifySessionTokenEdge(
  token: string,
  secret: string | null = readSessionSecretEdge()
): Promise<EdgeSessionPayload | null> {
  if (!token || !secret) {
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

  const key = await importKey(secret);
  const expected = await signToBase64Url(key, payloadBase64);
  if (!safeEqual(signature, expected)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlToString(payloadBase64));
  } catch {
    return null;
  }
  return isEdgePayload(parsed) ? parsed : null;
}

/** Re-sign a token with a new effective expiry, preserving everything else. */
export async function reissueSessionTokenEdge(
  payload: EdgeSessionPayload,
  newExp: number,
  secret: string | null = readSessionSecretEdge()
): Promise<string | null> {
  if (!secret) {
    return null;
  }
  const payloadBase64 = stringToBase64Url(JSON.stringify({ ...payload, exp: newExp }));
  const key = await importKey(secret);
  const signature = await signToBase64Url(key, payloadBase64);
  return `${payloadBase64}.${signature}`;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function signToBase64Url(key: CryptoKey, data: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToBase64Url(new Uint8Array(sig));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Length-aware constant-time string comparison. */
function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < left.length; i += 1) {
    result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return result === 0;
}

function isEdgePayload(value: unknown): value is EdgeSessionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<EdgeSessionPayload>;
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
