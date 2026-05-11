import { prisma } from "@/lib/db";
import {
  doesPanelistMatchTargetConsumer,
  getTargetConsumerSummary,
} from "@/lib/target-consumer";
import {
  normalizeDateValue,
  parseStudySessionSchedule,
} from "@/lib/study-schedule";

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

  const studies = await prisma.study.findMany({
    where: {
      status: { in: ["RECRUITING", "ACTIVE"] },
      sensoryAttributes: {
        some: {},
      },
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
