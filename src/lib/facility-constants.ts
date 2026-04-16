export const FACILITIES_BY_REGION = {
  "Agusan del Norte": [
    "FIC CSU Main Campus",
    "FIC CSU Cabadbaran Campus",
    "Food iHub (DOST Caraga)",
  ],
  "Agusan del Sur": [
    "FIC ASSCAT Bunawan",
  ],
  "Surigao del Norte": [
    "FICSNSU del Carmen Campus",
  ],
  "Surigao del Sur": [
    "FIC NEMSU Cantilan Campus",
  ],
} as const;

export const REGIONS = Object.keys(FACILITIES_BY_REGION) as Array<keyof typeof FACILITIES_BY_REGION>;
export const ALL_FACILITIES = REGIONS.flatMap((region) => [...FACILITIES_BY_REGION[region]]);
export const FACILITY_REGION_ROWS = REGIONS.flatMap((region) =>
  FACILITIES_BY_REGION[region].map((facility) => ({ region, facility }))
);

export type Region = keyof typeof FACILITIES_BY_REGION;
export type Facility = typeof FACILITIES_BY_REGION[Region][number];

export function getRegionForFacility(facility: string): Region | null {
  for (const region of REGIONS) {
    const facilities = FACILITIES_BY_REGION[region] as readonly string[];
    if (facilities.includes(facility)) {
      return region;
    }
  }
  return null;
}

export function isValidRegion(region: string): region is Region {
  return REGIONS.includes(region as Region);
}

export function isValidFacility(facility: string): facility is Facility {
  return ALL_FACILITIES.includes(facility as Facility);
}

export function isFicManagedFacility(facilityInput: string) {
  const facility = facilityInput.trim();
  if (!facility) {
    return false;
  }

  // Prefer the canonical managed facility list, but keep a relaxed fallback
  // for legacy free-text locations that still contain "fic".
  return isValidFacility(facility) || /fic/i.test(facility);
}

export function isFacilityInRegion(region: string, facility: string) {
  if (!isValidRegion(region)) {
    return false;
  }
  const facilities = FACILITIES_BY_REGION[region] as readonly string[];
  return facilities.includes(facility);
}

export function normalizeRegionFacility(regionInput: string, facilityInput: string) {
  const region = regionInput.trim();
  const facility = facilityInput.trim();

  if (!isValidRegion(region) || !isValidFacility(facility) || !isFacilityInRegion(region, facility)) {
    return null;
  }

  return { region, facility };
}
