import { prisma } from "@/lib/db";
import { notifyUser } from "@/lib/notifications";
import { ensureParticipantAssignment, formatPanelistNumber } from "@/lib/participant-assignment";
import { Prisma } from "@prisma/client";

interface TargetDemographics {
  ageRange?: [number, number];
  genders?: ("MALE" | "FEMALE" | "NON_BINARY")[];
  lifestyles?: string[];
  experience?: string;
  location?: string;
}

interface ScreeningCriterion {
  type: string;
  required?: string | boolean;
  min?: number;
  max?: number;
}

interface StratumConfig {
  variable: string; // "gender", "age_group"
  distribution: Record<string, number>; // e.g. { male: 15, female: 15 }
}

interface PanelistRecord {
  id: string;
  userId: string | null;
  age: number;
  gender: "MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_SAY";
  lifestyle: string[];
  consumptionHabits: { snacks?: string } | null;
  participations: Array<{ id: string }>;
}

interface SelectionRecord extends PanelistRecord {
  stratum: string;
}

export class StratifiedSamplingService {
  /**
   * Execute complete sampling workflow: Filter -> Screen -> Stratify -> Select
   */
  async executeSampling(
    studyId: string,
    targetDemographics: TargetDemographics,
    screeningCriteria: ScreeningCriterion[],
    stratumConfig: StratumConfig,
    totalSampleSize: number
  ) {
    const eligiblePool = await this.filterEligiblePanelists(targetDemographics);
    const qualifiedPool = await this.applyScreening(eligiblePool, studyId, screeningCriteria);
    const selection = this.performStratifiedSelection(qualifiedPool, stratumConfig, totalSampleSize);
    await this.saveSelections(studyId, selection);

    return {
      eligibleCount: eligiblePool.length,
      qualifiedCount: qualifiedPool.length,
      selected: selection.selected.length,
      waitlist: selection.waitlist.length,
      strata: selection.strataBreakdown,
    };
  }

  private async filterEligiblePanelists(target: TargetDemographics): Promise<PanelistRecord[]> {
    const where: Prisma.PanelistWhereInput = {
      isActive: true,
    };

    if (target.ageRange) {
      where.age = {
        gte: target.ageRange[0],
        lte: target.ageRange[1],
      };
    }

    if (target.genders?.length) {
      where.gender = { in: target.genders };
    }

    if (target.lifestyles?.length) {
      where.lifestyle = { hasEvery: target.lifestyles };
    }

    const records = await prisma.panelist.findMany({
      where,
      select: {
        id: true,
        userId: true,
        age: true,
        gender: true,
        lifestyle: true,
        consumptionHabits: true,
        participations: {
          where: {
            status: { in: ["SELECTED", "CONFIRMED"] },
            study: { status: { in: ["ACTIVE", "RECRUITING"] } },
          },
          select: { id: true },
        },
      },
    });

    return records as unknown as PanelistRecord[];
  }

  private async applyScreening(
    candidates: PanelistRecord[],
    studyId: string,
    criteria: ScreeningCriterion[]
  ): Promise<PanelistRecord[]> {
    const qualified: PanelistRecord[] = [];

    for (const panelist of candidates) {
      if (panelist.participations.length > 0) {
        continue;
      }

      const screeningData = this.simulateScreeningResponse(panelist);
      const isQualified = this.evaluateScreening(screeningData, criteria);

      await prisma.screeningResponse.upsert({
        where: {
          panelistId_studyId: {
            panelistId: panelist.id,
            studyId,
          },
        },
        update: {
          responses: screeningData,
          isQualified,
        },
        create: {
          panelistId: panelist.id,
          studyId,
          responses: screeningData,
          isQualified,
        },
      });

      if (isQualified) {
        qualified.push(panelist);
      }
    }

    return qualified;
  }

  private simulateScreeningResponse(panelist: PanelistRecord) {
    return {
      age: panelist.age,
      consumptionFrequency: panelist.consumptionHabits?.snacks ?? "weekly",
      allergies: "none",
      lifestyle: panelist.lifestyle,
    };
  }

  private evaluateScreening(responses: Record<string, unknown>, criteria: ScreeningCriterion[]) {
    for (const criterion of criteria) {
      if (criterion.type === "age_range") {
        const age = Number(responses.age);
        if (typeof criterion.min === "number" && age < criterion.min) return false;
        if (typeof criterion.max === "number" && age > criterion.max) return false;
      }

      if (criterion.type === "consumption") {
        if (criterion.required === "daily" && responses.consumptionFrequency !== "daily") {
          return false;
        }
      }
    }

    return true;
  }

  private performStratifiedSelection(
    qualifiedPool: PanelistRecord[],
    config: StratumConfig,
    totalSize: number
  ) {
    const strata: Record<string, PanelistRecord[]> = {};

    qualifiedPool.forEach((panelist) => {
      let stratumValue = "default";

      if (config.variable === "gender") {
        stratumValue = panelist.gender.toLowerCase();
      } else if (config.variable === "age_group") {
        stratumValue = this.getAgeGroup(panelist.age);
      }

      if (!strata[stratumValue]) {
        strata[stratumValue] = [];
      }
      strata[stratumValue].push(panelist);
    });

    const selected: SelectionRecord[] = [];
    const waitlist: SelectionRecord[] = [];
    const breakdown: Record<string, { selected: number; waitlist: number }> = {};

    for (const [stratumValue, candidates] of Object.entries(strata)) {
      const shuffled = [...candidates];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      const targetCount = config.distribution[stratumValue] ?? 0;
      const stratumSelected = shuffled.slice(0, targetCount);
      const stratumWaitlist = shuffled.slice(targetCount);

      selected.push(...stratumSelected.map((p) => ({ ...p, stratum: stratumValue })));
      waitlist.push(...stratumWaitlist.map((p) => ({ ...p, stratum: stratumValue })));

      breakdown[stratumValue] = {
        selected: stratumSelected.length,
        waitlist: stratumWaitlist.length,
      };
    }

    if (selected.length < totalSize) {
      const deficit = totalSize - selected.length;
      const promoted = waitlist.splice(0, deficit);
      selected.push(...promoted);
    }

    if (selected.length > totalSize) {
      const overflow = selected.splice(totalSize);
      waitlist.unshift(...overflow);
    }

    return {
      selected,
      waitlist,
      strataBreakdown: breakdown,
    };
  }

  private getAgeGroup(age: number): string {
    if (age <= 12) return "children";
    if (age <= 17) return "teenagers";
    if (age <= 25) return "young_adults";
    if (age <= 40) return "adults";
    if (age <= 59) return "middle_aged";
    return "seniors";
  }

  private async saveSelections(studyId: string, selection: { selected: SelectionRecord[]; waitlist: SelectionRecord[] }) {
    const notifications: Array<{
      userId: string;
      status: "SELECTED" | "WAITLIST";
      panelistNumber: number | null;
      randomizeCode: string | null;
    }> = [];

    await prisma.$transaction(async (tx) => {
      const persistRows = async (rows: SelectionRecord[], status: "SELECTED" | "WAITLIST") => {
        for (let idx = 0; idx < rows.length; idx += 1) {
          const participant = rows[idx];
          const existing = await tx.studyParticipant.findUnique({
            where: {
              studyId_panelistId: {
                studyId,
                panelistId: participant.id,
              },
            },
            select: {
              id: true,
              panelistNumber: true,
              randomizeCode: true,
              sampleCodes: true,
            },
          });

          const baseUpdate = {
            status,
            stratum: participant.stratum,
            selectionOrder: idx + 1,
            invitationSent: status === "SELECTED" ? new Date() : null,
          } as const;

          let persistedId = existing?.id;
          let panelistNumber = existing?.panelistNumber ?? null;
          let randomizeCode = existing?.randomizeCode ?? null;
          let sampleCodes = existing?.sampleCodes ?? null;

          if (existing) {
            await tx.studyParticipant.update({
              where: { id: existing.id },
              data: baseUpdate,
            });
          } else {
            const created = await tx.studyParticipant.create({
              data: {
                studyId,
                panelistId: participant.id,
                ...baseUpdate,
              },
              select: {
                id: true,
                panelistNumber: true,
                randomizeCode: true,
                sampleCodes: true,
              },
            });
            persistedId = created.id;
            panelistNumber = created.panelistNumber;
            randomizeCode = created.randomizeCode;
            sampleCodes = created.sampleCodes;
          }

          if (!persistedId) {
            continue;
          }

          const assigned = await ensureParticipantAssignment(tx, {
            participantId: persistedId,
            studyId,
            panelistNumber,
            randomizeCode,
            sampleCodes,
          });

          if (participant.userId) {
            notifications.push({
              userId: participant.userId,
              status,
              panelistNumber: assigned.panelistNumber,
              randomizeCode: assigned.randomizeCode,
            });
          }
        }
      };

      await persistRows(selection.selected, "SELECTED");
      await persistRows(selection.waitlist, "WAITLIST");
    });

    for (const entry of notifications) {
      await notifyUser(entry.userId, {
        title: entry.status === "SELECTED" ? "Study slot assigned" : "You are on study waitlist",
        message:
          entry.status === "SELECTED"
            ? `You are qualified for a sensory session. Panelist No: ${formatPanelistNumber(entry.panelistNumber)}.`
            : `You are currently waitlisted. Panelist No: ${formatPanelistNumber(entry.panelistNumber)}.`,
        level: "INFO",
        category: "SURVEY",
        actionUrl: `/studies/${studyId}/start`,
        metadata: {
          studyId,
          panelistNumber: entry.panelistNumber,
          randomizeCode: entry.randomizeCode,
          status: entry.status,
        },
      });
    }
  }

  /**
   * Handle cancellation by promoting the next participant from waitlist.
   */
  async handleCancellation(studyId: string, participantId: string) {
    const cancelled = await prisma.studyParticipant.update({
      where: { id: participantId },
      data: { status: "CANCELLED" },
    });

    const nextInLine = await prisma.studyParticipant.findFirst({
      where: {
        studyId,
        status: "WAITLIST",
        stratum: cancelled.stratum,
      },
      orderBy: { selectionOrder: "asc" },
    });

    if (!nextInLine) {
      return null;
    }

    await prisma.studyParticipant.update({
      where: { id: nextInLine.id },
      data: {
        status: "SELECTED",
        invitationSent: new Date(),
      },
    });

    await ensureParticipantAssignment(prisma, {
      participantId: nextInLine.id,
      studyId,
      panelistNumber: nextInLine.panelistNumber,
      randomizeCode: nextInLine.randomizeCode,
      sampleCodes: nextInLine.sampleCodes,
    });

    return nextInLine;
  }
}
