import { Prisma } from "@prisma/client";

type MissingColumnErrorMeta = {
  modelName?: string;
  column?: string;
};

export function isMissingColumnError(error: unknown, modelName?: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== "P2022") {
    return false;
  }

  if (!modelName) {
    return true;
  }

  const meta = (error.meta ?? {}) as MissingColumnErrorMeta;
  return meta.modelName === modelName || (typeof meta.column === "string" && meta.column.startsWith(`${modelName}.`));
}

export function logSchemaDriftWarning(context: string, error: unknown) {
  console.warn(
    `[db-schema] ${context}: database schema is out-of-date. Run 'npm run db:sync' to align DB with prisma/schema.prisma.`,
    error
  );
}
