import { Prisma } from "@prisma/client";

const USER_MANAGEMENT_MODELS = new Set(["Notification", "RoleUpgradeRequest"]);

export function isMissingUserManagementTableError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== "P2021") {
    return false;
  }

  const modelName = typeof error.meta?.modelName === "string" ? error.meta.modelName : "";
  if (USER_MANAGEMENT_MODELS.has(modelName)) {
    return true;
  }

  const tableName = typeof error.meta?.table === "string" ? error.meta.table : "";
  return tableName.includes("Notification") || tableName.includes("RoleUpgradeRequest");
}

export function logUserManagementTableWarning(context: string, error: unknown) {
  console.warn(`[db-setup] ${context}: user-management tables are missing. Run 'npm run db:push'.`, error);
}
