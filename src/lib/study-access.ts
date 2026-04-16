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
    if (!isFicTaggedStudyLocation(input.studyLocation)) {
      return false;
    }
    if (!input.ficAssignedFacility) {
      return false;
    }
    return input.studyLocation.trim().toLowerCase() === input.ficAssignedFacility.trim().toLowerCase();
  }
  return false;
}
