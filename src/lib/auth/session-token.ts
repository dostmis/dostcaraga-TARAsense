import { createHmac, timingSafeEqual } from "crypto";

const SESSION_TOKEN_VERSION = 1;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

type SessionTokenPayload = {
  v: number;
  uid: string;
  iat: number;
  exp: number;
};

function getSessionSecret() {
  const secret =
    process.env.SESSION_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    process.env.ADMIN_PASSWORD ??
    "local-dev-session-secret-change-me";

  return secret;
}

function toBase64Url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function createSignature(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function safeJsonParse(raw: string): SessionTokenPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SessionTokenPayload>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v !== SESSION_TOKEN_VERSION) return null;
    if (typeof parsed.uid !== "string" || parsed.uid.length < 3) return null;
    if (typeof parsed.iat !== "number" || typeof parsed.exp !== "number") return null;
    return {
      v: parsed.v,
      uid: parsed.uid,
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function createSessionToken(userId: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionTokenPayload = {
    v: SESSION_TOKEN_VERSION,
    uid: userId,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };

  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = createSignature(encoded);
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token: string): { userId: string } | null {
  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = createSignature(encodedPayload);
  const provided = Buffer.from(providedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  const payload = safeJsonParse(fromBase64Url(encodedPayload));
  if (!payload) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return null;
  }

  return { userId: payload.uid };
}
