"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SensoryAnalysisEngine } from "@/lib/services/analysis-engine";
import { Prisma } from "@prisma/client";
import { notifyUser } from "@/lib/notifications";
import { clearGuestSessionCookies, getCurrentGuestSession, getCurrentSession } from "@/lib/auth/session";
import { createWorkflowTraceId, runInBackground } from "@/lib/async-workflow";
import { logUserUsage } from "@/lib/user-usage";
import {
  MAX_CUSTOM_OPTION_TEXT,
  MAX_CUSTOM_PARAGRAPH_ANSWER,
  MAX_CUSTOM_QUESTIONS,
  MAX_CUSTOM_QUESTION_OPTIONS,
  normalizeCustomAnswers,
  parseCustomQuestions,
} from "@/lib/custom-questions";

const MAX_ATTRIBUTE_KEYS = 40;
const MAX_SAMPLE_RESPONSES = 20;
const MAX_OPEN_ENDED_LENGTH = 2000;
const MAX_DRAFT_JSON_BYTES = 80_000;

const CustomAnswersSchema = z
  .record(
    z.string().min(1).max(64),
    z.union([
      z.string().max(MAX_CUSTOM_PARAGRAPH_ANSWER),
      z.array(z.string().max(MAX_CUSTOM_OPTION_TEXT)).max(MAX_CUSTOM_QUESTION_OPTIONS),
    ])
  )
  .refine((row) => Object.keys(row).length <= MAX_CUSTOM_QUESTIONS, {
    message: `Too many custom answers. Maximum is ${MAX_CUSTOM_QUESTIONS}.`,
  });
const DRAFT_RETENTION_DAYS = 14;
const JAR_BUCKET_VALUES = new Set(["too_low", "just_right", "too_high"]);

const DraftAttributeValueSchema = z.union([
  z.number().min(1).max(9),
  z.string().max(MAX_OPEN_ENDED_LENGTH),
  z
    .object({
      type: z.string().max(40).optional(),
      value: z.union([z.number().int().min(1).max(5), z.string().max(40)]).optional(),
      rawValue: z.number().int().min(1).max(5).optional(),
      bucket: z.enum(["too_low", "just_right", "too_high"]).optional(),
    })
    .passthrough(),
]);

const ResponseDraftSchema = z
  .object({
    phase: z.enum(["instructions", "sample", "ranking", "comments"]),
    currentSampleIndex: z.number().int().min(0).max(MAX_SAMPLE_RESPONSES - 1),
    currentStep: z.number().int().min(0).max(MAX_ATTRIBUTE_KEYS),
    responsesBySample: z
      .record(
        z.string().regex(/^\d+$/),
        z
          .record(z.string().min(1).max(120), DraftAttributeValueSchema)
          .refine((row) => Object.keys(row).length <= MAX_ATTRIBUTE_KEYS, {
            message: `Too many draft attribute fields. Maximum is ${MAX_ATTRIBUTE_KEYS}.`,
          })
      )
      .refine((row) => Object.keys(row).length <= MAX_SAMPLE_RESPONSES, {
        message: `Too many draft sample responses. Maximum is ${MAX_SAMPLE_RESPONSES}.`,
      }),
    sampleRanking: z
      .record(
        z.string().regex(/^\d+$/),
        z.union([z.number().int().min(1).max(MAX_SAMPLE_RESPONSES), z.null()])
      )
      .default({}),
    comments: z
      .object({
        likedMost: z.string().max(MAX_OPEN_ENDED_LENGTH).optional(),
        improvements: z.string().max(MAX_OPEN_ENDED_LENGTH).optional(),
      })
      .default({}),
    customAnswers: CustomAnswersSchema.default({}),
    samplePlanSignature: z.string().min(1).max(12_000),
    updatedAt: z.string().datetime(),
  })
  .refine((payload) => Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_DRAFT_JSON_BYTES, {
    message: `Draft is too large. Maximum is ${MAX_DRAFT_JSON_BYTES} bytes.`,
  });

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
  sampleRanking: z
    .array(
      z.object({
        sampleNumber: z.number().int().min(1),
        rank: z.number().int().min(1),
      })
    )
    .max(MAX_SAMPLE_RESPONSES)
    .optional(),
  comments: z
    .object({
      likedMost: z.string().max(MAX_OPEN_ENDED_LENGTH).optional(),
      improvements: z.string().max(MAX_OPEN_ENDED_LENGTH).optional(),
    })
    .optional(),
  customAnswers: CustomAnswersSchema.optional(),
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

interface NormalizedSampleRanking {
  sampleNumber: number;
  rank: number;
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
      sampleRanking: NormalizedSampleRanking[];
      comments: {
        likedMost: string;
        improvements: string;
      };
    }
  | {
      success: false;
      error: string;
    };

type ResponseDraftPayload = z.infer<typeof ResponseDraftSchema>;

class AlreadySubmittedError extends Error {
  constructor() {
    super("ALREADY_SUBMITTED");
  }
}

const responseParticipantSelect = {
  id: true,
  status: true,
  source: true,
  consentStatus: true,
  study: {
    select: {
      id: true,
      title: true,
      creatorId: true,
      creator: { select: { role: true } },
      targetDemographics: true,
      customQuestions: true,
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
} satisfies Prisma.StudyParticipantSelect;

type ResponseParticipant = Prisma.StudyParticipantGetPayload<{ select: typeof responseParticipantSelect }>;

type AuthorizedResponseParticipant =
  | {
      success: true;
      session: Awaited<ReturnType<typeof getCurrentSession>>;
      guestSession: Awaited<ReturnType<typeof getCurrentGuestSession>>;
      participant: ResponseParticipant;
    }
  | {
      success: false;
      error: string;
    };

async function authorizeResponseParticipant(
  studyId: string,
  participantId: string,
  options: { allowCompleted?: boolean } = {}
): Promise<AuthorizedResponseParticipant> {
  const session = await getCurrentSession();
  const guestSession = await getCurrentGuestSession();
  if (!session && !guestSession) {
    return { success: false, error: "Please login to continue evaluation." };
  }

  const participant = await prisma.studyParticipant.findFirst({
    where: {
      id: participantId,
      studyId,
    },
    select: responseParticipantSelect,
  });

  if (!participant) {
    return { success: false, error: "Participant not found for this study." };
  }
  if (!options.allowCompleted && participant.status === "COMPLETED") {
    return { success: false, error: "Participant slot has already submitted responses." };
  }
  if (session?.role === "CONSUMER" && participant.panelist.userId !== session.userId) {
    return { success: false, error: "You are not allowed to answer this study participant slot." };
  }
  if (session?.role === "MSME") {
    if (participant.study.creatorId === session.userId) {
      return { success: false, error: "MSME users cannot answer their own created studies." };
    }
    if (participant.study.creator.role !== "MSME") {
      return { success: false, error: "MSME users can only answer other MSME studies." };
    }
    if (participant.panelist.userId !== session.userId) {
      return { success: false, error: "You are not allowed to answer this study participant slot." };
    }
  }
  if (session && !["CONSUMER", "MSME", "ADMIN"].includes(session.role)) {
    return { success: false, error: "Your account role is not allowed to submit sensory responses." };
  }
  if (!session && guestSession) {
    if (participant.source !== "WALK_IN_GUEST") {
      return { success: false, error: "Guest session is not allowed for this participant slot." };
    }
    if (guestSession.studyId !== studyId || guestSession.participantId !== participant.id) {
      return { success: false, error: "Guest session does not match this participant slot." };
    }
  }

  return { success: true, session, guestSession, participant };
}

function validateParticipantCanDraft(participant: ResponseParticipant) {
  if (participant.status === "COMPLETED") {
    return { success: false as const, error: "Participant slot has already submitted responses." };
  }
  if (participant.status !== "CONFIRMED") {
    return { success: false as const, error: "Participant slot is not confirmed for evaluation." };
  }
  if (participant.consentStatus !== "AGREED") {
    return { success: false as const, error: "Please complete consent before continuing evaluation." };
  }
  if (participant.study.sensoryAttributes.length === 0) {
    return { success: false as const, error: "Study has no configured sensory attributes." };
  }
  return { success: true as const };
}

function validateDraftResponsesAgainstStudy(
  payload: ResponseDraftPayload,
  attributes: StudyAttributeConfig[],
  sampleCount: number
) {
  const sampleAttributes = attributes.filter((attribute) => attribute.type !== "OPEN_ENDED");
  const sampleAttributeByName = new Map(sampleAttributes.map((attribute) => [attribute.name, attribute]));

  for (const [sampleIndexKey, row] of Object.entries(payload.responsesBySample)) {
    const sampleIndex = Number(sampleIndexKey);
    if (!Number.isInteger(sampleIndex) || sampleIndex < 0 || sampleIndex >= sampleCount) {
      return { success: false as const, error: "Draft contains a sample outside this study plan." };
    }

    for (const [attributeName, value] of Object.entries(row)) {
      const attribute = sampleAttributeByName.get(attributeName);
      if (!attribute) {
        return { success: false as const, error: `Unknown draft attribute "${attributeName}".` };
      }
      const parsed = parseAttributeValue(attribute, value, attributeName);
      if (!parsed.success) {
        return { success: false as const, error: parsed.error };
      }
    }
  }

  for (const [sampleNumberKey, rank] of Object.entries(payload.sampleRanking)) {
    const sampleNumber = Number(sampleNumberKey);
    if (!Number.isInteger(sampleNumber) || sampleNumber < 1 || sampleNumber > sampleCount) {
      return { success: false as const, error: "Draft ranking contains a sample outside this study plan." };
    }
    if (rank !== null && (rank < 1 || rank > sampleCount)) {
      return { success: false as const, error: "Draft ranking is outside this study plan." };
    }
  }

  return { success: true as const };
}

export async function submitResponse(studyId: string, participantId: string, payload: unknown) {
  try {
    const validated = SubmitResponseSchema.parse(payload);
    const access = await authorizeResponseParticipant(studyId, participantId, { allowCompleted: true });
    if (!access.success) {
      return { success: false, error: access.error };
    }
    const { session, guestSession, participant } = access;

    if (participant.status === "COMPLETED") {
      return { success: true, alreadySubmitted: true };
    }
    if (participant.status !== "CONFIRMED") {
      return { success: false, error: "Participant slot is not confirmed for evaluation." };
    }
    if (participant.consentStatus !== "AGREED") {
      return { success: false, error: "Please complete consent before submitting responses." };
    }
    if (participant.study.sensoryAttributes.length === 0) {
      return { success: false, error: "Study has no configured sensory attributes." };
    }

    const sampleCount = resolveStudySampleCount(participant.study.targetDemographics);
    const normalized = normalizePayloadAgainstStudy(
      validated,
      participant.study.sensoryAttributes as StudyAttributeConfig[],
      sampleCount
    );
    if (!normalized.success) {
      return { success: false, error: normalized.error };
    }

    const customQuestions = parseCustomQuestions(participant.study.customQuestions);
    const customAnswersResult = normalizeCustomAnswers(customQuestions, validated.customAnswers ?? {});
    if (!customAnswersResult.success) {
      return { success: false, error: customAnswersResult.error };
    }

    const responseData = JSON.parse(
      JSON.stringify({
        overallLiking: normalized.overallLiking,
        attributes: normalized.attributes,
        sampleResponses: normalized.sampleResponses,
        sampleRanking: normalized.sampleRanking,
        comments: normalized.comments,
        customAnswers: customAnswersResult.value,
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

        await tx.sensoryResponseDraft.deleteMany({
          where: {
            studyId,
            participantId,
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

    const traceId = createWorkflowTraceId("submit-response");
    runInBackground(
      "submit-response-post-processing",
      async () => {
        await Promise.allSettled([
          (async () => {
            const analysisEngine = new SensoryAnalysisEngine();
            await analysisEngine.analyzeStudy(studyId);
          })(),
          (async () => {
            await logUserUsage({
              actorUserId: session?.userId ?? participant.panelist.userId,
              action: "SENSORY_RESPONSE_SUBMITTED",
              entityType: "Study",
              entityId: studyId,
              summary: `Submitted sensory response for "${participant.study.title}".`,
              metadata: {
                studyId,
                participantId,
                channel: session ? "web" : "guest",
                sampleResponseCount: normalized.sampleResponses.length,
              },
            });
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
          })(),
        ]);
      },
      {
        traceId,
        metadata: { studyId, participantId },
      }
    );

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

export async function getResponseDraft(studyId: string, participantId: string) {
  try {
    const access = await authorizeResponseParticipant(studyId, participantId, { allowCompleted: true });
    if (!access.success) {
      return { success: false, error: access.error };
    }
    const { participant } = access;
    if (participant.status === "COMPLETED") {
      return { success: true, draft: null };
    }
    const readiness = validateParticipantCanDraft(participant);
    if (!readiness.success) {
      return { success: false, error: readiness.error };
    }

    const draft = await prisma.sensoryResponseDraft.findUnique({
      where: { participantId },
      select: {
        data: true,
        updatedAt: true,
        expiresAt: true,
      },
    });
    if (!draft) {
      return { success: true, draft: null };
    }

    if (draft.expiresAt.getTime() <= Date.now()) {
      await prisma.sensoryResponseDraft.deleteMany({ where: { participantId, studyId } });
      return { success: true, draft: null };
    }

    const parsed = ResponseDraftSchema.safeParse(draft.data);
    if (!parsed.success) {
      await prisma.sensoryResponseDraft.deleteMany({ where: { participantId, studyId } });
      return { success: true, draft: null };
    }

    return {
      success: true,
      draft: {
        ...parsed.data,
        updatedAt: draft.updatedAt.toISOString(),
      },
    };
  } catch (error) {
    console.error("Get response draft error:", error);
    return { success: false, error: "Failed to load response draft." };
  }
}

export async function saveResponseDraft(studyId: string, participantId: string, payload: unknown) {
  try {
    const access = await authorizeResponseParticipant(studyId, participantId);
    if (!access.success) {
      return { success: false, error: access.error };
    }
    const { participant } = access;
    const readiness = validateParticipantCanDraft(participant);
    if (!readiness.success) {
      return { success: false, error: readiness.error };
    }

    const validated = ResponseDraftSchema.parse(payload);
    const sampleCount = resolveStudySampleCount(participant.study.targetDemographics);
    if (validated.currentSampleIndex >= sampleCount) {
      return { success: false, error: "Draft sample position is outside this study plan." };
    }

    const draftValidation = validateDraftResponsesAgainstStudy(
      validated,
      participant.study.sensoryAttributes as StudyAttributeConfig[],
      sampleCount
    );
    if (!draftValidation.success) {
      return { success: false, error: draftValidation.error };
    }

    const data = JSON.parse(JSON.stringify(validated)) as Prisma.InputJsonValue;
    const expiresAt = new Date(Date.now() + DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const draft = await prisma.sensoryResponseDraft.upsert({
      where: { participantId },
      create: {
        studyId,
        participantId,
        data,
        version: 1,
        expiresAt,
      },
      update: {
        data,
        version: { increment: 1 },
        expiresAt,
      },
      select: {
        updatedAt: true,
      },
    });

    return { success: true, updatedAt: draft.updatedAt.toISOString() };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? "Invalid draft payload." };
    }
    console.error("Save response draft error:", error);
    return { success: false, error: "Failed to save response draft." };
  }
}

export async function deleteResponseDraft(studyId: string, participantId: string) {
  try {
    const access = await authorizeResponseParticipant(studyId, participantId, { allowCompleted: true });
    if (!access.success) {
      return { success: false, error: access.error };
    }
    await prisma.sensoryResponseDraft.deleteMany({
      where: {
        studyId,
        participantId,
      },
    });
    return { success: true };
  } catch (error) {
    console.error("Delete response draft error:", error);
    return { success: false, error: "Failed to delete response draft." };
  }
}

function normalizePayloadAgainstStudy(
  payload: z.infer<typeof SubmitResponseSchema>,
  attributes: StudyAttributeConfig[],
  sampleCount: number
): NormalizePayloadResult {
  const allowedAttributeNames = new Set(attributes.map((attribute) => attribute.name));
  const sampleLevelAttributes = attributes.filter((attribute) => attribute.type !== "OPEN_ENDED");
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
  const rawSampleResponses = payload.sampleResponses ?? [];
  if (rawSampleResponses.length !== sampleCount) {
    return { success: false, error: `Expected responses for exactly ${sampleCount} sample(s).` };
  }

  const seenSampleNumbers = new Set<number>();
  for (const sample of rawSampleResponses) {
    if (sample.sampleNumber > sampleCount || seenSampleNumbers.has(sample.sampleNumber)) {
      return { success: false, error: "Invalid or duplicate sample response number." };
    }
    seenSampleNumbers.add(sample.sampleNumber);

    const allowedSampleAttributeNames = new Set(sampleLevelAttributes.map((attribute) => attribute.name));
    const unknownSampleKeys = Object.keys(sample.attributes).filter((key) => !allowedSampleAttributeNames.has(key));
    if (unknownSampleKeys.length > 0) {
      return { success: false, error: `Unknown sample attribute(s): ${unknownSampleKeys.join(", ")}.` };
    }

    const normalizedSampleAttributes: Record<string, unknown> = {};
    let sampleOverallFromAttribute: number | null = null;

    for (const attribute of sampleLevelAttributes) {
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

  const rankingResult = normalizeSampleRanking(payload.sampleRanking, sampleCount);
  if (!rankingResult.success) {
    return rankingResult;
  }

  const comments = {
    likedMost: payload.comments?.likedMost?.trim() ?? "",
    improvements: payload.comments?.improvements?.trim() ?? "",
  };

  return {
    success: true,
    overallLiking: overallFromAttributes,
    attributes: normalizedAttributes,
    sampleResponses: normalizedSampleResponses,
    sampleRanking: rankingResult.value,
    comments,
  };
}

function normalizeSampleRanking(
  sampleRanking: Array<{ sampleNumber: number; rank: number }> | undefined,
  sampleCount: number
):
  | { success: true; value: NormalizedSampleRanking[] }
  | { success: false; error: string } {
  if (sampleCount <= 1) {
    return { success: true, value: [] };
  }

  if (!sampleRanking || sampleRanking.length !== sampleCount) {
    return { success: false, error: `Rank all ${sampleCount} samples before submitting.` };
  }

  const sampleNumbers = new Set<number>();
  const ranks = new Set<number>();
  const rows: NormalizedSampleRanking[] = [];

  for (const row of sampleRanking) {
    if (row.sampleNumber < 1 || row.sampleNumber > sampleCount || sampleNumbers.has(row.sampleNumber)) {
      return { success: false, error: "Invalid or duplicate ranked sample number." };
    }
    if (row.rank < 1 || row.rank > sampleCount || ranks.has(row.rank)) {
      return { success: false, error: "Each sample rank must be unique and within the sample count." };
    }

    sampleNumbers.add(row.sampleNumber);
    ranks.add(row.rank);
    rows.push({
      sampleNumber: row.sampleNumber,
      rank: row.rank,
    });
  }

  return {
    success: true,
    value: rows.sort((left, right) => left.sampleNumber - right.sampleNumber),
  };
}

function resolveStudySampleCount(value: unknown) {
  if (!value || typeof value !== "object") {
    return 1;
  }

  const raw = (value as { numberOfSamples?: unknown }).numberOfSamples;
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 1;
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
