import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateKeyInTimeZone, getDateKeysBetween, isValidDateKey } from "@/lib/date-time";
import { formatPanelistNumber } from "@/lib/participant-assignment";
import type { MobileUser } from "@/lib/mobile/api";

const FIC_TIMEZONE = "Asia/Manila";
const MAX_DATE_RANGE_DAYS = 120;
const MAX_BULK_DATES = 120;

type AvailabilityEntry = {
  date: string;
  isAvailable: boolean;
};

export async function getFicDashboardData(user: MobileUser, query?: string) {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  const now = new Date();
  const studyWhere = buildFicStudyWhere(user);

  const [studies, uploadedStudyCount, ficStudyCount, activeStudyCount, totalResponseCount, upcomingSessionCount, pendingSessionCount] =
    await Promise.all([
      prisma.study.findMany({
        where: studyWhere,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          productName: true,
          category: true,
          stage: true,
          description: true,
          location: true,
          status: true,
          sampleSize: true,
          createdAt: true,
          updatedAt: true,
          creator: { select: { id: true, name: true, organization: true } },
          _count: { select: { responses: true, participants: true } },
        },
        take: 50,
      }),
      prisma.study.count(),
      prisma.study.count({ where: studyWhere }),
      prisma.study.count({
        where: {
          ...studyWhere,
          status: { in: ["ACTIVE", "RECRUITING"] },
        },
      }),
      prisma.sensoryResponse.count({
        where: {
          study: studyWhere,
        },
      }),
      prisma.studyParticipant.count({
        where: {
          status: { in: ["WAITLIST", "SELECTED", "CONFIRMED"] },
          study: studyWhere,
          OR: [{ sessionAt: { gte: now } }, { requestedSessionAt: { gte: now } }],
        },
      }),
      prisma.studyParticipant.count({
        where: {
          status: { in: ["WAITLIST", "SELECTED", "CONFIRMED"] },
          sessionAt: null,
          requestedSessionAt: { gte: now },
          study: studyWhere,
        },
      }),
    ]);

  const filteredStudies = filterStudies(studies, normalizedQuery);

  return {
    timezone: FIC_TIMEZONE,
    assignment: getAssignment(user),
    stats: {
      bookingNotifications: ficStudyCount,
      upcomingSessions: upcomingSessionCount,
      pendingConfirmation: pendingSessionCount,
      uploadedStudies: uploadedStudyCount,
      activeStudies: activeStudyCount,
      totalResponses: totalResponseCount,
    },
    studies: filteredStudies.map(serializeStudy),
    meta: {
      query: normalizedQuery,
      count: filteredStudies.length,
      assignedFacilityRequired: user.role === "FIC" && !user.assignedFacility,
    },
  };
}

export async function getFicStudies(user: MobileUser, query?: string, limit = 50) {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  const studies = await prisma.study.findMany({
    where: buildFicStudyWhere(user),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      productName: true,
      category: true,
      stage: true,
      description: true,
      location: true,
      status: true,
      sampleSize: true,
      createdAt: true,
      updatedAt: true,
      creator: { select: { id: true, name: true, organization: true } },
      _count: { select: { responses: true, participants: true } },
    },
    take: Math.max(boundedLimit * 2, boundedLimit),
  });

  const filteredStudies = filterStudies(studies, normalizedQuery).slice(0, boundedLimit);
  return {
    studies: filteredStudies.map(serializeStudy),
    meta: {
      query: normalizedQuery,
      limit: boundedLimit,
      count: filteredStudies.length,
      assignment: getAssignment(user),
    },
  };
}

export async function getFicBookedSessions(user: MobileUser, query?: string, limit = 100) {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 300));
  const todayKey = formatDateKeyInTimeZone(new Date(), FIC_TIMEZONE);

  const rows = await prisma.studyParticipant.findMany({
    where: {
      OR: [{ sessionAt: { not: null } }, { requestedSessionAt: { not: null } }],
      status: { in: ["WAITLIST", "SELECTED", "CONFIRMED"] },
      study: buildFicStudyWhere(user),
    },
    select: {
      id: true,
      panelistNumber: true,
      status: true,
      sessionAt: true,
      requestedSessionAt: true,
      study: {
        select: {
          id: true,
          title: true,
          productName: true,
          location: true,
          creator: {
            select: {
              id: true,
              name: true,
              organization: true,
            },
          },
        },
      },
      panelist: {
        select: {
          name: true,
        },
      },
    },
    take: boundedLimit,
  });

  const sessions = rows
    .map((row) => {
      const scheduledAt = row.sessionAt ?? row.requestedSessionAt;
      if (!scheduledAt) {
        return null;
      }

      return {
        id: row.id,
        studyId: row.study.id,
        studyTitle: row.study.title,
        productName: row.study.productName,
        location: row.study.location,
        panelistName: row.panelist.name,
        panelistNumber: formatPanelistNumber(row.panelistNumber),
        participantStatus: row.status,
        sessionState: row.sessionAt ? "CONFIRMED" : "PENDING_CONFIRMATION",
        scheduledAt: scheduledAt.toISOString(),
        dateKey: formatDateKeyInTimeZone(scheduledAt, FIC_TIMEZONE),
        msme: {
          id: row.study.creator.id,
          name: row.study.creator.name,
          organization: row.study.creator.organization,
        },
        links: {
          form: `/studies/${row.study.id}/form`,
          dashboard: `/dashboard/${row.study.id}`,
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter((row) => row.dateKey >= todayKey)
    .filter((row) => {
      if (!normalizedQuery) {
        return true;
      }

      return [
        row.studyTitle,
        row.productName,
        row.location,
        row.panelistName,
        row.panelistNumber,
        row.participantStatus,
        row.msme.name,
        row.msme.organization ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));

  return {
    timezone: FIC_TIMEZONE,
    sessions,
    meta: {
      query: normalizedQuery,
      limit: boundedLimit,
      count: sessions.length,
      assignment: getAssignment(user),
    },
  };
}

export async function getFicAvailability(user: MobileUser, startDate: string, endDate: string) {
  const validation = validateDateRange(startDate, endDate);
  if (!validation.ok) {
    return validation;
  }

  const rows = await prisma.ficAvailability.findMany({
    where: {
      ficUserId: user.id,
      date: { gte: startDate, lte: endDate },
    },
    orderBy: { date: "asc" },
  });

  return {
    ok: true as const,
    timezone: FIC_TIMEZONE,
    startDate,
    endDate,
    availability: rows.map(serializeAvailability),
  };
}

export async function setFicAvailability(user: MobileUser, date: string, isAvailable: unknown) {
  if (!isValidDateKey(date)) {
    return { ok: false as const, status: 400, error: "date must be YYYY-MM-DD." };
  }
  if (typeof isAvailable !== "boolean") {
    return { ok: false as const, status: 400, error: "isAvailable boolean is required." };
  }

  const existing = await prisma.ficAvailability.findUnique({
    where: { ficUserId_date: { ficUserId: user.id, date } },
    select: { isLocked: true },
  });

  if (existing?.isLocked) {
    return { ok: false as const, status: 409, error: "Cannot modify locked date already booked by a study." };
  }

  const row = await prisma.ficAvailability.upsert({
    where: { ficUserId_date: { ficUserId: user.id, date } },
    update: { isAvailable },
    create: { ficUserId: user.id, date, isAvailable },
  });

  return {
    ok: true as const,
    availability: serializeAvailability(row),
  };
}

export async function bulkSetFicAvailability(user: MobileUser, entries: unknown) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false as const, status: 400, error: "dates array is required." };
  }
  if (entries.length > MAX_BULK_DATES) {
    return { ok: false as const, status: 400, error: `Maximum ${MAX_BULK_DATES} dates can be updated per request.` };
  }

  const normalizedEntries = entries.reduce<AvailabilityEntry[]>((accumulator, entry) => {
    if (!entry || typeof entry !== "object") {
      return accumulator;
    }
    const row = entry as { date?: unknown; isAvailable?: unknown };
    if (typeof row.date === "string" && typeof row.isAvailable === "boolean") {
      accumulator.push({ date: row.date.trim(), isAvailable: row.isAvailable });
    }
    return accumulator;
  }, []);

  const errors: Array<{ date: string; error: string }> = [];
  const results = [];

  for (const entry of normalizedEntries) {
    if (!isValidDateKey(entry.date)) {
      errors.push({ date: entry.date, error: "date must be YYYY-MM-DD." });
      continue;
    }

    const result = await setFicAvailability(user, entry.date, entry.isAvailable);
    if (!result.ok) {
      errors.push({ date: entry.date, error: result.error });
      continue;
    }
    results.push(result.availability);
  }

  if (normalizedEntries.length !== entries.length) {
    errors.push({ date: "", error: "Each item must include date and isAvailable boolean fields." });
  }

  return {
    ok: true as const,
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function buildFicStudyWhere(user: MobileUser): Prisma.StudyWhereInput {
  if (user.role === "ADMIN") {
    return {
      OR: [
        {
          targetDemographics: {
            path: ["coordinationMode"],
            equals: "FIC_ASSISTED",
          },
        },
        { location: { contains: "fic", mode: "insensitive" } },
      ],
    };
  }

  return {
    location: user.assignedFacility
      ? { equals: user.assignedFacility, mode: "insensitive" }
      : { equals: "__UNASSIGNED_FIC_FACILITY__", mode: "insensitive" },
  };
}

function getAssignment(user: MobileUser) {
  return {
    assignedRegion: user.assignedRegion ?? null,
    assignedFacility: user.assignedFacility ?? null,
  };
}

function filterStudies<T extends { title: string; productName: string; location: string; status: string; creator: { name: string; organization: string | null } }>(
  studies: T[],
  normalizedQuery: string
) {
  if (!normalizedQuery) {
    return studies;
  }

  return studies.filter((study) =>
    [study.title, study.productName, study.location, study.status, study.creator.name, study.creator.organization ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery)
  );
}

function serializeStudy<T extends {
  id: string;
  title: string;
  productName: string;
  category: string;
  stage: string;
  description: string | null;
  location: string;
  status: string;
  sampleSize: number;
  createdAt: Date;
  updatedAt: Date;
  creator: { id: string; name: string; organization: string | null };
  _count: { responses: number; participants: number };
}>(study: T) {
  return {
    id: study.id,
    title: study.title,
    productName: study.productName,
    category: study.category,
    stage: study.stage,
    description: study.description,
    location: study.location,
    status: study.status,
    sampleSize: study.sampleSize,
    createdAt: study.createdAt.toISOString(),
    updatedAt: study.updatedAt.toISOString(),
    msme: {
      id: study.creator.id,
      name: study.creator.name,
      organization: study.creator.organization,
    },
    responseCount: study._count.responses,
    participantCount: study._count.participants,
    targetReached: study._count.responses >= study.sampleSize,
    links: {
      form: `/studies/${study.id}/form`,
      dashboard: `/dashboard/${study.id}`,
    },
  };
}

function serializeAvailability(row: {
  id: string;
  ficUserId: string;
  date: string;
  isAvailable: boolean;
  isLocked: boolean;
  lockedById: string | null;
  lockedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    ficUserId: row.ficUserId,
    date: row.date,
    isAvailable: row.isAvailable,
    isLocked: row.isLocked,
    lockedById: row.lockedById,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateDateRange(startDate: string, endDate: string) {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    return { ok: false as const, status: 400, error: "startDate and endDate must be YYYY-MM-DD." };
  }

  const dateKeys = getDateKeysBetween(startDate, endDate);
  if (dateKeys.length === 0) {
    return { ok: false as const, status: 400, error: "Invalid date range." };
  }
  if (dateKeys.length > MAX_DATE_RANGE_DAYS) {
    return {
      ok: false as const,
      status: 400,
      error: `Date range is too large. Maximum supported range is ${MAX_DATE_RANGE_DAYS} days.`,
    };
  }

  return { ok: true as const };
}
