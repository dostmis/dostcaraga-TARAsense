import type { AppRole } from "@/lib/auth/roles";

export function isFicTaggedStudyLocation(location: string | null | undefined) {
  return typeof location === "string" && /\bfic\b/i.test(location);
}

export function canAccessStudyByRole(input: {
  role: AppRole;
  userId: string;
  studyCreatorId: string;
  studyLocation: string;
  ficAssignedFacility?: string | null;
}) {
  if (input.role === "ADMIN") {
    return true;
  }
  if (input.role === "MSME") {
    return input.userId === input.studyCreatorId;
  }
  if (input.role === "FIC") {
    if (!input.ficAssignedFacility) {
      return false;
    }
    // Allow FIC users to access studies at their assigned facility.
    // Facility names do not always include the literal word "FIC".
    return input.studyLocation.trim().toLowerCase() === input.ficAssignedFacility.trim().toLowerCase();
  }
  return false;
}

export function canViewRandomizedBlindCodePlan(input: {
  role: AppRole;
  userId: string;
  studyCreatorId: string;
  targetDemographics: unknown;
}) {
  const meta = parseStudyCoordinationMeta(input.targetDemographics);

  if (meta.coordinationMode === "FIC_ASSISTED") {
    return input.role === "FIC" && meta.ficAssigneeId === input.userId;
  }

  if (meta.coordinationMode === "SELF_MANAGED_PUBLIC") {
    return (input.role === "MSME" || input.role === "ADMIN") && input.userId === input.studyCreatorId;
  }

  return false;
}

function parseStudyCoordinationMeta(value: unknown) {
  if (!value || typeof value !== "object") {
    return { coordinationMode: null, ficAssigneeId: null };
  }

  const record = value as {
    coordinationMode?: unknown;
    ficAssignee?: unknown;
  };
  const coordinationMode =
    record.coordinationMode === "FIC_ASSISTED" || record.coordinationMode === "SELF_MANAGED_PUBLIC"
      ? record.coordinationMode
      : null;
  const ficAssignee =
    record.ficAssignee && typeof record.ficAssignee === "object"
      ? (record.ficAssignee as { id?: unknown })
      : null;

  return {
    coordinationMode,
    ficAssigneeId: typeof ficAssignee?.id === "string" ? ficAssignee.id : null,
  };
}
