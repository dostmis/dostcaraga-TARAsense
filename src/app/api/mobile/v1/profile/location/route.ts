import { NextRequest } from "next/server";
import { z } from "zod";
import {
  enforceMobileRateLimit,
  mobileError,
  mobileJson,
  parseJsonBody,
  requireMobileUser,
} from "@/lib/mobile/api";
import { MUTATION_RATE_LIMIT } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { validateLocationConsistency } from "@/lib/locations/psgc-queries";

export const dynamic = "force-dynamic";

const PayloadSchema = z.object({
  regionId: z.string().min(1),
  provinceId: z.string().min(1),
  cityId: z.string().min(1),
  barangayId: z.string().min(1),
  addressDetails: z.string().max(280).optional().nullable(),
});

export async function PUT(request: NextRequest) {
  const auth = await requireMobileUser(request);
  if ("response" in auth) {
    return auth.response;
  }

  const limited = enforceMobileRateLimit(
    request,
    "mobile-profile-location",
    MUTATION_RATE_LIMIT,
    auth.user.id,
  );
  if (limited) {
    return limited;
  }

  const payload = await parseJsonBody(request);
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return mobileError(
      parsed.error.issues[0]?.message ?? "Invalid location",
      400,
      "INVALID_LOCATION",
    );
  }

  const consistency = await validateLocationConsistency(parsed.data);
  if (!consistency.ok) {
    return mobileError(consistency.error, 400, "INVALID_LOCATION");
  }

  const profile = await prisma.userProfile.upsert({
    where: { userId: auth.user.id },
    create: {
      userId: auth.user.id,
      regionId: parsed.data.regionId,
      provinceId: parsed.data.provinceId,
      cityId: parsed.data.cityId,
      barangayId: parsed.data.barangayId,
      addressDetails: parsed.data.addressDetails ?? null,
      completedAt: new Date(),
    },
    update: {
      regionId: parsed.data.regionId,
      provinceId: parsed.data.provinceId,
      cityId: parsed.data.cityId,
      barangayId: parsed.data.barangayId,
      addressDetails: parsed.data.addressDetails ?? null,
      completedAt: new Date(),
    },
    select: { id: true, completedAt: true },
  });

  return mobileJson({
    profileId: profile.id,
    completedAt: profile.completedAt?.toISOString() ?? null,
  });
}
