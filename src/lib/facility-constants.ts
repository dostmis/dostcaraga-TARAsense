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
