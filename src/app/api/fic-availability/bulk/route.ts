import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { isValidDateKey } from "@/lib/date-time";

type BulkEntry = {
  date: string;
  isAvailable: boolean;
};

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session || (session.role !== "ADMIN" && session.role !== "FIC")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const requestedFicUserId = (url.searchParams.get("ficUserId") ?? "").trim();
    const targetFicUserId = requestedFicUserId || session.userId;
    if (session.role !== "ADMIN" && session.userId !== targetFicUserId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const payload = (await request.json()) as { dates?: BulkEntry[] };
    if (!Array.isArray(payload?.dates) || payload.dates.length === 0) {
      return NextResponse.json({ error: "dates array is required" }, { status: 400 });
    }

    const results: Array<{
      id: string;
      ficUserId: string;
      date: string;
      isAvailable: boolean;
      isLocked: boolean;
      lockedById: string | null;
      lockedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }> = [];
    const errors: Array<{ date: string; error: string }> = [];

    for (const entry of payload.dates) {
      if (!entry || !isValidDateKey(entry.date) || typeof entry.isAvailable !== "boolean") {
        errors.push({
          date: entry?.date ?? "",
          error: "Invalid payload item. date must be YYYY-MM-DD and isAvailable must be boolean",
        });
        continue;
      }

      try {
        const existing = await prisma.ficAvailability.findUnique({
          where: { ficUserId_date: { ficUserId: targetFicUserId, date: entry.date } },
          select: { isLocked: true },
        });

        if (existing?.isLocked) {
          errors.push({ date: entry.date, error: "Cannot modify locked date (already booked by study)" });
          continue;
        }

        const upserted = await prisma.ficAvailability.upsert({
          where: { ficUserId_date: { ficUserId: targetFicUserId, date: entry.date } },
          update: { isAvailable: entry.isAvailable },
          create: { ficUserId: targetFicUserId, date: entry.date, isAvailable: entry.isAvailable },
        });

        results.push(upserted);
      } catch (error) {
        errors.push({
          date: entry.date,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Failed to bulk set FIC availability:", error);
    return NextResponse.json({ error: "Failed to bulk set FIC availability" }, { status: 500 });
  }
}
