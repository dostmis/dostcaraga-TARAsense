import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { formatPanelistNumber, parseSampleCodes } from "@/lib/participant-assignment";

type RouteContext = {
  params: Promise<{ studyId: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const session = await getCurrentSession();
    if (!session || session.role === "CONSUMER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { studyId } = await context.params;
    const study = await prisma.study.findUnique({
      where: { id: studyId },
      select: {
        id: true,
        title: true,
        creatorId: true,
        participants: {
          orderBy: [{ panelistNumber: "asc" }, { selectionOrder: "asc" }],
          select: {
            panelistNumber: true,
            randomizeCode: true,
            sampleCodes: true,
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
              },
            },
          },
        },
      },
    });

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }
    if (session.role === "MSME" && study.creatorId !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const headers = [
      "Panelist No",
      "Randomize Code",
      "Sample Codes",
      "Panelist Name",
      "Email",
      "Phone",
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
      ...study.participants.map((row) =>
        [
          formatPanelistNumber(row.panelistNumber),
          row.randomizeCode ?? "Unassigned",
          parseSampleCodes(row.sampleCodes).map((entry) => `S${entry.sample}:${entry.code}`).join(" | "),
          row.panelist.name,
          row.panelist.email,
          row.panelist.phone ?? "",
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
    const safeName = study.title.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

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

function parseOfferedSessions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function escapeCsv(value: string) {
  const escaped = value.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}
