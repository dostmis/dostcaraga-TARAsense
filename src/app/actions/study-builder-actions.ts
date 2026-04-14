"use server";

import { randomUUID } from "crypto";
import { createStudy } from "@/app/actions/study-actions";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { notifyRole, notifyUser } from "@/lib/notifications";
import { z } from "zod";

const PrismaCategorySchema = z.enum([
  "BEVERAGE",
  "SNACK",
  "DESSERT",
  "FUNCTIONAL_FOOD",
  "DAIRY",
  "BAKERY",
]);

const BuilderSessionSlotSchema = z.object({
  dayOffset: z.number().int().min(0),
  label: z.string().min(1),
  startDateTime: z.string().datetime(),
  endDateTime: z.string().datetime(),
  capacity: z.number().int().min(1),
});

const BuilderPayloadSchema = z.object({
  studyMode: z.enum(["MARKET", "SENSORY"]),
  marketStudyType: z
    .enum([
      "PACKAGING_EVALUATION",
      "PRICE_SENSITIVITY",
      "PRODUCT_INTENT",
      "CONSUMER_USAGE_HABIT",
    ])
    .optional(),
  sensoryStudyType: z.enum(["DISCRIMINATIVE", "DESCRIPTIVE", "CONSUMER_TEST"]).optional(),
  sensoryMethod: z.string().optional(),
  consumerObjective: z
    .enum([
      "CHECK_ACCEPTABILITY",
      "IMPROVE_TASTE",
      "IMPROVE_TEXTURE",
      "FINE_TUNE",
      "FAST_ITERATION",
    ])
    .optional(),
  studyTitle: z.string().min(3),
  purpose: z.string().min(3),
  facilityType: z.string().min(1),
  numberOfSamples: z.number().int().min(1),
  targetResponses: z.number().int().min(1),
  productName: z.string().optional(),
  categoryCode: PrismaCategorySchema.optional(),
  categoryLabel: z.string().optional(),
  attributes: z
    .array(
      z.object({
        name: z.string().min(1),
        dimension: z.enum(["Taste", "Texture", "Aftertaste", "Mouthfeel"]),
        isJarTarget: z.boolean().optional(),
        isCustom: z.boolean().optional(),
        actionable: z.boolean().optional(),
      })
    )
    .default([]),
  sampleSetups: z
    .array(
      z.object({
        description: z.string().min(1),
        ingredient: z.string().optional(),
        allergen: z.string().min(1),
      })
    )
    .default([]),
  testingStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  testingDurationDays: z.number().int().min(1).max(31).optional(),
  sessionSlots: z.array(BuilderSessionSlotSchema).default([]),
  questions: z.array(z.string().min(1)).default([]),
});

const OBJECTIVE_LIMITS: Record<
  "CHECK_ACCEPTABILITY" | "IMPROVE_TASTE" | "IMPROVE_TEXTURE" | "FINE_TUNE" | "FAST_ITERATION",
  number
> = {
  CHECK_ACCEPTABILITY: 110,
  IMPROVE_TASTE: 60,
  IMPROVE_TEXTURE: 60,
  FINE_TUNE: 60,
  FAST_ITERATION: 35,
};

export async function createStudyFromBuilder(payload: unknown) {
  try {
    const validated = BuilderPayloadSchema.parse(payload);
    const session = await getCurrentSession();
    if (!session) {
      return { success: false, error: "Login required." };
    }
    if (session.role !== "MSME" && session.role !== "ADMIN") {
      return { success: false, error: "Only MSME or Admin users can create studies." };
    }

    const creator = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true },
    });
    if (!creator) {
      return { success: false, error: "User session is invalid. Please login again." };
    }

    if (validated.studyMode === "MARKET") {
      const result = await createMarketStudy(validated, creator.id);
      await pushStudyNotifications(validated, creator.id, session.role, result);
      return result;
    }

    const result = await createSensoryStudy(validated, creator.id);
    await pushStudyNotifications(validated, creator.id, session.role, result);
    return result;
  } catch (error) {
    console.error("Create study from builder failed:", error);
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? "Invalid study data." };
    }
    if (error instanceof Error) {
      if (error.message.includes("Authentication failed")) {
        return { success: false, error: "Database authentication failed. Check DATABASE_URL credentials." };
      }
      return { success: false, error: error.message };
    }
    return { success: false, error: "Failed to create study." };
  }
}

async function createMarketStudy(payload: z.infer<typeof BuilderPayloadSchema>, creatorId: string) {
  if (!payload.marketStudyType) {
    return { success: false, error: "Select a market study type." };
  }

  const study = await prisma.study.create({
    data: {
      creatorId,
      title: payload.studyTitle,
      productName: payload.marketStudyType.replace(/_/g, " "),
      category: "FUNCTIONAL_FOOD",
      stage: "MARKET_READINESS",
      description: payload.purpose,
      targetDemographics: {
        studyMode: "MARKET",
        marketStudyType: payload.marketStudyType,
        numberOfSamples: payload.numberOfSamples,
        facilityType: payload.facilityType,
      },
      screeningCriteria: {
        questions: payload.questions,
        sampleSetups: payload.sampleSetups,
      },
      stratificationVar: null,
      sampleSize: payload.targetResponses,
      location: payload.facilityType,
      status: "DRAFT",
    },
  });

  return {
    success: true,
    studyId: study.id,
    redirectPath: `/studies/${study.id}/form`,
  };
}

async function createSensoryStudy(payload: z.infer<typeof BuilderPayloadSchema>, creatorId: string) {
  if (!payload.sensoryStudyType) {
    return { success: false, error: "Select a sensory study type." };
  }
  if (!payload.productName?.trim()) {
    return { success: false, error: "Product name is required for sensory studies." };
  }
  if (!payload.categoryCode) {
    return { success: false, error: "Choose a product category profile." };
  }

  const objective = payload.consumerObjective;
  if (payload.sensoryStudyType === "CONSUMER_TEST") {
    if (!objective) {
      return { success: false, error: "Select what you want to do with the consumer test." };
    }
    const cap = OBJECTIVE_LIMITS[objective];
    if (payload.targetResponses > cap) {
      return {
        success: false,
        error: `Target responses exceed the ${cap} participant limit for ${objective.replace(/_/g, " ")}.`,
      };
    }
  }

  const scheduleResult = buildSessionSchedule(payload);
  if (!scheduleResult.success) {
    return { success: false, error: scheduleResult.error };
  }

  const totalScheduleCapacity = scheduleResult.value.slots.reduce(
    (sum, slot) => sum + slot.capacity,
    0
  );
  if (payload.targetResponses > totalScheduleCapacity) {
    return {
      success: false,
      error: `Target responses (${payload.targetResponses}) exceed configured session capacity (${totalScheduleCapacity}).`,
    };
  }

  await ensurePanelists(Math.max(payload.targetResponses * 2, 40));

  const stage = mapStage(payload.sensoryStudyType, objective);
  const planResult = validateSensoryAttributePlan(payload.attributes, objective);
  if (!planResult.success) {
    return { success: false, error: planResult.error };
  }

  const attributeQuestions = buildSensoryQuestionnaire(planResult.rows);

  const studyResult = await createStudy(
    {
      title: payload.studyTitle,
      productName: payload.productName,
      category: payload.categoryCode,
      stage,
      sampleSize: payload.targetResponses,
      location: payload.facilityType,
      targetDemographics: {
        ageRange: [18, 55],
        genders: ["MALE", "FEMALE", "NON_BINARY"],
        lifestyles: [],
        experience: "regular-consumer",
        studyMode: "SENSORY",
        sensoryStudyType: payload.sensoryStudyType,
        sensoryMethod: payload.sensoryMethod,
        consumerObjective: objective,
        categoryLabel: payload.categoryLabel,
        numberOfSamples: payload.numberOfSamples,
        sessionSchedule: scheduleResult.value,
        sensoryAttributePlan: planResult.rows,
      },
      stratificationVar: "gender",
      attributes: attributeQuestions,
      screeningQuestions: [
        {
          question: "Age qualification check",
          type: "age_range",
          min: 18,
          max: 55,
          required: true,
        },
        {
          question: "Consumes this product category daily",
          type: "consumption",
          required: "daily",
        },
        {
          question: "Sample setup notes",
          type: "text",
          required: false,
          options: payload.sampleSetups.map((setup) =>
            `${setup.description} | Ingredients: ${setup.ingredient || "N/A"} | Allergen: ${setup.allergen}`
          ),
        },
      ],
    },
    creatorId
  );

  if (!studyResult.success || !studyResult.studyId) {
    return { success: false, error: studyResult.error ?? "Failed to create sensory study." };
  }

  return {
    success: true,
    studyId: studyResult.studyId,
    redirectPath: `/studies/${studyResult.studyId}/form`,
  };
}

function buildSessionSchedule(payload: z.infer<typeof BuilderPayloadSchema>) {
  if (!payload.testingStartDate) {
    return { success: false as const, error: "Testing start date is required." };
  }
  if (!payload.testingDurationDays) {
    return { success: false as const, error: "Testing duration is required." };
  }
  const durationDays = payload.testingDurationDays;
  if (payload.sessionSlots.length === 0) {
    return { success: false as const, error: "Add at least one testing session." };
  }

  const slots = payload.sessionSlots.reduce<
    Array<{
      id: string;
      dayOffset: number;
      label: string;
      startsAt: string;
      endsAt: string;
      capacity: number;
    }>
  >((accumulator, slot) => {
    if (slot.dayOffset >= durationDays) {
      return accumulator;
    }

    const startsAt = new Date(slot.startDateTime);
    const endsAt = new Date(slot.endDateTime);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return accumulator;
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      return accumulator;
    }

    accumulator.push({
      id: randomUUID(),
      dayOffset: slot.dayOffset,
      label: slot.label.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      capacity: slot.capacity,
    });
    return accumulator;
  }, []);

  if (slots.length === 0) {
    return {
      success: false as const,
      error: "All configured sessions are invalid. Check date, time, and day mapping.",
    };
  }

  const uniqueStarts = new Set(slots.map((slot) => slot.startsAt));
  if (uniqueStarts.size !== slots.length) {
    return {
      success: false as const,
      error: "Duplicate session start times are not allowed.",
    };
  }

  return {
    success: true as const,
    value: {
      timezone: "Asia/Manila",
      startDate: payload.testingStartDate,
      durationDays,
      slots: slots.sort(
        (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
      ),
    },
  };
}

function buildSensoryQuestionnaire(
  attributes: Array<{
    name: string;
    dimension: "Taste" | "Texture" | "Aftertaste" | "Mouthfeel";
    isJarTarget: boolean;
    isCustom: boolean;
  }>
) {
  const rows = attributes.slice(0, 5).filter((attribute) => attribute.name.trim().length > 0);
  const output: Array<{
    name: string;
    type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED";
    attributeType?: string;
    sourceAttributeName?: string;
    isCustom?: boolean;
    questionType?: "HEDONIC" | "JAR" | "OPEN_ENDED";
    scaleType?: "NINE_PT" | "JAR_5PT" | "TEXT";
    jarOptions?: {
      low: string;
      midLow: string;
      mid: string;
      midHigh: string;
      high: string;
      labels: string[];
    };
  }> = [];

  output.push({
    name: "Overall Acceptability",
    type: "OVERALL_LIKING",
    questionType: "HEDONIC",
    scaleType: "NINE_PT",
  });

  rows
    .filter((attribute) => attribute.isJarTarget)
    .forEach((attribute) => {
    output.push({
      name: `${attribute.name} (JAR)`,
      type: "JAR",
      attributeType: attribute.dimension.toLowerCase(),
      sourceAttributeName: attribute.name,
      isCustom: attribute.isCustom,
      questionType: "JAR",
      scaleType: "JAR_5PT",
      jarOptions: {
        low: "Much too low",
        midLow: "Slightly too low",
        mid: "Just about right",
        midHigh: "Slightly too high",
        high: "Much too high",
        labels: ["Much too low", "Slightly too low", "Just about right", "Slightly too high", "Much too high"],
      },
    });
  });

  output.push({
    name: "What should be improved?",
    type: "OPEN_ENDED",
    questionType: "OPEN_ENDED",
    scaleType: "TEXT",
  });

  return output;
}

function mapStage(
  studyType: "DISCRIMINATIVE" | "DESCRIPTIVE" | "CONSUMER_TEST",
  objective?: "CHECK_ACCEPTABILITY" | "IMPROVE_TASTE" | "IMPROVE_TEXTURE" | "FINE_TUNE" | "FAST_ITERATION"
): "PROTOTYPE_CHECK" | "REFINEMENT" | "MARKET_READINESS" {
  if (studyType === "CONSUMER_TEST") {
    if (objective === "CHECK_ACCEPTABILITY") return "MARKET_READINESS";
    if (objective === "IMPROVE_TASTE" || objective === "IMPROVE_TEXTURE" || objective === "FINE_TUNE") return "REFINEMENT";
    return "PROTOTYPE_CHECK";
  }
  return "PROTOTYPE_CHECK";
}

function validateSensoryAttributePlan(
  attributes: Array<{
    name: string;
    dimension: "Taste" | "Texture" | "Aftertaste" | "Mouthfeel";
    isJarTarget?: boolean;
    isCustom?: boolean;
    actionable?: boolean;
  }>,
  objective: "CHECK_ACCEPTABILITY" | "IMPROVE_TASTE" | "IMPROVE_TEXTURE" | "FINE_TUNE" | "FAST_ITERATION" | undefined
) {
  const rows = attributes
    .slice(0, 5)
    .map((attribute) => ({
      name: attribute.name.trim(),
      dimension: attribute.dimension,
      isJarTarget: Boolean(attribute.isJarTarget),
      isCustom: Boolean(attribute.isCustom),
      actionable: Boolean(attribute.actionable),
    }))
    .filter((attribute) => attribute.name.length > 0);

  if (rows.length > 5) {
    return { success: false as const, error: "A maximum of 5 attributes may be selected per test." };
  }

  const customAttributes = rows.filter((attribute) => attribute.isCustom);
  if (customAttributes.length > 1) {
    return { success: false as const, error: "Only 1 custom attribute is allowed per test." };
  }

  for (const customAttribute of customAttributes) {
    const words = customAttribute.name.split(/\s+/).filter(Boolean);
    if (words.length > 2) {
      return { success: false as const, error: "Custom attribute name must be at most 2 words." };
    }
    if (!customAttribute.actionable) {
      return {
        success: false as const,
        error: "Custom attributes must be marked actionable and adjustable in formulation.",
      };
    }
  }

  const jarTargets = rows.filter((attribute) => attribute.isJarTarget);
  if (jarTargets.length > 3) {
    return { success: false as const, error: "Only the TOP 3 attributes can be selected for JAR questions." };
  }

  if (!objective) {
    return { success: false as const, error: "Select the MSME goal for this consumer test." };
  }

  if (objective === "CHECK_ACCEPTABILITY" && jarTargets.length !== 0) {
    return { success: false as const, error: "Check acceptability requires Overall Acceptability only (no JAR attributes)." };
  }

  if (objective === "IMPROVE_TASTE") {
    if (jarTargets.length !== 1 || jarTargets[0].dimension !== "Taste") {
      return { success: false as const, error: "Improve taste requires exactly 1 Taste JAR attribute." };
    }
  }

  if (objective === "IMPROVE_TEXTURE") {
    if (jarTargets.length !== 1 || jarTargets[0].dimension !== "Texture") {
      return { success: false as const, error: "Improve texture requires exactly 1 Texture JAR attribute." };
    }
  }

  if (objective === "FINE_TUNE" && jarTargets.length !== 2) {
    return { success: false as const, error: "Fine-tune requires exactly 2 JAR attributes." };
  }

  if (objective === "FAST_ITERATION" && (jarTargets.length < 1 || jarTargets.length > 2)) {
    return { success: false as const, error: "FAST iteration requires 1 to 2 JAR attributes." };
  }

  if (objective !== "CHECK_ACCEPTABILITY" && jarTargets.length === 0) {
    return { success: false as const, error: "Select at least 1 JAR attribute for this objective." };
  }

  const duplicates = new Set<string>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (duplicates.has(key)) {
      return { success: false as const, error: `Duplicate attribute detected: ${row.name}` };
    }
    duplicates.add(key);
  }

  return { success: true as const, rows };
}

async function ensurePanelists(minPanelists: number) {
  const currentCount = await prisma.panelist.count();
  if (currentCount >= minPanelists) {
    return;
  }

  const genders: Array<"MALE" | "FEMALE" | "NON_BINARY"> = ["MALE", "FEMALE", "NON_BINARY"];
  const lifestyles = [["student"], ["office-worker"], ["fitness"], ["home-cook"]];
  const missing = minPanelists - currentCount;

  const seedRows = Array.from({ length: missing }, (_, index) => {
    const seedNumber = currentCount + index + 1;
    const gender = genders[index % genders.length];
    const lifestyle = lifestyles[index % lifestyles.length];
    const age = 18 + (index % 30);
    return {
      name: `Panelist ${seedNumber}`,
      email: `panelist${seedNumber}@tarasense.local`,
      age,
      gender,
      location: "Metro Manila",
      occupation: lifestyle[0],
      lifestyle,
      dietaryPrefs: [],
      consumptionHabits: { snacks: index % 2 === 0 ? "daily" : "weekly" },
      isActive: true,
    };
  });

  await prisma.panelist.createMany({
    data: seedRows,
    skipDuplicates: true,
  });
}

async function pushStudyNotifications(
  payload: z.infer<typeof BuilderPayloadSchema>,
  creatorId: string,
  creatorRole: "MSME" | "ADMIN",
  result: { success: boolean; studyId?: string }
) {
  if (!result.success || !result.studyId) {
    return;
  }

  const studyType =
    payload.studyMode === "MARKET"
      ? (payload.marketStudyType?.replace(/_/g, " ") ?? "Market Study")
      : (payload.sensoryStudyType?.replace(/_/g, " ") ?? "Sensory Study");

  await notifyUser(creatorId, {
    title: "Study created successfully",
    message: `${payload.studyTitle} (${studyType}) is now saved in your workspace.`,
    level: "SUCCESS",
    category: "STUDY",
    actionUrl: `/studies/${result.studyId}/form`,
    metadata: {
      studyId: result.studyId,
      studyMode: payload.studyMode,
      facilityType: payload.facilityType,
    },
  });

  if (creatorRole !== "MSME") {
    return;
  }

  if (payload.studyMode === "SENSORY") {
    await notifyRole("CONSUMER", {
      title: "New study available",
      message: `${payload.studyTitle} is now open for sensory participation.`,
      level: "INFO",
      category: "SURVEY",
      actionUrl: `/studies/${result.studyId}/start`,
      metadata: { studyId: result.studyId },
    });
  }

  if (/fic/i.test(payload.facilityType)) {
    await notifyRole("FIC", {
      title: "New MSME booking to FIC",
      message: `${payload.studyTitle} was booked with facility type: ${payload.facilityType}.`,
      level: "WARNING",
      category: "STUDY",
      actionUrl: `/dashboard/${result.studyId}`,
      metadata: { studyId: result.studyId, facilityType: payload.facilityType },
    });
  } else {
    await notifyRole("FIC", {
      title: "New MSME study uploaded",
      message: `${payload.studyTitle} was created and is available for review.`,
      level: "INFO",
      category: "STUDY",
      actionUrl: `/studies/${result.studyId}/form`,
      metadata: { studyId: result.studyId },
    });
  }
}
