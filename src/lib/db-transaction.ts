import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const DEFAULT_MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 25;

export async function runSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxRetries?: number; label?: string }
) {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const label = options?.label ?? "transaction";

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < maxRetries) {
        const retryDelayMs = BASE_RETRY_DELAY_MS * attempt + Math.floor(Math.random() * BASE_RETRY_DELAY_MS);
        console.warn(`[db] ${label} serialization conflict on attempt ${attempt}/${maxRetries}; retrying in ${retryDelayMs}ms`);
        await sleep(retryDelayMs);
        continue;
      }

      if (isRetryableTransactionError(error)) {
        console.error(`[db] ${label} failed after ${maxRetries} retries`, error);
      }
      throw error;
    }
  }

  throw new Error(`[db] ${label} failed unexpectedly`);
}

export async function lockStudyRow(tx: Prisma.TransactionClient, studyId: string) {
  await tx.$queryRaw`SELECT id FROM "Study" WHERE id = ${studyId} FOR UPDATE`;
}

function isRetryableTransactionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
