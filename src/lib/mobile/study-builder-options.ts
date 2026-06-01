import { FACILITIES_BY_REGION, REGIONS } from "@/lib/facility-constants";
import {
  TARGET_CONSUMER_CONSUMPTION_OPTIONS,
  TARGET_CONSUMER_DIETARY_OPTIONS,
  TARGET_CONSUMER_GENDER_OPTIONS,
  TARGET_CONSUMER_LIFESTYLE_OPTIONS,
} from "@/lib/target-consumer";

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
  { value: "MARKET_READINESS", label: "Consumer Acceptability", panelCount: 100, bufferCount: 0, defaultTarget: 100 },
  { value: "REFINEMENT", label: "Refinement", panelCount: 50, bufferCount: 0, defaultTarget: 50 },
  { value: "PROTOTYPING", label: "Prototyping", panelCount: 25, bufferCount: 10, defaultTarget: 35 },
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
      { name: "Mouthfeel / Body", dimension: "mouthfeel" },
      { name: "Aftertaste intensity", dimension: "aftertaste" },
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
      { name: "Aftertaste", dimension: "aftertaste" },
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
      { name: "Oiliness", dimension: "mouthfeel" },
      { name: "Aftertaste", dimension: "aftertaste" },
    ],
  },
  {
    key: "dairy_cultured",
    label: "Dairy - Cultured / Fermented",
    categoryCode: "DAIRY",
    attributes: [
      { name: "Sourness", dimension: "Taste" },
      { name: "Sweetness", dimension: "Taste" },
      { name: "Creaminess", dimension: "mouthfeel" },
      { name: "Thickness", dimension: "Texture" },
      { name: "Aftertaste", dimension: "aftertaste" },
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
      { name: "Mouthfeel", dimension: "mouthfeel" },
      { name: "Aftertaste", dimension: "aftertaste" },
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
    attributeDimensions: ["Appearance", "Aroma", "Texture", "Taste", "mouthfeel", "Flavor", "aftertaste"],
    targetConsumerOptions: {
      genders: TARGET_CONSUMER_GENDER_OPTIONS,
      lifestyles: TARGET_CONSUMER_LIFESTYLE_OPTIONS,
      dietaryPrefs: TARGET_CONSUMER_DIETARY_OPTIONS,
      consumptionHabits: TARGET_CONSUMER_CONSUMPTION_OPTIONS,
    },
  };
}
