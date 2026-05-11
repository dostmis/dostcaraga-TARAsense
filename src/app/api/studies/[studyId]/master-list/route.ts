import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { formatPanelistNumber, parseSampleCodes } from "@/lib/participant-assignment";
import { assignSampleCodesFromCodeBook, createStudyRandomCodeBook, parseStudyRandomCodeBook } from "@/lib/random-codebook";
import { canAccessStudyByRole, canViewRandomizedBlindCodePlan } from "@/lib/study-access";

type RouteContext = {
  params: Promise<{ studyId: string }>;
};

interface MasterListRow {
  panelistNumber: number | null;
  randomizeCode: string | null;
  sampleCodes: unknown;
  source: string;
  guestCode: string | null;
  status: string;
  stratum: string | null;
  selectionOrder: number;
  consentStatus: string;
  offeredSessions: unknown;
  requestedSessionAt: Date | null;
  sessionAt: Date | null;
  panelist: {
    name: string;
    email: string;
    phone: string | null;
    location: string;
    organization: string | null;
    occupation: string;
  };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await getCurrentSession();
    if (!session || (session.role !== "ADMIN" && session.role !== "MSME" && session.role !== "FIC")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { studyId } = await context.params;
    const study = await prisma.study.findUnique({
      where: { id: studyId },
      select: {
        id: true,
        title: true,
        creatorId: true,
        location: true,
        sampleSize: true,
        targetDemographics: true,
      },
    });

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }
    const currentUser =
      session.role === "FIC"
        ? await prisma.user.findUnique({
            where: { id: session.userId },
            select: { assignedFacility: true },
          })
        : null;
    if (
      !canAccessStudyByRole({
        role: session.role,
        userId: session.userId,
        studyCreatorId: study.creatorId,
        studyLocation: study.location,
        ficAssignedFacility: currentUser?.assignedFacility,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const canExportBlindCodes = canViewRandomizedBlindCodePlan({
      role: session.role,
      userId: session.userId,
      studyCreatorId: study.creatorId,
      targetDemographics: study.targetDemographics,
    });
    const url = new URL(request.url);
    const exportView = url.searchParams.get("view");
    const safeName = study.title.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

    if (exportView === "blind-code-plan") {
      if (!canExportBlindCodes) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const csv = await buildBlindCodePlanCsv(study.id, study.sampleSize, study.targetDemographics);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=\"${safeName || "study"}-${study.id}-blind-code-plan.csv\"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const participants = await loadMasterListRows(study.id, canExportBlindCodes);

    const headers = [
      "Panelist No",
      "Source",
      "Guest ID",
      ...(canExportBlindCodes ? ["Randomize Code", "Sample Codes"] : []),
      "Panelist Name",
      "Address",
      "Organization",
      "Occupation",
      "Status",
      "Consent",
      "Offered Sessions",
      "Requested Session",
      "Session Schedule",
      "Selection Order",
      "Stratum",
    ];

    const lines = [
      headers.join(","),
      ...participants.map((row) =>
        [
          formatPanelistNumber(row.panelistNumber),
          row.source,
          row.guestCode ?? "",
          ...(canExportBlindCodes
            ? [
                row.randomizeCode ?? "Unassigned",
                parseSampleCodes(row.sampleCodes)
                  .map((entry) => `Serving ${entry.servingOrder ?? entry.sample}: ${entry.code} (S${entry.sample})`)
                  .join(" | "),
              ]
            : []),
          row.panelist.name,
          row.panelist.location,
          row.panelist.organization ?? "",
          row.panelist.occupation,
          row.status,
          row.consentStatus,
          parseOfferedSessions(row.offeredSessions).join(" | "),
          row.requestedSessionAt ? new Date(row.requestedSessionAt).toISOString() : "",
          row.sessionAt ? new Date(row.sessionAt).toISOString() : "",
          String(row.selectionOrder),
          row.stratum ?? "",
        ]
          .map(escapeCsv)
          .join(",")
      ),
    ];

    const csv = lines.join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${safeName || "study"}-${study.id}-master-list.csv\"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export master list:", error);
    return NextResponse.json({ error: "Failed to export master list" }, { status: 500 });
  }
}

async function buildBlindCodePlanCsv(studyId: string, sampleSize: number, targetDemographics: unknown) {
  const codeBook = await ensureRandomCodeBookForStudy(studyId, sampleSize, targetDemographics);

  const participants = await prisma.studyParticipant.findMany({
    where: { studyId },
    select: {
      panelistNumber: true,
      source: true,
      guestCode: true,
      status: true,
      panelist: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ panelistNumber: "asc" }, { selectionOrder: "asc" }],
  });
  const participantByNumber = new Map(
    participants
      .filter((participant) => typeof participant.panelistNumber === "number")
      .map((participant) => [participant.panelistNumber as number, participant])
  );

  const headers = [
    "Panelist No",
    "Panelist Name",
    "Source",
    "Guest ID",
    "Status",
    ...Array.from({ length: codeBook.sampleCount }, (_, index) => `Sample ${index + 1} Code`),
  ];

  const lines = [
    headers.join(","),
    ...Array.from({ length: codeBook.participantCapacity }, (_, index) => {
      const panelistNumber = index + 1;
      const participant = participantByNumber.get(panelistNumber);
      const sampleCodes = sortSampleCodesByTrueSample(assignSampleCodesFromCodeBook(codeBook, panelistNumber) ?? []);
      return [
        formatPanelistNumber(panelistNumber),
        participant?.panelist.name ?? "",
        participant?.source ?? "",
        participant?.guestCode ?? "",
        participant?.status ?? "UNASSIGNED",
        ...sampleCodes.map((row) => `${row.code} (${row.servingOrder})`),
      ]
        .map(escapeCsv)
        .join(",");
    }),
  ];

  return lines.join("\n");
}

async function ensureRandomCodeBookForStudy(studyId: string, sampleSize: number, targetDemographics: unknown) {
  const existingMeta = targetDemographics && typeof targetDemographics === "object"
    ? (targetDemographics as Record<string, unknown>)
    : {};
  const existing = parseStudyRandomCodeBook(existingMeta.randomCodeBook);
  if (existing) {
    return existing;
  }

  const generated = createStudyRandomCodeBook(sampleSize, resolveSampleCountFromTargetDemographics(existingMeta));
  await prisma.study.update({
    where: { id: studyId },
    data: {
      targetDemographics: JSON.parse(
        JSON.stringify({
          ...existingMeta,
          randomCodeBook: generated,
        })
      ),
    },
  });

  return generated;
}

function resolveSampleCountFromTargetDemographics(targetDemographics: Record<string, unknown>) {
  const raw = targetDemographics.numberOfSamples;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) {
    return 1;
  }
  return Math.max(1, Math.floor(raw));
}

function sortSampleCodesByTrueSample<T extends { sample: number }>(rows: T[]) {
  return [...rows].sort((left, right) => left.sample - right.sample);
}

async function loadMasterListRows(studyId: string, includeBlindCodes: boolean): Promise<MasterListRow[]> {
  const commonSelect = {
    panelistNumber: true,
    source: true,
    guestCode: true,
    status: true,
    stratum: true,
    selectionOrder: true,
    consentStatus: true,
    offeredSessions: true,
    requestedSessionAt: true,
    sessionAt: true,
    panelist: {
      select: {
        name: true,
        email: true,
        phone: true,
        location: true,
        organization: true,
        occupation: true,
      },
    },
  } as const;
  const orderBy = [{ panelistNumber: "asc" as const }, { selectionOrder: "asc" as const }];

  if (includeBlindCodes) {
    return prisma.studyParticipant.findMany({
      where: { studyId },
      orderBy,
      select: {
        ...commonSelect,
        randomizeCode: true,
        sampleCodes: true,
      },
    }) as unknown as Promise<MasterListRow[]>;
  }

  const rows = await prisma.studyParticipant.findMany({
    where: { studyId },
    orderBy,
    select: commonSelect,
  }) as unknown as Array<Omit<MasterListRow, "randomizeCode" | "sampleCodes">>;

  return rows.map((row) => ({
    ...row,
    randomizeCode: null,
    sampleCodes: null,
  }));
}

function parseOfferedSessions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function escapeCsv(value: string) {
  const safeValue = neutralizeCsvFormula(value);
  const escaped = safeValue.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

function neutralizeCsvFormula(value: string) {
  if (/^[\s]*[=+\-@]/.test(value)) {
    return `'${value}`;
  }
  return value;
}
