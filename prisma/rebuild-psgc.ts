/**
 * Destructive, one-shot rebuild of the PSGC tables for an existing database
 * whose rows use a legacy/sample code scheme incompatible with the canonical
 * dump (prisma/seed-data/psgc.json).
 *
 * The legacy seed only covered Caraga (a 10-city / ~269-barangay sample) using
 * a code scheme that does not match the PSGC API. A plain upsert would create
 * duplicates, so this script wipes the four PSGC tables and reloads them from
 * the dump — then re-links the handful of rows (user profiles, study targets)
 * that referenced the old rows, matching by human-readable name.
 *
 * Optional relations (UserProfile, StudyLocationTarget) are SET NULL on delete;
 * FicFacilityProfile (required) is verified empty first to avoid an FK abort.
 *
 * Run with: npx tsx prisma/rebuild-psgc.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Dump = {
  regions: Array<{ code: string; name: string; shortName?: string }>;
  provinces: Array<{ code: string; name: string; regionCode: string }>;
  cities: Array<{ code: string; name: string; provinceCode: string; isCity?: boolean }>;
  barangays: Array<{ code: string; name: string; cityCode: string }>;
};

type Snapshot = {
  table: "user_profiles" | "study_location_targets";
  id: string;
  region: string | null;
  province: string | null;
  city: string | null;
  barangay: string | null;
};

// --- name normalisation, tolerant of the two different naming styles --------
const deburr = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "");

function normRegion(name: string): string {
  let s = deburr(name).toLowerCase();
  // "Region XIII – Caraga" -> take the part after the dash when present
  const dash = s.split(/[–—-]/);
  if (dash.length > 1 && /region/.test(dash[0])) s = dash.slice(1).join(" ");
  return s.replace(/\bregion\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function normName(name: string): string {
  return deburr(name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function normCity(name: string): string {
  let s = deburr(name).toLowerCase();
  s = s.replace(/^city of\s+/, "").replace(/\bcity\b/g, "");
  s = s.replace(/\(capital\)/g, "").replace(/\(.*?\)/g, "");
  return s.replace(/[^a-z0-9]+/g, " ").trim();
}

async function main() {
  const dumpPath = join(process.cwd(), "prisma", "seed-data", "psgc.json");
  if (!existsSync(dumpPath)) {
    throw new Error(`Missing ${dumpPath}. Run: npx tsx prisma/seed-data/build-psgc-json.ts`);
  }
  const dump: Dump = JSON.parse(readFileSync(dumpPath, "utf8"));

  // Guard: a required relation would abort the wipe.
  const ficCount = await prisma.ficFacilityProfile.count();
  if (ficCount > 0) {
    throw new Error(
      `${ficCount} FicFacilityProfile rows reference PSGC (required FK). Aborting to avoid data loss — re-link those first.`,
    );
  }

  // 1. Snapshot existing references (by name) before wiping.
  const snaps: Snapshot[] = [];
  const profiles = await prisma.userProfile.findMany({
    where: { OR: [{ regionId: { not: null } }, { cityId: { not: null } }] },
    select: {
      id: true,
      region: { select: { name: true } },
      province: { select: { name: true } },
      city: { select: { name: true } },
      barangay: { select: { name: true } },
    },
  });
  for (const p of profiles)
    snaps.push({
      table: "user_profiles",
      id: p.id,
      region: p.region?.name ?? null,
      province: p.province?.name ?? null,
      city: p.city?.name ?? null,
      barangay: p.barangay?.name ?? null,
    });
  const targets = await prisma.studyLocationTarget.findMany({
    where: { OR: [{ regionId: { not: null } }, { cityId: { not: null } }] },
    select: {
      id: true,
      region: { select: { name: true } },
      province: { select: { name: true } },
      city: { select: { name: true } },
      barangay: { select: { name: true } },
    },
  });
  for (const t of targets)
    snaps.push({
      table: "study_location_targets",
      id: t.id,
      region: t.region?.name ?? null,
      province: t.province?.name ?? null,
      city: t.city?.name ?? null,
      barangay: t.barangay?.name ?? null,
    });
  console.log(`[rebuild] Snapshotted ${snaps.length} location references.`);

  // 2. Wipe (child → parent; FK SET NULL clears the references).
  await prisma.psgcBarangay.deleteMany({});
  await prisma.psgcCity.deleteMany({});
  await prisma.psgcProvince.deleteMany({});
  await prisma.psgcRegion.deleteMany({});
  console.log("[rebuild] Wiped PSGC tables.");

  // 3. Reload from dump.
  await prisma.psgcRegion.createMany({
    data: dump.regions.map((r) => ({ code: r.code, name: r.name, shortName: r.shortName ?? null })),
  });
  const regionIdByCode = new Map(
    (await prisma.psgcRegion.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id]),
  );
  await prisma.psgcProvince.createMany({
    data: dump.provinces
      .map((p) => {
        const regionId = regionIdByCode.get(p.regionCode);
        return regionId ? { code: p.code, name: p.name, regionId } : null;
      })
      .filter((x): x is { code: string; name: string; regionId: string } => x !== null),
  });
  const provinceIdByCode = new Map(
    (await prisma.psgcProvince.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]),
  );
  await prisma.psgcCity.createMany({
    data: dump.cities
      .map((c) => {
        const provinceId = provinceIdByCode.get(c.provinceCode);
        return provinceId
          ? { code: c.code, name: c.name, isCity: Boolean(c.isCity), provinceId }
          : null;
      })
      .filter((x): x is { code: string; name: string; isCity: boolean; provinceId: string } => x !== null),
  });
  const cityIdByCode = new Map(
    (await prisma.psgcCity.findMany({ select: { id: true, code: true } })).map((c) => [c.code, c.id]),
  );
  const brgyRows = dump.barangays
    .map((b) => {
      const cityId = cityIdByCode.get(b.cityCode);
      return cityId ? { code: b.code, name: b.name, cityId } : null;
    })
    .filter((x): x is { code: string; name: string; cityId: string } => x !== null);
  for (let i = 0; i < brgyRows.length; i += 1000) {
    await prisma.psgcBarangay.createMany({ data: brgyRows.slice(i, i + 1000), skipDuplicates: true });
  }
  const counts = await Promise.all([
    prisma.psgcRegion.count(),
    prisma.psgcProvince.count(),
    prisma.psgcCity.count(),
    prisma.psgcBarangay.count(),
  ]);
  console.log(`[rebuild] Loaded regions=${counts[0]} provinces=${counts[1]} cities=${counts[2]} barangays=${counts[3]}`);

  // 4. Re-link references by name.
  const regions = await prisma.psgcRegion.findMany({ select: { id: true, name: true } });
  const provinces = await prisma.psgcProvince.findMany({ select: { id: true, name: true, regionId: true } });
  const cities = await prisma.psgcCity.findMany({ select: { id: true, name: true, provinceId: true } });

  let relinked = 0;
  const failures: string[] = [];
  for (const s of snaps) {
    const regionId = s.region
      ? regions.find((r) => normRegion(r.name) === normRegion(s.region!))?.id ?? null
      : null;
    const provinceId =
      s.province && regionId
        ? provinces.find((p) => p.regionId === regionId && normName(p.name) === normName(s.province!))?.id ?? null
        : null;
    const cityId =
      s.city && provinceId
        ? cities.find((c) => c.provinceId === provinceId && normCity(c.name) === normCity(s.city!))?.id ?? null
        : null;
    let barangayId: string | null = null;
    if (s.barangay && cityId) {
      const brgys = await prisma.psgcBarangay.findMany({ where: { cityId }, select: { id: true, name: true } });
      barangayId = brgys.find((b) => normName(b.name) === normName(s.barangay!))?.id ?? null;
    }

    const missing: string[] = [];
    if (s.region && !regionId) missing.push(`region "${s.region}"`);
    if (s.province && !provinceId) missing.push(`province "${s.province}"`);
    if (s.city && !cityId) missing.push(`city "${s.city}"`);
    if (s.barangay && !barangayId) missing.push(`barangay "${s.barangay}"`);
    if (missing.length) {
      failures.push(`${s.table}#${s.id}: could not match ${missing.join(", ")}`);
    }

    const data = { regionId, provinceId, cityId, barangayId };
    if (s.table === "user_profiles") await prisma.userProfile.update({ where: { id: s.id }, data });
    else await prisma.studyLocationTarget.update({ where: { id: s.id }, data });
    relinked += 1;
  }
  console.log(`[rebuild] Re-linked ${relinked} references.`);
  if (failures.length) {
    console.warn(`[rebuild] ${failures.length} partial/failed matches:`);
    for (const f of failures) console.warn(`   - ${f}`);
  } else {
    console.log("[rebuild] All references matched cleanly.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
