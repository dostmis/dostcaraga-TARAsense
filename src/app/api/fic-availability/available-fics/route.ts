import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";

function isValidDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getDaysBetween(startDate: string, endDate: string): string[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates: string[] = [];

  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
  }

  return dates;
}

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session || (session.role !== "ADMIN" && session.role !== "MSME")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const startDate = (url.searchParams.get("startDate") ?? "").trim();
    const endDate = (url.searchParams.get("endDate") ?? "").trim();
    const facility = (url.searchParams.get("facility") ?? "").trim();

    if (!isValidDateValue(startDate) || !isValidDateValue(endDate)) {
      return NextResponse.json({ error: "startDate and endDate must be YYYY-MM-DD" }, { status: 400 });
    }

    const fics = await prisma.user.findMany({
      where: {
        role: { in: ["FIC", "FIC_MANAGER"] },
        ...(facility ? { organization: facility } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        organization: true,
      },
    });

    const totalDays = getDaysBetween(startDate, endDate).length || 1;
    const availableFics = await Promise.all(
      fics.map(async (fic) => {
        const availability = await prisma.ficAvailability.findMany({
          where: {
            ficUserId: fic.id,
            date: { gte: startDate, lte: endDate },
            isAvailable: true,
            isLocked: false,
          },
          orderBy: { date: "asc" },
          select: { date: true },
        });

        const availableDates = availability.map((entry) => entry.date);
        const availabilityPercentage = Math.round((availableDates.length / totalDays) * 100);

        return {
          ...fic,
          availableDates,
          availabilityPercentage,
        };
      })
    );

    return NextResponse.json(availableFics.filter((fic) => fic.availableDates.length > 0));
  } catch (error) {
    console.error("Failed to fetch available FICs:", error);
    return NextResponse.json({ error: "Failed to fetch available FICs" }, { status: 500 });
  }
}
