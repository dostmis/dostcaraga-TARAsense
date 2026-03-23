import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { markAllNotificationsRead } from "@/app/actions/notification-actions";
import { prisma } from "@/lib/db";

type NotificationPanelProps = {
  userId: string;
  redirectTo: string;
};

export async function NotificationPanel({ userId, redirectTo }: NotificationPanelProps) {
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.notification.count({
      where: { userId, isRead: false },
    }),
  ]);

  return (
    <section className="bg-white border rounded-2xl p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#fff0de] text-[#9a5822]">
            <Bell size={18} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-[#2f241d]">System Messages</h2>
            <p className="text-xs text-[#8d735f]">{unreadCount} unread notifications</p>
          </div>
        </div>
        <form action={markAllNotificationsRead}>
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-[#d9ccbf] px-3 py-1.5 text-xs font-medium text-[#5a4536] hover:bg-[#fff8ef] sm:w-auto"
          >
            <CheckCheck size={14} />
            Mark all read
          </button>
        </form>
      </div>

      <div className="mt-4 space-y-2">
        {notifications.length === 0 && (
          <p className="rounded-xl border border-dashed p-4 text-sm text-gray-500">
            No notifications yet. Actions you take will appear here.
          </p>
        )}
        {notifications.map((notification) => (
          <article
            key={notification.id}
            className={`rounded-xl border p-3 ${
              notification.isRead ? "border-[#e7ddd4] bg-white" : "border-[#ebd5bf] bg-[#fff7eb]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[#2f241d]">{notification.title}</p>
                <p className="mt-1 text-xs text-[#6f5b4f]">{notification.message}</p>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-[#8d735f]">{notification.category}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11px] text-[#8d735f]">{formatTimeAgo(notification.createdAt)}</p>
              {notification.actionUrl && (
                <Link href={notification.actionUrl} className="text-xs font-medium text-[#9a5822] hover:text-[#874715]">
                  View
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatTimeAgo(value: Date) {
  const elapsed = Date.now() - value.getTime();
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
