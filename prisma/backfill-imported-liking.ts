/**
 * One-off migration: reclassify an imported study's JAR attributes as Attribute Liking.
 *
 * Early dataset imports typed every attribute column as JAR (the importer was JAR-only), so
 * hedonic attribute-liking data rendered under the JAR chart. This script retypes the study's
 * JAR sensory attributes to ATTRIBUTE_LIKING and rewrites stored responses so their per-attribute
 * values become plain numbers (what the analysis engine reads for ATTRIBUTE_LIKING) instead of
 * the JAR { type: "JAR_5PT", rawValue, bucket } objects.
 *
 * Run with:
 *   npx tsx prisma/backfill-imported-liking.ts <studyId> [--dry-run]
 *   npm run db:backfill:imported-liking -- <studyId> [--dry-run]
 *
 * Idempotent — attribute values that are already plain numbers are left untouched. After running,
 * refresh the study analysis (GET the analysis route with ?refresh=1) to regenerate the charts.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

type JarLikeValue = { type?: unknown; rawValue?: unknown; bucket?: unknown };

// Convert a stored JAR value ({ rawValue } object) to the plain number used for ATTRIBUTE_LIKING.
// Returns the input unchanged when it is already numeric or unrecognised.
function toPlainScore(value: unknown): { changed: boolean; value: unknown } {
  if (typeof value === "number") {
    return { changed: false, value };
  }
  if (value && typeof value === "object") {
    const raw = (value as JarLikeValue).rawValue;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return { changed: true, value: raw };
    }
  }
  return { changed: false, value };
}

function rewriteAttributes(
  attributes: Record<string, unknown> | undefined,
  targetNames: Set<string>
): { attributes: Record<string, unknown>; changed: number } {
  if (!attributes || typeof attributes !== "object") {
    return { attributes: attributes ?? {}, changed: 0 };
  }
  const next: Record<string, unknown> = { ...attributes };
  let changed = 0;
  for (const name of targetNames) {
    if (!(name in next)) continue;
    const result = toPlainScore(next[name]);
    if (result.changed) {
      next[name] = result.value;
      changed += 1;
    }
  }
  return { attributes: next, changed };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const studyId = args.find((arg) => !arg.startsWith("--"));

  if (!studyId) {
    console.error("Usage: npx tsx prisma/backfill-imported-liking.ts <studyId> [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: { id: true, title: true },
  });
  if (!study) {
    console.error(`Study not found: ${studyId}`);
    process.exitCode = 1;
    return;
  }

  const jarAttributes = await prisma.sensoryAttribute.findMany({
    where: { studyId, type: "JAR" },
    select: { id: true, name: true },
  });
  if (jarAttributes.length === 0) {
    console.log(`No JAR attributes to convert for study "${study.title}" (${studyId}). Nothing to do.`);
    return;
  }

  const targetNames = new Set(jarAttributes.map((attribute) => attribute.name));
  console.log(
    `Study "${study.title}" (${studyId}) — converting ${jarAttributes.length} JAR attribute(s) to ATTRIBUTE_LIKING:`,
    Array.from(targetNames).join(", ")
  );

  const responses = await prisma.sensoryResponse.findMany({
    where: { studyId },
    select: { id: true, data: true },
  });

  let responsesChanged = 0;
  let valuesChanged = 0;

  // Compute the rewritten payloads up front so we can report/dry-run without touching the DB.
  const pendingResponses: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const response of responses) {
    const data = response.data as {
      attributes?: Record<string, unknown>;
      sampleResponses?: Array<{ attributes?: Record<string, unknown> } & Record<string, unknown>>;
    } | null;
    if (!data || typeof data !== "object") continue;

    let responseChanged = 0;
    const aggregated = rewriteAttributes(data.attributes, targetNames);
    responseChanged += aggregated.changed;

    const sampleResponses = Array.isArray(data.sampleResponses)
      ? data.sampleResponses.map((sample) => {
          const rewritten = rewriteAttributes(sample.attributes, targetNames);
          responseChanged += rewritten.changed;
          return { ...sample, attributes: rewritten.attributes };
        })
      : data.sampleResponses;

    if (responseChanged === 0) continue;

    responsesChanged += 1;
    valuesChanged += responseChanged;
    pendingResponses.push({ id: response.id, data: { ...data, attributes: aggregated.attributes, sampleResponses } });
  }

  if (!dryRun) {
    await prisma.$transaction(
      async (client) => {
        // 1) Retype attributes and drop JAR options.
        await client.sensoryAttribute.updateMany({
          where: { studyId, type: "JAR" },
          data: { type: "ATTRIBUTE_LIKING", jarOptions: Prisma.DbNull },
        });
        // Keep the derived sensory questions consistent with the new hedonic framing.
        await client.sensoryQuestion.updateMany({
          where: { studyId, questionType: "JAR", questionText: { in: Array.from(targetNames) } },
          data: { questionType: "HEDONIC", scaleType: "NINE_PT" },
        });

        // 2) Rewrite stored response values (aggregated + per-sample) to plain numbers.
        for (const { id, data } of pendingResponses) {
          await client.sensoryResponse.update({
            where: { id },
            data: { data: data as Prisma.InputJsonValue },
          });
        }
      },
      { timeout: 120_000 }
    );
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Done. attributes=${jarAttributes.length} responsesScanned=${responses.length} ` +
      `responsesChanged=${responsesChanged} valuesRewritten=${valuesChanged}`
  );
  if (!dryRun) {
    console.log("Refresh the study analysis (GET /api/studies/<studyId>/analysis?refresh=1) to regenerate charts.");
  }
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
