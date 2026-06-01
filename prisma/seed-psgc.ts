/**
 * PSGC seeder.
 *
 * Order of preference for source data:
 *   1. prisma/seed-data/psgc.json  – full PH dump (nationwide barangay coverage)
 *   2. Built-in bootstrap (all 17 regions + 82 provinces) + curated Caraga
 *      cities/barangays. Always runs so the cascading dropdowns are usable
 *      even on a fresh install.
 *
 * Expected shape of psgc.json (when supplied):
 *   {
 *     regions:   [{ code, name, shortName? }]
 *     provinces: [{ code, name, regionCode }]
 *     cities:    [{ code, name, provinceCode, isCity }]
 *     barangays: [{ code, name, cityCode }]
 *   }
 *
 * Run with: npx tsx prisma/seed-psgc.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { BOOTSTRAP_REGIONS } from "./seed-data/psgc-bootstrap";
import { CARAGA_CITIES } from "./seed-data/psgc-caraga";

const prisma = new PrismaClient();

type FullDump = {
  regions: Array<{ code: string; name: string; shortName?: string }>;
  provinces: Array<{ code: string; name: string; regionCode: string }>;
  cities: Array<{ code: string; name: string; provinceCode: string; isCity?: boolean }>;
  barangays: Array<{ code: string; name: string; cityCode: string }>;
};

async function main() {
  const dumpPath = join(process.cwd(), "prisma", "seed-data", "psgc.json");
  const dump: FullDump | null = existsSync(dumpPath)
    ? (JSON.parse(readFileSync(dumpPath, "utf8")) as FullDump)
    : null;

  if (dump) {
    console.log(`[psgc] Loading full PSGC dump from ${dumpPath}`);
    await seedFromDump(dump);
  } else {
    console.log("[psgc] No psgc.json found — seeding bootstrap (17 regions + 82 provinces + Caraga cities/barangays).");
    console.log("[psgc] To enable nationwide barangay coverage, drop a PSGC dump at prisma/seed-data/psgc.json (see header for format).");
    await seedBootstrap();
  }

  const counts = await Promise.all([
    prisma.psgcRegion.count(),
    prisma.psgcProvince.count(),
    prisma.psgcCity.count(),
    prisma.psgcBarangay.count(),
  ]);
  console.log(`[psgc] Done. regions=${counts[0]} provinces=${counts[1]} cities=${counts[2]} barangays=${counts[3]}`);
}

async function seedBootstrap() {
  for (const region of BOOTSTRAP_REGIONS) {
    const persistedRegion = await prisma.psgcRegion.upsert({
      where: { code: region.code },
      create: { code: region.code, name: region.name, shortName: region.shortName },
      update: { name: region.name, shortName: region.shortName },
    });

    for (const province of region.provinces) {
      await prisma.psgcProvince.upsert({
        where: { code: province.code },
        create: {
          code: province.code,
          name: province.name,
          regionId: persistedRegion.id,
        },
        update: { name: province.name, regionId: persistedRegion.id },
      });
    }
  }

  // Caraga cities + barangays
  for (const city of CARAGA_CITIES) {
    const province = await prisma.psgcProvince.findUnique({ where: { code: city.provinceCode } });
    if (!province) {
      console.warn(`[psgc] Province ${city.provinceCode} missing for city ${city.name}`);
      continue;
    }
    const persistedCity = await prisma.psgcCity.upsert({
      where: { code: city.code },
      create: {
        code: city.code,
        name: city.name,
        isCity: city.isCity,
        provinceId: province.id,
      },
      update: { name: city.name, isCity: city.isCity, provinceId: province.id },
    });

    for (const barangay of city.barangays) {
      await prisma.psgcBarangay.upsert({
        where: { code: barangay.code },
        create: { code: barangay.code, name: barangay.name, cityId: persistedCity.id },
        update: { name: barangay.name, cityId: persistedCity.id },
      });
    }
  }
}

async function seedFromDump(dump: FullDump) {
  const regionByCode = new Map<string, string>(); // code -> db id
  const provinceByCode = new Map<string, string>();
  const cityByCode = new Map<string, string>();

  for (const r of dump.regions) {
    const created = await prisma.psgcRegion.upsert({
      where: { code: r.code },
      create: { code: r.code, name: r.name, shortName: r.shortName ?? null },
      update: { name: r.name, shortName: r.shortName ?? null },
    });
    regionByCode.set(r.code, created.id);
  }

  for (const p of dump.provinces) {
    const regionId = regionByCode.get(p.regionCode);
    if (!regionId) continue;
    const created = await prisma.psgcProvince.upsert({
      where: { code: p.code },
      create: { code: p.code, name: p.name, regionId },
      update: { name: p.name, regionId },
    });
    provinceByCode.set(p.code, created.id);
  }

  // Cities in chunks for speed
  const cityChunkSize = 200;
  for (let i = 0; i < dump.cities.length; i += cityChunkSize) {
    const chunk = dump.cities.slice(i, i + cityChunkSize);
    await Promise.all(
      chunk.map(async (c) => {
        const provinceId = provinceByCode.get(c.provinceCode);
        if (!provinceId) return;
        const created = await prisma.psgcCity.upsert({
          where: { code: c.code },
          create: {
            code: c.code,
            name: c.name,
            isCity: Boolean(c.isCity),
            provinceId,
          },
          update: { name: c.name, isCity: Boolean(c.isCity), provinceId },
        });
        cityByCode.set(c.code, created.id);
      }),
    );
  }

  // Barangays in chunks
  const brgyChunkSize = 500;
  for (let i = 0; i < dump.barangays.length; i += brgyChunkSize) {
    const chunk = dump.barangays.slice(i, i + brgyChunkSize);
    await prisma.psgcBarangay.createMany({
      data: chunk
        .map((b) => {
          const cityId = cityByCode.get(b.cityCode);
          if (!cityId) return null;
          return { code: b.code, name: b.name, cityId };
        })
        .filter((row): row is { code: string; name: string; cityId: string } => row !== null),
      skipDuplicates: true,
    });
    if (i % (brgyChunkSize * 10) === 0) {
      console.log(`[psgc] Barangays: ${Math.min(i + brgyChunkSize, dump.barangays.length)}/${dump.barangays.length}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
