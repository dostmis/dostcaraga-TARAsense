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

const MAX_STUDY_ATTRIBUTES = 25;
const MAX_ATTRIBUTE_NAME_LENGTH = 120;

const CreateStudySchema = z.object({
  title: z.string().min(3),
  productName: z.string().min(1),
  category: z.enum(["BEVERAGE", "SNACK", "DESSERT", "FUNCTIONAL_FOOD", "DAIRY", "BAKERY"]),
  stage: z.enum(["PROTOTYPE_CHECK", "REFINEMENT", "MARKET_READINESS"]),
  sampleSize: z.number().min(10).max(200),
  location: z.string(),
  targetDemographics: z.object({
    ageRange: z.tuple([z.number(), z.number()]),
    genders: z.array(z.enum(["MALE", "FEMALE", "NON_BINARY"])).optional(),
    lifestyles: z.array(z.string()).optional(),
    experience: z.string().optional()
  }).passthrough(),
  stratificationVar: z.enum(["gender", "age_group", "none"]),
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
  }))
});

export async function createStudy(data: z.infer<typeof CreateStudySchema>, userId: string) {
  try {
    // Validate
    const validated = CreateStudySchema.parse(data);
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
    const attributeValidationError = validateSensoryAttributeSetup(normalizedAttributes);
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
          creatorId: userId,
          status: "RECRUITING"
        }
      });

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
    return { success: true, studyId: study.id };
  } catch (error) {
    console.error("Create study error:", error);
    return { success: false, error: "Failed to create study" };
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
  }>
) {
  if (attributes.length === 0) {
    return "At least one sensory attribute is required.";
  }
  if (attributes.length > MAX_STUDY_ATTRIBUTES) {
    return `Too many sensory attributes. Maximum is ${MAX_STUDY_ATTRIBUTES}.`;
  }

  let overallCount = 0;
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

    if (attribute.type === "JAR") {
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
      if (!["taste", "texture", "aftertaste", "mouthfeel"].includes(normalizedType)) {
        return `Invalid attribute type "${attribute.attributeType}" for "${attribute.name}".`;
      }
    }
  }

  if (overallCount !== 1) {
    return "Exactly one OVERALL_LIKING question is required.";
  }

  return null;
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
    if (!normalizedName || !["taste", "texture", "aftertaste", "mouthfeel"].includes(normalizedType)) {
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
    genders?: ("MALE" | "FEMALE" | "NON_BINARY")[];
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
  if (!session || (session.role !== "MSME" && session.role !== "ADMIN")) {
    redirect("/login?error=MSME+login+required");
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
