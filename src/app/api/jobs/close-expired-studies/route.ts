import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notifyUser } from "@/lib/notifications";
import { logUserUsage } from "@/lib/user-usage";

const MAX_STUDIES_PER_RUN = 200;

/**
 * Scheduled job: closes studies whose testing schedule has ended.
 *
 * Because every recruiting feed (consumer "Available Surveys", MSME "Evaluate
 * Studies", and the mobile feeds) lists only studies with status RECRUITING or
 * ACTIVE, moving an expired study out of those statuses removes it from every
 * dashboard at once.
 *
 *  - Reached its target responses  -> COMPLETED
 *  - Below its target responses    -> ANALYZING (eligible for repost)
 *
 * Studies without a parseable session schedule have a null scheduleEndsAt and
 * are never auto-closed.
 *
 * Mirror of the session-reminders job: authenticated with the shared
 * x-cron-secret header.
 */
export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error("CRON_SECRET is missing. Refusing to run close-expired-studies job.");
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 503 });
    }

    const incoming = request.headers.get("x-cron-secret") ?? "";
    const incomingBuf = Buffer.from(incoming, "utf8");
    const expectedBuf = Buffer.from(cronSecret, "utf8");
    const valid =
      incomingBuf.length === expectedBuf.length && timingSafeEqual(incomingBuf, expectedBuf);
    if (!valid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();

    const expiredStudies = await prisma.study.findMany({
      where: {
        status: { in: ["RECRUITING", "ACTIVE"] },
        scheduleEndsAt: { not: null, lte: now },
      },
      orderBy: { scheduleEndsAt: "asc" },
      select: {
        id: true,
        title: true,
        creatorId: true,
        sampleSize: true,
        targetDemographics: true,
        scheduleEndsAt: true,
        _count: { select: { responses: true } },
      },
      take: MAX_STUDIES_PER_RUN,
    });

    let completed = 0;
    let needsRepost = 0;

    for (const study of expiredStudies) {
      const responsesAtClose = study._count.responses;
      const reachedTarget = responsesAtClose >= study.sampleSize;
      const nextStatus = reachedTarget ? "COMPLETED" : "ANALYZING";

      const mergedTargetDemographics = withClosureMetadata(study.targetDemographics, {
        closedAt: now.toISOString(),
        reason: reachedTarget ? "TARGET_REACHED" : "BELOW_MINIMUM",
        scheduleEndsAt: study.scheduleEndsAt?.toISOString() ?? null,
        responsesAtClose,
        sampleSize: study.sampleSize,
      });

      // Guard the status in the WHERE clause so a concurrent run (or a manual
      // status change) cannot double-process the same study.
      const updateResult = await prisma.study.updateMany({
        where: { id: study.id, status: { in: ["RECRUITING", "ACTIVE"] } },
        data: {
          status: nextStatus,
          closedAt: now,
          targetDemographics: mergedTargetDemographics,
        },
      });
      if (updateResult.count === 0) {
        continue;
      }

      if (reachedTarget) {
        completed += 1;
      } else {
        needsRepost += 1;
      }

      await notifyUser(study.creatorId, {
        title: reachedTarget ? "Study completed" : "Study closed — below target",
        message: reachedTarget
          ? `"${study.title}" reached its target responses (${responsesAtClose}/${study.sampleSize}) and its testing window has ended. View the analysis to finalize.`
          : `"${study.title}" closed with ${responsesAtClose}/${study.sampleSize} responses. Repost it to recruit more participants for a stronger analysis.`,
        level: reachedTarget ? "SUCCESS" : "WARNING",
        category: "STUDY",
        actionUrl: reachedTarget ? `/dashboard/${study.id}` : `/msme/dashboard?view=history`,
        metadata: {
          studyId: study.id,
          type: reachedTarget ? "STUDY_COMPLETED" : "STUDY_NEEDS_REPOST",
          responsesAtClose,
          sampleSize: study.sampleSize,
        },
      });

      await logUserUsage({
        actorUserId: null,
        action: "STUDY_AUTO_CLOSED",
        entityType: "Study",
        entityId: study.id,
        summary: `Auto-closed "${study.title}" (${nextStatus}) at end of schedule with ${responsesAtClose}/${study.sampleSize} responses.`,
        metadata: {
          studyId: study.id,
          nextStatus,
          reachedTarget,
          responsesAtClose,
          sampleSize: study.sampleSize,
        },
      });
    }

    return NextResponse.json({
      scanned: expiredStudies.length,
      completed,
      needsRepost,
      processedAt: now.toISOString(),
      truncated: expiredStudies.length === MAX_STUDIES_PER_RUN,
    });
  } catch (error) {
    console.error("Failed to close expired studies:", error);
    return NextResponse.json({ error: "Failed to close expired studies" }, { status: 500 });
  }
}

function withClosureMetadata(
  targetDemographics: Prisma.JsonValue,
  closure: {
    closedAt: string;
    reason: "TARGET_REACHED" | "BELOW_MINIMUM";
    scheduleEndsAt: string | null;
    responsesAtClose: number;
    sampleSize: number;
  }
): Prisma.InputJsonValue {
  const base =
    targetDemographics && typeof targetDemographics === "object" && !Array.isArray(targetDemographics)
      ? (targetDemographics as Record<string, unknown>)
      : {};

  return { ...base, closure } as Prisma.InputJsonValue;
}
