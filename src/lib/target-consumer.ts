import type { Prisma } from "@prisma/client";

export type TargetConsumerGender = "MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_SAY";
export type TargetConsumerDietaryPref =
  | "NO_SPECIFIC_DIET"
  | "PLANT_BASED"
  | "VEGETARIAN"
  | "VEGAN"
  | "FLEXITARIAN"
  | "KETO"
  | "LOW_SUGAR"
  | "HALAL_CONSCIOUS";

export type TargetConsumerProfile = {
  ageRange: [number, number];
  genders: TargetConsumerGender[];
  workDailyLiving: string[];
  healthFitness: string[];
  foodConsumption: string[];
  dietaryPrefs: TargetConsumerDietaryPref[];
  // Legacy fields, kept for backwards compatibility with stored study targets.
  lifestyles: string[];
  consumptionHabits: {
    coffeeDrinker?: boolean;
    snackConsumer?: boolean;
    energyDrinkConsumer?: boolean;
  };
};

export type TargetConsumerPanelist = {
  age?: number;
  gender?: string;
  lifestyle: string[];
  workDailyLiving?: string[];
  healthFitness?: string[];
  foodConsumption?: string[];
  dietaryPrefs?: string[];
  consumptionHabits?: unknown;
  isActive?: boolean;
} | null;

export const TARGET_CONSUMER_GENDER_OPTIONS: Array<{ value: TargetConsumerGender; label: string }> = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "NON_BINARY", label: "Non-binary" },
  { value: "PREFER_NOT_SAY", label: "Prefer not to say" },
];

export const TARGET_CONSUMER_DIETARY_OPTIONS: Array<{ value: TargetConsumerDietaryPref; label: string }> = [
  { value: "NO_SPECIFIC_DIET", label: "No specific diet" },
  { value: "PLANT_BASED", label: "Plant-based" },
  { value: "VEGETARIAN", label: "Vegetarian" },
  { value: "VEGAN", label: "Vegan" },
  { value: "FLEXITARIAN", label: "Flexitarian" },
  { value: "KETO", label: "Keto" },
  { value: "LOW_SUGAR", label: "Low-sugar" },
  { value: "HALAL_CONSCIOUS", label: "Halal-conscious" },
];

export const TARGET_CONSUMER_WORK_DAILY_LIVING_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "office_worker", label: "Office worker" },
  { value: "remote_worker", label: "Remote worker" },
  { value: "entrepreneur", label: "Entrepreneur" },
  { value: "shift_worker", label: "Shift worker" },
] as const;

export const TARGET_CONSUMER_HEALTH_FITNESS_OPTIONS = [
  { value: "athlete", label: "Athlete" },
  { value: "fitness_enthusiast", label: "Fitness enthusiast" },
  { value: "gym_goer", label: "Gym-goer" },
  { value: "active_lifestyle", label: "Active lifestyle" },
  { value: "wellness_focused", label: "Wellness-focused" },
] as const;

export const TARGET_CONSUMER_FOOD_CONSUMPTION_OPTIONS = [
  { value: "foodie", label: "Foodie" },
  { value: "convenience_seeker", label: "Convenience-seeker" },
  { value: "budget_conscious", label: "Budget-conscious" },
  { value: "cafe_enthusiast", label: "Café enthusiast" },
  { value: "frequent_snacker", label: "Frequent snacker" },
] as const;

/** @deprecated Retained only for the mobile (Flutter) API surface; new code should use the categorized options. */
export const TARGET_CONSUMER_LIFESTYLE_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "athlete", label: "Athlete" },
  { value: "office_worker", label: "Office worker" },
] as const;

/** @deprecated Retained only for the mobile (Flutter) API surface; new code should use the categorized options. */
export const TARGET_CONSUMER_CONSUMPTION_OPTIONS = [
  { value: "coffeeDrinker", label: "Coffee drinker" },
  { value: "snackConsumer", label: "Snack consumer" },
  { value: "energyDrinkConsumer", label: "Energy drink consumer" },
] as const;

export const DEFAULT_TARGET_CONSUMER: TargetConsumerProfile = {
  ageRange: [18, 55],
  genders: ["MALE", "FEMALE", "NON_BINARY"],
  workDailyLiving: [],
  healthFitness: [],
  foodConsumption: [],
  dietaryPrefs: [],
  lifestyles: [],
  consumptionHabits: {},
};

const ALLOWED_GENDERS = new Set(TARGET_CONSUMER_GENDER_OPTIONS.map((option) => option.value));
const ALLOWED_DIETARY_PREFS = new Set(TARGET_CONSUMER_DIETARY_OPTIONS.map((option) => option.value));
const ALLOWED_WORK_DAILY_LIVING = new Set(TARGET_CONSUMER_WORK_DAILY_LIVING_OPTIONS.map((option) => option.value));
const ALLOWED_HEALTH_FITNESS = new Set(TARGET_CONSUMER_HEALTH_FITNESS_OPTIONS.map((option) => option.value));
const ALLOWED_FOOD_CONSUMPTION = new Set(TARGET_CONSUMER_FOOD_CONSUMPTION_OPTIONS.map((option) => option.value));

export function normalizeTargetConsumer(value: unknown): TargetConsumerProfile {
  const source = isRecord(value) && isRecord(value.targetConsumer)
    ? value.targetConsumer
    : isRecord(value)
      ? value
      : {};

  return {
    ageRange: normalizeAgeRange(source.ageRange),
    genders: normalizeStringArray(source.genders, ALLOWED_GENDERS, DEFAULT_TARGET_CONSUMER.genders),
    workDailyLiving: normalizeStringArray(source.workDailyLiving, ALLOWED_WORK_DAILY_LIVING, []),
    healthFitness: normalizeStringArray(source.healthFitness, ALLOWED_HEALTH_FITNESS, []),
    foodConsumption: normalizeStringArray(source.foodConsumption, ALLOWED_FOOD_CONSUMPTION, []),
    dietaryPrefs: normalizeStringArray(source.dietaryPrefs, ALLOWED_DIETARY_PREFS, []),
    lifestyles: Array.isArray(source.lifestyles)
      ? source.lifestyles.map((item) => String(item)).filter((item) => item.length > 0)
      : [],
    consumptionHabits: normalizeLegacyConsumption(source.consumptionHabits),
  };
}

export function buildTargetConsumerWhere(value: unknown): Prisma.PanelistWhereInput {
  const target = normalizeTargetConsumer(value);
  const where: Prisma.PanelistWhereInput = {
    isActive: true,
  };

  const and: Prisma.PanelistWhereInput[] = [];
  if (target.workDailyLiving.length > 0) {
    and.push({ workDailyLiving: { hasEvery: target.workDailyLiving } });
  }
  if (target.healthFitness.length > 0) {
    and.push({ healthFitness: { hasEvery: target.healthFitness } });
  }
  if (target.foodConsumption.length > 0) {
    and.push({ foodConsumption: { hasEvery: target.foodConsumption } });
  }
  if (target.dietaryPrefs.length > 0) {
    where.dietaryPrefs = { hasEvery: target.dietaryPrefs };
  }
  if (and.length > 0) {
    where.AND = and;
  }

  return where;
}

export function doesPanelistMatchTargetConsumer(
  panelist: TargetConsumerPanelist,
  targetValue: unknown
) {
  if (!panelist || panelist.isActive === false) {
    return false;
  }

  const target = normalizeTargetConsumer(targetValue);
  if (!matchesAll(target.workDailyLiving, panelist.workDailyLiving ?? [])) {
    return false;
  }
  if (!matchesAll(target.healthFitness, panelist.healthFitness ?? [])) {
    return false;
  }
  if (!matchesAll(target.foodConsumption, panelist.foodConsumption ?? [])) {
    return false;
  }
  if (!matchesAll(target.dietaryPrefs, panelist.dietaryPrefs ?? [])) {
    return false;
  }
  return true;
}

export function getTargetConsumerSummary(value: unknown) {
  const target = normalizeTargetConsumer(value);
  const parts: string[] = [];

  if (target.workDailyLiving.length > 0) {
    parts.push(`Work & Daily Living: ${target.workDailyLiving.map((v) => humanizeOption(v, TARGET_CONSUMER_WORK_DAILY_LIVING_OPTIONS)).join(", ")}`);
  }
  if (target.healthFitness.length > 0) {
    parts.push(`Health & Fitness: ${target.healthFitness.map((v) => humanizeOption(v, TARGET_CONSUMER_HEALTH_FITNESS_OPTIONS)).join(", ")}`);
  }
  if (target.foodConsumption.length > 0) {
    parts.push(`Food & Consumption: ${target.foodConsumption.map((v) => humanizeOption(v, TARGET_CONSUMER_FOOD_CONSUMPTION_OPTIONS)).join(", ")}`);
  }
  if (target.dietaryPrefs.length > 0) {
    parts.push(`Dietary: ${target.dietaryPrefs.map((v) => humanizeOption(v, TARGET_CONSUMER_DIETARY_OPTIONS)).join(", ")}`);
  }

  return parts.length > 0 ? parts.join(" | ") : "Any consumer profile";
}

function matchesAll(required: string[], actual: string[]) {
  if (required.length === 0) return true;
  const actualSet = new Set(actual);
  return required.every((value) => actualSet.has(value));
}

function normalizeAgeRange(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) {
    return DEFAULT_TARGET_CONSUMER.ageRange;
  }

  const min = Number(value[0]);
  const max = Number(value[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return DEFAULT_TARGET_CONSUMER.ageRange;
  }

  const normalizedMin = Math.max(10, Math.min(100, Math.floor(min)));
  const normalizedMax = Math.max(10, Math.min(100, Math.floor(max)));
  if (normalizedMin > normalizedMax) {
    return [normalizedMax, normalizedMin];
  }
  return [normalizedMin, normalizedMax];
}

function normalizeStringArray<T extends string>(
  value: unknown,
  allowed: Set<T>,
  fallback: T[]
) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value
    .map((item) => String(item).trim())
    .filter((item): item is T => allowed.has(item as T));

  return Array.from(new Set(normalized));
}

function normalizeLegacyConsumption(value: unknown): TargetConsumerProfile["consumptionHabits"] {
  if (!isRecord(value)) {
    return {};
  }
  const habits: TargetConsumerProfile["consumptionHabits"] = {};
  if (value.coffeeDrinker === true) habits.coffeeDrinker = true;
  if (value.snackConsumer === true) habits.snackConsumer = true;
  if (value.energyDrinkConsumer === true) habits.energyDrinkConsumer = true;
  return habits;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function humanizeOption(value: string, options: ReadonlyArray<{ value: string; label: string }>) {
  return options.find((option) => option.value === value)?.label ?? value;
}
