import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runInBackground } from "@/lib/async-workflow";
import { sendPushToUsers } from "@/lib/push/fcm";

type NotificationInput = {
  title: string;
  message: string;
  level?: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  category?: "AUTH" | "STUDY" | "ROLE" | "SURVEY" | "SYSTEM";
  actionUrl?: string;
  metadata?: Prisma.InputJsonValue;
  /** Set to false to suppress FCM push for this notification. */
  push?: boolean;
};

function buildPushData(input: NotificationInput): Record<string, string> {
  const data: Record<string, string> = {
    category: input.category ?? "SYSTEM",
    level: input.level ?? "INFO",
  };
  if (input.actionUrl) {
    data.actionUrl = input.actionUrl;
  }
  if (input.metadata && typeof input.metadata === "object") {
    for (const [key, value] of Object.entries(input.metadata as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      data[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
  }
  return data;
}

function dispatchPush(userIds: string[], input: NotificationInput) {
  if (process.env.PUSH_NOTIFICATIONS_ENABLED !== "true") return;
  if (input.push === false) return;
  const recipients = Array.from(new Set(userIds.filter(Boolean)));
  if (recipients.length === 0) return;

  runInBackground("notify-push", async () => {
    await sendPushToUsers(recipients, {
      title: input.title,
      body: input.message,
      data: buildPushData(input),
    });
  });
}

export async function notifyUser(userId: string, input: NotificationInput) {
  if (!userId) return;
  try {
    await prisma.notification.create({
      data: {
        userId,
        title: input.title,
        message: input.message,
        level: input.level ?? "INFO",
        category: input.category ?? "SYSTEM",
        actionUrl: input.actionUrl ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch (error) {
    console.error("Failed to create notification for user:", error);
  }

  dispatchPush([userId], input);
}

export async function notifyUsers(userIds: string[], input: NotificationInput) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return;

  try {
    await prisma.notification.createMany({
      data: uniqueUserIds.map((userId) => ({
        userId,
        title: input.title,
        message: input.message,
        level: input.level ?? "INFO",
        category: input.category ?? "SYSTEM",
        actionUrl: input.actionUrl ?? null,
        metadata: input.metadata ?? undefined,
      })),
    });
  } catch (error) {
    console.error("Failed to create bulk notifications:", error);
  }

  dispatchPush(uniqueUserIds, input);
}

export async function notifyRole(role: UserRole, input: NotificationInput) {
  const users = await prisma.user.findMany({
    where: { role },
    select: { id: true },
  });

  await notifyUsers(
    users.map((user) => user.id),
    input
  );
}
