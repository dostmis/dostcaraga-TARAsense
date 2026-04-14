"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SensoryAnalysisEngine } from "@/lib/services/analysis-engine";
import { Prisma } from "@prisma/client";
import { notifyUser } from "@/lib/notifications";
import { clearGuestSessionCookies, getCurrentGuestSession, getCurrentSession } from "@/lib/auth/session";

const MAX_ATTRIBUTE_KEYS = 40;
const MAX_SAMPLE_RESPONSES = 20;
const MAX_OPEN_ENDED_LENGTH = 2000;
const JAR_BUCKET_VALUES = new Set(["too_low", "just_right", "too_high"]);

const SubmitResponseSchema = z.object({
  overallLiking: z.number().min(1).max(9),
  attributes: z
    .record(z.string().min(1).max(120), z.unknown())
    .refine((row) => Object.keys(row).length <= MAX_ATTRIBUTE_KEYS, {
      message: `Too many attribute fields. Maximum is ${MAX_ATTRIBUTE_KEYS}.`,
    }),
  sampleResponses: z
    .array(
      z.object({
        sampleNumber: z.number().int().min(1),
        overallLiking: z.number().min(1).max(9).optional(),
        attributes: z
          .record(z.string().min(1).max(120), z.unknown())
          .refine((row) => Object.keys(row).length <= MAX_ATTRIBUTE_KEYS, {
            message: `Too many attribute fields. Maximum is ${MAX_ATTRIBUTE_KEYS}.`,
          }),
      })
    )
    .max(MAX_SAMPLE_RESPONSES)
    .optional(),
  submittedAt: z.string().datetime().optional(),
});

interface StudyAttributeConfig {
  name: string;
  type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED";
}

interface NormalizedSampleResponse {
  sampleNumber: number;
  overallLiking?: number;
  attributes: Record<string, unknown>;
}

type ParseAttributeResult =
  | {
      success: true;
      value: unknown;
    }
  | {
      success: false;
      error: string;
    };

type NormalizePayloadResult =
  | {
      success: true;
      overallLiking: number;
      attributes: Record<string, unknown>;
      sampleResponses: NormalizedSampleResponse[];
    }
  | {
      success: false;
      error: string;
    };

class AlreadySubmittedError extends Error {
  constructor() {
    super("ALREADY_SUBMITTED");
  }
}

export async function submitResponse(studyId: string, participantId: string, payload: unknown) {
  try {
    const session = await getCurrentSession();
    const guestSession = await getCurrentGuestSession();
    if (!session && !guestSession) {
      return { success: false, error: "Please login to submit responses." };
    }

    const validated = SubmitResponseSchema.parse(payload);

    const participant = await prisma.studyParticipant.findFirst({
      where: {
        id: participantId,
        studyId,
      },
      select: {
        id: true,
        status: true,
        source: true,
        study: {
          select: {
            id: true,
            title: true,
            creatorId: true,
            sensoryAttributes: {
              select: {
                name: true,
                type: true,
              },
              orderBy: {
                order: "asc",
              },
            },
            sensoryQuestions: {
              select: {
                id: true,
                questionText: true,
                questionType: true,
              },
            },
          },
        },
        panelist: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!participant) {
      return { success: false, error: "Participant not found for this study." };
    }
    if (session?.role === "CONSUMER" && participant.panelist.userId !== session.userId) {
      return { success: false, error: "You are not allowed to answer this study participant slot." };
    }
    if (session?.role === "MSME" && participant.study.creatorId === session.userId) {
      return { success: false, error: "MSME users cannot answer their own created studies." };
    }
    if (!session && guestSession) {
      if (participant.source !== "WALK_IN_GUEST") {
        return { success: false, error: "Guest session is not allowed for this participant slot." };
      }
      if (guestSession.studyId !== studyId || guestSession.participantId !== participant.id) {
        return { success: false, error: "Guest session does not match this participant slot." };
      }
    }

    if (participant.status === "COMPLETED") {
      return { success: true, alreadySubmitted: true };
    }
    if (participant.study.sensoryAttributes.length === 0) {
      return { success: false, error: "Study has no configured sensory attributes." };
    }

    const normalized = normalizePayloadAgainstStudy(
      validated,
      participant.study.sensoryAttributes as StudyAttributeConfig[]
    );
    if (!normalized.success) {
      return { success: false, error: normalized.error };
    }

    const responseData = JSON.parse(
      JSON.stringify({
        overallLiking: normalized.overallLiking,
        attributes: normalized.attributes,
        sampleResponses: normalized.sampleResponses,
      })
    ) as Prisma.InputJsonValue;

    const submittedAt = validated.submittedAt ? new Date(validated.submittedAt) : new Date();

    try {
      await prisma.$transaction(async (tx) => {
        const participantUpdate = await tx.studyParticipant.updateMany({
          where: {
            id: participantId,
            studyId,
            status: {
              not: "COMPLETED",
            },
          },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
          },
        });

        if (participantUpdate.count === 0) {
          throw new AlreadySubmittedError();
        }

        await tx.sensoryResponse.create({
          data: {
            studyId,
            participantId,
            data: responseData,
            submittedAt,
          },
        });

        const numericQuestionRows = buildQuestionResponses(
          studyId,
          participantId,
          participant.study.sensoryQuestions,
          normalized.attributes
        );
        if (numericQuestionRows.length > 0) {
          await tx.questionResponse.createMany({
            data: numericQuestionRows,
          });
        }
      });
    } catch (error) {
      if (error instanceof AlreadySubmittedError || isUniqueConstraintError(error)) {
        return { success: true, alreadySubmitted: true };
      }
      throw error;
    }

    try {
      const analysisEngine = new SensoryAnalysisEngine();
      await analysisEngine.analyzeStudy(studyId);
    } catch (analysisError) {
      console.error("Analyze study after submission failed:", analysisError);
    }

    try {
      await notifyUser(participant.study.creatorId, {
        title: "New sensory response submitted",
        message: `A participant submitted responses for "${participant.study.title}".`,
        level: "INFO",
        category: "SURVEY",
        actionUrl: `/dashboard/${studyId}`,
        metadata: { studyId, participantId },
      });

      if (participant.panelist.userId) {
        await notifyUser(participant.panelist.userId, {
          title: "Survey submitted",
          message: `Your responses for "${participant.study.title}" were submitted successfully.`,
          level: "SUCCESS",
          category: "SURVEY",
          actionUrl: "/test/completed",
          metadata: { studyId, participantId },
        });
      }
    } catch (notificationError) {
      console.error("Submission notifications failed:", notificationError);
    }

    revalidatePath(`/dashboard/${studyId}`);
    revalidatePath("/");

    if (!session && guestSession) {
      const store = await cookies();
      clearGuestSessionCookies(store);
    }

    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues[0]?.message ?? "Invalid response payload.",
      };
    }

    console.error("Submit response error:", error);
    return { success: false, error: "Failed to submit response." };
  }
}

function normalizePayloadAgainstStudy(
  payload: z.infer<typeof SubmitResponseSchema>,
  attributes: StudyAttributeConfig[]
): NormalizePayloadResult {
  const allowedAttributeNames = new Set(attributes.map((attribute) => attribute.name));
  const normalizedAttributes: Record<string, unknown> = {};
  let overallFromAttributes: number | null = null;

  const unknownTopLevelKeys = Object.keys(payload.attributes).filter((key) => !allowedAttributeNames.has(key));
  if (unknownTopLevelKeys.length > 0) {
    return { success: false, error: `Unknown attribute(s): ${unknownTopLevelKeys.join(", ")}.` };
  }

  for (const attribute of attributes) {
    const parsed = parseAttributeValue(attribute, payload.attributes[attribute.name], attribute.name);
    if (!parsed.success) {
      return parsed;
    }
    normalizedAttributes[attribute.name] = parsed.value;

    if (attribute.type === "OVERALL_LIKING") {
      overallFromAttributes = parsed.value as number;
    }
  }

  if (overallFromAttributes === null) {
    return { success: false, error: "Missing OVERALL_LIKING question in configured study." };
  }
  if (Math.abs(overallFromAttributes - payload.overallLiking) > 0.01) {
    return { success: false, error: "Overall liking value is inconsistent with answered attributes." };
  }

  const normalizedSampleResponses: NormalizedSampleResponse[] = [];
  for (const sample of payload.sampleResponses ?? []) {
    const unknownSampleKeys = Object.keys(sample.attributes).filter((key) => !allowedAttributeNames.has(key));
    if (unknownSampleKeys.length > 0) {
      return { success: false, error: `Unknown sample attribute(s): ${unknownSampleKeys.join(", ")}.` };
    }

    const normalizedSampleAttributes: Record<string, unknown> = {};
    let sampleOverallFromAttribute: number | null = null;

    for (const attribute of attributes) {
      const parsed = parseAttributeValue(
        attribute,
        sample.attributes[attribute.name],
        `sample ${sample.sampleNumber} - ${attribute.name}`
      );
      if (!parsed.success) {
        return parsed;
      }

      normalizedSampleAttributes[attribute.name] = parsed.value;
      if (attribute.type === "OVERALL_LIKING") {
        sampleOverallFromAttribute = parsed.value as number;
      }
    }

    if (sample.overallLiking !== undefined && sampleOverallFromAttribute !== null) {
      if (Math.abs(sample.overallLiking - sampleOverallFromAttribute) > 0.01) {
        return {
          success: false,
          error: `Overall liking mismatch in sample ${sample.sampleNumber}.`,
        };
      }
    }

    normalizedSampleResponses.push({
      sampleNumber: sample.sampleNumber,
      overallLiking: sampleOverallFromAttribute ?? undefined,
      attributes: normalizedSampleAttributes,
    });
  }

  return {
    success: true,
    overallLiking: overallFromAttributes,
    attributes: normalizedAttributes,
    sampleResponses: normalizedSampleResponses,
  };
}

function parseAttributeValue(attribute: StudyAttributeConfig, rawValue: unknown, label: string): ParseAttributeResult {
  if (rawValue === undefined) {
    return { success: false, error: `Missing answer for "${label}".` };
  }

  if (attribute.type === "OVERALL_LIKING" || attribute.type === "ATTRIBUTE_LIKING") {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue < 1 || rawValue > 9) {
      return { success: false, error: `Invalid liking score for "${label}".` };
    }
    return {
      success: true,
      value: Math.round(rawValue * 100) / 100,
    };
  }

  if (attribute.type === "JAR") {
    const normalizedJar = normalizeJarRawValue(rawValue);
    if (!normalizedJar) {
      return { success: false, error: `Invalid JAR option for "${label}". Use the standardized 5-point JAR scale.` };
    }

    return {
      success: true,
      value: {
        type: "JAR_5PT",
        rawValue: normalizedJar.rawValue,
        bucket: normalizedJar.bucket,
      },
    };
  }

  if (typeof rawValue !== "string") {
    return { success: false, error: `Invalid text response for "${label}".` };
  }
  if (rawValue.length > MAX_OPEN_ENDED_LENGTH) {
    return {
      success: false,
      error: `Text response for "${label}" exceeds ${MAX_OPEN_ENDED_LENGTH} characters.`,
    };
  }

  return {
    success: true,
    value: rawValue.trim(),
  };
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function normalizeJarRawValue(rawValue: unknown) {
  if (typeof rawValue === "number" && Number.isInteger(rawValue) && rawValue >= 1 && rawValue <= 5) {
    return {
      rawValue,
      bucket: collapseJarBucket(rawValue),
    };
  }

  if (typeof rawValue === "string" && JAR_BUCKET_VALUES.has(rawValue)) {
    return mapLegacyJarBucketToRaw(rawValue);
  }

  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const row = rawValue as { type?: unknown; value?: unknown; rawValue?: unknown; bucket?: unknown };
  if (typeof row.rawValue === "number" && Number.isInteger(row.rawValue) && row.rawValue >= 1 && row.rawValue <= 5) {
    return {
      rawValue: row.rawValue,
      bucket: collapseJarBucket(row.rawValue),
    };
  }

  if (typeof row.value === "number" && Number.isInteger(row.value) && row.value >= 1 && row.value <= 5) {
    return {
      rawValue: row.value,
      bucket: collapseJarBucket(row.value),
    };
  }

  if (typeof row.bucket === "string" && JAR_BUCKET_VALUES.has(row.bucket)) {
    return mapLegacyJarBucketToRaw(row.bucket);
  }

  if (typeof row.value === "string" && JAR_BUCKET_VALUES.has(row.value)) {
    return mapLegacyJarBucketToRaw(row.value);
  }

  return null;
}

function mapLegacyJarBucketToRaw(bucket: string) {
  if (bucket === "too_low") {
    return { rawValue: 2, bucket: "too_low" as const };
  }
  if (bucket === "just_right") {
    return { rawValue: 3, bucket: "just_right" as const };
  }
  return { rawValue: 4, bucket: "too_high" as const };
}

function collapseJarBucket(rawValue: number) {
  if (rawValue <= 2) return "too_low" as const;
  if (rawValue === 3) return "just_right" as const;
  return "too_high" as const;
}

function buildQuestionResponses(
  studyId: string,
  respondentId: string,
  questions: Array<{ id: string; questionText: string; questionType: "HEDONIC" | "JAR" | "OPEN_ENDED" }>,
  attributes: Record<string, unknown>
) {
  const rows: Array<{ studyId: string; respondentId: string; questionId: string; rawValue: number }> = [];

  for (const question of questions) {
    if (question.questionType === "OPEN_ENDED") {
      continue;
    }

    const value = attributes[question.questionText];
    if (question.questionType === "HEDONIC" && typeof value === "number") {
      rows.push({
        studyId,
        respondentId,
        questionId: question.id,
        rawValue: value,
      });
      continue;
    }

    if (question.questionType === "JAR" && value && typeof value === "object") {
      const jar = value as { rawValue?: unknown };
      if (typeof jar.rawValue === "number" && Number.isFinite(jar.rawValue)) {
        rows.push({
          studyId,
          respondentId,
          questionId: question.id,
          rawValue: jar.rawValue,
        });
      }
    }
  }

  return rows;
}
