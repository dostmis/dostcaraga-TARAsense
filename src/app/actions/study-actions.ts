"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { StratifiedSamplingService } from "@/lib/services/sampling-service";
import { getCurrentSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { Prisma } from "@prisma/client";
import { z } from "zod";

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
    jarOptions: z.object({
      low: z.string(),
      mid: z.string(),
      high: z.string()
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
    const targetDemographicsJson = JSON.parse(
      JSON.stringify(validated.targetDemographics)
    ) as Prisma.InputJsonValue;
    const screeningCriteriaJson = JSON.parse(
      JSON.stringify(validated.screeningQuestions)
    ) as Prisma.InputJsonValue;

    const study = await prisma.study.create({
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

    await prisma.sensoryAttribute.createMany({
      data: validated.attributes.map((attr, idx) => ({
        studyId: study.id,
        name: attr.name,
        type: attr.type,
        order: idx,
        jarOptions: attr.jarOptions
      }))
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
