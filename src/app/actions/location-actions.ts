"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/session";
import { validateLocationConsistency } from "@/lib/locations/psgc-queries";
import { logUserUsage } from "@/lib/user-usage";

const SaveLocationSchema = z.object({
  regionId: z.string().min(1, "Region is required"),
  provinceId: z.string().min(1, "Province is required"),
  cityId: z.string().min(1, "City / municipality is required"),
  barangayId: z.string().min(1, "Barangay is required"),
  addressDetails: z
    .string()
    .max(280, "Address details must be 280 characters or fewer")
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : null)),
});

export type SaveLocationInput = z.input<typeof SaveLocationSchema>;
export type SaveLocationResult =
  | { success: true; profileId: string }
  | { success: false; error: string };

export async function saveUserLocation(input: SaveLocationInput): Promise<SaveLocationResult> {
  const session = await getCurrentSession();
  if (!session) {
    return { success: false, error: "Not authenticated" };
  }

  const parsed = SaveLocationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid location" };
  }

  const consistency = await validateLocationConsistency(parsed.data);
  if (!consistency.ok) {
    return { success: false, error: consistency.error };
  }

  const profile = await prisma.userProfile.upsert({
    where: { userId: session.userId },
    create: {
      userId: session.userId,
      regionId: parsed.data.regionId,
      provinceId: parsed.data.provinceId,
      cityId: parsed.data.cityId,
      barangayId: parsed.data.barangayId,
      addressDetails: parsed.data.addressDetails,
      completedAt: new Date(),
    },
    update: {
      regionId: parsed.data.regionId,
      provinceId: parsed.data.provinceId,
      cityId: parsed.data.cityId,
      barangayId: parsed.data.barangayId,
      addressDetails: parsed.data.addressDetails,
      completedAt: new Date(),
    },
    select: { id: true },
  });

  await logUserUsage({
    actorUserId: session.userId,
    action: "PROFILE_LOCATION_UPDATED",
    entityType: "UserProfile",
    entityId: profile.id,
    summary: "Updated profile location.",
    metadata: {
      regionId: parsed.data.regionId,
      provinceId: parsed.data.provinceId,
      cityId: parsed.data.cityId,
      barangayId: parsed.data.barangayId,
      hasAddressDetails: Boolean(parsed.data.addressDetails),
    },
  });

  revalidatePath("/profile");
  return { success: true, profileId: profile.id };
}

export async function getUserLocationLabels(userId: string) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      regionId: true,
      provinceId: true,
      cityId: true,
      barangayId: true,
      addressDetails: true,
      completedAt: true,
      region: { select: { id: true, name: true, shortName: true } },
      province: { select: { id: true, name: true } },
      city: { select: { id: true, name: true, isCity: true } },
      barangay: { select: { id: true, name: true } },
    },
  });
  if (!profile) return null;

  return {
    value: {
      regionId: profile.regionId,
      provinceId: profile.provinceId,
      cityId: profile.cityId,
      barangayId: profile.barangayId,
    },
    labels: {
      region: profile.region?.shortName
        ? `${profile.region.shortName} — ${profile.region.name}`
        : profile.region?.name ?? null,
      province: profile.province?.name ?? null,
      city: profile.city ? (profile.city.isCity ? `${profile.city.name} (City)` : profile.city.name) : null,
      barangay: profile.barangay?.name ?? null,
    },
    addressDetails: profile.addressDetails,
    completedAt: profile.completedAt,
  };
}
