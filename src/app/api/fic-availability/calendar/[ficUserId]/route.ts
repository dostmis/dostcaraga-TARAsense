import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { formatLocalDateKey, isValidDateKey } from "@/lib/date-time";

type RouteContext = {
  params: Promise<{ ficUserId: string }>;
};

function getDefaultMonthRange() {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const startDate = formatLocalDateKey(startOfMonth);
  const endDate = formatLocalDateKey(endOfMonth);
  return { startDate, endDate };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await getCurrentSession();
    if (!session || (session.role !== "ADMIN" && session.role !== "FIC" && session.role !== "MSME")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ficUserId } = await context.params;
    if (session.role === "FIC" && session.userId !== ficUserId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const requestedStartDate = (url.searchParams.get("startDate") ?? "").trim();
    const requestedEndDate = (url.searchParams.get("endDate") ?? "").trim();
    const defaultRange = getDefaultMonthRange();
    const startDate = requestedStartDate || defaultRange.startDate;
    const endDate = requestedEndDate || defaultRange.endDate;

    if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
      return NextResponse.json({ error: "startDate and endDate must be YYYY-MM-DD" }, { status: 400 });
    }

    const availabilities = await prisma.ficAvailability.findMany({
      where: {
        ficUserId,
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: "asc" },
    });

    return NextResponse.json(availabilities);
  } catch (error) {
    console.error("Failed to fetch FIC calendar:", error);
    return NextResponse.json({ error: "Failed to fetch FIC calendar" }, { status: 500 });
  }
}
