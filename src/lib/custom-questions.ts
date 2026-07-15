/**
 * Shared model for MSME-authored "Additional Questions" on sensory studies.
 *
 * These are Google-Forms-style questions (Multiple Choice / Checkboxes / Paragraph)
 * that a panelist answers once, at the end of the sensory evaluation. Definitions are
 * stored on `Study.customQuestions`; answers ride inside the existing
 * `SensoryResponse.data` JSON blob under `customAnswers`.
 *
 * This module is intentionally framework-agnostic and zod-free so it can be imported
 * from both server actions and client components without bloating the client bundle.
 */

export const CUSTOM_QUESTION_TYPES = ["MULTIPLE_CHOICE", "CHECKBOXES", "PARAGRAPH"] as const;
export type CustomQuestionType = (typeof CUSTOM_QUESTION_TYPES)[number];

export const MAX_CUSTOM_QUESTIONS = 10;
export const MAX_CUSTOM_QUESTION_OPTIONS = 10;
export const MAX_CUSTOM_QUESTION_TEXT = 300;
export const MAX_CUSTOM_OPTION_TEXT = 160;
export const MAX_CUSTOM_PARAGRAPH_ANSWER = 2000;

export interface CustomQuestion {
  id: string;
  text: string;
  type: CustomQuestionType;
  options: string[];
  required: boolean;
  order: number;
}

/** MC / Paragraph answers are a string; Checkboxes answers are a string[]. */
export type CustomAnswerValue = string | string[];
export type CustomAnswers = Record<string, CustomAnswerValue>;

/** Draft/authoring shape as it arrives from the builder before ids/order are fixed. */
export interface CustomQuestionInput {
  id?: string;
  text: string;
  type: CustomQuestionType;
  options: string[];
  required: boolean;
}

export function isCustomQuestionType(value: unknown): value is CustomQuestionType {
  return value === "MULTIPLE_CHOICE" || value === "CHECKBOXES" || value === "PARAGRAPH";
}

export function customQuestionTypeUsesOptions(type: CustomQuestionType): boolean {
  return type === "MULTIPLE_CHOICE" || type === "CHECKBOXES";
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Validate + normalize authored questions coming from the builder. Trims text,
 * drops empty/duplicate options, enforces the "≥2 options for choice questions"
 * rule, assigns a stable id (reusing the client id when present) and an order.
 */
export function finalizeCustomQuestions(
  input: CustomQuestionInput[],
  makeId: () => string
): { success: true; value: CustomQuestion[] } | { success: false; error: string } {
  if (input.length > MAX_CUSTOM_QUESTIONS) {
    return { success: false, error: `Add at most ${MAX_CUSTOM_QUESTIONS} additional questions.` };
  }

  const value: CustomQuestion[] = [];
  const seenText = new Set<string>();
  const seenIds = new Set<string>();

  for (const [index, question] of input.entries()) {
    const text = question.text.trim();
    if (!text) {
      return { success: false, error: `Additional question ${index + 1} needs question text.` };
    }
    if (text.length > MAX_CUSTOM_QUESTION_TEXT) {
      return { success: false, error: `Additional question ${index + 1} text is too long.` };
    }
    const textKey = text.toLowerCase();
    if (seenText.has(textKey)) {
      return { success: false, error: `Duplicate additional question: "${text}".` };
    }
    seenText.add(textKey);

    if (!isCustomQuestionType(question.type)) {
      return { success: false, error: `Additional question "${text}" has an invalid type.` };
    }

    let options: string[] = [];
    if (customQuestionTypeUsesOptions(question.type)) {
      options = dedupeStrings(question.options.map((option) => option.trim()).filter(Boolean));
      if (options.length < 2) {
        return { success: false, error: `"${text}" needs at least 2 options.` };
      }
      if (options.length > MAX_CUSTOM_QUESTION_OPTIONS) {
        return { success: false, error: `"${text}" allows at most ${MAX_CUSTOM_QUESTION_OPTIONS} options.` };
      }
      if (options.some((option) => option.length > MAX_CUSTOM_OPTION_TEXT)) {
        return { success: false, error: `An option for "${text}" is too long.` };
      }
    }

    let id = (question.id ?? "").trim();
    if (!id || seenIds.has(id)) {
      id = makeId();
    }
    seenIds.add(id);

    value.push({
      id,
      text,
      type: question.type,
      options,
      required: Boolean(question.required),
      order: index,
    });
  }

  return { success: true, value };
}

/** Safely read `Study.customQuestions` JSON (from the DB) into a typed list. */
export function parseCustomQuestions(value: unknown): CustomQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: CustomQuestion[] = [];
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      return;
    }
    const record = raw as Record<string, unknown>;
    if (!isCustomQuestionType(record.type)) {
      return;
    }
    const text = typeof record.text === "string" ? record.text : "";
    if (!text.trim()) {
      return;
    }
    const id = typeof record.id === "string" && record.id.trim() ? record.id : `q_${index}`;
    const options =
      record.type === "PARAGRAPH"
        ? []
        : Array.isArray(record.options)
          ? record.options.filter((option): option is string => typeof option === "string")
          : [];
    out.push({
      id,
      text,
      type: record.type,
      options,
      required: record.required === true,
      order: typeof record.order === "number" ? record.order : index,
    });
  });
  return out.sort((left, right) => left.order - right.order);
}

/**
 * Validate a panelist's raw answers against the study's questions and return a
 * normalized `customAnswers` map. Enforces required-ness, allowed option values,
 * and length caps. Unanswered optional questions are simply omitted.
 */
export function normalizeCustomAnswers(
  questions: CustomQuestion[],
  raw: unknown
): { success: true; value: CustomAnswers } | { success: false; error: string } {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const answers: CustomAnswers = {};

  for (const question of questions) {
    const provided = source[question.id];

    if (question.type === "PARAGRAPH") {
      const text = typeof provided === "string" ? provided.trim() : "";
      if (!text) {
        if (question.required) {
          return { success: false, error: `Please answer: "${question.text}".` };
        }
        continue;
      }
      if (text.length > MAX_CUSTOM_PARAGRAPH_ANSWER) {
        return { success: false, error: `Your answer to "${question.text}" is too long.` };
      }
      answers[question.id] = text;
      continue;
    }

    if (question.type === "MULTIPLE_CHOICE") {
      const choice = typeof provided === "string" ? provided.trim() : "";
      if (!choice) {
        if (question.required) {
          return { success: false, error: `Please answer: "${question.text}".` };
        }
        continue;
      }
      if (!question.options.includes(choice)) {
        return { success: false, error: `Invalid option selected for "${question.text}".` };
      }
      answers[question.id] = choice;
      continue;
    }

    // CHECKBOXES
    const selected = Array.isArray(provided)
      ? dedupeStrings(
          provided
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        )
      : [];
    if (selected.length === 0) {
      if (question.required) {
        return { success: false, error: `Please answer: "${question.text}".` };
      }
      continue;
    }
    if (selected.some((item) => !question.options.includes(item))) {
      return { success: false, error: `Invalid option selected for "${question.text}".` };
    }
    answers[question.id] = selected;
  }

  return { success: true, value: answers };
}
