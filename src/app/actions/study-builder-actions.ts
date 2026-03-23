"use server";

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
  consumerObjective: z.enum(["MARKET_READINESS", "REFINEMENT", "PROTOTYPING"]).optional(),
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
        dimension: z.string().min(1),
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
  questions: z.array(z.string().min(1)).default([]),
});

const OBJECTIVE_LIMITS: Record<"MARKET_READINESS" | "REFINEMENT" | "PROTOTYPING", number> = {
  MARKET_READINESS: 110,
  REFINEMENT: 60,
  PROTOTYPING: 35,
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

  await ensurePanelists(Math.max(payload.targetResponses * 2, 40));

  const stage = mapStage(payload.sensoryStudyType, objective);
  const attributeQuestions = buildSensoryQuestionnaire(payload.attributes);

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

function buildSensoryQuestionnaire(attributes: Array<{ name: string; dimension: string }>) {
  const rows = attributes.slice(0, 5).filter((attribute) => attribute.name.trim().length > 0);
  const output: Array<{
    name: string;
    type: "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED";
    jarOptions?: { low: string; mid: string; high: string };
  }> = [];

  output.push({ name: "Overall Liking", type: "OVERALL_LIKING" });

  rows.forEach((attribute) => {
    output.push({
      name: `${attribute.name} Liking`,
      type: "ATTRIBUTE_LIKING",
    });
  });

  rows.forEach((attribute) => {
    output.push({
      name: `${attribute.name} (JAR)`,
      type: "JAR",
      jarOptions: {
        low: `Too low ${attribute.name.toLowerCase()}`,
        mid: "Just right",
        high: `Too high ${attribute.name.toLowerCase()}`,
      },
    });
  });

  output.push({
    name: "What should be improved?",
    type: "OPEN_ENDED",
  });

  return output;
}

function mapStage(
  studyType: "DISCRIMINATIVE" | "DESCRIPTIVE" | "CONSUMER_TEST",
  objective?: "MARKET_READINESS" | "REFINEMENT" | "PROTOTYPING"
): "PROTOTYPE_CHECK" | "REFINEMENT" | "MARKET_READINESS" {
  if (studyType === "CONSUMER_TEST") {
    if (objective === "MARKET_READINESS") return "MARKET_READINESS";
    if (objective === "REFINEMENT") return "REFINEMENT";
    return "PROTOTYPE_CHECK";
  }
  return "PROTOTYPE_CHECK";
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
