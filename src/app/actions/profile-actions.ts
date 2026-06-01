"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DietaryPref, Gender } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { notifyUser } from "@/lib/notifications";
import {
  TARGET_CONSUMER_DIETARY_OPTIONS,
  TARGET_CONSUMER_FOOD_CONSUMPTION_OPTIONS,
  TARGET_CONSUMER_HEALTH_FITNESS_OPTIONS,
  TARGET_CONSUMER_WORK_DAILY_LIVING_OPTIONS,
  type TargetConsumerDietaryPref,
} from "@/lib/target-consumer";

const ALLOWED_DIETARY_PREFS = new Set<TargetConsumerDietaryPref>(
  TARGET_CONSUMER_DIETARY_OPTIONS.map((option) => option.value)
);
const ALLOWED_WORK_DAILY_LIVING = new Set<string>(
  TARGET_CONSUMER_WORK_DAILY_LIVING_OPTIONS.map((option) => option.value)
);
const ALLOWED_HEALTH_FITNESS = new Set<string>(
  TARGET_CONSUMER_HEALTH_FITNESS_OPTIONS.map((option) => option.value)
);
const ALLOWED_FOOD_CONSUMPTION = new Set<string>(
  TARGET_CONSUMER_FOOD_CONSUMPTION_OPTIONS.map((option) => option.value)
);
const ALLOWED_GENDERS = new Set<Gender>(["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_SAY"]);

function collectFromForm(formData: FormData, key: string, allowed: Set<string>) {
  return formData
    .getAll(key)
    .map((value) => String(value).trim())
    .filter((value) => allowed.has(value));
}

export async function saveProfile(formData: FormData) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login?error=Please+login+to+update+your+profile");
  }
  const redirectTo = resolveRedirectTarget(formData.get("redirectTo"));

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) {
    redirect("/login?error=Session+expired");
  }

  const name = String(formData.get("name") ?? "").trim();
  const organizationRaw = String(formData.get("organization") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const genderInput = String(formData.get("gender") ?? "").toUpperCase() as Gender;
  const age = Number(formData.get("age") ?? "0");

  const dietaryPrefs = formData
    .getAll("dietaryPrefs")
    .map((value) => String(value).trim().toUpperCase())
    .filter((value): value is TargetConsumerDietaryPref =>
      ALLOWED_DIETARY_PREFS.has(value as TargetConsumerDietaryPref)
    ) as DietaryPref[];

  const workDailyLiving = collectFromForm(formData, "workDailyLiving", ALLOWED_WORK_DAILY_LIVING);
  const healthFitness = collectFromForm(formData, "healthFitness", ALLOWED_HEALTH_FITNESS);
  const foodConsumption = collectFromForm(formData, "foodConsumption", ALLOWED_FOOD_CONSUMPTION);

  if (name.length < 2) {
    redirect(withFeedback(redirectTo, "error", "Name must be at least 2 characters"));
  }
  if (!Number.isFinite(age) || age < 10 || age > 100) {
    redirect(withFeedback(redirectTo, "error", "Age must be between 10 and 100"));
  }
  if (!ALLOWED_GENDERS.has(genderInput)) {
    redirect(withFeedback(redirectTo, "error", "Choose a valid gender"));
  }
  if (location.length < 2) {
    redirect(withFeedback(redirectTo, "error", "Location is required"));
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      organization: organizationRaw || null,
    },
  });

  const panelistData = {
    userId: user.id,
    name,
    email: user.email,
    age,
    gender: genderInput,
    location,
    dietaryPrefs,
    workDailyLiving,
    healthFitness,
    foodConsumption,
    isActive: true,
  };

  const existingPanelist = await prisma.panelist.findFirst({
    where: {
      OR: [{ userId: user.id }, { email: user.email }],
    },
    select: { id: true },
  });

  if (existingPanelist) {
    await prisma.panelist.update({
      where: { id: existingPanelist.id },
      data: panelistData,
    });
  } else {
    await prisma.panelist.create({
      data: { ...panelistData, consumptionHabits: {} },
    });
  }

  await notifyUser(user.id, {
    title: "Profile updated",
    message: "Your panelist profile details were saved successfully.",
    level: "SUCCESS",
    category: "SYSTEM",
    actionUrl: redirectTo,
  });

  revalidatePath("/profile");
  revalidatePath(ROLE_DASHBOARD_PATH[session.role]);
  revalidatePath(redirectTo.split("?")[0] || redirectTo);
  redirect(withFeedback(redirectTo, "message", "Profile updated successfully"));
}

function resolveRedirectTarget(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/profile";
}

function withFeedback(path: string, key: "error" | "message", value: string) {
  const target = new URL(path, "http://localhost");
  target.searchParams.set(key, value);
  return `${target.pathname}${target.search}`;
}
