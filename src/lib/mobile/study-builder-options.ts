import { FACILITIES_BY_REGION, REGIONS } from "@/lib/facility-constants";

export const MARKET_TYPE_OPTIONS = [
  { value: "PACKAGING_EVALUATION", label: "Packaging Evaluation" },
  { value: "PRICE_SENSITIVITY", label: "Price Sensitivity Study" },
  { value: "PRODUCT_INTENT", label: "Product Intent Study" },
  { value: "CONSUMER_USAGE_HABIT", label: "Consumer Usage & Habit Study" },
];

export const SENSORY_STUDY_TYPES = [
  { value: "DISCRIMINATIVE", label: "Discriminative" },
  { value: "DESCRIPTIVE", label: "Descriptive" },
  { value: "CONSUMER_TEST", label: "Consumer Test" },
];

export const CONSUMER_OBJECTIVES = [
  { value: "CHECK_ACCEPTABILITY", label: "Check acceptability", max: 110, defaultTarget: 80 },
  { value: "IMPROVE_TASTE", label: "Improve taste", max: 60, defaultTarget: 50 },
  { value: "IMPROVE_TEXTURE", label: "Improve texture", max: 60, defaultTarget: 50 },
  { value: "FINE_TUNE", label: "Fine-tune", max: 60, defaultTarget: 50 },
  { value: "FAST_ITERATION", label: "FAST iteration", max: 35, defaultTarget: 30 },
];

export const DISCRIMINATIVE_METHODS = ["Triangle Test", "Duo-trio", "Tetrad", "Multiple Ranking"];
export const DESCRIPTIVE_METHODS = ["QDA", "Spectrum Method", "Similarity Measures"];

export const CATEGORY_PROFILES = [
  {
    key: "bev_juice",
    label: "Beverages - Fruit Juice / Juice Drinks",
    categoryCode: "BEVERAGE",
    attributes: [
      { name: "Sweetness", dimension: "Taste" },
      { name: "Sourness / Acidity", dimension: "Taste" },
      { name: "Flavor intensity", dimension: "Taste" },
      { name: "Mouthfeel / Body", dimension: "Mouthfeel" },
      { name: "Aftertaste intensity", dimension: "Aftertaste" },
    ],
  },
  {
    key: "bakery_cakes",
    label: "Bakery - Cakes / Pastries",
    categoryCode: "BAKERY",
    attributes: [
      { name: "Sweetness", dimension: "Taste" },
      { name: "Moistness", dimension: "Texture" },
      { name: "Crumb softness", dimension: "Texture" },
      { name: "Flavor intensity", dimension: "Taste" },
      { name: "Aftertaste", dimension: "Aftertaste" },
    ],
  },
  {
    key: "snack_chips",
    label: "Snacks - Chips / Crunchy Snacks",
    categoryCode: "SNACK",
    attributes: [
      { name: "Saltiness", dimension: "Taste" },
      { name: "Crunchiness", dimension: "Texture" },
      { name: "Flavor intensity", dimension: "Taste" },
      { name: "Oiliness", dimension: "Mouthfeel" },
      { name: "Aftertaste", dimension: "Aftertaste" },
    ],
  },
  {
    key: "dairy_cultured",
    label: "Dairy - Cultured / Fermented",
    categoryCode: "DAIRY",
    attributes: [
      { name: "Sourness", dimension: "Taste" },
      { name: "Sweetness", dimension: "Taste" },
      { name: "Creaminess", dimension: "Mouthfeel" },
      { name: "Thickness", dimension: "Texture" },
      { name: "Aftertaste", dimension: "Aftertaste" },
    ],
  },
  {
    key: "functional_food",
    label: "Functional Food",
    categoryCode: "FUNCTIONAL_FOOD",
    attributes: [
      { name: "Sweetness", dimension: "Taste" },
      { name: "Bitterness", dimension: "Taste" },
      { name: "Texture", dimension: "Texture" },
      { name: "Mouthfeel", dimension: "Mouthfeel" },
      { name: "Aftertaste", dimension: "Aftertaste" },
    ],
  },
];

export function getStudyBuilderOptions() {
  return {
    timezone: "Asia/Manila",
    studyModes: [
      { value: "MARKET", label: "Market Study" },
      { value: "SENSORY", label: "Sensory Study" },
    ],
    coordinationModes: [
      { value: "FIC_ASSISTED", label: "FIC-assisted" },
      { value: "SELF_MANAGED_PUBLIC", label: "Self-managed public venue" },
    ],
    marketStudyTypes: MARKET_TYPE_OPTIONS,
    sensoryStudyTypes: SENSORY_STUDY_TYPES,
    discriminativeMethods: DISCRIMINATIVE_METHODS,
    descriptiveMethods: DESCRIPTIVE_METHODS,
    consumerObjectives: CONSUMER_OBJECTIVES,
    categoryProfiles: CATEGORY_PROFILES,
    regions: REGIONS,
    facilitiesByRegion: FACILITIES_BY_REGION,
    attributeDimensions: ["Taste", "Texture", "Aftertaste", "Mouthfeel"],
  };
}
