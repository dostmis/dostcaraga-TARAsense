import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyUser } from "@/lib/notifications";
import { formatPanelistNumber } from "@/lib/participant-assignment";

const DEFAULT_TIMEZONE = "Asia/Manila";
const REMINDER_HOUR = 8;

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error("CRON_SECRET is missing. Refusing to run reminder job.");
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 503 });
    }

    const incoming = request.headers.get("x-cron-secret");
    if (incoming !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const timezone = process.env.REMINDER_TIMEZONE || DEFAULT_TIMEZONE;
    const now = new Date();
    const currentHour = getTzHour(now, timezone);
    if (currentHour < REMINDER_HOUR) {
      return NextResponse.json({
        sent: 0,
        skipped: true,
        reason: `Current hour in ${timezone} is ${currentHour}. Reminders run at or after ${REMINDER_HOUR}:00.`,
      });
    }

    const todayKey = getTzDateKey(now, timezone);
    const participants = await prisma.studyParticipant.findMany({
      where: {
        sessionAt: { not: null },
        reminderSentAt: null,
        status: { in: ["SELECTED", "CONFIRMED"] },
        consentStatus: { not: "DECLINED" },
      },
      select: {
        id: true,
        studyId: true,
        panelistNumber: true,
        randomizeCode: true,
        sessionAt: true,
        panelist: {
          select: {
            userId: true,
          },
        },
        study: {
          select: {
            title: true,
          },
        },
      },
    });

    const dueRows = participants.filter((row) => {
      if (!row.sessionAt || !row.panelist.userId) {
        return false;
      }
      return getTzDateKey(new Date(row.sessionAt), timezone) === todayKey;
    });

    for (const row of dueRows) {
      if (!row.panelist.userId) {
        continue;
      }

      await notifyUser(row.panelist.userId, {
        title: "Sensory session reminder",
        message: `Reminder: your sensory session for "${row.study.title}" is scheduled today. Panelist No: ${formatPanelistNumber(row.panelistNumber)}.`,
        level: "INFO",
        category: "SURVEY",
        actionUrl: `/studies/${row.studyId}/start`,
        metadata: {
          studyId: row.studyId,
          participationId: row.id,
          panelistNumber: row.panelistNumber,
          randomizeCode: row.randomizeCode,
          sessionAt: row.sessionAt?.toISOString() ?? null,
          reminderRunAt: now.toISOString(),
          timezone,
        },
      });

      await prisma.studyParticipant.update({
        where: { id: row.id },
        data: {
          reminderSentAt: now,
        },
      });
    }

    return NextResponse.json({
      sent: dueRows.length,
      timezone,
      date: todayKey,
      reminderHour: REMINDER_HOUR,
    });
  } catch (error) {
    console.error("Failed to send session reminders:", error);
    return NextResponse.json({ error: "Failed to send reminders" }, { status: 500 });
  }
}

function getTzDateKey(date: Date, timeZone: string) {
  // Using Intl.DateTimeFormat for consistent cross-platform timezone handling
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function getTzHour(date: Date, timeZone: string) {
  // Using Intl.DateTimeFormat for consistent cross-platform timezone handling
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number(formatted);
}
