export type AppRole = "MSME" | "FIC" | "CONSUMER" | "ADMIN";

export const ALL_ROLES: AppRole[] = ["MSME", "FIC", "CONSUMER", "ADMIN"];

export const ROLE_DASHBOARD_PATH: Record<AppRole, string> = {
  MSME: "/msme/dashboard",
  FIC: "/fic/dashboard",
  CONSUMER: "/consumer/dashboard",
  ADMIN: "/admin/dashboard",
};

/** User-facing display name for each app role. The MSME role is branded "INNOVATOR". */
export const ROLE_LABEL: Record<AppRole, string> = {
  MSME: "INNOVATOR",
  FIC: "FIC",
  CONSUMER: "CONSUMER",
  ADMIN: "ADMIN",
};

export function parseRole(value: string): AppRole | null {
  if (value === "FIC_MANAGER") return "FIC";
  if (value === "RESEARCHER") return "CONSUMER";
  if (value === "MSME" || value === "FIC" || value === "CONSUMER" || value === "ADMIN") {
    return value;
  }
  return null;
}
