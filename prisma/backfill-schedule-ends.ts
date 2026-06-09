/**
 * One-time backfill: populate Study.scheduleEndsAt for studies that were
 * created before automatic closure existed.
 *
 * Run with:  npx tsx prisma/backfill-schedule-ends.ts
 *
 * Only studies with a parseable session schedule get a value; studies without
 * one (market studies, schedule-less self-managed studies) keep a null
 * scheduleEndsAt and are never auto-closed. Idempotent — safe to re-run.
 */
import { PrismaClient } from "@prisma/client";
import { getStudyScheduleEnd } from "../src/lib/study-schedule";

const prisma = new PrismaClient();

async function main() {
  const studies = await prisma.study.findMany({
    where: {
      status: { in: ["RECRUITING", "ACTIVE"] },
      scheduleEndsAt: null,
    },
    select: { id: true, targetDemographics: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const study of studies) {
    const scheduleEnd = getStudyScheduleEnd(study.targetDemographics);
    if (!scheduleEnd) {
      skipped += 1;
      continue;
    }
    await prisma.study.update({
      where: { id: study.id },
      data: { scheduleEndsAt: scheduleEnd },
    });
    updated += 1;
  }

  console.log(`Backfill complete. scanned=${studies.length} updated=${updated} skipped(no schedule)=${skipped}`);
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
