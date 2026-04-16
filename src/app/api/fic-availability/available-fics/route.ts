import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { getDateKeysBetween, isValidDateKey } from "@/lib/date-time";
import { getRegionForFacility, isFacilityInRegion, isValidRegion } from "@/lib/facility-constants";

const MAX_DATE_RANGE_DAYS = 120;

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session || (session.role !== "ADMIN" && session.role !== "MSME")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const startDate = (url.searchParams.get("startDate") ?? "").trim();
    const endDate = (url.searchParams.get("endDate") ?? "").trim();
    const region = (url.searchParams.get("region") ?? "").trim();
    const facility = (url.searchParams.get("facility") ?? "").trim();
    const includeOverview = (url.searchParams.get("includeOverview") ?? "").trim() === "1";

    if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
      return NextResponse.json({ error: "startDate and endDate must be YYYY-MM-DD" }, { status: 400 });
    }

    const dateKeys = getDateKeysBetween(startDate, endDate);
    if (dateKeys.length === 0) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }
    if (dateKeys.length > MAX_DATE_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Date range is too large. Maximum supported range is ${MAX_DATE_RANGE_DAYS} days.` },
        { status: 400 }
      );
    }

    let resolvedRegion = region;
    if (facility && !resolvedRegion) {
      resolvedRegion = getRegionForFacility(facility) ?? "";
      if (!resolvedRegion) {
        return NextResponse.json({ error: "Facility is not recognized." }, { status: 400 });
      }
    }

    if (resolvedRegion && !isValidRegion(resolvedRegion)) {
      return NextResponse.json({ error: "Region is not recognized." }, { status: 400 });
    }

    if (resolvedRegion && facility && !isFacilityInRegion(resolvedRegion, facility)) {
      return NextResponse.json({ error: "Facility does not belong to the selected region." }, { status: 400 });
    }

    const fics = await prisma.user.findMany({
      where: {
        role: { in: ["FIC", "FIC_MANAGER"] },
        assignedRegion: { not: null },
        assignedFacility: { not: null },
        ...(resolvedRegion ? { assignedRegion: resolvedRegion } : {}),
        ...(facility ? { assignedFacility: facility } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        organization: true,
        assignedRegion: true,
        assignedFacility: true,
      },
    });

    if (fics.length === 0) {
      if (includeOverview) {
        return NextResponse.json({
          startDate,
          endDate,
          region: resolvedRegion || null,
          facility: facility || null,
          totalAssignedFicCount: 0,
          assignedFics: [],
          availableFics: [],
          availabilityByDate: dateKeys.map((dateKey) => ({
            date: dateKey,
            availableFicCount: 0,
            totalAssignedFicCount: 0,
          })),
          ficAvailabilityByUser: [],
        });
      }
      return NextResponse.json([]);
    }

    const availabilityRows = await prisma.ficAvailability.findMany({
      where: {
        ficUserId: { in: fics.map((fic) => fic.id) },
        date: { gte: startDate, lte: endDate },
        isAvailable: true,
        isLocked: false,
      },
      orderBy: [{ ficUserId: "asc" }, { date: "asc" }],
      select: { ficUserId: true, date: true },
    });

    const availableDatesByFicId = availabilityRows.reduce<Map<string, string[]>>((accumulator, row) => {
      const current = accumulator.get(row.ficUserId);
      if (current) {
        current.push(row.date);
      } else {
        accumulator.set(row.ficUserId, [row.date]);
      }
      return accumulator;
    }, new Map());

    const totalDays = dateKeys.length;
    const availableFics = fics.map((fic) => {
      const availableDates = availableDatesByFicId.get(fic.id) ?? [];
      const availabilityPercentage = Math.round((availableDates.length / totalDays) * 100);

      return {
        ...fic,
        availableDates,
        availabilityPercentage,
      };
    });

    if (includeOverview) {
      const availableFicCountByDate = dateKeys.reduce<Map<string, number>>((accumulator, dateKey) => {
        accumulator.set(dateKey, 0);
        return accumulator;
      }, new Map());

      for (const row of availabilityRows) {
        const current = availableFicCountByDate.get(row.date) ?? 0;
        availableFicCountByDate.set(row.date, current + 1);
      }

      return NextResponse.json({
        startDate,
        endDate,
        region: resolvedRegion || null,
        facility: facility || null,
        totalAssignedFicCount: fics.length,
        assignedFics: availableFics.map((fic) => ({
          id: fic.id,
          name: fic.name,
          email: fic.email,
          organization: fic.organization,
          assignedRegion: fic.assignedRegion,
          assignedFacility: fic.assignedFacility,
          availableDateCount: fic.availableDates.length,
          availabilityPercentage: fic.availabilityPercentage,
        })),
        availableFics: availableFics.filter((fic) => fic.availableDates.length > 0),
        availabilityByDate: dateKeys.map((dateKey) => ({
          date: dateKey,
          availableFicCount: availableFicCountByDate.get(dateKey) ?? 0,
          totalAssignedFicCount: fics.length,
        })),
        ficAvailabilityByUser: availableFics.map((fic) => ({
          ficUserId: fic.id,
          availableDates: fic.availableDates,
        })),
      });
    }

    return NextResponse.json(availableFics.filter((fic) => fic.availableDates.length > 0));
  } catch (error) {
    console.error("Failed to fetch available FICs:", error);
    return NextResponse.json({ error: "Failed to fetch available FICs" }, { status: 500 });
  }
}
