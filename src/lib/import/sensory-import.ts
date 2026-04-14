import { createHash } from "crypto";
import * as XLSX from "xlsx";

const REQUIRED_COLUMNS = ["Respondent_ID", "Sample", "Overall_Liking", "Attribute", "JAR_Score"] as const;

export const DEFAULT_IMPORT_LIMITS = {
  maxFileSizeBytes: 5 * 1024 * 1024,
  maxRows: 20000,
  maxIssueCount: 250,
} as const;

type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

type StudyAttributeType = "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED";
type StudyQuestionType = "HEDONIC" | "JAR" | "OPEN_ENDED";

interface ImportStudyAttribute {
  name: string;
  type: StudyAttributeType;
  sourceAttributeName?: string | null;
}

interface ImportStudyQuestion {
  id: string;
  questionText: string;
  questionType: StudyQuestionType;
}

export interface ImportStudyConfig {
  studyId: string;
  title: string;
  sampleSize: number;
  configuredSampleCount: number;
  attributes: ImportStudyAttribute[];
  questions: ImportStudyQuestion[];
}

interface ParsedLongRow {
  rowNumber: number;
  respondentId: string;
  sampleLabel: string;
  overallLiking: number;
  attribute: string;
  attributeKey: string;
  jarScore: 1 | 2 | 3 | 4 | 5;
}

interface ConfiguredJarAttribute {
  name: string;
  importKey: string;
}

export interface ImportIssue {
  rowNumber?: number;
  field?: string;
  message: string;
}

interface SamplePayload {
  sampleNumber: number;
  sampleLabel: string;
  overallLiking: number;
  attributes: Record<string, unknown>;
}

export interface PreparedImportRespondent {
  respondentId: string;
  overallLiking: number;
  attributes: Record<string, unknown>;
  sampleResponses: SamplePayload[];
}

export interface PreparedImportPayload {
  respondents: PreparedImportRespondent[];
  sampleLabelByNumber: Record<number, string>;
  jarAttributeNames: string[];
  openEndedAttributeNames: string[];
  overallAttributeName: string;
}

export interface SensoryImportPreviewResult {
  fileHash: string;
  fileName: string;
  rowsRead: number;
  rowsParsed: number;
  rowsRejected: number;
  respondentCount: number;
  sampleCount: number;
  sampleLabels: string[];
  attributeCount: number;
  attributeNames: string[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  prepared?: PreparedImportPayload;
}

export interface ImportTemplateProfile {
  fileHash: string;
  fileName: string;
  rowsRead: number;
  rowsParsed: number;
  rowsRejected: number;
  respondentCount: number;
  sampleCount: number;
  sampleLabels: string[];
  attributeCount: number;
  attributeNames: string[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

interface ParseOptions {
  maxRows?: number;
  maxIssues?: number;
}

export interface ImportDatasetHints {
  productName?: string;
  datasetTitle?: string;
  sampleLegend: Array<{ sampleCode: string; label: string }>;
}

export function parseConfiguredSampleCount(targetDemographics: unknown) {
  if (!targetDemographics || typeof targetDemographics !== "object") {
    return 1;
  }

  const row = targetDemographics as { numberOfSamples?: unknown };
  if (typeof row.numberOfSamples !== "number" || !Number.isFinite(row.numberOfSamples)) {
    return 1;
  }

  return Math.max(1, Math.floor(row.numberOfSamples));
}

export function extractImportDatasetHints(fileName: string, fileBuffer: Buffer): ImportDatasetHints {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", raw: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return {
      datasetTitle: stripFileExtension(fileName),
      sampleLegend: [],
    };
  }

  const sheet = workbook.Sheets[firstSheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });
  if (grid.length === 0) {
    return {
      datasetTitle: stripFileExtension(fileName),
      sampleLegend: [],
    };
  }

  const header = (grid[0] ?? []).map((value) => sanitizeHeader(value));
  const extraHeader = header.find(
    (value) =>
      Boolean(value) &&
      !REQUIRED_COLUMNS.some((column) => column.toLowerCase() === value.toLowerCase()) &&
      !value.startsWith("__EMPTY")
  );

  const scanRows = grid.slice(1, 150);
  let productName: string | undefined;
  const legend = new Map<string, string>();

  for (const row of scanRows) {
    if (!Array.isArray(row)) {
      continue;
    }
    for (const cell of row) {
      const text = normalizeText(cell);
      if (!text) {
        continue;
      }

      const productMatch = text.match(/^Product\s*:\s*(.+)$/i);
      if (productMatch && !productName) {
        productName = productMatch[1].trim();
      }

      const legendMatch = text.match(/^([A-Za-z0-9]{1,6})\s*=\s*(.+)$/);
      if (legendMatch) {
        legend.set(legendMatch[1].trim(), legendMatch[2].trim());
      }
    }
  }

  return {
    productName,
    datasetTitle: extraHeader || stripFileExtension(fileName),
    sampleLegend: Array.from(legend.entries()).map(([sampleCode, label]) => ({ sampleCode, label })),
  };
}

export function parseAndValidateSensoryImport(
  fileName: string,
  fileBuffer: Buffer,
  study: ImportStudyConfig,
  options: ParseOptions = {}
): SensoryImportPreviewResult {
  const maxIssues = options.maxIssues ?? DEFAULT_IMPORT_LIMITS.maxIssueCount;
  const profile = inspectImportTemplate(fileName, fileBuffer, options);
  const parsedRows = profile.parsedRows;
  const errors = profile.errors;
  const warnings = profile.warnings;

  const baseResult: SensoryImportPreviewResult = {
    fileHash: profile.fileHash,
    fileName: profile.fileName,
    rowsRead: profile.rowsRead,
    rowsParsed: profile.rowsParsed,
    rowsRejected: profile.rowsRejected,
    respondentCount: profile.respondentCount,
    sampleCount: profile.sampleCount,
    sampleLabels: profile.sampleLabels,
    attributeCount: profile.attributeCount,
    attributeNames: profile.attributeNames,
    errors,
    warnings,
  };

  if (parsedRows.length === 0) {
    addIssue(errors, { message: "No valid rows were found in the uploaded file." }, maxIssues);
    return baseResult;
  }

  const studyValidation = validateStudyForPhaseOne(study, maxIssues);
  studyValidation.errors.forEach((issue) => addIssue(errors, issue, maxIssues));
  studyValidation.warnings.forEach((issue) => addIssue(warnings, issue, maxIssues));
  if (!studyValidation.valid || !studyValidation.overallAttributeName) {
    return baseResult;
  }

  if (profile.sampleLabels.length !== study.configuredSampleCount) {
    addIssue(
      errors,
      {
        message: `Sample count mismatch. Study expects ${study.configuredSampleCount} sample(s), import has ${profile.sampleLabels.length}.`,
      },
      maxIssues
    );
  }

  if (profile.respondentCount !== study.sampleSize) {
    addIssue(
      warnings,
      {
        message: `Imported respondents (${profile.respondentCount}) differ from target responses (${study.sampleSize}).`,
      },
      maxIssues
    );
  }

  const attributeValidation = validateAttributeSet(
    profile.attributeNames,
    studyValidation.jarAttributes,
    maxIssues
  );
  attributeValidation.errors.forEach((issue) => addIssue(errors, issue, maxIssues));
  if (errors.length > 0) {
    return baseResult;
  }

  const matrixValidation = validateLongMatrix(
    parsedRows,
    profile.sampleLabels,
    studyValidation.jarAttributes,
    maxIssues
  );
  matrixValidation.errors.forEach((issue) => addIssue(errors, issue, maxIssues));
  if (errors.length > 0) {
    return baseResult;
  }

  const prepared = buildPreparedPayload(
    parsedRows,
    profile.sampleLabels,
    studyValidation.jarAttributes,
    studyValidation.openEndedAttributeNames,
    studyValidation.overallAttributeName
  );

  return {
    ...baseResult,
    prepared,
  };
}

export function inspectImportTemplate(
  fileName: string,
  fileBuffer: Buffer,
  options: ParseOptions = {}
): ImportTemplateProfile & { parsedRows: ParsedLongRow[] } {
  const maxRows = options.maxRows ?? DEFAULT_IMPORT_LIMITS.maxRows;
  const maxIssues = options.maxIssues ?? DEFAULT_IMPORT_LIMITS.maxIssueCount;
  const fileHash = sha256(fileBuffer);
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];

  const { rowsRead, parsedRows } = parseTemplateRows(fileBuffer, maxRows, maxIssues, errors, warnings);
  const rowsRejected = Math.max(rowsRead - parsedRows.length, 0);

  const uniqueRespondents = new Set<string>();
  const uniqueSamples = new Set<string>();
  const uniqueAttributes = new Set<string>();
  parsedRows.forEach((row) => {
    uniqueRespondents.add(row.respondentId);
    uniqueSamples.add(row.sampleLabel);
    uniqueAttributes.add(row.attribute);
  });

  const sampleLabels = sortLabels(Array.from(uniqueSamples));
  const attributeNames = Array.from(uniqueAttributes).sort((left, right) => left.localeCompare(right));

  return {
    fileHash,
    fileName,
    rowsRead,
    rowsParsed: parsedRows.length,
    rowsRejected,
    respondentCount: uniqueRespondents.size,
    sampleCount: sampleLabels.length,
    sampleLabels,
    attributeCount: attributeNames.length,
    attributeNames,
    errors,
    warnings,
    parsedRows,
  };
}

export function buildQuestionResponseRows(
  studyId: string,
  respondentId: string,
  questions: ImportStudyQuestion[],
  attributes: Record<string, unknown>
) {
  const rows: Array<{ studyId: string; respondentId: string; questionId: string; rawValue: number }> = [];

  for (const question of questions) {
    if (question.questionType === "OPEN_ENDED") {
      continue;
    }

    const value = attributes[question.questionText];
    if (question.questionType === "HEDONIC" && typeof value === "number" && Number.isFinite(value)) {
      rows.push({
        studyId,
        respondentId,
        questionId: question.id,
        rawValue: value,
      });
      continue;
    }

    if (question.questionType === "JAR" && value && typeof value === "object") {
      const jarRow = value as { rawValue?: unknown };
      if (typeof jarRow.rawValue === "number" && Number.isFinite(jarRow.rawValue)) {
        rows.push({
          studyId,
          respondentId,
          questionId: question.id,
          rawValue: jarRow.rawValue,
        });
      }
    }
  }

  return rows;
}

function parseTemplateRows(
  fileBuffer: Buffer,
  maxRows: number,
  maxIssues: number,
  errors: ImportIssue[],
  warnings: ImportIssue[]
) {
  const parsedRows: ParsedLongRow[] = [];
  const workbook = XLSX.read(fileBuffer, { type: "buffer", raw: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    addIssue(errors, { message: "No worksheet was found in the uploaded file." }, maxIssues);
    return { rowsRead: 0, parsedRows };
  }

  const sheet = workbook.Sheets[firstSheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });

  if (grid.length < 2) {
    addIssue(errors, { message: "The file has no data rows." }, maxIssues);
    return { rowsRead: 0, parsedRows };
  }

  const headerCells = (grid[0] ?? []).map((value) => sanitizeHeader(value));
  const requiredColumnIndex = resolveRequiredColumnIndex(headerCells);
  const missingColumns = REQUIRED_COLUMNS.filter((column) => requiredColumnIndex[column] === -1);
  if (missingColumns.length > 0) {
    addIssue(
      errors,
      { message: `Missing required column(s): ${missingColumns.join(", ")}.` },
      maxIssues
    );
    return { rowsRead: Math.max(grid.length - 1, 0), parsedRows };
  }

  const unexpectedHeaders = headerCells.filter(
    (header) => Boolean(header) && !REQUIRED_COLUMNS.some((required) => required.toLowerCase() === header.toLowerCase())
  );
  if (unexpectedHeaders.length > 0) {
    addIssue(
      warnings,
      {
        message: `Ignoring extra column(s): ${unexpectedHeaders.join(", ")}.`,
      },
      maxIssues
    );
  }

  const dataRows = grid.slice(1);
  if (dataRows.length > maxRows) {
    addIssue(
      errors,
      {
        message: `File has ${dataRows.length} rows, which exceeds the ${maxRows} row limit.`,
      },
      maxIssues
    );
    return { rowsRead: dataRows.length, parsedRows };
  }

  dataRows.forEach((cells, index) => {
    if (!Array.isArray(cells)) {
      return;
    }

    const rowNumber = index + 2;
    const isEmptyRow = cells.every((value) => normalizeText(value).length === 0);
    if (isEmptyRow) {
      return;
    }

    const respondentId = normalizeText(cells[requiredColumnIndex.Respondent_ID]);
    const sampleLabel = normalizeText(cells[requiredColumnIndex.Sample]);
    const attribute = normalizeText(cells[requiredColumnIndex.Attribute]);
    const overallLiking = normalizeNumeric(cells[requiredColumnIndex.Overall_Liking]);
    const jarScore = normalizeNumeric(cells[requiredColumnIndex.JAR_Score]);

    if (!respondentId) {
      addIssue(errors, { rowNumber, field: "Respondent_ID", message: "Respondent_ID is required." }, maxIssues);
      return;
    }
    if (!sampleLabel) {
      addIssue(errors, { rowNumber, field: "Sample", message: "Sample is required." }, maxIssues);
      return;
    }
    if (!attribute) {
      addIssue(errors, { rowNumber, field: "Attribute", message: "Attribute is required." }, maxIssues);
      return;
    }
    if (!Number.isFinite(overallLiking) || overallLiking < 1 || overallLiking > 9) {
      addIssue(
        errors,
        {
          rowNumber,
          field: "Overall_Liking",
          message: "Overall_Liking must be a number from 1 to 9.",
        },
        maxIssues
      );
      return;
    }
    if (!Number.isInteger(jarScore) || jarScore < 1 || jarScore > 5) {
      addIssue(
        errors,
        {
          rowNumber,
          field: "JAR_Score",
          message: "JAR_Score must be an integer from 1 to 5.",
        },
        maxIssues
      );
      return;
    }

    parsedRows.push({
      rowNumber,
      respondentId,
      sampleLabel,
      overallLiking: roundToTwo(overallLiking),
      attribute,
      attributeKey: canonicalizeAttributeKey(attribute),
      jarScore: jarScore as 1 | 2 | 3 | 4 | 5,
    });
  });

  return { rowsRead: dataRows.length, parsedRows };
}

function validateStudyForPhaseOne(study: ImportStudyConfig, maxIssues: number) {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const overallAttributes = study.attributes.filter((attribute) => attribute.type === "OVERALL_LIKING");
  const jarAttributes = study.attributes.filter((attribute) => attribute.type === "JAR");
  const openEndedAttributes = study.attributes.filter((attribute) => attribute.type === "OPEN_ENDED");
  const attributeLikingAttributes = study.attributes.filter((attribute) => attribute.type === "ATTRIBUTE_LIKING");

  if (overallAttributes.length !== 1) {
    addIssue(
      errors,
      { message: "Study must contain exactly one OVERALL_LIKING question for import." },
      maxIssues
    );
  }
  if (jarAttributes.length === 0) {
    addIssue(errors, { message: "Study must contain at least one JAR attribute for import." }, maxIssues);
  }
  if (attributeLikingAttributes.length > 0) {
    addIssue(
      errors,
      {
        message:
          "Phase 1 import only supports OVERALL_LIKING + JAR (+ optional OPEN_ENDED). ATTRIBUTE_LIKING questions are not supported yet.",
      },
      maxIssues
    );
  }
  if (openEndedAttributes.length > 0) {
    addIssue(
      warnings,
      {
        message: "OPEN_ENDED questions will be stored as blank values for imported respondents.",
      },
      maxIssues
    );
  }

  const configuredJarAttributes = jarAttributes.map<ConfiguredJarAttribute>((attribute) => ({
    name: attribute.name,
    importKey: canonicalizeAttributeKey(attribute.sourceAttributeName || attribute.name),
  }));
  const seenConfiguredKeys = new Map<string, string>();
  configuredJarAttributes.forEach((attribute) => {
    const existing = seenConfiguredKeys.get(attribute.importKey);
    if (existing && existing !== attribute.name) {
      addIssue(
        errors,
        {
          message: `Configured JAR attributes "${existing}" and "${attribute.name}" map to the same canonical import key.`,
        },
        maxIssues
      );
      return;
    }
    seenConfiguredKeys.set(attribute.importKey, attribute.name);
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    jarAttributes: configuredJarAttributes,
    openEndedAttributeNames: openEndedAttributes.map((attribute) => attribute.name),
    overallAttributeName: overallAttributes[0]?.name ?? null,
  };
}

function validateAttributeSet(
  importedAttributes: string[],
  configuredJarAttributes: ConfiguredJarAttribute[],
  maxIssues: number
) {
  const errors: ImportIssue[] = [];
  const importedByKey = new Map<string, string[]>();
  importedAttributes.forEach((attribute) => {
    const key = canonicalizeAttributeKey(attribute);
    const existing = importedByKey.get(key) ?? [];
    existing.push(attribute);
    importedByKey.set(key, existing);
  });

  const configuredByKey = new Map(configuredJarAttributes.map((attribute) => [attribute.importKey, attribute.name]));

  const missingInImport = configuredJarAttributes
    .filter((attribute) => !importedByKey.has(attribute.importKey))
    .map((attribute) => attribute.name);
  const unknownInImport = Array.from(importedByKey.entries())
    .filter(([key]) => !configuredByKey.has(key))
    .flatMap(([, rawNames]) => rawNames);

  if (missingInImport.length > 0) {
    addIssue(
      errors,
      {
        message: `Missing configured JAR attribute(s): ${missingInImport.join(", ")}.`,
      },
      maxIssues
    );
  }
  if (unknownInImport.length > 0) {
    addIssue(
      errors,
      {
        message: `Import contains unknown attribute(s): ${unknownInImport.join(", ")}.`,
      },
      maxIssues
    );
  }

  return { errors };
}

function validateLongMatrix(
  rows: ParsedLongRow[],
  sampleLabels: string[],
  jarAttributes: ConfiguredJarAttribute[],
  maxIssues: number
) {
  const errors: ImportIssue[] = [];
  const seenTriplets = new Map<string, number>();
  const groupMap = new Map<string, { rows: ParsedLongRow[]; overallValues: Set<number>; attributes: Set<string> }>();
  const respondentSamples = new Map<string, Set<string>>();

  rows.forEach((row) => {
    const uniqueKey = `${row.respondentId}::${row.sampleLabel}::${row.attributeKey}`;
    const firstRowSeen = seenTriplets.get(uniqueKey);
    if (typeof firstRowSeen === "number") {
      addIssue(
        errors,
        {
          rowNumber: row.rowNumber,
          message: `Duplicate respondent/sample/attribute combination. First seen at row ${firstRowSeen}.`,
        },
        maxIssues
      );
      return;
    }
    seenTriplets.set(uniqueKey, row.rowNumber);

    const groupKey = `${row.respondentId}::${row.sampleLabel}`;
    const group = groupMap.get(groupKey) ?? { rows: [], overallValues: new Set<number>(), attributes: new Set<string>() };
    group.rows.push(row);
    group.overallValues.add(row.overallLiking);
    group.attributes.add(row.attributeKey);
    groupMap.set(groupKey, group);

    const sampleSet = respondentSamples.get(row.respondentId) ?? new Set<string>();
    sampleSet.add(row.sampleLabel);
    respondentSamples.set(row.respondentId, sampleSet);
  });

  const expectedAttributeSet = new Set(jarAttributes.map((attribute) => attribute.importKey));
  groupMap.forEach((group, groupKey) => {
    const [respondentId, sampleLabel] = groupKey.split("::");
    if (group.overallValues.size > 1) {
      addIssue(
        errors,
        {
          message: `Inconsistent Overall_Liking for respondent "${respondentId}" sample "${sampleLabel}".`,
        },
        maxIssues
      );
    }
    if (group.attributes.size !== expectedAttributeSet.size) {
      addIssue(
        errors,
        {
          message: `Incomplete attribute rows for respondent "${respondentId}" sample "${sampleLabel}".`,
        },
        maxIssues
      );
      return;
    }
    for (const attributeName of group.attributes) {
      if (!expectedAttributeSet.has(attributeName)) {
        addIssue(
          errors,
          {
            message: `Unknown attribute key "${attributeName}" for respondent "${respondentId}" sample "${sampleLabel}".`,
          },
          maxIssues
        );
      }
    }
  });

  respondentSamples.forEach((samples, respondentId) => {
    if (samples.size !== sampleLabels.length) {
      addIssue(
        errors,
        {
          message: `Respondent "${respondentId}" has ${samples.size} sample(s), expected ${sampleLabels.length}.`,
        },
        maxIssues
      );
    }
  });

  return { errors };
}

function buildPreparedPayload(
  rows: ParsedLongRow[],
  sampleLabels: string[],
  jarAttributes: ConfiguredJarAttribute[],
  openEndedAttributeNames: string[],
  overallAttributeName: string
): PreparedImportPayload {
  const sampleNumberByLabel = new Map<string, number>();
  sampleLabels.forEach((label, index) => {
    sampleNumberByLabel.set(label, index + 1);
  });

  const respondentOrder: string[] = [];
  const respondentMap = new Map<string, Map<string, ParsedLongRow[]>>();
  rows.forEach((row) => {
    if (!respondentMap.has(row.respondentId)) {
      respondentMap.set(row.respondentId, new Map<string, ParsedLongRow[]>());
      respondentOrder.push(row.respondentId);
    }

    const sampleMap = respondentMap.get(row.respondentId) ?? new Map<string, ParsedLongRow[]>();
    if (!sampleMap.has(row.sampleLabel)) {
      sampleMap.set(row.sampleLabel, []);
    }
    sampleMap.get(row.sampleLabel)?.push(row);
    respondentMap.set(row.respondentId, sampleMap);
  });

  const respondents: PreparedImportRespondent[] = respondentOrder.map((respondentId) => {
    const sampleMap = respondentMap.get(respondentId) ?? new Map<string, ParsedLongRow[]>();
    const sampleResponses: SamplePayload[] = sampleLabels.map((label) => {
      const rowsForSample = sampleMap.get(label) ?? [];
      const rowByAttribute = new Map<string, ParsedLongRow>();
      rowsForSample.forEach((row) => rowByAttribute.set(row.attributeKey, row));

      const sampleAttributes: Record<string, unknown> = {
        [overallAttributeName]: rowsForSample[0]?.overallLiking ?? 0,
      };

      jarAttributes.forEach((attribute) => {
        const sourceRow = rowByAttribute.get(attribute.importKey);
        if (!sourceRow) {
          return;
        }
        sampleAttributes[attribute.name] = {
          type: "JAR_5PT",
          rawValue: sourceRow.jarScore,
          bucket: collapseJarBucket(sourceRow.jarScore),
        };
      });

      openEndedAttributeNames.forEach((attributeName) => {
        sampleAttributes[attributeName] = "";
      });

      return {
        sampleNumber: sampleNumberByLabel.get(label) ?? 1,
        sampleLabel: label,
        overallLiking: rowsForSample[0]?.overallLiking ?? 0,
        attributes: sampleAttributes,
      };
    });

    const overallAverage = roundToTwo(
      sampleResponses.reduce((sum, sample) => sum + sample.overallLiking, 0) / Math.max(sampleResponses.length, 1)
    );

    const aggregatedAttributes: Record<string, unknown> = {
      [overallAttributeName]: overallAverage,
    };

    jarAttributes.forEach((attribute) => {
      const bucket: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      sampleResponses.forEach((sample) => {
        const value = sample.attributes[attribute.name];
        if (!value || typeof value !== "object") {
          return;
        }
        const row = value as { rawValue?: unknown };
        if (typeof row.rawValue === "number" && Number.isInteger(row.rawValue) && row.rawValue >= 1 && row.rawValue <= 5) {
          bucket[row.rawValue] += 1;
        }
      });

      const representative = chooseRepresentativeJarValue(bucket);
      aggregatedAttributes[attribute.name] =
        representative === null
          ? {
              type: "JAR_5PT",
              rawValue: 3,
              bucket: "just_right",
            }
          : {
              type: "JAR_5PT",
              rawValue: representative,
              bucket: collapseJarBucket(representative),
            };
    });

    openEndedAttributeNames.forEach((attributeName) => {
      aggregatedAttributes[attributeName] = "";
    });

    return {
      respondentId,
      overallLiking: overallAverage,
      attributes: aggregatedAttributes,
      sampleResponses,
    };
  });

  const sampleLabelByNumber = sampleLabels.reduce<Record<number, string>>((accumulator, label, index) => {
    accumulator[index + 1] = label;
    return accumulator;
  }, {});

  return {
    respondents,
    sampleLabelByNumber,
    jarAttributeNames: jarAttributes.map((attribute) => attribute.name),
    openEndedAttributeNames: [...openEndedAttributeNames],
    overallAttributeName,
  };
}

function resolveRequiredColumnIndex(headers: string[]) {
  const indexMap = {} as Record<RequiredColumn, number>;
  REQUIRED_COLUMNS.forEach((column) => {
    indexMap[column] = headers.findIndex((header) => header.toLowerCase() === column.toLowerCase());
  });
  return indexMap;
}

function sanitizeHeader(value: unknown) {
  if (typeof value !== "string") {
    return normalizeText(value);
  }
  return value.replace(/^\uFEFF/, "").trim();
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

function normalizeNumeric(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function sortLabels(labels: string[]) {
  return [...labels].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
}

function chooseRepresentativeJarValue(bucket: Record<number, number>) {
  const sorted = Object.entries(bucket)
    .map(([raw, count]) => ({ raw: Number(raw), count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return Math.abs(left.raw - 3) - Math.abs(right.raw - 3);
    });

  const top = sorted[0];
  if (!top || top.count <= 0) {
    return null;
  }
  return top.raw as 1 | 2 | 3 | 4 | 5;
}

function collapseJarBucket(rawValue: number) {
  if (rawValue <= 2) return "too_low" as const;
  if (rawValue === 3) return "just_right" as const;
  return "too_high" as const;
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalizeAttributeKey(value: string) {
  return value
    .replace(/\(jar\)/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function addIssue(target: ImportIssue[], issue: ImportIssue, maxIssues: number) {
  if (target.length >= maxIssues) {
    return;
  }
  target.push(issue);
}

function stripFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim();
}
