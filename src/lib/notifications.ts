import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";

type NotificationInput = {
  title: string;
  message: string;
  level?: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  category?: "AUTH" | "STUDY" | "ROLE" | "SURVEY" | "SYSTEM";
  actionUrl?: string;
  metadata?: Prisma.InputJsonValue;
};

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
