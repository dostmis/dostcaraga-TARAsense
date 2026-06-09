import type { FicFacilityType } from "@prisma/client";

/**
 * Single source of truth for the FIC facility application — UI option lists,
 * field limits, and the shared server-side validator. Mirrors the pattern used
 * by `target-consumer.ts` so the dashboard form, the server action, the admin
 * dossier, and the profile workspace all agree on the same shapes.
 */

export const FIC_FACILITY_TYPE_OPTIONS: Array<{ value: FicFacilityType; label: string }> = [
  { value: "FOOD_INNOVATION_CENTER", label: "Food Innovation Center (FIC)" },
  { value: "UNIVERSITY_LAB", label: "University / Academic Laboratory" },
  { value: "GOVERNMENT_RESEARCH", label: "Government Research Facility" },
  { value: "PRIVATE_RESEARCH", label: "Private Research Laboratory" },
  { value: "FOOD_INDUSTRY", label: "Food Industry Facility" },
  { value: "OTHER", label: "Others (Specify)" },
];

/** Exactly five sensory testing capabilities, rendered as a checkbox list. */
export const FIC_SENSORY_CAPABILITY_OPTIONS = [
  { value: "consumer_sensory_testing", label: "Consumer sensory testing" },
  { value: "descriptive_sensory_evaluation", label: "Descriptive sensory evaluation" },
  { value: "product_acceptability_testing", label: "Product acceptability testing" },
  { value: "shelf_life_packaging_evaluation", label: "Shelf-life or packaging evaluation" },
  { value: "trained_panel_evaluation", label: "Trained panel evaluation" },
] as const;

export type FicSensoryCapability = (typeof FIC_SENSORY_CAPABILITY_OPTIONS)[number]["value"];

/**
 * Government ID upload constraints. Declared here (framework-free) so both the
 * client form and the server-side {@link saveFicIdFile} agree on the same limits.
 */
export const FIC_ID_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export const FIC_ID_ACCEPT_ATTRIBUTE = FIC_ID_ALLOWED_MIME_TYPES.join(",");
export const MAX_FIC_ID_BYTES = 5 * 1024 * 1024; // 5MB

const ALLOWED_FACILITY_TYPES = new Set<FicFacilityType>(FIC_FACILITY_TYPE_OPTIONS.map((option) => option.value));
const ALLOWED_SENSORY_CAPABILITIES = new Set<string>(FIC_SENSORY_CAPABILITY_OPTIONS.map((option) => option.value));

/** Field length guards — keeps stored values bounded and the UI honest. */
export const FIC_FIELD_LIMITS = {
  facilityName: 160,
  institutionName: 160,
  physicalAddress: 280,
  website: 200,
  directorName: 120,
  position: 120,
  officialEmail: 160,
  contactNumber: 40,
  facilityTypeOther: 120,
} as const;

/** Normalized, validated application payload — shared by the profile record and the snapshot. */
export type FicApplicationData = {
  facilityName: string;
  institutionName: string;
  regionId: string;
  provinceId: string;
  cityId: string;
  physicalAddress: string;
  website: string | null;
  directorName: string;
  position: string;
  officialEmail: string;
  contactNumber: string;
  facilityType: FicFacilityType;
  facilityTypeOther: string | null;
  sensoryCapabilities: string[];
};

export type FicApplicationValidation =
  | { ok: true; data: FicApplicationData }
  | { ok: false; error: string };

export function isValidEmail(value: string): boolean {
  // Pragmatic single-address check — no whitespace, one @, a dotted domain.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidPhone(value: string): boolean {
  // Accept digits with common separators ( + - space ( ) ); require 7-15 digits.
  if (!/^[+()\d\s-]+$/.test(value)) {
    return false;
  }
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function isValidWebsiteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isFicFacilityType(value: string): value is FicFacilityType {
  return ALLOWED_FACILITY_TYPES.has(value as FicFacilityType);
}

export function normalizeSensoryCapabilities(values: Iterable<string>): string[] {
  const normalized = Array.from(values)
    .map((value) => value.trim())
    .filter((value) => ALLOWED_SENSORY_CAPABILITIES.has(value));
  return Array.from(new Set(normalized));
}

export function humanizeFicFacilityType(value: string): string {
  return FIC_FACILITY_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function humanizeSensoryCapability(value: string): string {
  return FIC_SENSORY_CAPABILITY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

type RawFicApplicationInput = {
  facilityName: string;
  institutionName: string;
  regionId: string;
  provinceId: string;
  cityId: string;
  physicalAddress: string;
  website: string;
  directorName: string;
  position: string;
  officialEmail: string;
  contactNumber: string;
  facilityType: string;
  facilityTypeOther: string;
  sensoryCapabilities: string[];
};

/**
 * Validates and normalizes the submitted FIC application. PSGC ID consistency
 * (province belongs to region, etc.) is checked separately by the caller via
 * `validateLocationConsistency`; here we only require non-empty location IDs.
 */
export function validateFicApplicationInput(raw: RawFicApplicationInput): FicApplicationValidation {
  const facilityName = raw.facilityName.trim();
  const institutionName = raw.institutionName.trim();
  const regionId = raw.regionId.trim();
  const provinceId = raw.provinceId.trim();
  const cityId = raw.cityId.trim();
  const physicalAddress = raw.physicalAddress.trim();
  const websiteRaw = raw.website.trim();
  const directorName = raw.directorName.trim();
  const position = raw.position.trim();
  const officialEmail = raw.officialEmail.trim().toLowerCase();
  const contactNumber = raw.contactNumber.trim();
  const facilityTypeRaw = raw.facilityType.trim();
  const facilityTypeOther = raw.facilityTypeOther.trim();

  if (facilityName.length < 2) {
    return { ok: false, error: "Facility name is required." };
  }
  if (facilityName.length > FIC_FIELD_LIMITS.facilityName) {
    return { ok: false, error: "Facility name is too long." };
  }
  if (institutionName.length < 2) {
    return { ok: false, error: "Institution / company name is required." };
  }
  if (institutionName.length > FIC_FIELD_LIMITS.institutionName) {
    return { ok: false, error: "Institution / company name is too long." };
  }
  if (!regionId || !provinceId || !cityId) {
    return { ok: false, error: "Region, province, and city/municipality are required." };
  }
  if (physicalAddress.length < 4) {
    return { ok: false, error: "Physical address is required." };
  }
  if (physicalAddress.length > FIC_FIELD_LIMITS.physicalAddress) {
    return { ok: false, error: "Physical address is too long." };
  }
  if (websiteRaw && (websiteRaw.length > FIC_FIELD_LIMITS.website || !isValidWebsiteUrl(websiteRaw))) {
    return { ok: false, error: "Website must be a valid http(s) URL." };
  }
  if (directorName.length < 2) {
    return { ok: false, error: "Facility director / head name is required." };
  }
  if (directorName.length > FIC_FIELD_LIMITS.directorName) {
    return { ok: false, error: "Facility director / head name is too long." };
  }
  if (position.length < 2) {
    return { ok: false, error: "Position / designation is required." };
  }
  if (position.length > FIC_FIELD_LIMITS.position) {
    return { ok: false, error: "Position / designation is too long." };
  }
  if (!officialEmail || officialEmail.length > FIC_FIELD_LIMITS.officialEmail || !isValidEmail(officialEmail)) {
    return { ok: false, error: "A valid official email address is required." };
  }
  if (!contactNumber || contactNumber.length > FIC_FIELD_LIMITS.contactNumber || !isValidPhone(contactNumber)) {
    return { ok: false, error: "A valid contact number is required." };
  }
  if (!isFicFacilityType(facilityTypeRaw)) {
    return { ok: false, error: "Select a valid facility type." };
  }
  const facilityType = facilityTypeRaw;
  if (facilityType === "OTHER") {
    if (facilityTypeOther.length < 2) {
      return { ok: false, error: "Specify the facility type when selecting Others." };
    }
    if (facilityTypeOther.length > FIC_FIELD_LIMITS.facilityTypeOther) {
      return { ok: false, error: "Other facility type is too long." };
    }
  }

  const sensoryCapabilities = normalizeSensoryCapabilities(raw.sensoryCapabilities);
  if (sensoryCapabilities.length === 0) {
    return { ok: false, error: "Select at least one sensory testing capability." };
  }

  return {
    ok: true,
    data: {
      facilityName,
      institutionName,
      regionId,
      provinceId,
      cityId,
      physicalAddress,
      website: websiteRaw || null,
      directorName,
      position,
      officialEmail,
      contactNumber,
      facilityType,
      facilityTypeOther: facilityType === "OTHER" ? facilityTypeOther : null,
      sensoryCapabilities,
    },
  };
}
