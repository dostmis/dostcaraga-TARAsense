import { DietaryPref, Gender } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { MobileUser } from "@/lib/mobile/api";

export const LIFESTYLE_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "athlete", label: "Athlete" },
  { value: "office_worker", label: "Office worker" },
];

export const DIETARY_OPTIONS: Array<{ value: DietaryPref; label: string }> = [
  { value: "VEGETARIAN", label: "Vegetarian" },
  { value: "VEGAN", label: "Vegan" },
  { value: "GLUTEN_FREE", label: "Gluten-free" },
];

export const GENDER_OPTIONS: Array<{ value: Gender; label: string }> = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "NON_BINARY", label: "Non-binary" },
  { value: "PREFER_NOT_SAY", label: "Prefer not to say" },
];

const ALLOWED_LIFESTYLES = new Set(LIFESTYLE_OPTIONS.map((option) => option.value));
const ALLOWED_DIETARY_PREFS = new Set<DietaryPref>(DIETARY_OPTIONS.map((option) => option.value));
const ALLOWED_GENDERS = new Set<Gender>(GENDER_OPTIONS.map((option) => option.value));

type ConsumptionHabits = {
  coffeeDrinker?: boolean;
  snackConsumer?: boolean;
  energyDrinkConsumer?: boolean;
  snacks?: string;
};

export async function getMobileProfile(user: MobileUser) {
  const panelist = await prisma.panelist.findFirst({
    where: {
      OR: [{ userId: user.id }, { email: user.email }],
    },
    select: {
      id: true,
      age: true,
      gender: true,
      location: true,
      occupation: true,
      lifestyle: true,
      dietaryPrefs: true,
      consumptionHabits: true,
      joinedAt: true,
      lastActive: true,
    },
  });

  const participationHistory = panelist
    ? await prisma.studyParticipant.findMany({
        where: { panelistId: panelist.id },
        include: {
          study: {
            select: {
              id: true,
              title: true,
              productName: true,
              stage: true,
            },
          },
        },
        orderBy: { selectionOrder: "desc" },
        take: 20,
      })
    : [];

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organization: user.organization,
      assignedRegion: user.assignedRegion ?? null,
      assignedFacility: user.assignedFacility ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
    panelist: panelist
      ? {
          ...panelist,
          joinedAt: panelist.joinedAt.toISOString(),
          lastActive: panelist.lastActive.toISOString(),
          consumptionHabits: parseConsumption(panelist.consumptionHabits),
        }
      : null,
    participationHistory: participationHistory.map((row) => ({
      id: row.id,
      status: row.status,
      completedAt: row.completedAt?.toISOString() ?? null,
      study: row.study,
    })),
    options: {
      lifestyles: LIFESTYLE_OPTIONS,
      dietaryPrefs: DIETARY_OPTIONS,
      genders: GENDER_OPTIONS,
    },
  };
}

export async function updateMobileProfile(user: MobileUser, payload: Record<string, unknown>) {
  const name = String(payload.name ?? user.name).trim();
  const organizationRaw = String(payload.organization ?? "").trim();
  const location = String(payload.location ?? "").trim();
  const occupation = String(payload.occupation ?? "").trim();
  const genderInput = String(payload.gender ?? "PREFER_NOT_SAY").toUpperCase() as Gender;
  const age = Number(payload.age ?? 0);

  const lifestyles = toStringArray(payload.lifestyle ?? payload.lifestyles)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => ALLOWED_LIFESTYLES.has(value));

  const dietaryPrefs = toStringArray(payload.dietaryPrefs)
    .map((value) => value.trim().toUpperCase() as DietaryPref)
    .filter((value) => ALLOWED_DIETARY_PREFS.has(value));

  const coffeeDrinker = Boolean(payload.coffeeDrinker);
  const snackConsumer = Boolean(payload.snackConsumer);
  const energyDrinkConsumer = Boolean(payload.energyDrinkConsumer);

  if (name.length < 2) {
    return { ok: false as const, error: "Name must be at least 2 characters." };
  }
  if (!Number.isFinite(age) || age < 10 || age > 100) {
    return { ok: false as const, error: "Age must be between 10 and 100." };
  }
  if (!ALLOWED_GENDERS.has(genderInput)) {
    return { ok: false as const, error: "Choose a valid gender." };
  }
  if (location.length < 2) {
    return { ok: false as const, error: "Location is required." };
  }
  if (occupation.length < 2) {
    return { ok: false as const, error: "Occupation is required." };
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      organization: organizationRaw || null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      organization: true,
      assignedRegion: true,
      assignedFacility: true,
      createdAt: true,
      updatedAt: true,
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

  return {
    ok: true as const,
    user: {
      ...updatedUser,
      role: user.role,
    },
  };
}

function parseConsumption(value: unknown): ConsumptionHabits {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as ConsumptionHabits;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item));
}
