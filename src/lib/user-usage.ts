import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";

type ActorSnapshot = {
  name?: string | null;
  email?: string | null;
  role?: UserRole | null;
};

type UserUsageInput = {
  actorUserId?: string | null;
  actor?: ActorSnapshot;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const MAX_ACTION_LENGTH = 80;
const MAX_ENTITY_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 320;
const MAX_METADATA_STRING_LENGTH = 500;
const REDACTED_KEYS = new Set([
  "password",
  "token",
  "refreshToken",
  "accessToken",
  "session",
  "cookie",
  "authorization",
  "apiKey",
  "secret",
]);

export async function logUserUsage(input: UserUsageInput) {
  try {
    const actor = input.actor ?? (input.actorUserId ? await readActorSnapshot(input.actorUserId) : null);

    await prisma.userUsageLog.create({
      data: {
        actorUserId: input.actorUserId || null,
        actorName: trimOrNull(actor?.name, 120),
        actorEmail: trimOrNull(actor?.email, 180),
        actorRole: actor?.role ?? null,
        action: trimRequired(input.action, MAX_ACTION_LENGTH, "UNKNOWN_ACTION"),
        entityType: trimOrNull(input.entityType, MAX_ENTITY_LENGTH),
        entityId: trimOrNull(input.entityId, MAX_ENTITY_LENGTH),
        summary: trimRequired(input.summary, MAX_SUMMARY_LENGTH, "User action recorded."),
        metadata: sanitizeMetadata(input.metadata),
        ipAddress: trimOrNull(input.ipAddress, 80),
        userAgent: trimOrNull(input.userAgent, 260),
      },
    });
  } catch (error) {
    console.error("Failed to write user usage log:", error);
  }
}

async function readActorSnapshot(userId: string): Promise<ActorSnapshot | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, role: true },
  });
}

function sanitizeMetadata(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  return sanitizeJsonValue(value, 0) as Prisma.InputJsonValue;
}

function sanitizeJsonValue(value: unknown, depth: number): unknown {
  if (depth > 4) return "[Max depth]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, MAX_METADATA_STRING_LENGTH);
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitizeJsonValue(entry, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, MAX_METADATA_STRING_LENGTH);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 40)
      .map(([key, entry]) => {
        const normalizedKey = key.toLowerCase();
        const shouldRedact = Array.from(REDACTED_KEYS).some((redacted) => normalizedKey.includes(redacted.toLowerCase()));
        return [key.slice(0, 80), shouldRedact ? "[REDACTED]" : sanitizeJsonValue(entry, depth + 1)];
      })
  );
}

function trimRequired(value: string, maxLength: number, fallback: string) {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, maxLength);
}

function trimOrNull(value: string | null | undefined, maxLength: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
