"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";

export async function markAllNotificationsRead(formData: FormData) {
  const session = await getCurrentSession();
  if (!session) {
    return;
  }

  await prisma.notification.updateMany({
    where: {
      userId: session.userId,
      isRead: false,
    },
    data: {
      isRead: true,
    },
  });

  const redirectTo = String(formData.get("redirectTo") ?? "").trim();
  if (redirectTo) {
    revalidatePath(redirectTo);
  }
}
