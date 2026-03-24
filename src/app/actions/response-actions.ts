"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { SensoryAnalysisEngine } from "@/lib/services/analysis-engine";
import { Prisma } from "@prisma/client";
import { notifyUser } from "@/lib/notifications";
import { getCurrentSession } from "@/lib/auth/session";

const SubmitResponseSchema = z.object({
  overallLiking: z.number().min(1).max(9),
  attributes: z.record(z.string(), z.unknown()),
  sampleResponses: z
    .array(
      z.object({
        sampleNumber: z.number().int().min(1),
        overallLiking: z.number().min(1).max(9).optional(),
        attributes: z.record(z.string(), z.unknown()),
      })
    )
    .optional(),
  submittedAt: z.string().datetime().optional(),
});

export async function submitResponse(studyId: string, participantId: string, payload: unknown) {
  try {
    const session = await getCurrentSession();
    if (!session) {
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
        study: {
          select: {
            id: true,
            title: true,
            creatorId: true,
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
    if (session.role === "CONSUMER" && participant.panelist.userId !== session.userId) {
      return { success: false, error: "You are not allowed to answer this study participant slot." };
    }
    if (session.role === "MSME" && participant.study.creatorId === session.userId) {
      return { success: false, error: "MSME users cannot answer their own created studies." };
    }
    if (participant.status === "COMPLETED") {
      return { success: false, error: "You already submitted this study." };
    }

    const existing = await prisma.sensoryResponse.findFirst({
      where: {
        studyId,
        participantId,
      },
      orderBy: {
        submittedAt: "desc",
      },
      select: { id: true },
    });
    if (existing) {
      return { success: false, error: "You already submitted this study." };
    }

    const responseData = JSON.parse(
      JSON.stringify({
        overallLiking: validated.overallLiking,
        attributes: validated.attributes,
        sampleResponses: validated.sampleResponses ?? [],
      })
    ) as Prisma.InputJsonValue;

    const submittedAt = validated.submittedAt ? new Date(validated.submittedAt) : new Date();

    await prisma.sensoryResponse.create({
      data: {
        studyId,
        participantId,
        data: responseData,
        submittedAt,
      },
    });

    await prisma.studyParticipant.update({
      where: { id: participantId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    const analysisEngine = new SensoryAnalysisEngine();
    await analysisEngine.analyzeStudy(studyId);

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

    revalidatePath(`/dashboard/${studyId}`);
    revalidatePath("/");

    return { success: true };
  } catch (error) {
    console.error("Submit response error:", error);
    return { success: false, error: "Failed to submit response." };
  }
}
