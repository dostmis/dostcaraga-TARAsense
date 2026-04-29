import { prisma } from "@/lib/db";

export async function getMsmeDashboardData(userId: string, query?: string) {
  const normalizedQuery = (query ?? "").trim().toLowerCase();

  const [totalStudies, ficBookings, totalResponses, activeStudies, studies] = await Promise.all([
    prisma.study.count({
      where: { creatorId: userId },
    }),
    prisma.study.count({
      where: {
        creatorId: userId,
        OR: [
          {
            targetDemographics: {
              path: ["coordinationMode"],
              equals: "FIC_ASSISTED",
            },
          },
          {
            location: {
              contains: "fic",
              mode: "insensitive",
            },
          },
        ],
      },
    }),
    prisma.sensoryResponse.count({
      where: {
        study: {
          creatorId: userId,
        },
      },
    }),
    prisma.study.count({
      where: {
        creatorId: userId,
        status: { in: ["ACTIVE", "RECRUITING"] },
      },
    }),
    prisma.study.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        participants: {
          orderBy: { selectionOrder: "asc" },
          select: {
            id: true,
            status: true,
            completedAt: true,
            panelist: { select: { name: true } },
          },
        },
        _count: {
          select: {
            responses: true,
            participants: true,
          },
        },
      },
      take: 50,
    }),
  ]);

  const filteredStudies = normalizedQuery
    ? studies.filter((study) => {
        const searchable = [
          study.title,
          study.productName,
          study.location,
          study.category,
          study.stage,
          study.status,
          ...study.participants.map((participant) => participant.panelist.name),
        ]
          .join(" ")
          .toLowerCase();
        return searchable.includes(normalizedQuery);
      })
    : studies;

  return {
    stats: {
      ficBookings,
      totalStudies,
      totalResponses,
      activeStudies,
    },
    studies: filteredStudies.map((study) => ({
      id: study.id,
      title: study.title,
      productName: study.productName,
      creatorId: study.creatorId,
      location: study.location,
      category: study.category,
      stage: study.stage,
      status: study.status,
      sampleSize: study.sampleSize,
      description: study.description,
      createdAt: study.createdAt.toISOString(),
      updatedAt: study.updatedAt.toISOString(),
      responseCount: study._count.responses,
      participantCount: study._count.participants,
      targetReached: study._count.responses >= study.sampleSize,
      participants: study.participants.map((participant) => ({
        id: participant.id,
        status: participant.status,
        completedAt: participant.completedAt?.toISOString() ?? null,
        panelistName: participant.panelist.name,
      })),
      links: {
        form: `/studies/${study.id}/form`,
        dashboard: `/dashboard/${study.id}`,
      },
    })),
  };
}
