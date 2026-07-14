"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { StratifiedSamplingService } from "@/lib/services/sampling-service";
import { getCurrentSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createStudyRandomCodeBook, parseStudyRandomCodeBook } from "@/lib/random-codebook";
import { getStudyScheduleEnd } from "@/lib/study-schedule";
import { buildSessionSchedule, extractBookingDatesFromSchedule } from "@/lib/study-session-builder";
import { isFacilityInRegion, isValidRegion } from "@/lib/facility-constants";
import { notifyRole } from "@/lib/notifications";
import { logUserUsage } from "@/lib/user-usage";
import { CUSTOM_QUESTION_TYPES, MAX_CUSTOM_QUESTIONS } from "@/lib/custom-questions";

const MAX_STUDY_ATTRIBUTES_STRICT = 5;
const MAX_STUDY_QUESTION_ROWS_STRICT = 13;
const MAX_STUDY_ATTRIBUTES_IMPORT = 25;
const MAX_ATTRIBUTE_NAME_LENGTH = 120;
const ALLOWED_ATTRIBUTE_TYPES = [
  "appearance",
  "aroma",
  "texture",
  "taste",
  "mouthfeel",
  "flavor",
  "aftertaste",
];
type SopMode = "STRICT_NEW_STUDY" | "IMPORT_COMPLETED_STUDY";

class StudyCreationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyCreationConflictError";
  }
}

const CreateStudySchema = z.object({
  title: z.string().min(3),
  productName: z.string().min(1),
  category: z.enum(["BEVERAGE", "SNACK", "DESSERT", "FUNCTIONAL_FOOD", "DAIRY", "BAKERY"]),
  stage: z.enum(["EXPLORATORY", "PROTOTYPE_CHECK", "REFINEMENT", "MARKET_READINESS"]),
  sampleSize: z.number().min(4).max(200),
  location: z.string(),
  targetDemographics: z.object({
    ageRange: z.tuple([z.number(), z.number()]),
    genders: z.array(z.enum(["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_SAY"])).optional(),
    lifestyles: z.array(z.string()).optional(),
    experience: z.string().optional()
  }).passthrough(),
  stratificationVar: z.enum(["gender", "age_group", "none"]),
  sopMode: z.enum(["STRICT_NEW_STUDY", "IMPORT_COMPLETED_STUDY"]).optional(),
  ficBooking: z.object({
    ficUserId: z.string().min(1),
    region: z.string().min(1),
    facility: z.string().min(1),
    bookingDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(62),
  }).optional(),
  attributes: z.array(z.object({
    name: z.string(),
    type: z.enum(["OVERALL_LIKING", "ATTRIBUTE_LIKING", "JAR", "OPEN_ENDED"]),
    attributeType: z.string().optional(),
    sourceAttributeName: z.string().optional(),
    isCustom: z.boolean().optional(),
    questionType: z.enum(["HEDONIC", "JAR", "OPEN_ENDED"]).optional(),
    scaleType: z.enum(["NINE_PT", "JAR_5PT", "TEXT"]).optional(),
    jarOptions: z.object({
      low: z.string(),
      midLow: z.string().optional(),
      mid: z.string(),
      midHigh: z.string().optional(),
      high: z.string(),
      labels: z.array(z.string()).optional(),
    }).optional()
  })),
  screeningQuestions: z.array(z.object({
    question: z.string(),
    type: z.enum(["single_choice", "multiple_choice", "text", "age_range", "consumption"]),
    options: z.array(z.string()).optional(),
    required: z.union([z.boolean(), z.string()]).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })),
  customQuestions: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        type: z.enum(CUSTOM_QUESTION_TYPES),
        options: z.array(z.string()).default([]),
        required: z.boolean().default(false),
        order: z.number().int(),
      })
    )
    .max(MAX_CUSTOM_QUESTIONS)
    .optional(),
});

export async function createStudy(
  data: z.infer<typeof CreateStudySchema>,
  userId: string,
  options: { skipBroadcast?: boolean } = {}
) {
  try {
    // Validate
    const validated = CreateStudySchema.parse(data);
    const sopMode: SopMode = validated.sopMode ?? "STRICT_NEW_STUDY";
    const normalizedFicBooking = normalizeFicBooking(validated.ficBooking);
    const normalizedAttributes = validated.attributes.map((attribute) => ({
      ...attribute,
      name: attribute.name.trim(),
      sourceAttributeName: attribute.sourceAttributeName?.trim(),
      attributeType: attribute.attributeType?.trim().toLowerCase(),
      isCustom: Boolean(attribute.isCustom),
      jarOptions:
        attribute.type === "JAR" && attribute.jarOptions
          ? {
            low: attribute.jarOptions.low.trim(),
            midLow: attribute.jarOptions.midLow?.trim(),
            mid: attribute.jarOptions.mid.trim(),
            midHigh: attribute.jarOptions.midHigh?.trim(),
            high: attribute.jarOptions.high.trim(),
            labels: Array.isArray(attribute.jarOptions.labels)
              ? attribute.jarOptions.labels.map((label) => label.trim())
              : undefined,
            }
          : undefined,
    }));
    
    // Enforce JAR SOP validation
    const attributeValidationError = validateSensoryAttributeSetup(normalizedAttributes, sopMode);
    if (attributeValidationError) {
      return { success: false, error: attributeValidationError };
    }

    const preparedTargetDemographics = prepareTargetDemographicsForStudy(
      validated.targetDemographics,
      validated.sampleSize
    );
    const targetDemographicsJson = JSON.parse(
      JSON.stringify(preparedTargetDemographics)
    ) as Prisma.InputJsonValue;
    const screeningCriteriaJson = JSON.parse(
      JSON.stringify(validated.screeningQuestions)
    ) as Prisma.InputJsonValue;
    const customQuestionsJson =
      validated.customQuestions && validated.customQuestions.length > 0
        ? (JSON.parse(JSON.stringify(validated.customQuestions)) as Prisma.InputJsonValue)
        : undefined;

    const study = await prisma.$transaction(async (tx) => {
      const createdStudy = await tx.study.create({
        data: {
          title: validated.title,
          productName: validated.productName,
          category: validated.category,
          stage: validated.stage,
          sampleSize: validated.sampleSize,
          location: validated.location,
          targetDemographics: targetDemographicsJson,
          stratificationVar: validated.stratificationVar === "none" ? null : validated.stratificationVar,
          screeningCriteria: screeningCriteriaJson,
          customQuestions: customQuestionsJson,
          creatorId: userId,
          status: "RECRUITING",
          scheduleEndsAt: getStudyScheduleEnd(preparedTargetDemographics),
        }
      });

      if (normalizedFicBooking) {
        await reserveFicBookingDates(tx, createdStudy.id, normalizedFicBooking);
      }

      await tx.sensoryAttribute.createMany({
        data: normalizedAttributes.map((attr, idx) => ({
          studyId: createdStudy.id,
          name: attr.name,
          type: attr.type,
          order: idx,
          attributeType: attr.attributeType,
          sourceAttributeName: attr.sourceAttributeName,
          isCustom: attr.isCustom,
          jarOptions: attr.type === "JAR" ? (attr.jarOptions as Prisma.InputJsonValue) : undefined
        }))
      });

      await syncCoreSensoryTables(tx, createdStudy.id, normalizedAttributes, preparedTargetDemographics);
      return createdStudy;
    });

    // Execute stratified sampling if not "none"
    if (validated.stratificationVar !== "none") {
      const samplingService = new StratifiedSamplingService();
      
      // Calculate distribution per stratum
      const distribution = calculateStratumDistribution(
        validated.stratificationVar,
        validated.sampleSize,
        validated.targetDemographics
      );

      await samplingService.executeSampling(
        study.id,
        validated.targetDemographics,
        validated.screeningQuestions,
        {
          variable: validated.stratificationVar,
          distribution
        },
        validated.sampleSize
      );
    }

    revalidatePath("/dashboard");

    if (!options.skipBroadcast) {
      void notifyRole("CONSUMER", {
        title: "New study available",
        message: `${validated.title} is now recruiting participants.`,
        category: "STUDY",
        actionUrl: `/studies/${study.id}/form`,
        metadata: { studyId: study.id, type: "NEW_STUDY" },
      }).catch((error) => {
        console.error("[push] notifyRole CONSUMER (new study) failed:", error);
      });
    }
    await logUserUsage({
      actorUserId: userId,
      action: "STUDY_CREATED",
      entityType: "Study",
      entityId: study.id,
      summary: `Created study "${validated.title}".`,
      metadata: {
        productName: validated.productName,
        category: validated.category,
        stage: validated.stage,
        sampleSize: validated.sampleSize,
        location: validated.location,
        studyMode: preparedTargetDemographics.studyMode ?? "SENSORY",
      },
    });

    return { success: true, studyId: study.id };
  } catch (error) {
    if (error instanceof StudyCreationConflictError) {
      return { success: false, error: error.message };
    }
    console.error("Create study error:", error);
    return { success: false, error: "Failed to create study" };
  }
}

const MAX_STUDY_REPOSTS = 3;

const RepostSessionSlotSchema = z.object({
  dayOffset: z.number().int().min(0),
  testingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  label: z.string().min(1),
  startDateTime: z.string().datetime(),
  endDateTime: z.string().datetime(),
  capacity: z.number().int().min(1),
});

const RepostStudySchema = z.object({
  studyId: z.string().min(1),
  testingStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  testingDurationDays: z.number().int().min(1).max(31),
  sessionSlots: z.array(RepostSessionSlotSchema).min(1),
  ficUserId: z.string().min(1).optional(),
});

/**
 * Re-opens a study that was auto-closed below its target so the creator can
 * recruit more participants. Existing responses are retained — new responses
 * accumulate on top, strengthening the analysis. The study returns to
 * RECRUITING and therefore reappears in every recruiting feed automatically.
 */
export async function repostStudy(input: z.infer<typeof RepostStudySchema>) {
  const session = await getCurrentSession();
  if (!session || (session.role !== "MSME" && session.role !== "ADMIN" && session.role !== "FIC")) {
    return { success: false as const, error: "Login required." };
  }

  const parsed = RepostStudySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid repost data." };
  }
  const data = parsed.data;

  const study = await prisma.study.findFirst({
    where: {
      id: data.studyId,
      ...(session.role === "ADMIN" ? {} : { creatorId: session.userId }),
    },
    select: {
      id: true,
      title: true,
      status: true,
      sampleSize: true,
      repostCount: true,
      scheduleEndsAt: true,
      targetDemographics: true,
      _count: { select: { responses: true } },
    },
  });
  if (!study) {
    return { success: false as const, error: "Study not found or you are not the owner." };
  }

  // Eligible when the study has been auto-closed below target (ANALYZING), or
  // is still open but its schedule has already ended (the close job has not run
  // yet). Active studies that are still within their schedule cannot be reposted.
  const scheduleEnded =
    study.scheduleEndsAt != null && study.scheduleEndsAt.getTime() <= Date.now();
  const isClosedBelowTarget = study.status === "ANALYZING";
  const isExpiredButOpen =
    (study.status === "RECRUITING" || study.status === "ACTIVE") && scheduleEnded;
  if (!isClosedBelowTarget && !isExpiredButOpen) {
    return {
      success: false as const,
      error: "Only closed or ended studies that are below target can be reposted.",
    };
  }
  const responsesCount = study._count.responses;
  if (responsesCount >= study.sampleSize) {
    return { success: false as const, error: "This study already reached its target responses." };
  }
  if (study.repostCount >= MAX_STUDY_REPOSTS) {
    return { success: false as const, error: `A study can be reposted at most ${MAX_STUDY_REPOSTS} times.` };
  }

  // Validate the new schedule with the exact rules used at study creation.
  const scheduleResult = buildSessionSchedule({
    testingStartDate: data.testingStartDate,
    testingDurationDays: data.testingDurationDays,
    sessionSlots: data.sessionSlots,
  });
  if (!scheduleResult.success) {
    return { success: false as const, error: scheduleResult.error };
  }
  const schedule = scheduleResult.value;

  const now = new Date();
  const scheduleEnd = getStudyScheduleEnd({ sessionSchedule: schedule });
  if (!scheduleEnd || scheduleEnd.getTime() <= now.getTime()) {
    return { success: false as const, error: "The new testing schedule must end in the future." };
  }
  const earliestStart = Math.min(...schedule.slots.map((slot) => new Date(slot.startsAt).getTime()));
  if (earliestStart <= now.getTime()) {
    return { success: false as const, error: "Testing sessions must be scheduled in the future." };
  }

  const remainingNeeded = study.sampleSize - responsesCount;
  const totalCapacity = schedule.slots.reduce((sum, slot) => sum + slot.capacity, 0);
  if (totalCapacity < remainingNeeded) {
    return {
      success: false as const,
      error: `New session capacity (${totalCapacity}) is below the remaining ${remainingNeeded} responses needed.`,
    };
  }

  const demographics = isStudyRecord(study.targetDemographics) ? study.targetDemographics : {};
  const coordinationMode =
    typeof demographics.coordinationMode === "string" ? demographics.coordinationMode : null;
  const bookingDates = extractBookingDatesFromSchedule(schedule.slots);

  // FIC-assisted studies need their facility dates re-reserved for the new window.
  let ficBooking: { ficUserId: string; region: string; facility: string; bookingDates: string[] } | null = null;
  if (coordinationMode === "FIC_ASSISTED") {
    const region = typeof demographics.region === "string" ? demographics.region : "";
    const facility = typeof demographics.facilityType === "string" ? demographics.facilityType : "";
    const existingAssignee =
      isStudyRecord(demographics.ficAssignee) && typeof demographics.ficAssignee.id === "string"
        ? demographics.ficAssignee.id
        : null;
    const ficUserId = data.ficUserId ?? existingAssignee;
    if (!ficUserId || !region || !facility) {
      return {
        success: false as const,
        error: "Unable to resolve the FIC assignment for this study. Coordinate new FIC dates first.",
      };
    }
    ficBooking = { ficUserId, region, facility, bookingDates };
  }

  const nextTargetDemographics: Record<string, unknown> = {
    ...demographics,
    sessionSchedule: schedule,
    ...(ficBooking ? { ficBookingDates: bookingDates } : {}),
  };
  // Reopening clears the closure audit stamp written by the auto-close job.
  delete nextTargetDemographics.closure;

  const targetDemographicsJson = JSON.parse(
    JSON.stringify(nextTargetDemographics)
  ) as Prisma.InputJsonValue;

  try {
    await prisma.$transaction(async (tx) => {
      if (ficBooking) {
        // Release this study's previous date locks before reserving the new ones.
        await tx.ficAvailability.updateMany({
          where: { lockedById: data.studyId },
          data: { isLocked: false, lockedById: null, lockedAt: null },
        });
        await reserveFicBookingDates(tx, data.studyId, ficBooking);
      }

      await tx.study.update({
        where: { id: data.studyId },
        data: {
          status: "RECRUITING",
          scheduleEndsAt: scheduleEnd,
          closedAt: null,
          repostCount: { increment: 1 },
          targetDemographics: targetDemographicsJson,
        },
      });
    });
  } catch (error) {
    if (error instanceof StudyCreationConflictError) {
      return { success: false as const, error: error.message };
    }
    console.error("Repost study error:", error);
    return { success: false as const, error: "Failed to repost study." };
  }

  void notifyRole("CONSUMER", {
    title: "Study reopened",
    message: `"${study.title}" is recruiting participants again. Join to share your feedback.`,
    category: "STUDY",
    actionUrl: `/studies/${study.id}/form`,
    metadata: { studyId: study.id, type: "STUDY_REPOSTED" },
  }).catch((error) => {
    console.error("[push] notifyRole CONSUMER (repost) failed:", error);
  });

  await logUserUsage({
    actorUserId: session.userId,
    action: "STUDY_REPOSTED",
    entityType: "Study",
    entityId: study.id,
    summary: `Reposted "${study.title}" with a new testing schedule (${responsesCount}/${study.sampleSize} responses so far).`,
    metadata: {
      studyId: study.id,
      repostCount: study.repostCount + 1,
      responsesAtRepost: responsesCount,
      sampleSize: study.sampleSize,
      newScheduleEndsAt: scheduleEnd.toISOString(),
    },
  });

  revalidatePath("/msme/dashboard");
  revalidatePath("/dashboard");
  revalidatePath("/consumer/dashboard");

  return { success: true as const, studyId: study.id };
}

function isStudyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFicBooking(booking: z.infer<typeof CreateStudySchema>["ficBooking"]) {
  if (!booking) {
    return null;
  }

  const uniqueDates = Array.from(
    new Set(
      booking.bookingDates
        .map((date) => date.trim())
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    )
  ).sort((left, right) => left.localeCompare(right));

  if (uniqueDates.length === 0) {
    return null;
  }

  return {
    ficUserId: booking.ficUserId.trim(),
    region: booking.region.trim(),
    facility: booking.facility.trim(),
    bookingDates: uniqueDates,
  };
}

async function reserveFicBookingDates(
  tx: Prisma.TransactionClient,
  studyId: string,
  booking: { ficUserId: string; region: string; facility: string; bookingDates: string[] }
) {
  if (!isValidRegion(booking.region) || !isFacilityInRegion(booking.region, booking.facility)) {
    throw new StudyCreationConflictError("Selected region and facility are invalid.");
  }

  const ficUser = await tx.user.findFirst({
    where: {
      id: booking.ficUserId,
      role: { in: ["FIC", "FIC_MANAGER"] },
      assignedRegion: booking.region,
      assignedFacility: booking.facility,
    },
    select: { id: true, name: true, assignedRegion: true, assignedFacility: true },
  });
  if (!ficUser) {
    throw new StudyCreationConflictError("Selected FIC assignee is invalid for the selected region/facility.");
  }

  const availabilityRows = await tx.ficAvailability.findMany({
    where: {
      ficUserId: booking.ficUserId,
      date: { in: booking.bookingDates },
    },
    select: {
      date: true,
      isAvailable: true,
      isLocked: true,
      lockedById: true,
    },
  });
  const availabilityByDate = new Map(availabilityRows.map((row) => [row.date, row]));

  const missingDates = booking.bookingDates.filter((date) => !availabilityByDate.has(date));
  const unavailableDates = booking.bookingDates.filter((date) => {
    const row = availabilityByDate.get(date);
    if (!row) {
      return false;
    }
    return !row.isAvailable;
  });
  const lockedDates = booking.bookingDates.filter((date) => {
    const row = availabilityByDate.get(date);
    if (!row) {
      return false;
    }
    return row.isLocked && row.lockedById !== studyId;
  });

  const blockedDates = Array.from(new Set([...missingDates, ...unavailableDates, ...lockedDates])).sort();
  if (blockedDates.length > 0) {
    const preview = blockedDates.slice(0, 6).join(", ");
    const suffix = blockedDates.length > 6 ? ` (+${blockedDates.length - 6} more)` : "";
    throw new StudyCreationConflictError(
      `Selected FIC dates are unavailable: ${preview}${suffix}. Choose different schedule dates.`
    );
  }

  const lockResult = await tx.ficAvailability.updateMany({
    where: {
      ficUserId: booking.ficUserId,
      date: { in: booking.bookingDates },
      isAvailable: true,
      OR: [{ isLocked: false }, { lockedById: studyId }],
    },
    data: {
      isLocked: true,
      lockedById: studyId,
      lockedAt: new Date(),
    },
  });

  if (lockResult.count !== booking.bookingDates.length) {
    throw new StudyCreationConflictError("Some selected FIC dates were booked by another study. Please refresh and retry.");
  }
}

function validateSensoryAttributeSetup(
  attributes: Array<{
    name: string;
    type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED";
    attributeType?: string;
    jarOptions?: {
      low: string;
      midLow?: string;
      mid: string;
      midHigh?: string;
      high: string;
      labels?: string[];
    };
    sourceAttributeName?: string;
    isCustom?: boolean;
  }>,
  sopMode: SopMode
) {
  const maxStudyAttributes = sopMode === "IMPORT_COMPLETED_STUDY" ? MAX_STUDY_ATTRIBUTES_IMPORT : MAX_STUDY_ATTRIBUTES_STRICT;
  const maxQuestionRows = sopMode === "IMPORT_COMPLETED_STUDY" ? MAX_STUDY_ATTRIBUTES_IMPORT : MAX_STUDY_QUESTION_ROWS_STRICT;
  const baseAttributeKeys = new Set<string>();
  const customBaseAttributeKeys = new Set<string>();

  if (attributes.length === 0) {
    return "At least one sensory attribute is required.";
  }
  if (attributes.length > maxQuestionRows) {
    return `Too many sensory questions. Maximum is ${maxQuestionRows}.`;
  }

  let overallCount = 0;
  let jarCount = 0;
  const seenNames = new Set<string>();

  for (const attribute of attributes) {
    if (!attribute.name) {
      return "Attribute names cannot be blank.";
    }
    if (attribute.name.length > MAX_ATTRIBUTE_NAME_LENGTH) {
      return `Attribute names must be ${MAX_ATTRIBUTE_NAME_LENGTH} characters or fewer.`;
    }

    const normalizedName = attribute.name.toLowerCase();
    if (seenNames.has(normalizedName)) {
      return `Duplicate attribute name detected: "${attribute.name}".`;
    }
    seenNames.add(normalizedName);

    if (attribute.type === "OVERALL_LIKING") {
      overallCount += 1;
    }

    if (attribute.type === "ATTRIBUTE_LIKING" || attribute.type === "JAR") {
      const baseAttributeKey = getBaseAttributeKey(attribute);
      if (baseAttributeKey) {
        baseAttributeKeys.add(baseAttributeKey);
        if (attribute.isCustom) {
          customBaseAttributeKeys.add(baseAttributeKey);
        }
      }
    }

    if (attribute.type === "JAR") {
      jarCount += 1;
      if (!attribute.jarOptions) {
        return `JAR options are required for "${attribute.name}".`;
      }
      if (
        !attribute.jarOptions.low ||
        !attribute.jarOptions.mid ||
        !attribute.jarOptions.high ||
        !attribute.jarOptions.midLow ||
        !attribute.jarOptions.midHigh
      ) {
        return `JAR options for "${attribute.name}" cannot be blank.`;
      }
      if (!attribute.attributeType) {
        return `Attribute type is required for JAR question "${attribute.name}".`;
      }
      const normalizedType = attribute.attributeType.toLowerCase();
      if (!ALLOWED_ATTRIBUTE_TYPES.includes(normalizedType)) {
        return `Invalid attribute type "${attribute.attributeType}" for "${attribute.name}".`;
      }
    }
  }

  if (sopMode === "STRICT_NEW_STUDY" && baseAttributeKeys.size > maxStudyAttributes) {
    return `Too many sensory attributes. Maximum is ${maxStudyAttributes}.`;
  }

  if (sopMode === "STRICT_NEW_STUDY" && customBaseAttributeKeys.size > 1) {
    return "Only one custom attribute is allowed per study.";
  }

  if (overallCount !== 1) {
    return "Exactly one OVERALL_LIKING question is required.";
  }

  if (sopMode === "STRICT_NEW_STUDY" && jarCount > maxStudyAttributes) {
    return `Too many JAR attributes. Maximum is ${maxStudyAttributes}.`;
  }

  return null;
}

function getBaseAttributeKey(attribute: {
  name: string;
  type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED";
  sourceAttributeName?: string;
}) {
  if (attribute.type === "OVERALL_LIKING" || attribute.type === "OPEN_ENDED") {
    return "";
  }

  return (attribute.sourceAttributeName?.trim() || attribute.name.replace(/\s*\(JAR\)\s*$/i, "").trim()).toLowerCase();
}

async function syncCoreSensoryTables(
  tx: Prisma.TransactionClient,
  studyId: string,
  attributes: Array<{
    name: string;
    type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED";
    attributeType?: string;
    sourceAttributeName?: string;
    isCustom: boolean;
    questionType?: "HEDONIC" | "JAR" | "OPEN_ENDED";
    scaleType?: "NINE_PT" | "JAR_5PT" | "TEXT";
  }>,
  targetDemographics: Record<string, unknown>
) {
  const plan = extractSensoryAttributePlan(targetDemographics);
  const attributeDefs = plan.length > 0
    ? plan
    : attributes
      .filter((attribute) => attribute.type === "JAR")
      .map((attribute) => ({
        name: attribute.sourceAttributeName?.trim() || attribute.name.replace(/\s*\(JAR\)\s*$/i, "").trim(),
        attributeType: attribute.attributeType?.toLowerCase() || "taste",
        isCustom: Boolean(attribute.isCustom),
      }));

  const attributeIdByName = new Map<string, string>();
  for (const definition of attributeDefs) {
    const created = await tx.coreAttribute.create({
      data: {
        studyId,
        attributeName: definition.name,
        category: "SENSORY",
        attributeType: definition.attributeType,
        isCustom: definition.isCustom,
      },
      select: { id: true, attributeName: true },
    });
    attributeIdByName.set(created.attributeName.toLowerCase(), created.id);
  }

  const questionsPayload = attributes.map((attribute, index) => {
    const questionType = attribute.questionType ?? mapLegacyAttributeTypeToQuestionType(attribute.type);
    const scaleType = attribute.scaleType ?? mapLegacyAttributeTypeToScaleType(attribute.type);
    const sourceName = (attribute.sourceAttributeName || attribute.name).toLowerCase();
    const attributeId = attributeIdByName.get(sourceName) ?? null;

    return {
      studyId,
      attributeId,
      questionText: attribute.name,
      questionType,
      scaleType,
      order: index,
    };
  });

  if (questionsPayload.length > 0) {
    await tx.sensoryQuestion.createMany({
      data: questionsPayload,
    });
  }
}

function extractSensoryAttributePlan(targetDemographics: Record<string, unknown>) {
  const raw = targetDemographics.sensoryAttributePlan;
  if (!Array.isArray(raw)) {
    return [] as Array<{ name: string; attributeType: string; isCustom: boolean }>;
  }

  return raw.reduce<Array<{ name: string; attributeType: string; isCustom: boolean }>>((accumulator, item) => {
    if (!item || typeof item !== "object") {
      return accumulator;
    }

    const row = item as { name?: unknown; dimension?: unknown; isCustom?: unknown };
    if (typeof row.name !== "string" || typeof row.dimension !== "string") {
      return accumulator;
    }
    const normalizedName = row.name.trim();
    const normalizedType = row.dimension.trim().toLowerCase();
    if (!normalizedName || !ALLOWED_ATTRIBUTE_TYPES.includes(normalizedType)) {
      return accumulator;
    }

    accumulator.push({
      name: normalizedName,
      attributeType: normalizedType,
      isCustom: Boolean(row.isCustom),
    });
    return accumulator;
  }, []);
}

function mapLegacyAttributeTypeToQuestionType(type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED") {
  if (type === "JAR") return "JAR" as const;
  if (type === "OPEN_ENDED") return "OPEN_ENDED" as const;
  return "HEDONIC" as const;
}

function mapLegacyAttributeTypeToScaleType(type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED") {
  if (type === "JAR") return "JAR_5PT" as const;
  if (type === "OPEN_ENDED") return "TEXT" as const;
  return "NINE_PT" as const;
}

function calculateStratumDistribution(
  variable: string, 
  totalSize: number, 
  demographics: {
    ageRange: [number, number];
    genders?: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_SAY")[];
  }
) {
  if (variable === "gender") {
    const keys = (demographics.genders?.length
      ? demographics.genders.map((gender) => gender.toLowerCase())
      : ["male", "female"]);
    return distributeEvenly(keys, totalSize);
  }

  if (variable === "age_group") {
    const groups = getAgeGroupsForRange(demographics.ageRange[0], demographics.ageRange[1]);
    return distributeEvenly(groups.length > 0 ? groups : ["young_adults", "adults"], totalSize);
  }

  return { default: totalSize };
}

function prepareTargetDemographicsForStudy(
  targetDemographics: z.infer<typeof CreateStudySchema>["targetDemographics"],
  sampleSize: number
) {
  const row = { ...targetDemographics } as Record<string, unknown>;
  const existing = parseStudyRandomCodeBook(row.randomCodeBook);
  if (existing) {
    return row;
  }

  const sampleCount = resolveSampleCountFromTargetDemographics(row);
  row.randomCodeBook = createStudyRandomCodeBook(sampleSize, sampleCount);
  return row;
}

export async function deleteStudyWithPassword(formData: FormData) {
  const session = await getCurrentSession();
  if (!session || (session.role !== "MSME" && session.role !== "ADMIN" && session.role !== "FIC")) {
    redirect("/login?error=Login+required");
  }

  const studyId = String(formData.get("studyId") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? "/msme/dashboard?view=history"));

  if (!studyId || !password) {
    redirect(withFeedback(redirectTo, "error", "Study+ID+and+password+are+required"));
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, password: true },
  });

  if (!user?.password || !verifyPassword(password, user.password)) {
    redirect(withFeedback(redirectTo, "error", "Incorrect+password.+Delete+cancelled"));
  }

  const ownedStudy = await prisma.study.findFirst({
    where: {
      id: studyId,
      creatorId: session.userId,
    },
    select: { id: true },
  });

  if (!ownedStudy) {
    redirect(withFeedback(redirectTo, "error", "Study+not+found+or+you+are+not+the+owner"));
  }

  await prisma.$transaction(async (tx) => {
    await tx.ficAvailability.updateMany({
      where: { lockedById: studyId },
      data: {
        isLocked: false,
        lockedById: null,
        lockedAt: null,
      },
    });
    await tx.sensoryResponse.deleteMany({ where: { studyId } });
    await tx.studyAnalysis.deleteMany({ where: { studyId } });
    await tx.studyParticipant.deleteMany({ where: { studyId } });
    await tx.screeningResponse.deleteMany({ where: { studyId } });
    await tx.sensoryAttribute.deleteMany({ where: { studyId } });
    await tx.study.delete({
      where: { id: studyId },
    });
  });

  revalidatePath("/msme/dashboard");
  revalidatePath("/dashboard");

  redirect(withFeedback(redirectTo, "message", "Study+deleted+successfully"));
}

function getAgeGroupsForRange(min: number, max: number) {
  const groups = new Set<string>();
  for (let age = min; age <= max; age += 1) {
    groups.add(getAgeGroup(age));
  }
  return Array.from(groups);
}

function getAgeGroup(age: number) {
  if (age <= 12) return "children";
  if (age <= 17) return "teenagers";
  if (age <= 25) return "young_adults";
  if (age <= 40) return "adults";
  if (age <= 59) return "middle_aged";
  return "seniors";
}

function distributeEvenly(keys: string[], total: number) {
  const distribution: Record<string, number> = {};
  const base = Math.floor(total / keys.length);
  let remainder = total % keys.length;

  for (const key of keys) {
    distribution[key] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) {
      remainder -= 1;
    }
  }

  return distribution;
}

function resolveSampleCountFromTargetDemographics(targetDemographics: Record<string, unknown>) {
  const raw = targetDemographics.numberOfSamples;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) {
    return 1;
  }
  return Math.max(1, Math.floor(raw));
}

function withFeedback(pathname: string, key: "error" | "message", value: string) {
  const divider = pathname.includes("?") ? "&" : "?";
  return `${pathname}${divider}${key}=${value}`;
}

function safeRedirect(raw: string) {
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/msme/dashboard?view=history";
}
