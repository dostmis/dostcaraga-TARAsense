import { ProductCategory, ProjectStatus } from "@prisma/client";

/** Human-friendly labels for the product categories shared with Study. */
export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  BEVERAGE: "Beverage",
  SNACK: "Snack",
  DESSERT: "Dessert",
  FUNCTIONAL_FOOD: "Functional Food",
  DAIRY: "Dairy",
  BAKERY: "Bakery",
};

export const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as ProductCategory[]).map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  IN_STUDY: "In Study",
  UNDER_EVALUATION: "Under Evaluation",
  AI_READY: "AI Ready",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const PROJECT_STATUS_OPTIONS = (Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map(
  (value) => ({ value, label: PROJECT_STATUS_LABELS[value] })
);

/** Tailwind classes for the status badge, tuned to the dashboard palette. */
export const PROJECT_STATUS_BADGE: Record<ProjectStatus, string> = {
  DRAFT: "border-slate-200 bg-slate-100 text-slate-600",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  IN_STUDY: "border-blue-200 bg-blue-50 text-blue-700",
  UNDER_EVALUATION: "border-amber-200 bg-amber-50 text-amber-700",
  AI_READY: "border-violet-200 bg-violet-50 text-violet-700",
  COMPLETED: "border-emerald-300 bg-emerald-100 text-emerald-800",
  ARCHIVED: "border-slate-200 bg-slate-50 text-slate-500",
};

/** Friendly labels for a Study's stage, shown on the project study tabs. */
export const STUDY_STAGE_LABELS: Record<string, string> = {
  EXPLORATORY: "Exploratory",
  PROTOTYPE_CHECK: "Prototyping",
  REFINEMENT: "Refinement",
  MARKET_READINESS: "Market Readiness",
};

export function formatStudyStage(stage: string): string {
  return STUDY_STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
}

/** All sensory studies share one type today; kept as a helper for the study tabs. */
export function formatStudyType(): string {
  return "Sensory";
}

export function formatCategory(category: ProductCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function formatProjectStatus(status: ProjectStatus): string {
  return PROJECT_STATUS_LABELS[status] ?? status;
}
