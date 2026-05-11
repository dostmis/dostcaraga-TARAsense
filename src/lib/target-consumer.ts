import type { Prisma } from "@prisma/client";

export type TargetConsumerGender = "MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_SAY";
export type TargetConsumerDietaryPref = "VEGETARIAN" | "VEGAN" | "GLUTEN_FREE";

export type TargetConsumerProfile = {
  ageRange: [number, number];
  genders: TargetConsumerGender[];
  lifestyles: string[];
  dietaryPrefs: TargetConsumerDietaryPref[];
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

export const TARGET_CONSUMER_LIFESTYLE_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "athlete", label: "Athlete" },
  { value: "office_worker", label: "Office worker" },
];

export const TARGET_CONSUMER_DIETARY_OPTIONS: Array<{ value: TargetConsumerDietaryPref; label: string }> = [
  { value: "VEGETARIAN", label: "Vegetarian" },
  { value: "VEGAN", label: "Vegan" },
  { value: "GLUTEN_FREE", label: "Gluten-free" },
];

export const TARGET_CONSUMER_CONSUMPTION_OPTIONS = [
  { value: "coffeeDrinker", label: "Coffee drinker" },
  { value: "snackConsumer", label: "Snack consumer" },
  { value: "energyDrinkConsumer", label: "Energy drink consumer" },
] as const;

export const DEFAULT_TARGET_CONSUMER: TargetConsumerProfile = {
  ageRange: [18, 55],
  genders: ["MALE", "FEMALE", "NON_BINARY"],
  lifestyles: [],
  dietaryPrefs: [],
  consumptionHabits: {},
};

const ALLOWED_GENDERS = new Set(TARGET_CONSUMER_GENDER_OPTIONS.map((option) => option.value));
const ALLOWED_LIFESTYLES = new Set(TARGET_CONSUMER_LIFESTYLE_OPTIONS.map((option) => option.value));
const ALLOWED_DIETARY_PREFS = new Set(TARGET_CONSUMER_DIETARY_OPTIONS.map((option) => option.value));
const CONSUMPTION_KEYS = TARGET_CONSUMER_CONSUMPTION_OPTIONS.map((option) => option.value);

export function normalizeTargetConsumer(value: unknown): TargetConsumerProfile {
  const source = isRecord(value) && isRecord(value.targetConsumer)
    ? value.targetConsumer
    : isRecord(value)
      ? value
      : {};

  return {
    ageRange: normalizeAgeRange(source.ageRange),
    genders: normalizeStringArray(source.genders, ALLOWED_GENDERS, DEFAULT_TARGET_CONSUMER.genders),
    lifestyles: normalizeStringArray(source.lifestyles, ALLOWED_LIFESTYLES, []),
    dietaryPrefs: normalizeStringArray(source.dietaryPrefs, ALLOWED_DIETARY_PREFS, []),
    consumptionHabits: normalizeConsumptionRequirements(source.consumptionHabits),
  };
}

export function buildTargetConsumerWhere(value: unknown): Prisma.PanelistWhereInput {
  const target = normalizeTargetConsumer(value);
  const where: Prisma.PanelistWhereInput = {
    isActive: true,
  };

  if (target.lifestyles.length > 0) {
    where.lifestyle = { hasEvery: target.lifestyles };
  }
  if (target.dietaryPrefs.length > 0) {
    where.dietaryPrefs = { hasEvery: target.dietaryPrefs };
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
  if (!target.lifestyles.every((lifestyle) => panelist.lifestyle.includes(lifestyle))) {
    return false;
  }
  if (!target.dietaryPrefs.every((preference) => (panelist.dietaryPrefs ?? []).includes(preference))) {
    return false;
  }

  const habits = parseConsumptionHabits(panelist.consumptionHabits);
  return CONSUMPTION_KEYS.every((key) => !target.consumptionHabits[key] || habits[key] === true);
}

export function getTargetConsumerSummary(value: unknown) {
  const target = normalizeTargetConsumer(value);
  const parts = [];

  if (target.lifestyles.length > 0) {
    parts.push(`Lifestyle: ${target.lifestyles.map(humanizeLifestyle).join(", ")}`);
  }
  if (target.dietaryPrefs.length > 0) {
    parts.push(`Dietary: ${target.dietaryPrefs.map(humanizeEnum).join(", ")}`);
  }

  const requiredHabits = CONSUMPTION_KEYS.filter((key) => target.consumptionHabits[key]);
  if (requiredHabits.length > 0) {
    parts.push(`Consumption: ${requiredHabits.map(humanizeCamelCase).join(", ")}`);
  }

  return parts.length > 0 ? parts.join(" | ") : "Any consumer profile";
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

function normalizeConsumptionRequirements(value: unknown): TargetConsumerProfile["consumptionHabits"] {
  if (!isRecord(value)) {
    return {};
  }

  return CONSUMPTION_KEYS.reduce<TargetConsumerProfile["consumptionHabits"]>((accumulator, key) => {
    if (value[key] === true) {
      accumulator[key] = true;
    }
    return accumulator;
  }, {});
}

function parseConsumptionHabits(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  return {
    coffeeDrinker: value.coffeeDrinker === true,
    snackConsumer:
      typeof value.snackConsumer === "boolean"
        ? value.snackConsumer
        : value.snacks === "daily" || value.snacks === "weekly",
    energyDrinkConsumer: value.energyDrinkConsumer === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function humanizeEnum(value: string) {
  return value.replace(/_/g, " ").toLowerCase();
}

function humanizeLifestyle(value: string) {
  if (value === "office_worker") return "office worker";
  return value;
}

function humanizeCamelCase(value: string) {
  return value.replace(/([A-Z])/g, " $1").toLowerCase();
}
