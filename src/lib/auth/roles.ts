export type AppRole = "MSME" | "FIC" | "CONSUMER" | "ADMIN";

export const ALL_ROLES: AppRole[] = ["MSME", "FIC", "CONSUMER", "ADMIN"];

export const ROLE_DASHBOARD_PATH: Record<AppRole, string> = {
  MSME: "/msme/dashboard",
  FIC: "/fic/dashboard",
  CONSUMER: "/consumer/dashboard",
  ADMIN: "/admin/dashboard",
};

export function parseRole(value: string): AppRole | null {
  if (value === "FIC_MANAGER") return "FIC";
  if (value === "RESEARCHER") return "CONSUMER";
  if (value === "MSME" || value === "FIC" || value === "CONSUMER" || value === "ADMIN") {
    return value;
  }
  return null;
}
