import type { Prisma, StudyTargetScope } from "@prisma/client";
import { prisma } from "@/lib/db";

export type UserLocation = {
  regionId: string | null;
  provinceId: string | null;
  cityId: string | null;
  barangayId: string | null;
};

/**
 * Returns the user's PSGC location IDs. Returns null when the user has no
 * profile yet (treated as "incomplete" by callers — they should hide
 * location-targeted studies for these users).
 */
export async function getUserLocation(userId: string): Promise<UserLocation | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      regionId: true,
      provinceId: true,
      cityId: true,
      barangayId: true,
      completedAt: true,
    },
  });

  if (!profile || !profile.completedAt) {
    return null;
  }

  return {
    regionId: profile.regionId,
    provinceId: profile.provinceId,
    cityId: profile.cityId,
    barangayId: profile.barangayId,
  };
}

export function isLocationComplete(profile: {
  regionId: string | null;
  provinceId: string | null;
  cityId: string | null;
  barangayId: string | null;
}) {
  return Boolean(profile.regionId && profile.provinceId && profile.cityId && profile.barangayId);
}

/**
 * Build a Prisma `where` clause fragment that restricts studies to ones whose
 * locationTarget matches the supplied user location, OR studies that have no
 * locationTarget yet (treated as legacy/all-visible — adjust if you want
 * strict opt-in).
 *
 * SECURITY: This is the single source of truth for visibility filtering.
 * Every list/feed query for non-MSME/Admin users must compose this.
 */
export function buildVisibleStudiesWhere(location: UserLocation | null): Prisma.StudyWhereInput {
  // No completed profile → user only sees studies that have no targeting yet
  // (legacy) OR studies explicitly marked ALL.
  if (!location) {
    return {
      OR: [
        { locationTarget: { is: null } },
        { locationTarget: { scope: "ALL" } },
      ],
    };
  }

  const conditions: Prisma.StudyWhereInput[] = [
    // Untargeted (legacy) studies remain visible
    { locationTarget: { is: null } },
    // Explicit "Everyone"
    { locationTarget: { scope: "ALL" } },
  ];

  if (location.regionId) {
    conditions.push({
      locationTarget: { scope: "REGION", regionId: location.regionId },
    });
  }
  if (location.provinceId) {
    conditions.push({
      locationTarget: { scope: "PROVINCE", provinceId: location.provinceId },
    });
  }
  if (location.cityId) {
    conditions.push({
      locationTarget: { scope: "CITY", cityId: location.cityId },
    });
  }
  if (location.barangayId) {
    conditions.push({
      locationTarget: { scope: "BARANGAY", barangayId: location.barangayId },
    });
  }

  return { OR: conditions };
}

/**
 * Synchronous version used when the study's target is already loaded —
 * useful for in-memory checks (e.g. before allowing participation).
 */
export function isStudyVisibleToUser(
  target: {
    scope: StudyTargetScope;
    regionId: string | null;
    provinceId: string | null;
    cityId: string | null;
    barangayId: string | null;
  } | null,
  location: UserLocation | null,
): boolean {
  if (!target) return true; // legacy/untargeted
  if (target.scope === "ALL") return true;
  if (!location) return false;

  switch (target.scope) {
    case "REGION":
      return Boolean(target.regionId && location.regionId === target.regionId);
    case "PROVINCE":
      return Boolean(target.provinceId && location.provinceId === target.provinceId);
    case "CITY":
      return Boolean(target.cityId && location.cityId === target.cityId);
    case "BARANGAY":
      return Boolean(target.barangayId && location.barangayId === target.barangayId);
    default:
      return false;
  }
}

/**
 * Returns the set of user IDs whose profiles match the given study target —
 * used for fanning out notifications when a study is published.
 *
 * Capped at `limit` to avoid runaway broadcasts; defaults to 5000.
 */
export async function findUsersMatchingTarget(
  target: {
    scope: StudyTargetScope;
    regionId: string | null;
    provinceId: string | null;
    cityId: string | null;
    barangayId: string | null;
  },
  options: { limit?: number; roles?: Array<"CONSUMER" | "MSME" | "FIC" | "ADMIN" | "RESEARCHER" | "FIC_MANAGER"> } = {},
): Promise<string[]> {
  const limit = Math.min(Math.max(options.limit ?? 5000, 1), 20000);

  let where: Prisma.UserProfileWhereInput;
  switch (target.scope) {
    case "ALL":
      where = { completedAt: { not: null } };
      break;
    case "REGION":
      if (!target.regionId) return [];
      where = { regionId: target.regionId, completedAt: { not: null } };
      break;
    case "PROVINCE":
      if (!target.provinceId) return [];
      where = { provinceId: target.provinceId, completedAt: { not: null } };
      break;
    case "CITY":
      if (!target.cityId) return [];
      where = { cityId: target.cityId, completedAt: { not: null } };
      break;
    case "BARANGAY":
      if (!target.barangayId) return [];
      where = { barangayId: target.barangayId, completedAt: { not: null } };
      break;
    default:
      return [];
  }

  if (options.roles && options.roles.length > 0) {
    where = { ...where, user: { role: { in: options.roles } } };
  }

  const rows = await prisma.userProfile.findMany({
    where,
    select: { userId: true },
    take: limit,
  });
  return rows.map((row) => row.userId);
}
