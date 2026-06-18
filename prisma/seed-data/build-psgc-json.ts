/**
 * Builds prisma/seed-data/psgc.json — the full nationwide PSGC dataset consumed
 * by prisma/seed-psgc.ts (and prisma/rebuild-psgc.ts).
 *
 * Source of truth: the public PSGC API at https://psgc.gitlab.io/api/ which
 * publishes the PSA's Philippine Standard Geographic Code as flat JSON. We use
 * that project's hierarchical `code` field (region 9-digit → province → city →
 * barangay) as our internal code, because it is internally consistent across
 * all four tiers (the `psgc10DigitCode` field is NOT — HUCs get a separate
 * pseudo-province segment there).
 *
 * Transforms applied on top of the raw API data:
 *   1. Negros Island Region (Region XVIII, RA 12000 / 2024): a synthetic region
 *      is added and Negros Occidental, Negros Oriental and Siquijor are moved
 *      into it. The API has not yet published NIR.
 *   2. NCR has no provinces in PSGC; our schema requires city → province. All
 *      NCR cities are attached to a synthetic "Metro Manila" province so they
 *      remain selectable in the cascading picker.
 *   3. The two independent cities with no province (City of Isabela, Cotabato
 *      City) are each attached to a synthetic single-city province under their
 *      administrative region.
 *
 * Run with: npx tsx prisma/seed-data/build-psgc-json.ts
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://psgc.gitlab.io/api";

type ApiRegion = { code: string; name: string; regionName: string };
type ApiProvince = { code: string; name: string; regionCode: string };
type ApiCity = {
  code: string;
  name: string;
  provinceCode: string | false;
  regionCode: string;
  isCity?: boolean;
};
type ApiBarangay = {
  code: string;
  name: string;
  cityCode: string | false;
  municipalityCode: string | false;
  subMunicipalityCode: string | false;
};

type OutRegion = { code: string; name: string; shortName?: string };
type OutProvince = { code: string; name: string; regionCode: string };
type OutCity = { code: string; name: string; provinceCode: string; isCity: boolean };
type OutBarangay = { code: string; name: string; cityCode: string };
type Dump = {
  regions: OutRegion[];
  provinces: OutProvince[];
  cities: OutCity[];
  barangays: OutBarangay[];
};

// --- Synthetic / transform constants -------------------------------------
const NIR = { code: "180000000", name: "Negros Island Region", shortName: "Region XVIII" };
const NCR_REGION_CODE = "130000000";
const NCR_PROVINCE = { code: "130000000", name: "Metro Manila", regionCode: NCR_REGION_CODE };
// Independent cities (no provinceCode in PSGC). code = the city's own PSGC code.
const INDEPENDENT_CITY_PROVINCES: Record<string, { code: string; name: string; regionCode: string }> = {
  "099701000": { code: "099700000", name: "City of Isabela", regionCode: "090000000" },
  "129804000": { code: "129800000", name: "Cotabato City", regionCode: "120000000" },
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/${path}`);
  if (!res.ok) throw new Error(`Fetch ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function main() {
  console.log("[build-psgc] Fetching PSGC API …");
  const [regions, provinces, cities, barangays] = await Promise.all([
    getJson<ApiRegion[]>("regions.json"),
    getJson<ApiProvince[]>("provinces.json"),
    getJson<ApiCity[]>("cities-municipalities.json"),
    getJson<ApiBarangay[]>("barangays.json"),
  ]);
  console.log(
    `[build-psgc] Raw: regions=${regions.length} provinces=${provinces.length} cities=${cities.length} barangays=${barangays.length}`,
  );

  // 1. Regions (+ NIR)
  const outRegions: OutRegion[] = regions.map((r) => ({
    code: r.code,
    name: r.name,
    shortName: r.regionName || undefined,
  }));
  outRegions.push({ code: NIR.code, name: NIR.name, shortName: NIR.shortName });

  // Negros provinces → NIR
  const negrosNames = new Set(["Negros Occidental", "Negros Oriental", "Siquijor"]);
  const outProvinces: OutProvince[] = provinces.map((p) => ({
    code: p.code,
    name: p.name,
    regionCode: negrosNames.has(p.name) ? NIR.code : p.regionCode,
  }));
  const movedNegros = outProvinces.filter((p) => p.regionCode === NIR.code).map((p) => p.name);
  console.log(`[build-psgc] Moved into NIR: ${movedNegros.join(", ")}`);

  // 2/3. Synthetic province parents for NCR + independent cities
  outProvinces.push(NCR_PROVINCE);
  for (const synth of Object.values(INDEPENDENT_CITY_PROVINCES)) outProvinces.push(synth);

  // Cities — resolve province parent
  const provinceCodes = new Set(outProvinces.map((p) => p.code));
  const outCities: OutCity[] = [];
  let ncrCount = 0;
  let independentCount = 0;
  for (const c of cities) {
    let provinceCode: string | undefined;
    if (c.provinceCode) {
      provinceCode = c.provinceCode;
    } else if (c.regionCode === NCR_REGION_CODE) {
      provinceCode = NCR_PROVINCE.code;
      ncrCount += 1;
    } else if (INDEPENDENT_CITY_PROVINCES[c.code]) {
      provinceCode = INDEPENDENT_CITY_PROVINCES[c.code].code;
      independentCount += 1;
    } else {
      console.warn(`[build-psgc] City with no province parent: ${c.name} (${c.code}) region ${c.regionCode}`);
      continue;
    }
    if (!provinceCodes.has(provinceCode)) {
      console.warn(`[build-psgc] City ${c.name} references missing province ${provinceCode}`);
      continue;
    }
    outCities.push({ code: c.code, name: c.name, provinceCode, isCity: Boolean(c.isCity) });
  }
  console.log(`[build-psgc] NCR cities attached to Metro Manila: ${ncrCount}; independent cities: ${independentCount}`);

  // Barangays — link via city/municipality/sub-municipality code
  const cityCodes = new Set(outCities.map((c) => c.code));
  const outBarangays: OutBarangay[] = [];
  let orphanBarangays = 0;
  for (const b of barangays) {
    const cityCode = b.cityCode || b.municipalityCode || b.subMunicipalityCode;
    if (!cityCode || !cityCodes.has(cityCode)) {
      orphanBarangays += 1;
      continue;
    }
    outBarangays.push({ code: b.code, name: b.name, cityCode });
  }
  if (orphanBarangays) console.warn(`[build-psgc] Skipped ${orphanBarangays} barangays with no resolvable city parent`);

  // Validation: referential integrity
  const regionCodes = new Set(outRegions.map((r) => r.code));
  const badProvinces = outProvinces.filter((p) => !regionCodes.has(p.regionCode));
  if (badProvinces.length) throw new Error(`${badProvinces.length} provinces reference unknown regions`);

  const dump: Dump = {
    regions: outRegions,
    provinces: outProvinces,
    cities: outCities,
    barangays: outBarangays,
  };
  const outPath = join(process.cwd(), "prisma", "seed-data", "psgc.json");
  writeFileSync(outPath, JSON.stringify(dump));
  console.log(
    `[build-psgc] Wrote ${outPath}\n` +
      `[build-psgc] Final: regions=${dump.regions.length} provinces=${dump.provinces.length} ` +
      `cities=${dump.cities.length} barangays=${dump.barangays.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
