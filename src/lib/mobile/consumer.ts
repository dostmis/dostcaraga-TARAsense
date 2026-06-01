import { prisma } from "@/lib/db";
import {
  doesPanelistMatchTargetConsumer,
  getTargetConsumerSummary,
} from "@/lib/target-consumer";
import {
  normalizeDateValue,
  parseStudySessionSchedule,
} from "@/lib/study-schedule";
import { ensureParticipantAssignment } from "@/lib/participant-assignment";
import { runSerializableTransaction, lockStudyRow } from "@/lib/db-transaction";
import { notifyUser } from "@/lib/notifications";
import { logUserUsage } from "@/lib/user-usage";
import {
  buildVisibleStudiesWhere,
  getUserLocation,
  isStudyVisibleToUser,
} from "@/lib/locations/study-visibility";

export async function getConsumerAvailableStudies(userId: string, query?: string, limit = 20) {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 50));

  const panelist = await prisma.panelist.findFirst({
    where: { userId },
    select: {
      id: true,
      age: true,
      gender: true,
      lifestyle: true,
      dietaryPrefs: true,
      consumptionHabits: true,
      isActive: true,
    },
  });

  if (!panelist || panelist.isActive === false) {
    return {
      profileRequired: true,
      studies: [],
      meta: {
        query: normalizedQuery,
        limit: boundedLimit,
        count: 0,
      },
    };
  }

  const userLocation = await getUserLocation(userId);
  const visibilityWhere = buildVisibleStudiesWhere(userLocation);

  const studies = await prisma.study.findMany({
    where: {
      status: { in: ["RECRUITING", "ACTIVE"] },
      sensoryAttributes: {
        some: {},
      },
      AND: [visibilityWhere],
    },
    orderBy: { createdAt: "desc" },
    include: {
      participants: {
        select: {
          id: true,
          status: true,
          panelistNumber: true,
          offeredSessions: true,
          requestedSessionAt: true,
          sessionAt: true,
          panelist: {
            select: {
              id: true,
              userId: true,
            },
          },
        },
      },
      _count: {
        select: {
          sensoryAttributes: true,
          participants: true,
          responses: true,
        },
      },
    },
    take: Math.max(boundedLimit * 3, boundedLimit),
  });

  const matchedStudies = studies
    .filter((study) => doesPanelistMatchTargetConsumer(panelist, study.targetDemographics))
    .filter((study) => {
      const myParticipation = study.participants.find((participant) => participant.panelist.userId === userId);
      return myParticipation?.status !== "COMPLETED";
    })
    .filter((study) => {
      if (!normalizedQuery) {
        return true;
      }

      const searchable = [
        study.title,
        study.productName,
        study.category,
        study.stage,
        study.status,
        study.location,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedQuery);
    })
    .slice(0, boundedLimit);

  return {
    profileRequired: false,
    studies: matchedStudies.map((study) => {
      const myParticipation = study.participants.find((participant) => participant.panelist.id === panelist.id) ?? null;
      const sessionSchedule = parseStudySessionSchedule(study.targetDemographics);
      const sessionSlots =
        sessionSchedule?.slots.map((slot) => {
          const reservedCount = study.participants.filter((participant) => {
            if (participant.status === "CANCELLED" || participant.status === "DECLINED") {
              return false;
            }

            const selectedStart = normalizeDateValue(participant.sessionAt ?? participant.requestedSessionAt);
            return selectedStart === slot.startsAt;
          }).length;

          return {
            id: slot.id,
            label: slot.label,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            capacity: slot.capacity,
            reservedCount,
            remainingCount: Math.max(0, slot.capacity - reservedCount),
          };
        }) ?? [];

      return {
        id: study.id,
        title: study.title,
        productName: study.productName,
        category: study.category,
        stage: study.stage,
        status: study.status,
        description: study.description,
        location: study.location,
        sampleSize: study.sampleSize,
        responseCount: study._count.responses,
        participantCount: study._count.participants,
        questionnaireCount: study._count.sensoryAttributes,
        targetConsumerSummary: getTargetConsumerSummary(study.targetDemographics),
        createdAt: study.createdAt.toISOString(),
        updatedAt: study.updatedAt.toISOString(),
        myParticipation: myParticipation
          ? {
              id: myParticipation.id,
              status: myParticipation.status,
              panelistNumber: myParticipation.panelistNumber,
              requestedSessionAt: myParticipation.requestedSessionAt?.toISOString() ?? null,
              sessionAt: myParticipation.sessionAt?.toISOString() ?? null,
            }
          : null,
        sessionSchedule: sessionSchedule
          ? {
              timezone: sessionSchedule.timezone,
              startDate: sessionSchedule.startDate,
              durationDays: sessionSchedule.durationDays,
              slots: sessionSlots,
            }
          : null,
        links: {
          form: `/studies/${study.id}/form`,
          start: `/studies/${study.id}/start`,
        },
      };
    }),
    meta: {
      query: normalizedQuery,
      limit: boundedLimit,
      count: matchedStudies.length,
    },
  };
}

export async function joinStudy(
  userId: string,
  studyId: string,
  requestedSessionAt?: string,
): Promise<
  | {
      success: true;
      participant: {
        id: string;
        studyId: string;
        status: string;
        consentStatus: string;
        requestedSessionAt: string | null;
        panelistNumber: number | null;
        randomizeCode: string | null;
      };
    }
  | {
      success: false;
      error: string;
    }
> {
  const panelist = await prisma.panelist.findFirst({
    where: { userId },
    select: {
      id: true,
      age: true,
      gender: true,
      lifestyle: true,
      dietaryPrefs: true,
      consumptionHabits: true,
      isActive: true,
    },
  });

  if (!panelist) {
    return {
      success: false,
      error: "Consumer profile not found. Please complete your profile first.",
    };
  }

  if (!panelist.isActive) {
    return {
      success: false,
      error: "Your consumer profile is inactive.",
    };
  }

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      title: true,
      status: true,
      targetDemographics: true,
      creatorId: true,
      locationTarget: {
        select: {
          scope: true,
          regionId: true,
          provinceId: true,
          cityId: true,
          barangayId: true,
        },
      },
    },
  });

  if (!study) {
    return {
      success: false,
      error: "Study not found.",
    };
  }

  if (study.status !== "RECRUITING" && study.status !== "ACTIVE") {
    return {
      success: false,
      error: "This study is not accepting new participants.",
    };
  }

  if (!doesPanelistMatchTargetConsumer(panelist, study.targetDemographics)) {
    return {
      success: false,
      error: "You do not match the target consumer profile for this study.",
    };
  }

  // Location gate: studies with explicit targets require a completed user profile.
  const userLocation = await getUserLocation(userId);
  if (!isStudyVisibleToUser(study.locationTarget, userLocation)) {
    if (!userLocation) {
      return {
        success: false,
        error: "Complete your profile location before joining studies in this area.",
      };
    }
    return {
      success: false,
      error: "This study is restricted to participants in a different area.",
    };
  }

  const existing = await prisma.studyParticipant.findFirst({
    where: { studyId, panelistId: panelist.id },
  });

  if (existing) {
    return {
      success: false,
      error: "You have already joined this study.",
    };
  }

  const parsedSessionAt = requestedSessionAt ? new Date(requestedSessionAt) : undefined;

  try {
    const result = await runSerializableTransaction(async (tx) => {
      await lockStudyRow(tx, studyId);

      const existingParticipantCount = await tx.studyParticipant.count({
        where: { studyId },
      });

      const participant = await tx.studyParticipant.create({
        data: {
          studyId,
          panelistId: panelist.id,
          source: "REGISTERED_CONSUMER",
          status: "SELECTED",
          consentStatus: "PENDING",
          requestedSessionAt: parsedSessionAt,
          selectionOrder: existingParticipantCount + 1,
        },
        select: {
          id: true,
          studyId: true,
          panelistId: true,
          status: true,
          consentStatus: true,
          requestedSessionAt: true,
          panelistNumber: true,
          randomizeCode: true,
          sampleCodes: true,
        },
      });

      const assigned = await ensureParticipantAssignment(tx, {
        participantId: participant.id,
        studyId: participant.studyId,
        panelistNumber: participant.panelistNumber,
        randomizeCode: participant.randomizeCode,
        sampleCodes: participant.sampleCodes,
      });

      return {
        participant,
        assigned,
      };
    }, { label: "joinStudy" });

    void notifyUser(study.creatorId, {
      title: "New study registration",
      message: `A consumer registered for ${study.title}.`,
      category: "STUDY",
      actionUrl: `/dashboard/${studyId}`,
      metadata: { studyId, participantId: result.participant.id, type: "STUDY_REGISTRATION" },
    }).catch((error) => {
      console.error("[push] notifyUser MSME (study registration) failed:", error);
    });
    void logUserUsage({
      actorUserId: userId,
      action: "STUDY_PARTICIPATION_SUBMITTED",
      entityType: "Study",
      entityId: studyId,
      summary: `Joined study "${study.title}" from mobile.`,
      metadata: {
        channel: "mobile",
        studyId,
        participantId: result.participant.id,
        requestedSessionAt: result.participant.requestedSessionAt?.toISOString() ?? null,
      },
    });

    return {
      success: true,
      participant: {
        id: result.participant.id,
        studyId: result.participant.studyId,
        status: result.participant.status,
        consentStatus: result.participant.consentStatus,
        requestedSessionAt: result.participant.requestedSessionAt?.toISOString() ?? null,
        panelistNumber: result.assigned.panelistNumber ?? null,
        randomizeCode: result.assigned.randomizeCode ?? null,
      },
    };
  } catch (error) {
    console.error("Mobile joinStudy error:", { userId, studyId, error });
    return {
      success: false,
      error: "Failed to join study. Please try again.",
    };
  }
}

export async function getConsumerStudyForm(
  studyId: string,
): Promise<
  | {
      success: true;
      form: {
        studyId: string;
        title: string;
        attributes: Array<{
          id: string;
          name: string;
          type: string;
          order: number;
          attributeType: string | null;
          jarOptions: unknown;
        }>;
        questions: Array<{
          id: string;
          text: string | null;
          type: string | null;
          order: number;
        }>;
      };
    }
  | {
      success: false;
      error: string;
    }
> {
  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      title: true,
      status: true,
      sensoryAttributes: {
        select: {
          id: true,
          name: true,
          type: true,
          order: true,
          attributeType: true,
          jarOptions: true,
        },
        orderBy: { order: "asc" },
      },
      sensoryQuestions: {
        select: {
          id: true,
          questionText: true,
          questionType: true,
          order: true,
        },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!study) {
    return {
      success: false,
      error: "Study not found.",
    };
  }

  if (study.status !== "RECRUITING" && study.status !== "ACTIVE") {
    return {
      success: false,
      error: "This study is not available.",
    };
  }

  return {
    success: true,
    form: {
      studyId: study.id,
      title: study.title,
      attributes: study.sensoryAttributes.map((attr) => ({
        id: attr.id,
        name: attr.name,
        type: attr.type,
        order: attr.order,
        attributeType: attr.attributeType,
        jarOptions: attr.jarOptions,
      })),
      questions: study.sensoryQuestions.map((q) => ({
        id: q.id,
        text: q.questionText,
        type: q.questionType,
        order: q.order,
      })),
    },
  };
}

export async function getConsumerStudyResults(userId: string, studyId: string) {
  const panelist = await prisma.panelist.findFirst({
    where: { userId },
    select: { id: true },
  });

  if (!panelist) {
    return {
      success: false,
      error: "Consumer profile not found.",
    };
  }

  const participant = await prisma.studyParticipant.findFirst({
    where: {
      studyId,
      panelistId: panelist.id,
    },
    select: { id: true, status: true },
  });

  if (!participant) {
    return {
      success: false,
      error: "You did not participate in this study.",
    };
  }

  if (participant.status !== "COMPLETED") {
    return {
      success: false,
      error: "Results are only available after study completion.",
    };
  }

  const analysis = await prisma.studyAnalysis.findUnique({
    where: { studyId },
    select: {
      overallLiking: true,
      attributeStats: true,
      penaltyAnalysis: true,
      updatedAt: true,
    },
  });

  if (!analysis) {
    return {
      success: false,
      error: "Analysis results not yet available for this study.",
    };
  }

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: {
      title: true,
      productName: true,
      sensoryAttributes: {
        select: {
          id: true,
          name: true,
          type: true,
          attributeType: true,
        },
      },
    },
  });

  if (!study) {
    return {
      success: false,
      error: "Study not found.",
    };
  }

  const overallLikingData = analysis.overallLiking as {
    perSampleResults?: Array<{
      sampleNumber: number;
      mean: number;
      stdDev: number;
      n: number;
      sampleLabel?: string;
    }>;
    bySample?: Array<{
      sampleNumber: number;
      mean: number;
      stdDev: number;
      n: number;
      sampleLabel?: string;
    }>;
  } | null;

  const perSampleResults = (overallLikingData?.perSampleResults || overallLikingData?.bySample || []) as Array<{
    sampleNumber: number;
    mean: number;
    stdDev: number;
    n: number;
    sampleLabel?: string;
  }>;

  const attributeStatsData = analysis.attributeStats as
    | Array<{
        sampleNumber: number;
        attributes: Array<{
          name: string;
          mean: number;
          stdDev: number;
          n: number;
        }>;
      }>
    | null;

  const formattedResults = perSampleResults.map((sample) => {
    const attrs = attributeStatsData?.find((a) => a.sampleNumber === sample.sampleNumber)?.attributes || [];

    const decision = sample.mean >= 7 ? "Generally liked" : sample.mean >= 5 ? "Acceptable" : "Needs improvement";

    return {
      sampleNumber: sample.sampleNumber,
      sampleLabel: sample.sampleLabel || `Sample ${sample.sampleNumber}`,
      metrics: {
        participants: sample.n,
        meanLiking: Math.round(sample.mean * 100) / 100,
        stdDeviation: Math.round(sample.stdDev * 100) / 100,
        decision,
      },
      attributes: attrs.map((attr) => ({
        name: attr.name,
        mean: Math.round(attr.mean * 100) / 100,
        stdDev: Math.round(attr.stdDev * 100) / 100,
        n: attr.n,
      })),
    };
  });

  return {
    success: true,
    results: {
      studyId,
      title: study.title,
      productName: study.productName,
      samplesCount: perSampleResults.length,
      generatedAt: analysis.updatedAt.toISOString(),
      perSampleResults: formattedResults,
      penaltyAnalysis: analysis.penaltyAnalysis,
    },
  };
}

export async function getConsumerCompletedStudies(userId: string, query?: string, limit = 20) {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 50));

  const panelist = await prisma.panelist.findFirst({
    where: { userId },
    select: {
      id: true,
      isActive: true,
    },
  });

  if (!panelist) {
    return {
      profileRequired: true,
      studies: [],
      meta: {
        query: normalizedQuery,
        limit: boundedLimit,
        count: 0,
      },
    };
  }

  const participations = await prisma.studyParticipant.findMany({
    where: {
      panelistId: panelist.id,
      status: "COMPLETED",
    },
    orderBy: [
      { completedAt: "desc" },
      { selectionOrder: "desc" },
    ],
    include: {
      study: {
        select: {
          id: true,
          title: true,
          productName: true,
          category: true,
          stage: true,
          status: true,
          description: true,
          location: true,
          sampleSize: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              sensoryAttributes: true,
              participants: true,
              responses: true,
            },
          },
        },
      },
      responses: {
        select: {
          id: true,
          submittedAt: true,
        },
        orderBy: {
          submittedAt: "desc",
        },
        take: 1,
      },
    },
    take: Math.max(boundedLimit * 3, boundedLimit),
  });

  const matchedParticipations = participations
    .filter((participation) => {
      if (!normalizedQuery) {
        return true;
      }

      const searchable = [
        participation.study.title,
        participation.study.productName,
        participation.study.category,
        participation.study.stage,
        participation.study.status,
        participation.study.location,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedQuery);
    })
    .slice(0, boundedLimit);

  return {
    profileRequired: false,
    studies: matchedParticipations.map((participation) => {
      const response = participation.responses[0] ?? null;

      return {
        id: participation.study.id,
        title: participation.study.title,
        productName: participation.study.productName,
        category: participation.study.category,
        stage: participation.study.stage,
        status: participation.study.status,
        description: participation.study.description,
        location: participation.study.location,
        sampleSize: participation.study.sampleSize,
        responseCount: participation.study._count.responses,
        participantCount: participation.study._count.participants,
        questionnaireCount: participation.study._count.sensoryAttributes,
        createdAt: participation.study.createdAt.toISOString(),
        updatedAt: participation.study.updatedAt.toISOString(),
        myParticipation: {
          id: participation.id,
          status: participation.status,
          panelistNumber: participation.panelistNumber,
          completedAt: participation.completedAt?.toISOString() ?? null,
          responseId: response?.id ?? null,
          submittedAt: response?.submittedAt.toISOString() ?? participation.completedAt?.toISOString() ?? null,
        },
        links: {
          completed: `/test/completed?studyId=${participation.study.id}`,
          form: `/studies/${participation.study.id}/form`,
        },
      };
    }),
    meta: {
      query: normalizedQuery,
      limit: boundedLimit,
      count: matchedParticipations.length,
    },
  };
}
