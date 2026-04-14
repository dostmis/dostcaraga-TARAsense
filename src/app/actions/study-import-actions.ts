"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { createStudy } from "@/app/actions/study-actions";
import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { SensoryAnalysisEngine } from "@/lib/services/analysis-engine";
import {
  DEFAULT_IMPORT_LIMITS,
  buildQuestionResponseRows,
  extractImportDatasetHints,
  inspectImportTemplate,
  parseAndValidateSensoryImport,
  parseConfiguredSampleCount,
} from "@/lib/import/sensory-import";

const ALLOWED_IMPORT_EXTENSIONS = new Set([".csv", ".xlsx"]);
const IMPORT_METADATA_SOURCE = "STUDY_FILE_IMPORT_V1";

interface StudyImportActionResult {
  success: boolean;
  valid?: boolean;
  error?: string;
  fileName?: string;
  fileHash?: string;
  rowsRead?: number;
  rowsParsed?: number;
  rowsRejected?: number;
  respondents?: number;
  sampleCount?: number;
  sampleLabels?: string[];
  attributeCount?: number;
  attributeNames?: string[];
  warnings?: Array<{ rowNumber?: number; field?: string; message: string }>;
  errors?: Array<{ rowNumber?: number; field?: string; message: string }>;
  importedAt?: string;
  newStudyId?: string;
  redirectPath?: string;
}

export async function previewStudyImport(
  studyId: string,
  formData: FormData
): Promise<StudyImportActionResult> {
  return runStudyImportValidation(studyId, formData, false);
}

export async function commitStudyImport(
  studyId: string,
  formData: FormData
): Promise<StudyImportActionResult> {
  const preview = await runStudyImportValidation(studyId, formData, true);
  if (!preview.success || !preview.valid || !preview.fileHash) {
    return preview;
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return { success: false, error: "Upload a CSV or XLSX file first." };
  }

  const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
  const study = await loadStudyForImport(studyId);
  if (!study) {
    return { success: false, error: "Study not found." };
  }

  const configuredSampleCount = parseConfiguredSampleCount(study.targetDemographics);
  const parsed = parseAndValidateSensoryImport(
    fileEntry.name,
    fileBuffer,
    {
      studyId: study.id,
      title: study.title,
      sampleSize: study.sampleSize,
      configuredSampleCount,
      attributes: study.sensoryAttributes.map((attribute) => ({
        name: attribute.name,
        type: attribute.type,
        sourceAttributeName: attribute.sourceAttributeName ?? null,
      })),
      questions: study.sensoryQuestions.map((question) => ({
        id: question.id,
        questionText: question.questionText,
        questionType: question.questionType,
      })),
    },
    {
      maxRows: DEFAULT_IMPORT_LIMITS.maxRows,
      maxIssues: DEFAULT_IMPORT_LIMITS.maxIssueCount,
    }
  );

  if (!parsed.prepared || parsed.errors.length > 0) {
    return {
      success: true,
      valid: false,
      fileName: parsed.fileName,
      fileHash: parsed.fileHash,
      rowsRead: parsed.rowsRead,
      rowsParsed: parsed.rowsParsed,
      rowsRejected: parsed.rowsRejected,
      respondents: parsed.respondentCount,
      sampleCount: parsed.sampleCount,
      sampleLabels: parsed.sampleLabels,
      attributeCount: parsed.attributeCount,
      attributeNames: parsed.attributeNames,
      warnings: parsed.warnings,
      errors: parsed.errors,
    };
  }
  const prepared = parsed.prepared;

  const duplicateImport = await prisma.sensoryResponse.findFirst({
    where: {
      studyId,
      data: {
        path: ["importMeta", "sourceFileHash"],
        equals: parsed.fileHash,
      },
    },
    select: { id: true },
  });
  if (duplicateImport) {
    return {
      success: true,
      valid: false,
      fileName: parsed.fileName,
      fileHash: parsed.fileHash,
      rowsRead: parsed.rowsRead,
      rowsParsed: parsed.rowsParsed,
      rowsRejected: parsed.rowsRejected,
      respondents: parsed.respondentCount,
      sampleCount: parsed.sampleCount,
      sampleLabels: parsed.sampleLabels,
      attributeCount: parsed.attributeCount,
      attributeNames: parsed.attributeNames,
      warnings: parsed.warnings,
      errors: [
        ...parsed.errors,
        { message: "This file was already imported for this study (matching checksum)." },
      ],
    };
  }

  const importedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const [participantExtremes] = await Promise.all([
      tx.studyParticipant.aggregate({
        where: { studyId },
        _max: {
          panelistNumber: true,
          selectionOrder: true,
        },
      }),
    ]);

    let nextPanelistNumber = (participantExtremes._max.panelistNumber ?? 0) + 1;
    let nextSelectionOrder = (participantExtremes._max.selectionOrder ?? 0) + 1;
    const questionRows: Array<{ studyId: string; respondentId: string; questionId: string; rawValue: number }> = [];

    for (const respondent of prepared.respondents) {
      const email = buildImportedPanelistEmail(studyId, parsed.fileHash, respondent.respondentId);
      const panelist = await tx.panelist.create({
        data: {
          userId: null,
          name: `Imported Respondent ${respondent.respondentId}`,
          email,
          phone: null,
          age: 30,
          gender: "PREFER_NOT_SAY",
          location: "Imported Dataset",
          organization: "Imported Study Data",
          occupation: "Imported Panelist",
          lifestyle: [],
          dietaryPrefs: [],
          consumptionHabits: {} as Prisma.InputJsonValue,
          isActive: true,
          isGuest: true,
        },
        select: {
          id: true,
        },
      });

      const participant = await tx.studyParticipant.create({
        data: {
          studyId,
          panelistId: panelist.id,
          source: "WALK_IN_GUEST",
          status: "COMPLETED",
          selectionOrder: nextSelectionOrder,
          panelistNumber: nextPanelistNumber,
          consentStatus: "AGREED",
          consentedAt: importedAt,
          completedAt: importedAt,
          confirmedAt: importedAt,
        },
        select: { id: true },
      });

      nextPanelistNumber += 1;
      nextSelectionOrder += 1;

      const payload = JSON.parse(
        JSON.stringify({
          overallLiking: respondent.overallLiking,
          attributes: respondent.attributes,
          sampleResponses: respondent.sampleResponses.map((sample) => ({
            sampleNumber: sample.sampleNumber,
            overallLiking: sample.overallLiking,
            attributes: sample.attributes,
          })),
          importMeta: {
            source: IMPORT_METADATA_SOURCE,
            sourceFileHash: parsed.fileHash,
            sourceFileName: parsed.fileName,
            importedAt: importedAt.toISOString(),
            respondentId: respondent.respondentId,
            sampleLabelByNumber: prepared.sampleLabelByNumber,
          },
        })
      ) as Prisma.InputJsonValue;

      await tx.sensoryResponse.create({
        data: {
          studyId,
          participantId: participant.id,
          data: payload,
          submittedAt: importedAt,
        },
      });

      const respondentQuestionRows = buildQuestionResponseRows(
        studyId,
        participant.id,
        study.sensoryQuestions.map((question) => ({
          id: question.id,
          questionText: question.questionText,
          questionType: question.questionType,
        })),
        respondent.attributes
      );
      questionRows.push(...respondentQuestionRows);
    }

    if (questionRows.length > 0) {
      await tx.questionResponse.createMany({
        data: questionRows,
      });
    }
  });

  try {
    const engine = new SensoryAnalysisEngine();
    await engine.analyzeStudy(studyId);
  } catch (analysisError) {
    console.error("Analyze study after import failed:", analysisError);
  }

  await prisma.study.update({
    where: { id: studyId },
    data: { status: "COMPLETED" },
  });

  revalidatePath(`/dashboard/${studyId}`);
  revalidatePath(`/studies/${studyId}/form`);
  revalidatePath("/dashboard");

  return {
    success: true,
    valid: true,
    fileName: parsed.fileName,
    fileHash: parsed.fileHash,
    rowsRead: parsed.rowsRead,
    rowsParsed: parsed.rowsParsed,
    rowsRejected: parsed.rowsRejected,
    respondents: parsed.respondentCount,
    sampleCount: parsed.sampleCount,
    sampleLabels: parsed.sampleLabels,
    attributeCount: parsed.attributeCount,
    attributeNames: parsed.attributeNames,
    warnings: parsed.warnings,
    errors: parsed.errors,
    importedAt: importedAt.toISOString(),
  };
}

export async function createImportReadyCloneFromFile(
  sourceStudyId: string,
  formData: FormData
): Promise<StudyImportActionResult> {
  const session = await getCurrentSession();
  if (!session) {
    return { success: false, error: "Login required." };
  }
  if (session.role !== "MSME" && session.role !== "ADMIN") {
    return { success: false, error: "Only MSME/Admin users can create import-ready studies." };
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return { success: false, error: "Upload a CSV or XLSX file first." };
  }
  if (fileEntry.size <= 0) {
    return { success: false, error: "Uploaded file is empty." };
  }
  if (fileEntry.size > DEFAULT_IMPORT_LIMITS.maxFileSizeBytes) {
    return {
      success: false,
      error: `File exceeds ${Math.round(DEFAULT_IMPORT_LIMITS.maxFileSizeBytes / (1024 * 1024))}MB limit.`,
    };
  }
  if (!hasAllowedFileExtension(fileEntry.name)) {
    return { success: false, error: "Unsupported file type. Upload a .csv or .xlsx file." };
  }

  const sourceStudy = await prisma.study.findUnique({
    where: { id: sourceStudyId },
    select: {
      id: true,
      creatorId: true,
      title: true,
      productName: true,
      category: true,
      stage: true,
      location: true,
      targetDemographics: true,
      screeningCriteria: true,
      sampleSize: true,
      description: true,
      responses: {
        select: { id: true },
        take: 1,
      },
      sensoryAttributes: {
        select: {
          name: true,
          type: true,
        },
      },
    },
  });
  if (!sourceStudy) {
    return { success: false, error: "Study not found." };
  }
  if (session.role === "MSME" && sourceStudy.creatorId !== session.userId) {
    return { success: false, error: "You are not allowed to clone this study." };
  }
  if (sourceStudy.responses.length > 0) {
    return {
      success: false,
      error: "Cannot clone from a study with existing responses. Use a clean source study.",
    };
  }

  const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
  const profile = inspectImportTemplate(fileEntry.name, fileBuffer, {
    maxRows: DEFAULT_IMPORT_LIMITS.maxRows,
    maxIssues: DEFAULT_IMPORT_LIMITS.maxIssueCount,
  });

  if (profile.errors.length > 0) {
    return {
      success: true,
      valid: false,
      fileName: profile.fileName,
      fileHash: profile.fileHash,
      rowsRead: profile.rowsRead,
      rowsParsed: profile.rowsParsed,
      rowsRejected: profile.rowsRejected,
      respondents: profile.respondentCount,
      sampleCount: profile.sampleCount,
      sampleLabels: profile.sampleLabels,
      attributeCount: profile.attributeCount,
      attributeNames: profile.attributeNames,
      warnings: profile.warnings,
      errors: profile.errors,
    };
  }
  if (profile.attributeCount === 0) {
    return {
      success: false,
      error: "The uploaded file has no attribute rows.",
    };
  }
  if (profile.respondentCount < 10 || profile.respondentCount > 200) {
    return {
      success: false,
      error: `Imported respondent count (${profile.respondentCount}) is outside the supported study range (10-200).`,
    };
  }

  const sourceTarget = ensureTargetDemographics(sourceStudy.targetDemographics, profile.sampleCount);
  const screeningQuestions = ensureScreeningQuestions(sourceStudy.screeningCriteria);
  const overallQuestionName =
    sourceStudy.sensoryAttributes.find((attribute) => attribute.type === "OVERALL_LIKING")?.name ??
    "Overall Acceptability";
  const openEndedQuestionName =
    sourceStudy.sensoryAttributes.find((attribute) => attribute.type === "OPEN_ENDED")?.name ??
    "What should be improved?";

  const cloneTitle = `${sourceStudy.title} - Import Ready`;
  const cloneDescription =
    sourceStudy.description?.trim() ||
    "Import-ready clone generated from existing study configuration for historical sensory data onboarding.";

  const attributesPayload = [
    {
      name: overallQuestionName,
      type: "OVERALL_LIKING" as const,
      questionType: "HEDONIC" as const,
      scaleType: "NINE_PT" as const,
    },
    ...profile.attributeNames.map((attributeName) => ({
      name: attributeName,
      type: "JAR" as const,
      attributeType: "taste",
      sourceAttributeName: attributeName,
      isCustom: true,
      questionType: "JAR" as const,
      scaleType: "JAR_5PT" as const,
      jarOptions: {
        low: "Much too low",
        midLow: "Slightly too low",
        mid: "Just about right",
        midHigh: "Slightly too high",
        high: "Much too high",
        labels: ["Much too low", "Slightly too low", "Just about right", "Slightly too high", "Much too high"],
      },
    })),
    {
      name: openEndedQuestionName,
      type: "OPEN_ENDED" as const,
      questionType: "OPEN_ENDED" as const,
      scaleType: "TEXT" as const,
    },
  ];

  const createResult = await createStudy(
    {
      title: cloneTitle,
      productName: sourceStudy.productName,
      category: sourceStudy.category,
      stage: sourceStudy.stage,
      sampleSize: profile.respondentCount,
      location: sourceStudy.location,
      targetDemographics: sourceTarget,
      stratificationVar: "none",
      attributes: attributesPayload,
      screeningQuestions,
    },
    sourceStudy.creatorId
  );

  if (!createResult.success || !createResult.studyId) {
    return {
      success: false,
      error: createResult.error ?? "Failed to create import-ready clone study.",
    };
  }

  const cloneStudyId = createResult.studyId;
  await prisma.study.update({
    where: { id: cloneStudyId },
    data: { description: cloneDescription },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/studies/${cloneStudyId}/form`);

  return {
    success: true,
    valid: true,
    fileName: profile.fileName,
    fileHash: profile.fileHash,
    rowsRead: profile.rowsRead,
    rowsParsed: profile.rowsParsed,
    rowsRejected: profile.rowsRejected,
    respondents: profile.respondentCount,
    sampleCount: profile.sampleCount,
    sampleLabels: profile.sampleLabels,
    attributeCount: profile.attributeCount,
    attributeNames: profile.attributeNames,
    warnings: profile.warnings,
    errors: [],
    newStudyId: cloneStudyId,
    redirectPath: `/studies/${cloneStudyId}/form`,
  };
}

export async function createStudyAndImportFromFile(formData: FormData): Promise<StudyImportActionResult> {
  const session = await getCurrentSession();
  if (!session) {
    return { success: false, error: "Login required." };
  }
  if (session.role !== "MSME" && session.role !== "ADMIN") {
    return { success: false, error: "Only MSME/Admin users can create study imports." };
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return { success: false, error: "Upload a CSV or XLSX file first." };
  }
  if (fileEntry.size <= 0) {
    return { success: false, error: "Uploaded file is empty." };
  }
  if (fileEntry.size > DEFAULT_IMPORT_LIMITS.maxFileSizeBytes) {
    return {
      success: false,
      error: `File exceeds ${Math.round(DEFAULT_IMPORT_LIMITS.maxFileSizeBytes / (1024 * 1024))}MB limit.`,
    };
  }
  if (!hasAllowedFileExtension(fileEntry.name)) {
    return { success: false, error: "Unsupported file type. Upload a .csv or .xlsx file." };
  }

  const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
  const profile = inspectImportTemplate(fileEntry.name, fileBuffer, {
    maxRows: DEFAULT_IMPORT_LIMITS.maxRows,
    maxIssues: DEFAULT_IMPORT_LIMITS.maxIssueCount,
  });
  const hints = extractImportDatasetHints(fileEntry.name, fileBuffer);

  if (profile.errors.length > 0) {
    return {
      success: true,
      valid: false,
      fileName: profile.fileName,
      fileHash: profile.fileHash,
      rowsRead: profile.rowsRead,
      rowsParsed: profile.rowsParsed,
      rowsRejected: profile.rowsRejected,
      respondents: profile.respondentCount,
      sampleCount: profile.sampleCount,
      sampleLabels: profile.sampleLabels,
      attributeCount: profile.attributeCount,
      attributeNames: profile.attributeNames,
      warnings: profile.warnings,
      errors: profile.errors,
    };
  }
  if (profile.respondentCount < 10 || profile.respondentCount > 200) {
    return {
      success: false,
      error: `Imported respondent count (${profile.respondentCount}) is outside supported range (10-200).`,
    };
  }
  if (profile.sampleCount < 1) {
    return { success: false, error: "Imported file has no valid sample labels." };
  }
  if (profile.attributeCount < 1) {
    return { success: false, error: "Imported file has no valid sensory attributes." };
  }

  const productName = buildImportedProductName(fileEntry.name, hints);
  const category = inferCategoryFromProductName(productName);
  const timestamp = new Date().toISOString().slice(0, 10);
  const titleBase = hints.datasetTitle?.trim() || productName;
  const title = `${titleBase} - Imported ${timestamp}`;

  const createResult = await createStudy(
    {
      title,
      productName,
      category,
      stage: "REFINEMENT",
      sampleSize: profile.respondentCount,
      location: "Imported Dataset",
      targetDemographics: {
        ageRange: [18, 55],
        genders: ["MALE", "FEMALE", "NON_BINARY"],
        lifestyles: [],
        experience: "imported-dataset",
        studyMode: "SENSORY",
        numberOfSamples: profile.sampleCount,
        importedFileName: fileEntry.name,
        importedFileHash: profile.fileHash,
        sampleLabels: profile.sampleLabels,
        sampleLegend: hints.sampleLegend,
      },
      stratificationVar: "none",
      attributes: [
        {
          name: "Overall Acceptability",
          type: "OVERALL_LIKING",
          questionType: "HEDONIC",
          scaleType: "NINE_PT",
        },
        ...profile.attributeNames.map((attributeName) => ({
          name: attributeName,
          type: "JAR" as const,
          attributeType: "taste",
          sourceAttributeName: attributeName,
          isCustom: true,
          questionType: "JAR" as const,
          scaleType: "JAR_5PT" as const,
          jarOptions: {
            low: "Much too low",
            midLow: "Slightly too low",
            mid: "Just about right",
            midHigh: "Slightly too high",
            high: "Much too high",
            labels: ["Much too low", "Slightly too low", "Just about right", "Slightly too high", "Much too high"],
          },
        })),
        {
          name: "What should be improved?",
          type: "OPEN_ENDED",
          questionType: "OPEN_ENDED",
          scaleType: "TEXT",
        },
      ],
      screeningQuestions: [],
    },
    session.userId
  );

  if (!createResult.success || !createResult.studyId) {
    return {
      success: false,
      error: createResult.error ?? "Failed to create imported study.",
    };
  }

  const createdStudyId = createResult.studyId;
  const commitFormData = new FormData();
  const importFile = new File([fileBuffer], fileEntry.name, {
    type: fileEntry.type || "application/octet-stream",
  });
  commitFormData.set("file", importFile);

  const importResult = await commitStudyImport(createdStudyId, commitFormData);
  if (!importResult.success || !importResult.valid) {
    try {
      await prisma.study.delete({ where: { id: createdStudyId } });
    } catch (cleanupError) {
      console.error("Cleanup created study after failed import failed:", cleanupError);
    }
    return {
      success: false,
      error:
        importResult.error ??
        importResult.errors?.[0]?.message ??
        "Study was created but import failed. Please retry.",
    };
  }

  return {
    ...importResult,
    success: true,
    valid: true,
    newStudyId: createdStudyId,
    redirectPath: `/dashboard/${createdStudyId}`,
  };
}

async function runStudyImportValidation(
  studyId: string,
  formData: FormData,
  includePreparedPayload: boolean
): Promise<StudyImportActionResult> {
  const session = await getCurrentSession();
  if (!session) {
    return { success: false, error: "Login required." };
  }
  if (session.role !== "MSME" && session.role !== "ADMIN") {
    return { success: false, error: "Only MSME/Admin users can import study data." };
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return { success: false, error: "Upload a CSV or XLSX file first." };
  }
  if (fileEntry.size <= 0) {
    return { success: false, error: "Uploaded file is empty." };
  }
  if (fileEntry.size > DEFAULT_IMPORT_LIMITS.maxFileSizeBytes) {
    return {
      success: false,
      error: `File exceeds ${Math.round(DEFAULT_IMPORT_LIMITS.maxFileSizeBytes / (1024 * 1024))}MB limit.`,
    };
  }
  if (!hasAllowedFileExtension(fileEntry.name)) {
    return { success: false, error: "Unsupported file type. Upload a .csv or .xlsx file." };
  }

  const study = await loadStudyForImport(studyId);
  if (!study) {
    return { success: false, error: "Study not found." };
  }

  if (session.role === "MSME" && study.creatorId !== session.userId) {
    return { success: false, error: "You are not allowed to import data for this study." };
  }

  const existingResponses = await prisma.sensoryResponse.count({
    where: { studyId },
  });
  if (existingResponses > 0) {
    return {
      success: true,
      valid: false,
      errors: [
        {
          message:
            "Import is allowed only when the study has no existing responses to avoid mixed live/imported datasets.",
        },
      ],
      warnings: [],
    };
  }

  const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
  const configuredSampleCount = parseConfiguredSampleCount(study.targetDemographics);
  const parsed = parseAndValidateSensoryImport(
    fileEntry.name,
    fileBuffer,
    {
      studyId: study.id,
      title: study.title,
      sampleSize: study.sampleSize,
      configuredSampleCount,
      attributes: study.sensoryAttributes.map((attribute) => ({
        name: attribute.name,
        type: attribute.type,
        sourceAttributeName: attribute.sourceAttributeName ?? null,
      })),
      questions: study.sensoryQuestions.map((question) => ({
        id: question.id,
        questionText: question.questionText,
        questionType: question.questionType,
      })),
    },
    {
      maxRows: DEFAULT_IMPORT_LIMITS.maxRows,
      maxIssues: DEFAULT_IMPORT_LIMITS.maxIssueCount,
    }
  );

  const duplicateImport = await prisma.sensoryResponse.findFirst({
    where: {
      studyId,
      data: {
        path: ["importMeta", "sourceFileHash"],
        equals: parsed.fileHash,
      },
    },
    select: { id: true },
  });
  if (duplicateImport) {
    parsed.errors.push({
      message: "This file was already imported for this study (matching checksum).",
    });
  }

  const errors = parsed.errors;
  if (!includePreparedPayload) {
    delete parsed.prepared;
  }

  return {
    success: true,
    valid: errors.length === 0,
    fileName: parsed.fileName,
    fileHash: parsed.fileHash,
    rowsRead: parsed.rowsRead,
    rowsParsed: parsed.rowsParsed,
    rowsRejected: parsed.rowsRejected,
    respondents: parsed.respondentCount,
    sampleCount: parsed.sampleCount,
    sampleLabels: parsed.sampleLabels,
    attributeCount: parsed.attributeCount,
    attributeNames: parsed.attributeNames,
    warnings: parsed.warnings,
    errors,
  };
}

function hasAllowedFileExtension(fileName: string) {
  const normalized = fileName.toLowerCase();
  for (const extension of ALLOWED_IMPORT_EXTENSIONS) {
    if (normalized.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

function buildImportedPanelistEmail(studyId: string, hash: string, respondentId: string) {
  const safeRespondent = respondentId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const respondentToken = Buffer.from(respondentId).toString("hex").slice(0, 12) || "72";
  const suffix = hash.slice(0, 12);
  return `import-${studyId.slice(0, 8)}-${safeRespondent || "r"}-${respondentToken}-${suffix}@tarasense.local`;
}

function ensureTargetDemographics(raw: unknown, sampleCount: number) {
  const base = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  const ageRangeRaw = base.ageRange;
  const ageRange =
    Array.isArray(ageRangeRaw) &&
    ageRangeRaw.length === 2 &&
    typeof ageRangeRaw[0] === "number" &&
    typeof ageRangeRaw[1] === "number"
      ? ([ageRangeRaw[0], ageRangeRaw[1]] as [number, number])
      : ([18, 55] as [number, number]);

  return {
    ...base,
    ageRange,
    numberOfSamples: Math.max(1, sampleCount),
  };
}

function ensureScreeningQuestions(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [] as Array<{
      question: string;
      type: "single_choice" | "multiple_choice" | "text" | "age_range" | "consumption";
      options?: string[];
      required?: boolean | string;
      min?: number;
      max?: number;
    }>;
  }

  const allowedTypes = new Set(["single_choice", "multiple_choice", "text", "age_range", "consumption"]);
  return raw.reduce<
    Array<{
      question: string;
      type: "single_choice" | "multiple_choice" | "text" | "age_range" | "consumption";
      options?: string[];
      required?: boolean | string;
      min?: number;
      max?: number;
    }>
  >((accumulator, item) => {
    if (!item || typeof item !== "object") {
      return accumulator;
    }

    const row = item as {
      question?: unknown;
      type?: unknown;
      options?: unknown;
      required?: unknown;
      min?: unknown;
      max?: unknown;
    };
    if (typeof row.question !== "string" || typeof row.type !== "string") {
      return accumulator;
    }
    if (!allowedTypes.has(row.type)) {
      return accumulator;
    }

    accumulator.push({
      question: row.question,
      type: row.type as "single_choice" | "multiple_choice" | "text" | "age_range" | "consumption",
      options: Array.isArray(row.options) ? row.options.filter((value): value is string => typeof value === "string") : undefined,
      required:
        typeof row.required === "boolean" || typeof row.required === "string"
          ? row.required
          : undefined,
      min: typeof row.min === "number" ? row.min : undefined,
      max: typeof row.max === "number" ? row.max : undefined,
    });
    return accumulator;
  }, []);
}

function inferCategoryFromProductName(productName: string) {
  const value = productName.toLowerCase();
  if (/(ice cream|yogurt|milk|dairy|cheese)/.test(value)) return "DAIRY" as const;
  if (/(juice|drink|beverage|tea|coffee|soda)/.test(value)) return "BEVERAGE" as const;
  if (/(cake|cookie|bread|pastry|biscuit)/.test(value)) return "BAKERY" as const;
  if (/(snack|chips|cracker)/.test(value)) return "SNACK" as const;
  if (/(dessert|gelato|pudding)/.test(value)) return "DESSERT" as const;
  return "FUNCTIONAL_FOOD" as const;
}

function buildImportedProductName(fileName: string, hints: { productName?: string; datasetTitle?: string }) {
  if (hints.productName?.trim()) {
    return hints.productName.trim();
  }

  const seed = (hints.datasetTitle || fileName).replace(/\.[^.]+$/, "");
  const cleaned = seed
    .replace(/[_-]+/g, " ")
    .replace(/\b(dataset|imported|long|full|n\d+)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "Imported Sensory Product";
}

async function loadStudyForImport(studyId: string) {
  return prisma.study.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      title: true,
      creatorId: true,
      sampleSize: true,
      targetDemographics: true,
      sensoryAttributes: {
        select: {
          name: true,
          type: true,
          sourceAttributeName: true,
        },
        orderBy: { order: "asc" },
      },
      sensoryQuestions: {
        select: {
          id: true,
          questionText: true,
          questionType: true,
        },
      },
    },
  });
}
