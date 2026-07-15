/**
 * "On behalf of MSME" attribution.
 *
 * When a FIC user creates a study for an MSME that does not have an account, the
 * study's `creatorId` is the FIC user. The MSME is recorded as metadata inside the
 * study's `targetDemographics` JSON (no schema migration) under `onBehalfOfMsme`.
 */

export interface OnBehalfOfMsme {
  businessName: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
}

/**
 * Safely extract the `onBehalfOfMsme` block from a study's `targetDemographics` JSON.
 * Returns `null` when absent or malformed (e.g. missing a business name).
 */
export function parseOnBehalfOfMsme(targetDemographics: unknown): OnBehalfOfMsme | null {
  if (!targetDemographics || typeof targetDemographics !== "object") {
    return null;
  }
  const raw = (targetDemographics as { onBehalfOfMsme?: unknown }).onBehalfOfMsme;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const businessName = typeof record.businessName === "string" ? record.businessName.trim() : "";
  if (!businessName) {
    return null;
  }
  const asTrimmed = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

  return {
    businessName,
    contactPerson: asTrimmed(record.contactPerson),
    contactEmail: asTrimmed(record.contactEmail),
    contactPhone: asTrimmed(record.contactPhone),
  };
}
