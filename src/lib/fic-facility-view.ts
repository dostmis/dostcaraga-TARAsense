import type { FicFacilityFormInitial } from "@/components/profile/fic-facility-form";
import { getLocationPath } from "@/lib/locations/psgc-queries";

/**
 * Server-side row shape needed to prefill the FIC facility form. Matches the
 * fields selected from `FicFacilityProfile`.
 */
export type FicFacilityProfileRow = {
  id: string;
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
  facilityType: string;
  facilityTypeOther: string | null;
  sensoryCapabilities: string[];
  govIdPath: string | null;
};

/**
 * Resolves PSGC labels and the gated ID link so a stored facility profile can
 * prefill the {@link FicFacilityForm}. Shared by the consumer dashboard
 * (re-application) and the FIC profile workspace (editing).
 */
export async function buildFicFacilityFormInitial(
  profile: FicFacilityProfileRow
): Promise<FicFacilityFormInitial> {
  const path = await getLocationPath({
    regionId: profile.regionId,
    provinceId: profile.provinceId,
    cityId: profile.cityId,
  });

  return {
    facilityName: profile.facilityName,
    institutionName: profile.institutionName,
    location: {
      regionId: profile.regionId,
      provinceId: profile.provinceId,
      cityId: profile.cityId,
      barangayId: null,
    },
    locationLabels: {
      region: path.region?.shortName
        ? `${path.region.shortName} — ${path.region.name}`
        : path.region?.name ?? null,
      province: path.province?.name ?? null,
      city: path.city ? (path.city.isCity ? `${path.city.name} (City)` : path.city.name) : null,
    },
    physicalAddress: profile.physicalAddress,
    website: profile.website ?? "",
    directorName: profile.directorName,
    position: profile.position,
    officialEmail: profile.officialEmail,
    contactNumber: profile.contactNumber,
    facilityType: profile.facilityType,
    facilityTypeOther: profile.facilityTypeOther ?? "",
    sensoryCapabilities: profile.sensoryCapabilities,
    govIdHref: profile.govIdPath ? `/api/uploads/fic-id/${profile.id}` : null,
  };
}
