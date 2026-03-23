"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStudyFromBuilder } from "@/app/actions/study-builder-actions";

type StudyMode = "MARKET" | "SENSORY";
type MarketStudyType =
  | "PACKAGING_EVALUATION"
  | "PRICE_SENSITIVITY"
  | "PRODUCT_INTENT"
  | "CONSUMER_USAGE_HABIT";
type SensoryStudyType = "DISCRIMINATIVE" | "DESCRIPTIVE" | "CONSUMER_TEST";
type ConsumerObjective = "MARKET_READINESS" | "REFINEMENT" | "PROTOTYPING";

interface AttributeRow {
  name: string;
  dimension: string;
}

interface SampleSetupRow {
  description: string;
  ingredient: string;
  allergen: string;
}

interface CategoryProfile {
  key: string;
  label: string;
  categoryCode: "BEVERAGE" | "SNACK" | "DESSERT" | "FUNCTIONAL_FOOD" | "DAIRY" | "BAKERY";
  attributes: AttributeRow[];
}

const MARKET_TYPE_OPTIONS: Array<{ value: MarketStudyType; label: string }> = [
  { value: "PACKAGING_EVALUATION", label: "Packaging Evaluation" },
  { value: "PRICE_SENSITIVITY", label: "Price Sensitivity Study" },
  { value: "PRODUCT_INTENT", label: "Product Intent Study" },
  { value: "CONSUMER_USAGE_HABIT", label: "Consumer Usage & Habit Study" },
];

const DISCRIMINATIVE_METHODS = ["Triangle Test", "Duo-trio", "Tetrad", "Multiple Ranking"];
const DESCRIPTIVE_METHODS = ["QDA", "Spectrum Method", "Similarity Measures"];

const CONSUMER_OBJECTIVES: Array<{ value: ConsumerObjective; label: string; max: number }> = [
  { value: "MARKET_READINESS", label: "Market Readiness (readiness check)", max: 110 },
  { value: "REFINEMENT", label: "Refinement (refinement check)", max: 60 },
  { value: "PROTOTYPING", label: "Prototyping (prototype check)", max: 35 },
];

const DEFAULT_MARKET_QUESTIONS = [
  "How often do you purchase this type of product?",
  "What price range do you expect for this product?",
  "How likely are you to purchase this product if available today?",
  "What usage occasions best describe when you would use this product?",
  "What should be improved before launch?",
];

const CATEGORY_PROFILES: CategoryProfile[] = [
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
    key: "bev_carbonated",
    label: "Beverages - Carbonated Drinks",
    categoryCode: "BEVERAGE",
    attributes: [
      { name: "Sweetness", dimension: "Taste" },
      { name: "Sourness / Acidity", dimension: "Taste" },
      { name: "Carbonation level", dimension: "Mouthfeel" },
      { name: "Flavor intensity", dimension: "Taste" },
      { name: "Aftertaste intensity", dimension: "Aftertaste" },
    ],
  },
  {
    key: "bakery_cakes",
    label: "Bakery - Cakes",
    categoryCode: "BAKERY",
    attributes: [
      { name: "Sweetness", dimension: "Taste" },
      { name: "Moistness", dimension: "Texture" },
      { name: "Softness", dimension: "Texture" },
      { name: "Crumb density", dimension: "Texture" },
      { name: "Flavor intensity", dimension: "Taste" },
    ],
  },
  {
    key: "bakery_cookies",
    label: "Bakery - Cookies & Biscuits",
    categoryCode: "BAKERY",
    attributes: [
      { name: "Sweetness", dimension: "Taste" },
      { name: "Crispness", dimension: "Texture" },
      { name: "Hardness", dimension: "Texture" },
      { name: "Buttery flavor", dimension: "Taste" },
      { name: "Aftertaste intensity", dimension: "Aftertaste" },
    ],
  },
  {
    key: "snack_fried",
    label: "Snacks - Fried Snacks",
    categoryCode: "SNACK",
    attributes: [
      { name: "Saltiness", dimension: "Taste" },
      { name: "Crunchiness", dimension: "Texture" },
      { name: "Oiliness", dimension: "Mouthfeel" },
      { name: "Flavor intensity", dimension: "Taste" },
      { name: "Aftertaste intensity", dimension: "Aftertaste" },
    ],
  },
  {
    key: "snack_baked",
    label: "Snacks - Baked Snacks",
    categoryCode: "SNACK",
    attributes: [
      { name: "Saltiness", dimension: "Taste" },
      { name: "Crispness", dimension: "Texture" },
      { name: "Hardness", dimension: "Texture" },
      { name: "Flavor intensity", dimension: "Taste" },
      { name: "Dryness", dimension: "Texture" },
    ],
  },
  {
    key: "dairy_yogurt",
    label: "Dairy - Yogurt & Fermented Dairy",
    categoryCode: "DAIRY",
    attributes: [
      { name: "Sweetness", dimension: "Taste" },
      { name: "Sourness", dimension: "Taste" },
      { name: "Creaminess", dimension: "Mouthfeel" },
      { name: "Thickness", dimension: "Texture" },
      { name: "Aftertaste intensity", dimension: "Aftertaste" },
    ],
  },
  {
    key: "dairy_icecream",
    label: "Dairy - Ice Cream & Frozen Desserts",
    categoryCode: "DAIRY",
    attributes: [
      { name: "Sweetness", dimension: "Taste" },
      { name: "Creaminess", dimension: "Mouthfeel" },
      { name: "Iciness", dimension: "Texture" },
      { name: "Melting rate", dimension: "Texture" },
      { name: "Flavor intensity", dimension: "Taste" },
    ],
  },
  {
    key: "sauce_savory",
    label: "Sauces - Savory Sauces",
    categoryCode: "FUNCTIONAL_FOOD",
    attributes: [
      { name: "Saltiness", dimension: "Taste" },
      { name: "Thickness / Consistency", dimension: "Texture" },
      { name: "Flavor intensity", dimension: "Taste" },
      { name: "Oiliness", dimension: "Mouthfeel" },
      { name: "Aftertaste intensity", dimension: "Aftertaste" },
    ],
  },
  {
    key: "sauce_sweet",
    label: "Sauces - Sweet Sauces & Syrups",
    categoryCode: "FUNCTIONAL_FOOD",
    attributes: [
      { name: "Sweetness", dimension: "Taste" },
      { name: "Thickness", dimension: "Texture" },
      { name: "Stickiness", dimension: "Mouthfeel" },
      { name: "Flavor intensity", dimension: "Taste" },
      { name: "Aftertaste sweetness", dimension: "Aftertaste" },
    ],
  },
  {
    key: "ready_meals",
    label: "Ready-to-Eat / Ready-to-Cook - Savory Meals",
    categoryCode: "FUNCTIONAL_FOOD",
    attributes: [
      { name: "Saltiness", dimension: "Taste" },
      { name: "Flavor intensity", dimension: "Taste" },
      { name: "Tenderness", dimension: "Texture" },
      { name: "Oiliness", dimension: "Mouthfeel" },
      { name: "Aftertaste intensity", dimension: "Aftertaste" },
    ],
  },
  {
    key: "plant_meat",
    label: "Plant-Based - Meat Analogs",
    categoryCode: "FUNCTIONAL_FOOD",
    attributes: [
      { name: "Flavor intensity", dimension: "Taste" },
      { name: "Texture firmness", dimension: "Texture" },
      { name: "Juiciness", dimension: "Mouthfeel" },
      { name: "Aftertaste intensity", dimension: "Aftertaste" },
      { name: "Off-flavor intensity", dimension: "Taste" },
    ],
  },
  {
    key: "functional_bars",
    label: "Functional / Health Products - Nutrition & Energy Bars",
    categoryCode: "FUNCTIONAL_FOOD",
    attributes: [
      { name: "Sweetness", dimension: "Taste" },
      { name: "Texture firmness", dimension: "Texture" },
      { name: "Dryness", dimension: "Texture" },
      { name: "Aftertaste intensity", dimension: "Aftertaste" },
      { name: "Flavor acceptability", dimension: "Taste" },
    ],
  },
];

const EMPTY_SAMPLE_SETUP: SampleSetupRow = {
  description: "",
  ingredient: "",
  allergen: "",
};

export function CreateStudyBuilder({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [studyMode, setStudyMode] = useState<StudyMode>("SENSORY");
  const [marketStudyType, setMarketStudyType] = useState<MarketStudyType>("PACKAGING_EVALUATION");

  const [sensoryStudyType, setSensoryStudyType] = useState<SensoryStudyType>("CONSUMER_TEST");
  const [sensoryMethod, setSensoryMethod] = useState("Triangle Test");
  const [consumerObjective, setConsumerObjective] = useState<ConsumerObjective>("PROTOTYPING");

  const [studyTitle, setStudyTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [facilityType, setFacilityType] = useState("FIC Lab A");
  const [numberOfSamples, setNumberOfSamples] = useState(1);
  const [targetResponses, setTargetResponses] = useState(30);

  const [productName, setProductName] = useState("");
  const [profileKey, setProfileKey] = useState(CATEGORY_PROFILES[0].key);
  const [attributes, setAttributes] = useState<AttributeRow[]>(CATEGORY_PROFILES[0].attributes);

  const [sampleSetupCount, setSampleSetupCount] = useState(1);
  const [sampleSetups, setSampleSetups] = useState<SampleSetupRow[]>([{ ...EMPTY_SAMPLE_SETUP }]);
  const [marketQuestions, setMarketQuestions] = useState(DEFAULT_MARKET_QUESTIONS);
  const [error, setError] = useState<string | null>(null);

  const selectedProfile = useMemo(
    () => CATEGORY_PROFILES.find((profile) => profile.key === profileKey) ?? CATEGORY_PROFILES[0],
    [profileKey]
  );

  const consumerLimit = useMemo(() => {
    if (sensoryStudyType !== "CONSUMER_TEST") return null;
    return CONSUMER_OBJECTIVES.find((objective) => objective.value === consumerObjective)?.max ?? null;
  }, [sensoryStudyType, consumerObjective]);

  useEffect(() => {
    setAttributes(selectedProfile.attributes);
  }, [selectedProfile]);

  useEffect(() => {
    setSampleSetups((previous) => {
      const next = [...previous];
      while (next.length < sampleSetupCount) {
        next.push({ ...EMPTY_SAMPLE_SETUP });
      }
      return next.slice(0, sampleSetupCount);
    });
  }, [sampleSetupCount]);

  useEffect(() => {
    if (sensoryStudyType === "DISCRIMINATIVE") {
      setSensoryMethod(DISCRIMINATIVE_METHODS[0]);
      return;
    }
    if (sensoryStudyType === "DESCRIPTIVE") {
      setSensoryMethod(DESCRIPTIVE_METHODS[0]);
      return;
    }
    setSensoryMethod("Consumer Test");
  }, [sensoryStudyType]);

  const updateAttribute = (index: number, value: string) => {
    setAttributes((previous) =>
      previous.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return { ...row, name: value };
      })
    );
  };

  const updateSampleSetup = (index: number, field: keyof SampleSetupRow, value: string) => {
    setSampleSetups((previous) =>
      previous.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return { ...row, [field]: value };
      })
    );
  };

  const updateMarketQuestion = (index: number, value: string) => {
    setMarketQuestions((previous) =>
      previous.map((question, questionIndex) => (questionIndex === index ? value : question))
    );
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (studyMode === "SENSORY" && sensoryStudyType === "CONSUMER_TEST" && consumerLimit && targetResponses > consumerLimit) {
      setError(`Target responses exceed the ${consumerLimit} maximum for this consumer test objective.`);
      return;
    }

    startTransition(async () => {
      const payload = {
        studyMode,
        marketStudyType: studyMode === "MARKET" ? marketStudyType : undefined,
        sensoryStudyType: studyMode === "SENSORY" ? sensoryStudyType : undefined,
        sensoryMethod: studyMode === "SENSORY" ? sensoryMethod : undefined,
        consumerObjective: studyMode === "SENSORY" && sensoryStudyType === "CONSUMER_TEST" ? consumerObjective : undefined,
        studyTitle,
        purpose,
        facilityType,
        numberOfSamples,
        targetResponses,
        productName: studyMode === "SENSORY" ? productName : undefined,
        categoryCode: studyMode === "SENSORY" ? selectedProfile.categoryCode : undefined,
        categoryLabel: studyMode === "SENSORY" ? selectedProfile.label : undefined,
        attributes: studyMode === "SENSORY" ? attributes : [],
        sampleSetups,
        questions: studyMode === "MARKET" ? marketQuestions.filter((question) => question.trim().length > 0) : [],
      };

      const result = await createStudyFromBuilder(payload);
      const actionResult = result as {
        success?: boolean;
        error?: string;
        studyId?: string;
        redirectPath?: string;
      };
      const hasStudyId = typeof actionResult.studyId === "string";

      if (!actionResult.success || !hasStudyId) {
        setError(actionResult.error ?? "Failed to create study.");
        return;
      }

      const redirectPath = actionResult.redirectPath ?? `/studies/${actionResult.studyId}/form`;

      router.push(redirectPath);
    });
  };

  return (
    <div className={embedded ? "" : "min-h-screen bg-[#f8fafc] px-4 py-8"}>
      <div
        className={`space-y-8 rounded-[28px] border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)] ${
          embedded ? "p-5 sm:p-6 md:p-8" : "mx-auto max-w-5xl p-5 sm:p-8"
        }`}
      >
        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-[#0f172a]">Create Study</h1>
          <p className="text-[#64748b]">Configure Market or Sensory studies and generate a form with QR code.</p>
        </header>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-8">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Study Type</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <label className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] bg-white px-4 py-3">
                <input
                  type="radio"
                  checked={studyMode === "MARKET"}
                  onChange={() => setStudyMode("MARKET")}
                />
                <span>Market Study</span>
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] bg-white px-4 py-3">
                <input
                  type="radio"
                  checked={studyMode === "SENSORY"}
                  onChange={() => setStudyMode("SENSORY")}
                />
                <span>Sensory Study</span>
              </label>
            </div>
          </section>

          {studyMode === "MARKET" && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Market Study Setup</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <FieldLabel text="Market Study" />
                <select
                  value={marketStudyType}
                  onChange={(event) => setMarketStudyType(event.target.value as MarketStudyType)}
                  className="app-select"
                >
                  {MARKET_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700">Questions (Survey Form)</p>
                {marketQuestions.map((question, index) => (
                  <input
                    key={`market-question-${index}`}
                    value={question}
                    onChange={(event) => updateMarketQuestion(index, event.target.value)}
                    className="app-input"
                  />
                ))}
              </div>
            </section>
          )}

          {studyMode === "SENSORY" && (
            <section className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Sensory Study Setup</h2>

              <div className="grid md:grid-cols-2 gap-4">
                <FieldLabel text="Sensory Study" />
                <select
                  value={sensoryStudyType}
                  onChange={(event) => setSensoryStudyType(event.target.value as SensoryStudyType)}
                  className="app-select"
                >
                  <option value="DISCRIMINATIVE">Discriminative</option>
                  <option value="DESCRIPTIVE">Descriptive</option>
                  <option value="CONSUMER_TEST">Consumer Test</option>
                </select>
              </div>

              {sensoryStudyType === "DISCRIMINATIVE" && (
                <div className="grid md:grid-cols-2 gap-4">
                  <FieldLabel text="Method" />
                  <select
                    value={sensoryMethod}
                    onChange={(event) => setSensoryMethod(event.target.value)}
                    className="app-select"
                  >
                    {DISCRIMINATIVE_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {sensoryStudyType === "DESCRIPTIVE" && (
                <div className="grid md:grid-cols-2 gap-4">
                  <FieldLabel text="Method" />
                  <select
                    value={sensoryMethod}
                    onChange={(event) => setSensoryMethod(event.target.value)}
                    className="app-select"
                  >
                    {DESCRIPTIVE_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {sensoryStudyType === "CONSUMER_TEST" && (
                <div className="grid md:grid-cols-2 gap-4">
                  <FieldLabel text="What do you want to do with this test?" />
                  <select
                    value={consumerObjective}
                    onChange={(event) => setConsumerObjective(event.target.value as ConsumerObjective)}
                    className="app-select"
                  >
                    {CONSUMER_OBJECTIVES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                <FieldLabel text="Product Name" />
                <input
                  value={productName}
                  onChange={(event) => setProductName(event.target.value)}
                  className="app-input"
                  required
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <FieldLabel text="Category Profile" />
                <select
                  value={profileKey}
                  onChange={(event) => setProfileKey(event.target.value)}
                  className="app-select"
                >
                  {CATEGORY_PROFILES.map((profile) => (
                    <option key={profile.key} value={profile.key}>
                      {profile.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">Attributes (5 auto-loaded, last 2 editable)</p>
                <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="bg-[#f8fafc]">
                      <tr>
                        <th className="px-4 py-2 text-left">Attribute</th>
                        <th className="px-4 py-2 text-left">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attributes.map((attribute, index) => {
                        const editable = index >= 3;
                        return (
                          <tr key={`${attribute.name}-${index}`} className="border-t">
                            <td className="px-4 py-2">
                              <input
                                value={attribute.name}
                                onChange={(event) => updateAttribute(index, event.target.value)}
                                readOnly={!editable}
                                className={`app-input ${editable ? "bg-white" : "bg-[#f8fafc]"}`}
                              />
                            </td>
                            <td className="px-4 py-2 text-gray-700">{attribute.dimension}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm text-[#334155]">
                Questionnaire Logic generated on create:
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Overall Liking (9-point hedonic scale)</li>
                  <li>Attribute Liking for each attribute</li>
                  <li>JAR for each attribute</li>
                  <li>Open-ended improvement question</li>
                </ul>
              </div>
            </section>
          )}

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Details</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <FieldLabel text="Study Title" />
              <input
                value={studyTitle}
                onChange={(event) => setStudyTitle(event.target.value)}
                className="app-input"
                required
              />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <FieldLabel text="Purpose" />
              <textarea
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                className="app-textarea min-h-24"
                required
              />
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <FieldLabel text="Facility Type" />
                <input
                  value={facilityType}
                  onChange={(event) => setFacilityType(event.target.value)}
                  className="app-input"
                  required
                />
              </div>
              <div className="space-y-2">
                <FieldLabel text="Number of Samples" />
                <input
                  type="number"
                  min={1}
                  value={numberOfSamples}
                  onChange={(event) => setNumberOfSamples(Number(event.target.value))}
                  className="app-input"
                  required
                />
              </div>
              <div className="space-y-2">
                <FieldLabel text="Number of Target Responses" />
                <input
                  type="number"
                  min={1}
                  max={consumerLimit ?? undefined}
                  value={targetResponses}
                  onChange={(event) => setTargetResponses(Number(event.target.value))}
                  className="app-input"
                  required
                />
                {consumerLimit && (
                  <p className="text-xs text-gray-500">Maximum for selected objective: {consumerLimit}</p>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Sample Setups</h2>
            <div className="grid md:grid-cols-2 gap-4 items-end">
              <div className="space-y-2">
                <FieldLabel text="No. of Sample Setups" />
                <input
                  type="number"
                  min={1}
                  value={sampleSetupCount}
                  onChange={(event) => setSampleSetupCount(Math.max(1, Number(event.target.value)))}
                  className="app-input"
                />
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              {sampleSetups.map((setup, index) => (
                <div key={`sample-setup-${index}`} className="space-y-3 rounded-lg border border-[#e2e8f0] bg-white p-4">
                  <h3 className="font-medium text-gray-900">Sample Set-up {index + 1}</h3>
                  <div className="space-y-1">
                    <FieldLabel text="General Description / Formulation Notes" />
                    <input
                      value={setup.description}
                      onChange={(event) => updateSampleSetup(index, "description", event.target.value)}
                      className="app-input"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel text="Ingredient (Optional)" />
                    <input
                      value={setup.ingredient}
                      onChange={(event) => updateSampleSetup(index, "ingredient", event.target.value)}
                      className="app-input"
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel text="Allergen" />
                    <input
                      value={setup.allergen}
                      onChange={(event) => updateSampleSetup(index, "allergen", event.target.value)}
                      className="app-input"
                      required
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <button
            type="submit"
            disabled={isPending}
            className="app-button-primary w-full py-3 disabled:opacity-70"
          >
            {isPending ? "Creating Study..." : "Generate Study Form and QR"}
          </button>
        </form>
      </div>
    </div>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <label className="text-sm font-medium text-[#334155]">{text}</label>;
}

