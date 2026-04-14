import { randomBytes } from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  assignSampleCodesFromCodeBook,
  createStudyRandomCodeBook,
  parseStudyRandomCodeBook,
  StudyRandomCodeBook,
} from "@/lib/random-codebook";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type SampleCode = {
  sample: number;
  code: string;
};

type AssignmentInput = {
  participantId: string;
  studyId: string;
  panelistNumber: number | null;
  randomizeCode: string | null;
  sampleCodes?: Prisma.JsonValue | null;
};

export async function getNextPanelistNumber(db: DbClient, studyId: string) {
  const aggregate = await db.studyParticipant.aggregate({
    where: {
      studyId,
      panelistNumber: { not: null },
    },
    _max: {
      panelistNumber: true,
    },
  });

  return (aggregate._max.panelistNumber ?? 0) + 1;
}

export async function generateUniqueRandomizeCode(db: DbClient, studyId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const code = `RC-${randomBytes(3).toString("hex").toUpperCase()}`;
    const existing = await db.studyParticipant.findFirst({
      where: { studyId, randomizeCode: code },
      select: { id: true },
    });
    if (!existing) {
      return code;
    }
  }

  // Final deterministic fallback if random collisions persist.
  return `RC-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

export async function ensureParticipantAssignment(db: DbClient, input: AssignmentInput) {
  if (canStartTransaction(db)) {
    return db.$transaction(
      async (tx) => ensureParticipantAssignmentWithinTransaction(tx, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  return ensureParticipantAssignmentWithinTransaction(db, input);
}

async function ensureParticipantAssignmentWithinTransaction(db: DbClient, input: AssignmentInput) {
  await lockStudyForAssignment(db, input.studyId);

  let panelistNumber = input.panelistNumber;
  let randomizeCode = input.randomizeCode;
  let sampleCodes = parseSampleCodes(input.sampleCodes);
  const updateData: { panelistNumber?: number; randomizeCode?: string; sampleCodes?: Prisma.InputJsonValue } = {};

  if (!panelistNumber) {
    panelistNumber = await getNextPanelistNumber(db, input.studyId);
    updateData.panelistNumber = panelistNumber;
  }

  if (sampleCodes.length === 0) {
    const config = await resolveStudyAssignmentConfig(db, input.studyId);
    const planned = panelistNumber && config.codeBook
      ? assignSampleCodesFromCodeBook(config.codeBook, panelistNumber)
      : null;
    if (planned && planned.length > 0) {
      sampleCodes = planned;
    } else {
      sampleCodes = await generateUniqueSampleCodes(db, input.studyId, config.sampleCount);
    }
    updateData.sampleCodes = sampleCodes as unknown as Prisma.InputJsonValue;
  }

  if (!randomizeCode && sampleCodes.length > 0) {
    randomizeCode = sampleCodes[0]?.code ?? null;
    if (randomizeCode) {
      updateData.randomizeCode = randomizeCode;
    }
  }

  if (!randomizeCode) {
    randomizeCode = await generateUniqueRandomizeCode(db, input.studyId);
    updateData.randomizeCode = randomizeCode;
  }

  if (Object.keys(updateData).length > 0) {
    await db.studyParticipant.update({
      where: { id: input.participantId },
      data: updateData,
    });
  }

  return {
    panelistNumber,
    randomizeCode,
    sampleCodes,
  };
}

function canStartTransaction(db: DbClient): db is PrismaClient {
  return typeof (db as PrismaClient).$transaction === "function";
}

async function lockStudyForAssignment(db: DbClient, studyId: string) {
  await db.$queryRaw`SELECT id FROM "Study" WHERE id = ${studyId} FOR UPDATE`;
}

export function formatPanelistNumber(value: number | null | undefined) {
  if (!value || value < 1) {
    return "Unassigned";
  }
  return `P-${String(value).padStart(3, "0")}`;
}

export function parseSampleCodes(value: unknown): SampleCode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows = value.reduce<SampleCode[]>((accumulator, item) => {
    if (!item || typeof item !== "object") {
      return accumulator;
    }

    const record = item as { sample?: unknown; code?: unknown };
    if (typeof record.sample !== "number" || typeof record.code !== "string") {
      return accumulator;
    }

    accumulator.push({ sample: record.sample, code: record.code });
    return accumulator;
  }, []);

  return rows.sort((left, right) => left.sample - right.sample);
}

export function parseOfferedSessions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const valid = value.filter((item): item is string => typeof item === "string" && !Number.isNaN(new Date(item).getTime()));
  return Array.from(new Set(valid)).sort();
}

async function resolveStudyAssignmentConfig(db: DbClient, studyId: string): Promise<{
  sampleCount: number;
  codeBook: StudyRandomCodeBook | null;
}> {
  const study = await db.study.findUnique({
    where: { id: studyId },
    select: { sampleSize: true, targetDemographics: true },
  });

  if (!study) {
    return { sampleCount: 1, codeBook: null };
  }

  const demographics = study.targetDemographics && typeof study.targetDemographics === "object"
    ? (study.targetDemographics as Record<string, unknown>)
    : {};
  const sampleCount = resolveSampleCountFromDemographics(demographics);
  const existingCodeBook = parseStudyRandomCodeBook(demographics.randomCodeBook);
  if (existingCodeBook) {
    return { sampleCount, codeBook: existingCodeBook };
  }

  // Backfill legacy studies so assignments become deterministic by panelist number.
  const generated = createStudyRandomCodeBook(study.sampleSize, sampleCount);
  const nextDemographics = {
    ...demographics,
    randomCodeBook: generated,
  };

  try {
    await db.study.update({
      where: { id: studyId },
      data: {
        targetDemographics: JSON.parse(JSON.stringify(nextDemographics)) as Prisma.InputJsonValue,
      },
    });
    return { sampleCount, codeBook: generated };
  } catch {
    // If update fails (race conditions/permissions), continue with generated in-memory codebook.
    return { sampleCount, codeBook: generated };
  }
}

async function generateUniqueSampleCodes(db: DbClient, studyId: string, sampleCount: number) {
  const usedCodes = new Set<string>();

  const existingRows = await db.studyParticipant.findMany({
    where: { studyId },
    select: { sampleCodes: true },
  });

  for (const row of existingRows) {
    const parsed = parseSampleCodes(row.sampleCodes);
    for (const codeRow of parsed) {
      usedCodes.add(codeRow.code);
    }
  }

  const generated: SampleCode[] = [];
  while (generated.length < sampleCount) {
    const code = String(Math.floor(100 + Math.random() * 900));
    if (usedCodes.has(code)) {
      continue;
    }
    usedCodes.add(code);
    generated.push({ sample: generated.length + 1, code });
  }

  return generated;
}

function resolveSampleCountFromDemographics(targetDemographics: Record<string, unknown>) {
  const raw = targetDemographics.numberOfSamples;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) {
    return 1;
  }
  return Math.max(1, Math.floor(raw));
}
