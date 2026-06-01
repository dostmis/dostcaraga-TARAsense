import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging, type Message } from "firebase-admin/messaging";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const FCM_BATCH_SIZE = 500;
const STALE_TOKEN_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

let cachedApp: App | null = null;
let initFailed = false;

function getFirebaseApp(): App | null {
  if (cachedApp) return cachedApp;
  if (initFailed) return null;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    initFailed = true;
    console.warn("[push] FIREBASE_SERVICE_ACCOUNT_JSON not set; push notifications disabled.");
    return null;
  }

  try {
    const credential = JSON.parse(raw);
    const existing = getApps()[0];
    cachedApp = existing ?? initializeApp({ credential: cert(credential) });
    return cachedApp;
  } catch (error) {
    initFailed = true;
    console.error("[push] Failed to initialize Firebase Admin:", error);
    return null;
  }
}

export function isPushConfigured() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) && !initFailed;
}

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return { sent: 0, removed: 0 };

  const app = getFirebaseApp();
  if (!app) return { sent: 0, removed: 0 };

  const tokens = await prisma.deviceToken
    .findMany({
      where: { userId: { in: uniqueUserIds } },
      select: { token: true },
    })
    .catch((error) => {
      if (isMissingDeviceTokenTableError(error)) {
        console.warn("[push] DeviceToken table is not available; skipping push notification delivery.");
        return [];
      }
      throw error;
    });

  if (tokens.length === 0) return { sent: 0, removed: 0 };

  return sendPushToTokens(
    tokens.map((row) => row.token),
    payload,
  );
}

export async function sendPushToTokens(tokens: string[], payload: PushPayload) {
  const uniqueTokens = Array.from(new Set(tokens.filter(Boolean)));
  if (uniqueTokens.length === 0) return { sent: 0, removed: 0 };

  const app = getFirebaseApp();
  if (!app) return { sent: 0, removed: 0 };

  const messaging = getMessaging(app);
  const dataPayload = sanitizeDataPayload(payload.data);
  let sent = 0;
  const staleTokens: string[] = [];

  for (let offset = 0; offset < uniqueTokens.length; offset += FCM_BATCH_SIZE) {
    const batch = uniqueTokens.slice(offset, offset + FCM_BATCH_SIZE);
    const messages: Message[] = batch.map((token) => ({
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: dataPayload,
    }));

    try {
      const response = await messaging.sendEach(messages);
      response.responses.forEach((result, index) => {
        if (result.success) {
          sent += 1;
          return;
        }
        const code = result.error?.code ?? "";
        if (STALE_TOKEN_ERROR_CODES.has(code)) {
          staleTokens.push(batch[index]);
        } else {
          console.error("[push] FCM send error:", { code, message: result.error?.message });
        }
      });
    } catch (error) {
      console.error("[push] FCM batch send failed:", error);
    }
  }

  let removed = 0;
  if (staleTokens.length > 0) {
    const result = await prisma.deviceToken
      .deleteMany({ where: { token: { in: staleTokens } } })
      .catch((error) => {
        console.error("[push] Failed to delete stale tokens:", error);
        return { count: 0 };
      });
    removed = result.count;
  }

  return { sent, removed };
}

export async function cleanupStaleDeviceTokens(olderThanDays = 60) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  return prisma.deviceToken
    .deleteMany({
      where: { updatedAt: { lt: cutoff } },
    })
    .catch((error) => {
      if (isMissingDeviceTokenTableError(error)) {
        console.warn("[push] DeviceToken table is not available; skipping stale token cleanup.");
        return { count: 0 };
      }
      throw error;
    });
}

function isMissingDeviceTokenTableError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021" &&
    String(error.meta?.table ?? "").includes("DeviceToken")
  );
}

function sanitizeDataPayload(data: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!data) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : String(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
