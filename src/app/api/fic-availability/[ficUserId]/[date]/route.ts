import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { isValidDateKey } from "@/lib/date-time";

type RouteContext = {
  params: Promise<{ ficUserId: string; date: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await getCurrentSession();
    if (!session || (session.role !== "ADMIN" && session.role !== "FIC")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ficUserId, date } = await context.params;
    if (session.role !== "ADMIN" && session.userId !== ficUserId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!isValidDateKey(date)) {
      return NextResponse.json({ error: "Invalid date format. Expected YYYY-MM-DD" }, { status: 400 });
    }

    const payload = (await request.json()) as { isAvailable?: boolean };
    if (typeof payload?.isAvailable !== "boolean") {
      return NextResponse.json({ error: "isAvailable boolean is required" }, { status: 400 });
    }

    const existing = await prisma.ficAvailability.findUnique({
      where: { ficUserId_date: { ficUserId, date } },
      select: { isLocked: true },
    });
    if (existing?.isLocked) {
      return NextResponse.json({ error: "Cannot modify locked date (already booked by study)" }, { status: 409 });
    }

    const availability = await prisma.ficAvailability.upsert({
      where: { ficUserId_date: { ficUserId, date } },
      update: { isAvailable: payload.isAvailable },
      create: { ficUserId, date, isAvailable: payload.isAvailable },
    });

    return NextResponse.json(availability);
  } catch (error) {
    console.error("Failed to set FIC availability:", error);
    return NextResponse.json({ error: "Failed to set availability" }, { status: 500 });
  }
}
