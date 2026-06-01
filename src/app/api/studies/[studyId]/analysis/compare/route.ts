import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { compareSamples, formatPValue, type StudyDesign } from "@/lib/services/statistics";
import { getCurrentSession } from "@/lib/auth/session";
import { canAccessStudyByRole } from "@/lib/study-access";

type RouteContext = {
  params: Promise<{ studyId: string }>;
};

interface RawAttributeRecord {
  [key: string]: unknown;
}

interface SampleResponseLike {
  sampleNumber?: number;
  sampleLabel?: string;
  overallLiking?: number;
  attributes?: RawAttributeRecord;
}

interface ResponseDataShape {
  overallLiking?: number;
  attributes?: RawAttributeRecord;
  sampleResponses?: SampleResponseLike[];
}

export async function POST(request: Request, context: RouteContext) {
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
        creatorId: true,
        location: true,
        studyDesign: true,
      },
    });
    if (!study) return NextResponse.json({ error: "Study not found" }, { status: 404 });

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

    const body = await request.json().catch(() => null);
    const sampleNumbers = parseSampleNumbers(body?.sampleNumbers);
    const variableKey: string = typeof body?.variableKey === "string" ? body.variableKey : "overallLiking";

    if (sampleNumbers.length < 1) {
      return NextResponse.json({ error: "sampleNumbers must include at least one sample number." }, { status: 400 });
    }

    const responses = await prisma.sensoryResponse.findMany({
      where: { studyId },
      select: {
        participantId: true,
        data: true,
      },
    });

    const observations = buildObservations(responses);
    const filtered = observations.filter((observation) => sampleNumbers.includes(observation.sampleNumber));
    const inputs = sampleNumbers.map((sampleNumber) => {
      const sampleRows = filtered.filter((row) => row.sampleNumber === sampleNumber);
      const sampleLabel = sampleRows[0]?.sampleLabel ?? `Sample ${sampleNumber}`;
      const valuesByRespondent = new Map<string, number>();
      sampleRows.forEach((row) => {
        const value = extractVariableValue(row, variableKey);
        if (typeof value === "number" && Number.isFinite(value)) {
          valuesByRespondent.set(row.respondentId, value);
        }
      });
      return { sampleNumber, sampleLabel, valuesByRespondent };
    });

    const studyDesign: StudyDesign = study.studyDesign === "MONADIC" ? "MONADIC" : "WITHIN_SUBJECT";
    const result = compareSamples(inputs, { studyDesign });

    return NextResponse.json({
      variableKey,
      sampleSelection: sampleNumbers.length === observations.length ? "ALL_SAMPLES" : "SUBSET",
      sampleNumbers,
      samples: inputs.map((sample) => {
        const values = Array.from(sample.valuesByRespondent.values());
        const meanValue = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        const variance = values.length > 1
          ? values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (values.length - 1)
          : 0;
        return {
          sampleNumber: sample.sampleNumber,
          sampleLabel: sample.sampleLabel,
          mean: round3(meanValue),
          stdDev: round3(Math.sqrt(variance)),
          n: values.length,
          values,
        };
      }),
      statisticalComparison: {
        ...result,
        formattedPValue: formatPValue(result.pValue),
      },
    });
  } catch (error) {
    console.error("Failed to run comparison:", error);
    return NextResponse.json({ error: "Failed to run comparison" }, { status: 500 });
  }
}

function parseSampleNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const numbers = value
    .map((entry) => {
      const num = typeof entry === "number" ? entry : Number(entry);
      return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
    })
    .filter((num): num is number => num !== null);
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

interface FlatObservation {
  respondentId: string;
  sampleNumber: number;
  sampleLabel: string;
  overallLiking?: number;
  attributes: RawAttributeRecord;
}

function buildObservations(responses: Array<{ participantId: string; data: unknown }>): FlatObservation[] {
  const out: FlatObservation[] = [];
  responses.forEach((response) => {
    const data = (response.data ?? {}) as ResponseDataShape;
    const samples =
      Array.isArray(data.sampleResponses) && data.sampleResponses.length > 0
        ? data.sampleResponses
        : [
            {
              sampleNumber: 1,
              sampleLabel: "Sample 1",
              overallLiking: data.overallLiking,
              attributes: data.attributes ?? {},
            },
          ];
    samples.forEach((sample) => {
      const sampleNumber = typeof sample.sampleNumber === "number" && sample.sampleNumber > 0 ? Math.floor(sample.sampleNumber) : 1;
      out.push({
        respondentId: response.participantId,
        sampleNumber,
        sampleLabel: sample.sampleLabel?.trim() || `Sample ${sampleNumber}`,
        overallLiking:
          typeof sample.overallLiking === "number" && Number.isFinite(sample.overallLiking)
            ? sample.overallLiking
            : data.overallLiking,
        attributes: sample.attributes ?? {},
      });
    });
  });
  return out;
}

function extractVariableValue(observation: FlatObservation, variableKey: string): number | undefined {
  if (variableKey === "overallLiking") return observation.overallLiking;
  if (variableKey.startsWith("__penalty__::") || variableKey.startsWith("__meanDrop__::")) {
    const attributeName = variableKey.split("::")[1] ?? "";
    const value = observation.attributes[attributeName];
    const liking = observation.overallLiking;
    if (typeof liking !== "number" || !Number.isFinite(liking)) return undefined;
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5) {
      const bucket = value <= 2 ? "too_low" : value === 3 ? "just_right" : "too_high";
      if (bucket === "just_right") return undefined;
      return liking;
    }
    return undefined;
  }
  const value = observation.attributes[variableKey];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return observation.overallLiking;
}

function round3(value: number) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}
