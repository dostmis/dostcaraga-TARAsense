import { prisma } from "@/lib/db";

export type PsgcOption = {
  id: string;
  code: string;
  name: string;
};

export async function listRegions(query?: string): Promise<PsgcOption[]> {
  const where = query?.trim()
    ? { name: { contains: query.trim(), mode: "insensitive" as const } }
    : undefined;
  const rows = await prisma.psgcRegion.findMany({
    where,
    select: { id: true, code: true, name: true, shortName: true },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.shortName ? `${row.shortName} — ${row.name}` : row.name,
  }));
}

export async function listProvinces(regionId: string, query?: string): Promise<PsgcOption[]> {
  if (!regionId) return [];
  const rows = await prisma.psgcProvince.findMany({
    where: {
      regionId,
      ...(query?.trim()
        ? { name: { contains: query.trim(), mode: "insensitive" as const } }
        : {}),
    },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  return rows;
}

export async function listCities(provinceId: string, query?: string): Promise<PsgcOption[]> {
  if (!provinceId) return [];
  const rows = await prisma.psgcCity.findMany({
    where: {
      provinceId,
      ...(query?.trim()
        ? { name: { contains: query.trim(), mode: "insensitive" as const } }
        : {}),
    },
    select: { id: true, code: true, name: true, isCity: true },
    orderBy: [{ isCity: "desc" }, { name: "asc" }],
    take: 500,
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.isCity ? `${row.name} (City)` : row.name,
  }));
}

export async function listBarangays(cityId: string, query?: string): Promise<PsgcOption[]> {
  if (!cityId) return [];
  const rows = await prisma.psgcBarangay.findMany({
    where: {
      cityId,
      ...(query?.trim()
        ? { name: { contains: query.trim(), mode: "insensitive" as const } }
        : {}),
    },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
    take: 1000,
  });
  return rows;
}

export async function getLocationPath(ids: {
  regionId?: string | null;
  provinceId?: string | null;
  cityId?: string | null;
  barangayId?: string | null;
}) {
  const [region, province, city, barangay] = await Promise.all([
    ids.regionId
      ? prisma.psgcRegion.findUnique({ where: { id: ids.regionId }, select: { id: true, name: true, shortName: true } })
      : null,
    ids.provinceId
      ? prisma.psgcProvince.findUnique({ where: { id: ids.provinceId }, select: { id: true, name: true, regionId: true } })
      : null,
    ids.cityId
      ? prisma.psgcCity.findUnique({ where: { id: ids.cityId }, select: { id: true, name: true, isCity: true, provinceId: true } })
      : null,
    ids.barangayId
      ? prisma.psgcBarangay.findUnique({ where: { id: ids.barangayId }, select: { id: true, name: true, cityId: true } })
      : null,
  ]);
  return { region, province, city, barangay };
}

/**
 * Lightweight existence check used by validators — verifies that the supplied
 * IDs are consistent (e.g. provinceId belongs to regionId, etc.).
 */
export async function validateLocationConsistency(ids: {
  regionId?: string | null;
  provinceId?: string | null;
  cityId?: string | null;
  barangayId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ids.barangayId) {
    if (!ids.cityId) return { ok: false, error: "Barangay supplied without city" };
    const brgy = await prisma.psgcBarangay.findUnique({
      where: { id: ids.barangayId },
      select: { cityId: true },
    });
    if (!brgy) return { ok: false, error: "Barangay not found" };
    if (brgy.cityId !== ids.cityId) return { ok: false, error: "Barangay does not belong to selected city" };
  }
  if (ids.cityId) {
    if (!ids.provinceId) return { ok: false, error: "City supplied without province" };
    const city = await prisma.psgcCity.findUnique({
      where: { id: ids.cityId },
      select: { provinceId: true },
    });
    if (!city) return { ok: false, error: "City not found" };
    if (city.provinceId !== ids.provinceId) return { ok: false, error: "City does not belong to selected province" };
  }
  if (ids.provinceId) {
    if (!ids.regionId) return { ok: false, error: "Province supplied without region" };
    const province = await prisma.psgcProvince.findUnique({
      where: { id: ids.provinceId },
      select: { regionId: true },
    });
    if (!province) return { ok: false, error: "Province not found" };
    if (province.regionId !== ids.regionId) return { ok: false, error: "Province does not belong to selected region" };
  }
  if (ids.regionId) {
    const region = await prisma.psgcRegion.findUnique({ where: { id: ids.regionId }, select: { id: true } });
    if (!region) return { ok: false, error: "Region not found" };
  }
  return { ok: true };
}
