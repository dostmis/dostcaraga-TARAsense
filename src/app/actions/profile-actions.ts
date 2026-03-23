"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DietaryPref, Gender } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { ROLE_DASHBOARD_PATH } from "@/lib/auth/roles";
import { notifyUser } from "@/lib/notifications";

const ALLOWED_LIFESTYLES = new Set(["student", "athlete", "office_worker"]);
const ALLOWED_DIETARY_PREFS = new Set<DietaryPref>(["VEGETARIAN", "VEGAN", "GLUTEN_FREE"]);
const ALLOWED_GENDERS = new Set<Gender>(["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_SAY"]);

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
  const occupation = String(formData.get("occupation") ?? "").trim();
  const genderInput = String(formData.get("gender") ?? "").toUpperCase() as Gender;
  const age = Number(formData.get("age") ?? "0");

  const lifestyles = formData
    .getAll("lifestyle")
    .map((value) => String(value).trim().toLowerCase())
    .filter((value) => ALLOWED_LIFESTYLES.has(value));

  const dietaryPrefs = formData
    .getAll("dietaryPrefs")
    .map((value) => String(value).trim().toUpperCase() as DietaryPref)
    .filter((value) => ALLOWED_DIETARY_PREFS.has(value));

  const coffeeDrinker = formData.get("coffeeDrinker") === "on";
  const snackConsumer = formData.get("snackConsumer") === "on";
  const energyDrinkConsumer = formData.get("energyDrinkConsumer") === "on";

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
  if (occupation.length < 2) {
    redirect(withFeedback(redirectTo, "error", "Occupation is required"));
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
    occupation,
    lifestyle: lifestyles,
    dietaryPrefs,
    consumptionHabits: {
      coffeeDrinker,
      snackConsumer,
      energyDrinkConsumer,
      snacks: snackConsumer ? "daily" : "weekly",
    },
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
      data: panelistData,
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
