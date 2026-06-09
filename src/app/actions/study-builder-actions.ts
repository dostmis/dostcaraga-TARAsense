"use server";

import { createStudy } from "@/app/actions/study-actions";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { notifyRole, notifyUser } from "@/lib/notifications";
import { createWorkflowTraceId, runInBackground } from "@/lib/async-workflow";
import { isFacilityInRegion, isValidRegion } from "@/lib/facility-constants";
import { buildSessionSchedule, extractBookingDatesFromSchedule } from "@/lib/study-session-builder";
import { DEFAULT_TARGET_CONSUMER, normalizeTargetConsumer } from "@/lib/target-consumer";
import { logUserUsage } from "@/lib/user-usage";
import { validateLocationConsistency } from "@/lib/locations/psgc-queries";
import { findUsersMatchingTarget } from "@/lib/locations/study-visibility";
import { z } from "zod";
import type { StudyTargetScope } from "@prisma/client";

type ConsumerObjective = "MARKET_READINESS" | "REFINEMENT" | "PROTOTYPING";
type StudyStageValue = "PROTOTYPE_CHECK" | "REFINEMENT" | "MARKET_READINESS";
const ATTRIBUTE_DIMENSIONS = [
  "Appearance",
  "Aroma",
  "Texture",
  "Taste",
  "mouthfeel",
  "Flavor",
  "aftertaste",
] as const;
type AttributeDimension = (typeof ATTRIBUTE_DIMENSIONS)[number];
const AttributeDimensionSchema = z.preprocess((value) => {
  if (value === "Mouthfeel") return "mouthfeel";
  if (value === "Aftertaste") return "aftertaste";
  return value;
}, z.enum(ATTRIBUTE_DIMENSIONS));
const PRODUCT_IMAGE_MAX_BYTES = 1_000_000;
const PRODUCT_IMAGE_DATA_URL_MAX_LENGTH = 1_400_000;

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
  testingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  label: z.string().min(1),
  startDateTime: z.string().datetime(),
  endDateTime: z.string().datetime(),
  capacity: z.number().int().min(1),
});

const BuilderPayloadSchema = z.object({
  studyMode: z.enum(["MARKET", "SENSORY"]),
  coordinationMode: z.enum(["FIC_ASSISTED", "SELF_MANAGED_PUBLIC"]).default("FIC_ASSISTED"),
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
      "MARKET_READINESS",
      "REFINEMENT",
      "PROTOTYPING",
    ])
    .optional(),
  studyTitle: z.string().min(3),
  purpose: z.string().min(3),
  targetConsumer: z
    .object({
      ageRange: z.tuple([z.number().int().min(10).max(100), z.number().int().min(10).max(100)]),
      genders: z
        .array(z.enum(["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_SAY"]))
        .min(1)
        .default(DEFAULT_TARGET_CONSUMER.genders),
      lifestyles: z.array(z.enum(["student", "athlete", "office_worker"])).default([]),
      dietaryPrefs: z.array(z.enum(["VEGETARIAN", "VEGAN", "GLUTEN_FREE"])).default([]),
      consumptionHabits: z
        .object({
          coffeeDrinker: z.boolean().optional(),
          snackConsumer: z.boolean().optional(),
          energyDrinkConsumer: z.boolean().optional(),
        })
        .default({}),
    })
    .optional(),
  region: z.string().optional(),
  facilityType: z.string().optional(),
  publicVenueName: z.string().optional(),
  publicCityMunicipality: z.string().optional(),
  publicAddressDetails: z.string().optional(),
  ficUserId: z.string().min(1).optional(),
  numberOfSamples: z.number().int().min(1),
  targetResponses: z.number().int().min(1),
  productName: z.string().optional(),
  categoryCode: PrismaCategorySchema.optional(),
  categoryLabel: z.string().optional(),
  attributes: z
    .array(
      z.object({
        name: z.string().min(1),
        dimension: AttributeDimensionSchema,
        isJarTarget: z.boolean().optional(),
        isCustom: z.boolean().optional(),
        actionable: z.boolean().optional(),
      })
    )
    .default([]),
  sampleSetups: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(1000),
        ingredient: z.string().trim().max(1000).optional(),
        allergen: z.string().trim().max(500).optional(),
        imageDataUrl: z.string().max(PRODUCT_IMAGE_DATA_URL_MAX_LENGTH).optional(),
        imageName: z.string().trim().max(160).optional(),
        price: z.string().trim().max(80).optional(),
        purchaseIntentQuestion: z.string().trim().max(240).optional(),
      })
    )
    .default([]),
  testingStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  testingDurationDays: z.number().int().min(1).max(31).optional(),
  sessionSlots: z.array(BuilderSessionSlotSchema).default([]),
  questions: z.array(z.string().min(1)).default([]),
  locationTarget: z
    .object({
      scope: z.enum(["ALL", "REGION", "PROVINCE", "CITY", "BARANGAY"]).default("CITY"),
      regionId: z.string().nullable().optional(),
      provinceId: z.string().nullable().optional(),
      cityId: z.string().nullable().optional(),
      barangayId: z.string().nullable().optional(),
    })
    .optional(),
});

const OBJECTIVE_PANEL_REQUIREMENTS: Record<ConsumerObjective, number> = {
  MARKET_READINESS: 100,
  REFINEMENT: 50,
  PROTOTYPING: 35,
};

type ResolvedLocationContext =
  | {
      coordinationMode: "FIC_ASSISTED";
      location: string;
      region: string;
      facilityType: string;
    }
  | {
      coordinationMode: "SELF_MANAGED_PUBLIC";
      location: string;
      publicVenueName: string;
      publicCityMunicipality: string;
      publicAddressDetails: string;
    };

export async function createStudyFromBuilder(
  payload: unknown,
  actor?: { userId: string; role: "MSME" | "ADMIN" | "FIC" | "CONSUMER" }
) {
  try {
    const validated = BuilderPayloadSchema.parse(payload);
    const locationContext = resolveLocationContext(validated);
    if (!locationContext.ok) {
      return { success: false, error: locationContext.error };
    }

    const session = actor ?? (await getCurrentSession());
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
      const result = await createMarketStudy(validated, creator.id, locationContext.value);
      if (result.success && result.studyId) {
        await persistStudyLocationTarget(result.studyId, validated, locationContext.value, null);
      }
      scheduleStudyNotifications(validated, creator.id, session.role, result);
      return result;
    }

    const result = await createSensoryStudy(validated, creator.id, locationContext.value);
    if (result.success && result.studyId) {
      const ficUserId =
        locationContext.value.coordinationMode === "FIC_ASSISTED" && validated.ficUserId
          ? validated.ficUserId
          : null;
      await persistStudyLocationTarget(result.studyId, validated, locationContext.value, ficUserId);
    }
    scheduleStudyNotifications(validated, creator.id, session.role, result);
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

function resolveLocationContext(payload: z.infer<typeof BuilderPayloadSchema>) {
  if (payload.coordinationMode === "FIC_ASSISTED") {
    const region = String(payload.region ?? "").trim();
    const facilityType = String(payload.facilityType ?? "").trim();

    if (!region || !facilityType) {
      return { ok: false as const, error: "Select region and facility for FIC-assisted coordination." };
    }

    if (!isValidRegion(region) || !isFacilityInRegion(region, facilityType)) {
      return { ok: false as const, error: "Selected region and facility combination is invalid." };
    }

    return {
      ok: true as const,
      value: {
        coordinationMode: "FIC_ASSISTED" as const,
        location: facilityType,
        region,
        facilityType,
      },
    };
  }

  const publicVenueName = String(payload.publicVenueName ?? "").trim();
  const publicCityMunicipality = String(payload.publicCityMunicipality ?? "").trim();
  const publicAddressDetails = String(payload.publicAddressDetails ?? "").trim();

  if (!publicVenueName || !publicCityMunicipality) {
    return { ok: false as const, error: "Venue name and city/municipality are required for self-managed public studies." };
  }

  const location = publicAddressDetails
    ? `${publicVenueName}, ${publicAddressDetails}, ${publicCityMunicipality}`
    : `${publicVenueName}, ${publicCityMunicipality}`;

  return {
    ok: true as const,
    value: {
      coordinationMode: "SELF_MANAGED_PUBLIC" as const,
      location,
      publicVenueName,
      publicCityMunicipality,
      publicAddressDetails,
    },
  };
}

async function createMarketStudy(
  payload: z.infer<typeof BuilderPayloadSchema>,
  creatorId: string,
  locationContext: ResolvedLocationContext
) {
  if (!payload.marketStudyType) {
    return { success: false, error: "Select a market study type." };
  }
  const sampleSetupResult = normalizeMarketSampleSetups(payload);
  if (!sampleSetupResult.success) {
    return { success: false, error: sampleSetupResult.error };
  }
  const targetConsumer = normalizeTargetConsumer(payload.targetConsumer);

  const study = await prisma.study.create({
    data: {
      creatorId,
      title: payload.studyTitle,
      productName: payload.marketStudyType.replace(/_/g, " "),
      category: "FUNCTIONAL_FOOD",
      stage: "MARKET_READINESS",
      description: payload.purpose,
      targetDemographics: {
        ageRange: targetConsumer.ageRange,
        genders: targetConsumer.genders,
        lifestyles: targetConsumer.lifestyles,
        dietaryPrefs: targetConsumer.dietaryPrefs,
        consumptionHabits: targetConsumer.consumptionHabits,
        targetConsumer,
        studyMode: "MARKET",
        coordinationMode: locationContext.coordinationMode,
        marketStudyType: payload.marketStudyType,
        numberOfSamples: payload.numberOfSamples,
        ...(locationContext.coordinationMode === "FIC_ASSISTED"
          ? {
              region: locationContext.region,
              facilityType: locationContext.facilityType,
            }
          : {
              publicVenueName: locationContext.publicVenueName,
              publicCityMunicipality: locationContext.publicCityMunicipality,
              publicAddressDetails: locationContext.publicAddressDetails,
            }),
      },
      screeningCriteria: {
        questions: payload.questions,
        sampleSetups: sampleSetupResult.value,
      },
      stratificationVar: null,
      sampleSize: payload.targetResponses,
      location: locationContext.location,
      status: "DRAFT",
    },
  });
  await logUserUsage({
    actorUserId: creatorId,
    action: "STUDY_CREATED",
    entityType: "Study",
    entityId: study.id,
    summary: `Created market study "${payload.studyTitle}".`,
    metadata: {
      studyMode: "MARKET",
      marketStudyType: payload.marketStudyType,
      targetResponses: payload.targetResponses,
      coordinationMode: locationContext.coordinationMode,
      location: locationContext.location,
    },
  });

  return {
    success: true,
    studyId: study.id,
    redirectPath: `/studies/${study.id}/form`,
  };
}

async function createSensoryStudy(
  payload: z.infer<typeof BuilderPayloadSchema>,
  creatorId: string,
  locationContext: ResolvedLocationContext
) {
  if (!payload.sensoryStudyType) {
    return { success: false, error: "Select a sensory study type." };
  }
  if (payload.targetResponses < 10) {
    return { success: false, error: "Sensory studies require at least 10 target responses." };
  }
  if (payload.targetResponses > 200) {
    return { success: false, error: "Sensory studies support up to 200 target responses." };
  }
  if (!payload.productName?.trim()) {
    return { success: false, error: "Product name is required for sensory studies." };
  }
  if (!payload.categoryCode) {
    return { success: false, error: "Choose a product category profile." };
  }
  const sensorySampleSetupResult = normalizeSensorySampleSetups(payload.sampleSetups);
  if (!sensorySampleSetupResult.success) {
    return { success: false, error: sensorySampleSetupResult.error };
  }
  const targetConsumer = normalizeTargetConsumer(payload.targetConsumer);

  const objective = payload.consumerObjective;
  if (!objective) {
    return { success: false, error: "Select a product development stage." };
  }
  const requiredPanels = OBJECTIVE_PANEL_REQUIREMENTS[objective];
  if (payload.targetResponses < requiredPanels) {
    return {
      success: false,
      error: `Target responses must be at least ${requiredPanels} for ${formatConsumerObjectiveLabel(objective)}.`,
    };
  }

  const scheduleResult = buildSessionSchedule({
    testingStartDate: payload.testingStartDate,
    testingDurationDays: payload.testingDurationDays,
    sessionSlots: payload.sessionSlots,
  });
  if (!scheduleResult.success) {
    return { success: false, error: scheduleResult.error };
  }
  const bookingDates = extractBookingDatesFromSchedule(scheduleResult.value.slots);

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

  const requiresFicBooking = locationContext.coordinationMode === "FIC_ASSISTED";
  let selectedFic:
    | {
        id: string;
        name: string;
        assignedRegion: string | null;
        assignedFacility: string | null;
      }
    | null = null;
  if (requiresFicBooking) {
    if (!("region" in locationContext) || !("facilityType" in locationContext)) {
      return { success: false, error: "Select a valid FIC region and facility." };
    }
    if (!payload.ficUserId) {
      return { success: false, error: "Select a FIC assignee before setting a final schedule." };
    }

    selectedFic = await prisma.user.findFirst({
      where: {
        id: payload.ficUserId,
        role: { in: ["FIC", "FIC_MANAGER"] },
        assignedRegion: locationContext.region,
        assignedFacility: locationContext.facilityType,
      },
      select: {
        id: true,
        name: true,
        assignedRegion: true,
        assignedFacility: true,
      },
    });
    if (!selectedFic) {
      return { success: false, error: "Selected FIC assignee is invalid for the chosen facility." };
    }

    const bookingStatus = await checkFicBookingDates(payload.ficUserId, bookingDates);
    if (!bookingStatus.ok) {
      return { success: false, error: bookingStatus.error };
    }
  }

  await ensurePanelists(Math.max(payload.targetResponses * 2, 40));

  const stage = mapStage(payload.sensoryStudyType, objective);
  const planResult = validateSensoryAttributePlan(payload.attributes, objective);
  if (!planResult.success) {
    return { success: false, error: planResult.error };
  }

  const attributeQuestions = buildSensoryQuestionnaire(
    planResult.rows,
    payload.sensoryStudyType === "CONSUMER_TEST" && objective !== "MARKET_READINESS"
  );
  const ficBookingPayload =
    selectedFic && locationContext.coordinationMode === "FIC_ASSISTED"
      ? {
          ficUserId: selectedFic.id,
          region: locationContext.region,
          facility: locationContext.facilityType,
          bookingDates,
        }
      : undefined;

  const studyResult = await createStudy(
    {
      title: payload.studyTitle,
      productName: payload.productName,
      category: payload.categoryCode,
      stage,
      sampleSize: payload.targetResponses,
      location: locationContext.location,
      targetDemographics: {
        ageRange: targetConsumer.ageRange,
        genders: targetConsumer.genders,
        lifestyles: targetConsumer.lifestyles,
        dietaryPrefs: targetConsumer.dietaryPrefs,
        consumptionHabits: targetConsumer.consumptionHabits,
        targetConsumer,
        experience: "regular-consumer",
        studyMode: "SENSORY",
        coordinationMode: locationContext.coordinationMode,
        sensoryStudyType: payload.sensoryStudyType,
        sensoryMethod: payload.sensoryMethod,
        consumerObjective: objective,
        ...(objective
          ? {
              consumerPanelRequirement: {
                requiredPanels: OBJECTIVE_PANEL_REQUIREMENTS[objective],
                minimumPanels: OBJECTIVE_PANEL_REQUIREMENTS[objective],
                panelCount: objective === "PROTOTYPING" ? 25 : OBJECTIVE_PANEL_REQUIREMENTS[objective],
                bufferCount: objective === "PROTOTYPING" ? 10 : 0,
              },
            }
          : {}),
        categoryLabel: payload.categoryLabel,
        numberOfSamples: payload.numberOfSamples,
        ...(locationContext.coordinationMode === "FIC_ASSISTED"
          ? {
              region: locationContext.region,
              facilityType: locationContext.facilityType,
            }
          : {
              publicVenueName: locationContext.publicVenueName,
              publicCityMunicipality: locationContext.publicCityMunicipality,
              publicAddressDetails: locationContext.publicAddressDetails,
            }),
        sessionSchedule: scheduleResult.value,
        ...(selectedFic ? { ficBookingDates: bookingDates, ficAssignee: selectedFic } : {}),
        sensoryAttributePlan: planResult.rows,
      },
      stratificationVar: "gender",
      sopMode: "STRICT_NEW_STUDY",
      ficBooking: ficBookingPayload,
      attributes: attributeQuestions,
      screeningQuestions: [
        {
          question: "Age qualification check",
          type: "age_range",
          min: targetConsumer.ageRange[0],
          max: targetConsumer.ageRange[1],
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
          options: sensorySampleSetupResult.value.map((setup) =>
            `${setup.description} | Ingredients: ${setup.ingredient || "N/A"} | Allergen: ${setup.allergen}`
          ),
        },
      ],
    },
    creatorId,
    { skipBroadcast: true }
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

function normalizeMarketSampleSetups(payload: z.infer<typeof BuilderPayloadSchema>) {
  const baseRows = payload.sampleSetups.map((setup) => ({
    description: setup.description.trim(),
    ingredient: setup.ingredient?.trim() ?? "",
    allergen: setup.allergen?.trim() ?? "",
    imageDataUrl: setup.imageDataUrl?.trim() ?? "",
    imageName: setup.imageName?.trim() ?? "",
    price: setup.price?.trim() ?? "",
    purchaseIntentQuestion: setup.purchaseIntentQuestion?.trim() ?? "",
  }));

  if (payload.marketStudyType !== "PRODUCT_INTENT") {
    return {
      success: true as const,
      value: baseRows.map((setup) => ({
        description: setup.description,
        ingredient: setup.ingredient,
        allergen: setup.allergen,
      })),
    };
  }

  if (baseRows.length === 0) {
    return { success: false as const, error: "Add at least one Product Intent sample setup." };
  }

  const rows = [];
  for (const [index, setup] of baseRows.entries()) {
    if (!setup.description) {
      return { success: false as const, error: `General description is required for sample setup ${index + 1}.` };
    }
    if (!setup.price) {
      return { success: false as const, error: `Price is required for sample setup ${index + 1}.` };
    }
    if (!setup.purchaseIntentQuestion) {
      return { success: false as const, error: `Purchase intent question is required for sample setup ${index + 1}.` };
    }
    if (!isSafeProductImageDataUrl(setup.imageDataUrl)) {
      return {
        success: false as const,
        error: `Upload a valid JPG, PNG, or WebP image up to 1 MB for sample setup ${index + 1}.`,
      };
    }

    rows.push({
      description: setup.description,
      imageDataUrl: setup.imageDataUrl,
      imageName: setup.imageName,
      price: setup.price,
      purchaseIntentQuestion: setup.purchaseIntentQuestion,
    });
  }

  return { success: true as const, value: rows };
}

function normalizeSensorySampleSetups(sampleSetups: z.infer<typeof BuilderPayloadSchema>["sampleSetups"]) {
  const rows = [];
  for (const [index, setup] of sampleSetups.entries()) {
    const description = setup.description.trim();
    const allergen = setup.allergen?.trim() ?? "";
    if (!description) {
      return { success: false as const, error: `General description is required for sample setup ${index + 1}.` };
    }
    if (!allergen) {
      return { success: false as const, error: `Allergen is required for sensory sample setup ${index + 1}.` };
    }
    rows.push({
      description,
      ingredient: setup.ingredient?.trim() ?? "",
      allergen,
    });
  }
  return { success: true as const, value: rows };
}

function isSafeProductImageDataUrl(value: string) {
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return false;
  }
  const base64 = match[2] ?? "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteLength = Math.floor((base64.length * 3) / 4) - padding;
  return byteLength > 0 && byteLength <= PRODUCT_IMAGE_MAX_BYTES;
}

async function checkFicBookingDates(ficUserId: string, bookingDates: string[]) {
  if (bookingDates.length === 0) {
    return { ok: false as const, error: "No session dates were detected for FIC booking." };
  }

  const rows = await prisma.ficAvailability.findMany({
    where: {
      ficUserId,
      date: { in: bookingDates },
    },
    select: {
      date: true,
      isAvailable: true,
      isLocked: true,
    },
  });
  const byDate = new Map(rows.map((row) => [row.date, row]));

  const invalidDates = bookingDates.filter((date) => {
    const row = byDate.get(date);
    if (!row) {
      return true;
    }
    return !row.isAvailable || row.isLocked;
  });

  if (invalidDates.length > 0) {
    const preview = invalidDates.slice(0, 6).join(", ");
    const suffix = invalidDates.length > 6 ? ` (+${invalidDates.length - 6} more)` : "";
    return {
      ok: false as const,
      error: `Selected FIC availability does not include these date(s): ${preview}${suffix}.`,
    };
  }

  return { ok: true as const };
}

function buildSensoryQuestionnaire(
  attributes: Array<{
    name: string;
    dimension: AttributeDimension;
    isJarTarget: boolean;
    isCustom: boolean;
  }>,
  includeJarRatings: boolean
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

  rows.forEach((attribute) => {
    output.push({
      name: attribute.name,
      type: "ATTRIBUTE_LIKING",
      attributeType: attribute.dimension.toLowerCase(),
      sourceAttributeName: attribute.name,
      isCustom: attribute.isCustom,
      questionType: "HEDONIC",
      scaleType: "NINE_PT",
    });

    if (includeJarRatings) {
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
    }
  });

  output.push({
    name: "What did you like most about this product?",
    type: "OPEN_ENDED",
    questionType: "OPEN_ENDED",
    scaleType: "TEXT",
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
  _studyType: "DISCRIMINATIVE" | "DESCRIPTIVE" | "CONSUMER_TEST",
  objective?: ConsumerObjective
): StudyStageValue {
  if (objective === "MARKET_READINESS") return "MARKET_READINESS";
  if (objective === "REFINEMENT") return "REFINEMENT";
  return "PROTOTYPE_CHECK";
}

function formatConsumerObjectiveLabel(objective: ConsumerObjective) {
  if (objective === "MARKET_READINESS") return "Consumer Acceptability";
  if (objective === "REFINEMENT") return "Refinement";
  return "Prototyping";
}

function validateSensoryAttributePlan(
  attributes: Array<{
    name: string;
    dimension: AttributeDimension;
    isJarTarget?: boolean;
    isCustom?: boolean;
    actionable?: boolean;
  }>,
  objective: ConsumerObjective | undefined
) {
  const rows = attributes
    .map((attribute) => ({
      name: attribute.name.trim(),
      dimension: attribute.dimension,
      isJarTarget: objective === "MARKET_READINESS" ? false : true,
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

  if (!objective) {
    return { success: false as const, error: "Select the MSME goal for this consumer test." };
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

async function persistStudyLocationTarget(
  studyId: string,
  payload: z.infer<typeof BuilderPayloadSchema>,
  locationContext: ResolvedLocationContext,
  ficUserId: string | null,
) {
  const requestedScope = (payload.locationTarget?.scope ?? "CITY") as StudyTargetScope;

  // FIC_ASSISTED mode: inherit location from the chosen FIC's profile.
  if (locationContext.coordinationMode === "FIC_ASSISTED" && ficUserId) {
    const ficProfile = await prisma.userProfile.findUnique({
      where: { userId: ficUserId },
      select: {
        regionId: true,
        provinceId: true,
        cityId: true,
        barangayId: true,
        completedAt: true,
      },
    });

    // Find a fallback PSGC region match using the FIC's assignedRegion string,
    // for FICs that haven't completed their geographic profile yet.
    let fallbackRegionId: string | null = null;
    if ((!ficProfile || !ficProfile.completedAt) && locationContext.region) {
      const region = await prisma.psgcRegion.findFirst({
        where: {
          OR: [
            { name: { contains: locationContext.region, mode: "insensitive" } },
            { shortName: { contains: locationContext.region, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      fallbackRegionId = region?.id ?? null;
    }

    const inheritedRegionId = ficProfile?.regionId ?? fallbackRegionId;
    const inheritedProvinceId = ficProfile?.provinceId ?? null;
    const inheritedCityId = ficProfile?.cityId ?? null;
    const inheritedBarangayId = ficProfile?.barangayId ?? null;

    // Coerce scope down if higher precision is unavailable
    let effectiveScope: StudyTargetScope = requestedScope;
    if (effectiveScope === "BARANGAY" && !inheritedBarangayId) effectiveScope = inheritedCityId ? "CITY" : effectiveScope;
    if (effectiveScope === "CITY" && !inheritedCityId) effectiveScope = inheritedProvinceId ? "PROVINCE" : effectiveScope;
    if (effectiveScope === "PROVINCE" && !inheritedProvinceId) effectiveScope = inheritedRegionId ? "REGION" : effectiveScope;
    if (effectiveScope === "REGION" && !inheritedRegionId) effectiveScope = "ALL";

    await prisma.studyLocationTarget.upsert({
      where: { studyId },
      create: {
        studyId,
        scope: effectiveScope,
        regionId: inheritedRegionId,
        provinceId: inheritedProvinceId,
        cityId: inheritedCityId,
        barangayId: inheritedBarangayId,
        inheritedFromFicUserId: ficUserId,
      },
      update: {
        scope: effectiveScope,
        regionId: inheritedRegionId,
        provinceId: inheritedProvinceId,
        cityId: inheritedCityId,
        barangayId: inheritedBarangayId,
        inheritedFromFicUserId: ficUserId,
      },
    });
    return;
  }

  // SELF_MANAGED_PUBLIC: persist explicit PSGC ids from the builder.
  const target = payload.locationTarget ?? null;
  const ids = {
    regionId: target?.regionId ?? null,
    provinceId: target?.provinceId ?? null,
    cityId: target?.cityId ?? null,
    barangayId: target?.barangayId ?? null,
  };

  // ALL scope is always allowed.
  if (requestedScope !== "ALL") {
    const consistency = await validateLocationConsistency(ids);
    if (!consistency.ok) {
      // Drop to ALL rather than fail the entire study creation — we already
      // persisted the study. Log so it's visible.
      console.warn(`[study-target] Location consistency failed for study ${studyId}: ${consistency.error}`);
    }
  }

  await prisma.studyLocationTarget.upsert({
    where: { studyId },
    create: {
      studyId,
      scope: requestedScope,
      regionId: ids.regionId,
      provinceId: ids.provinceId,
      cityId: ids.cityId,
      barangayId: ids.barangayId,
      venueName:
        locationContext.coordinationMode === "SELF_MANAGED_PUBLIC"
          ? locationContext.publicVenueName
          : null,
      addressDetails:
        locationContext.coordinationMode === "SELF_MANAGED_PUBLIC"
          ? locationContext.publicAddressDetails || null
          : null,
    },
    update: {
      scope: requestedScope,
      regionId: ids.regionId,
      provinceId: ids.provinceId,
      cityId: ids.cityId,
      barangayId: ids.barangayId,
      venueName:
        locationContext.coordinationMode === "SELF_MANAGED_PUBLIC"
          ? locationContext.publicVenueName
          : null,
      addressDetails:
        locationContext.coordinationMode === "SELF_MANAGED_PUBLIC"
          ? locationContext.publicAddressDetails || null
          : null,
    },
  });
}

async function notifyLocationMatchedConsumers(
  studyId: string,
  studyTitle: string,
) {
  const target = await prisma.studyLocationTarget.findUnique({
    where: { studyId },
    select: {
      scope: true,
      regionId: true,
      provinceId: true,
      cityId: true,
      barangayId: true,
    },
  });
  if (!target) {
    // No target set — fall back to global consumer broadcast
    await notifyRole("CONSUMER", {
      title: "New study available",
      message: `${studyTitle} is now recruiting participants.`,
      category: "STUDY",
      actionUrl: `/studies/${studyId}/form`,
      metadata: { studyId, type: "NEW_STUDY" },
    });
    return;
  }

  const matchedUserIds = await findUsersMatchingTarget(target, { roles: ["CONSUMER"] });
  if (matchedUserIds.length === 0) {
    return;
  }

  // Direct user-level notifications so audit trails reflect who was targeted.
  for (const userId of matchedUserIds) {
    await notifyUser(userId, {
      title: "New study near you",
      message: `${studyTitle} is recruiting participants in your area.`,
      category: "STUDY",
      actionUrl: `/studies/${studyId}/form`,
      metadata: { studyId, type: "NEW_STUDY_TARGETED" },
    });
  }
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
      coordinationMode: payload.coordinationMode,
      facilityType: payload.facilityType,
    },
  });

  if (creatorRole !== "MSME") {
    return;
  }

  if (payload.studyMode === "SENSORY" || payload.studyMode === "MARKET") {
    await notifyLocationMatchedConsumers(result.studyId, payload.studyTitle);
  }

  if (payload.coordinationMode === "FIC_ASSISTED") {
    await notifyRole("FIC", {
      title: "New MSME booking to FIC",
      message: `${payload.studyTitle} was submitted for FIC-assisted coordination at ${payload.facilityType ?? "assigned facility"}.`,
      level: "WARNING",
      category: "STUDY",
      actionUrl: `/dashboard/${result.studyId}`,
      metadata: { studyId: result.studyId, facilityType: payload.facilityType, coordinationMode: payload.coordinationMode },
    });
  }
}

function scheduleStudyNotifications(
  payload: z.infer<typeof BuilderPayloadSchema>,
  creatorId: string,
  creatorRole: "MSME" | "ADMIN",
  result: { success: boolean; studyId?: string }
) {
  if (!result.success || !result.studyId) {
    return;
  }

  const traceId = createWorkflowTraceId("create-study");
  runInBackground(
    "create-study-notifications",
    async () => {
      await pushStudyNotifications(payload, creatorId, creatorRole, result);
    },
    {
      traceId,
      metadata: {
        studyId: result.studyId,
        creatorId,
        creatorRole,
        studyMode: payload.studyMode,
        coordinationMode: payload.coordinationMode,
      },
    }
  );
}
