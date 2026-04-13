import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";

type RouteContext = {
  params: Promise<{ ficUserId: string }>;
};

function isValidDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getDefaultMonthRange() {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const startDate = startOfMonth.toISOString().split("T")[0];
  const endDate = endOfMonth.toISOString().split("T")[0];
  return { startDate, endDate };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await getCurrentSession();
    if (!session || (session.role !== "ADMIN" && session.role !== "FIC")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ficUserId } = await context.params;
    if (session.role !== "ADMIN" && session.userId !== ficUserId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const requestedStartDate = (url.searchParams.get("startDate") ?? "").trim();
    const requestedEndDate = (url.searchParams.get("endDate") ?? "").trim();
    const defaultRange = getDefaultMonthRange();
    const startDate = requestedStartDate || defaultRange.startDate;
    const endDate = requestedEndDate || defaultRange.endDate;

    if (!isValidDateValue(startDate) || !isValidDateValue(endDate)) {
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
