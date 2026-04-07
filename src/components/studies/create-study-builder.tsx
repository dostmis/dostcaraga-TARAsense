"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStudyFromBuilder } from "@/app/actions/study-builder-actions";
import { FACILITIES_BY_REGION, REGIONS, getRegionForFacility } from "@/lib/facility-constants";
import type { Region, Facility } from "@/lib/facility-constants";

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

interface SessionSlotDraft {
  id: string;
  dayOffset: number;
  label: string;
  startTime: string;
  endTime: string;
  capacity: number;
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

const CONSUMER_OBJECTIVES: Array<{ value: ConsumerObjective; label: string; max: number; defaultTarget: number }> = [
  { value: "MARKET_READINESS", label: "Market Readiness (readiness check)", max: 110, defaultTarget: 100 },
  { value: "REFINEMENT", label: "Refinement (refinement check)", max: 60, defaultTarget: 50 },
  { value: "PROTOTYPING", label: "Prototyping (prototype check)", max: 35, defaultTarget: 30 },
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

const STUDY_TIMEZONE = "Asia/Manila";

export function CreateStudyBuilder({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [studyMode, setStudyMode] = useState<StudyMode>("SENSORY");
  const [marketStudyType, setMarketStudyType] = useState<MarketStudyType>("PACKAGING_EVALUATION");

  const [sensoryStudyType, setSensoryStudyType] = useState<SensoryStudyType>("CONSUMER_TEST");
  const [sensoryMethod, setSensoryMethod] = useState("Triangle Test");
  const [consumerObjective, setConsumerObjective] = useState<ConsumerObjective>("PROTOTYPING");

  const [region, setRegion] = useState<Region | "">("");
  const [facilityType, setFacilityType] = useState<string>("");
  const [targetResponses, setTargetResponses] = useState(30);

  const [productName, setProductName] = useState("");
  const [profileKey, setProfileKey] = useState(CATEGORY_PROFILES[0].key);
  const [attributes, setAttributes] = useState<AttributeRow[]>(CATEGORY_PROFILES[0].attributes);
  const [testingStartDate, setTestingStartDate] = useState(() => getTodayDateInput());
  const [testingDurationDays, setTestingDurationDays] = useState(1);
  const [sessionSlots, setSessionSlots] = useState<SessionSlotDraft[]>([
    createSessionSlotDraft(0, 0),
  ]);

  const [sampleSetupCount, setSampleSetupCount] = useState(1);
  const [sampleSetups, setSampleSetups] = useState<SampleSetupRow[]>([{ ...EMPTY_SAMPLE_SETUP }]);
  const [marketQuestions, setMarketQuestions] = useState(DEFAULT_MARKET_QUESTIONS);
  const [error, setError] = useState<string | null>(null);

  // Cascade region/facility logic
  useEffect(() => {
    if (region === "") {
      setFacilityType("");
    }
  }, [region]);

  useEffect(() => {
    if (facilityType && !region) {
      const detectedRegion = getRegionForFacility(facilityType);
      if (detectedRegion) {
        setRegion(detectedRegion);
      }
    }
  }, [facilityType, region]);

  const selectedProfile = useMemo(
    () => CATEGORY_PROFILES.find((profile) => profile.key === profileKey) ?? CATEGORY_PROFILES[0],
    [profileKey]
  );

  const consumerLimit = useMemo(() => {
    if (sensoryStudyType !== "CONSUMER_TEST") return null;
    return CONSUMER_OBJECTIVES.find((objective) => objective.value === consumerObjective)?.max ?? null;
  }, [sensoryStudyType, consumerObjective]);

  const sessionSlotsByDay = useMemo(() => {
    const totalDays = Math.max(1, Math.floor(testingDurationDays));
    return Array.from({ length: totalDays }, (_, dayOffset) => ({
      dayOffset,
      date: addDaysToDateInput(testingStartDate, dayOffset),
      slots: sessionSlots
        .filter((slot) => slot.dayOffset === dayOffset)
        .sort((left, right) => left.startTime.localeCompare(right.startTime)),
    }));
  }, [sessionSlots, testingDurationDays, testingStartDate]);

  const totalSessionCapacity = useMemo(
    () =>
      sessionSlots.reduce(
        (sum, slot) => sum + (Number.isFinite(slot.capacity) ? Math.max(1, Math.floor(slot.capacity)) : 1),
        0
      ),
    [sessionSlots]
  );

  useEffect(() => {
    setAttributes(selectedProfile.attributes);
  }, [selectedProfile]);

  useEffect(() => {
    if (studyMode === "SENSORY" && sensoryStudyType === "CONSUMER_TEST") {
      const objective = CONSUMER_OBJECTIVES.find((o) => o.value === consumerObjective);
      if (objective) {
        setTargetResponses(objective.defaultTarget);
      }
    }
  }, [consumerObjective, sensoryStudyType, studyMode]);

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
    const totalDays = Math.max(1, Math.floor(testingDurationDays));
    setSessionSlots((previous) => {
      const filtered = previous.filter((slot) => slot.dayOffset < totalDays);
      const next = [...filtered];
      for (let dayOffset = 0; dayOffset < totalDays; dayOffset += 1) {
        if (!next.some((slot) => slot.dayOffset === dayOffset)) {
          const daySlotCount = next.filter((slot) => slot.dayOffset === dayOffset).length;
          next.push(createSessionSlotDraft(dayOffset, daySlotCount));
        }
      }
      return next.sort((left, right) => {
        if (left.dayOffset !== right.dayOffset) {
          return left.dayOffset - right.dayOffset;
        }
        return left.startTime.localeCompare(right.startTime);
      });
    });
  }, [testingDurationDays]);

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

  const addSessionSlot = (dayOffset: number) => {
    setSessionSlots((previous) => {
      const nextIndex = previous.filter((slot) => slot.dayOffset === dayOffset).length;
      return [...previous, createSessionSlotDraft(dayOffset, nextIndex)];
    });
  };

  const removeSessionSlot = (slotId: string) => {
    setSessionSlots((previous) => {
      const target = previous.find((slot) => slot.id === slotId);
      if (!target) {
        return previous;
      }
      const daySlots = previous.filter((slot) => slot.dayOffset === target.dayOffset);
      if (daySlots.length <= 1) {
        return previous;
      }
      return previous.filter((slot) => slot.id !== slotId);
    });
  };

  const updateSessionSlot = (
    slotId: string,
    field: "label" | "startTime" | "endTime" | "capacity",
    value: string
  ) => {
    setSessionSlots((previous) =>
      previous.map((slot) => {
        if (slot.id !== slotId) {
          return slot;
        }

        if (field === "capacity") {
          const parsed = Number(value);
          const capacity = Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 1;
          return { ...slot, capacity };
        }

        return {
          ...slot,
          [field]: value,
        };
      })
    );
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!region) {
      setError("Please select a region.");
      return;
    }

    if (!facilityType) {
      setError("Please select a facility type.");
      return;
    }

    if (!Number.isInteger(targetResponses) || targetResponses < 1) {
      setError("Target responses must be at least 1.");
      return;
    }

    if (studyMode === "SENSORY" && sensoryStudyType === "CONSUMER_TEST" && consumerLimit && targetResponses > consumerLimit) {
      setError(`Target responses exceed the ${consumerLimit} maximum for this consumer test objective.`);
      return;
    }

    let sessionPayload: Array<{
      dayOffset: number;
      label: string;
      startDateTime: string;
      endDateTime: string;
      capacity: number;
    }> = [];

    if (studyMode === "SENSORY") {
      if (!testingStartDate) {
        setError("Testing start date is required.");
        return;
      }

      const invalidSlot = sessionSlots.find(
        (slot) =>
          !slot.label.trim() ||
          !slot.startTime ||
          !slot.endTime ||
          !Number.isFinite(slot.capacity) ||
          slot.capacity < 1
      );
      if (invalidSlot) {
        setError("Complete all session fields (label, start time, end time, capacity).");
        return;
      }

      sessionPayload = sessionSlots
        .map((slot) => {
          const dateValue = addDaysToDateInput(testingStartDate, slot.dayOffset);
          const startsAt = new Date(`${dateValue}T${slot.startTime}:00`);
          const endsAt = new Date(`${dateValue}T${slot.endTime}:00`);
          if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
            return null;
          }
          if (endsAt.getTime() <= startsAt.getTime()) {
            return null;
          }
          return {
            dayOffset: slot.dayOffset,
            label: slot.label.trim(),
            startDateTime: startsAt.toISOString(),
            endDateTime: endsAt.toISOString(),
            capacity: Math.max(1, Math.floor(slot.capacity)),
          };
        })
        .filter(
          (
            slot
          ): slot is {
            dayOffset: number;
            label: string;
            startDateTime: string;
            endDateTime: string;
            capacity: number;
          } => Boolean(slot)
        );

      if (sessionPayload.length !== sessionSlots.length) {
        setError("Each session must have a valid time range (end time must be after start time).");
        return;
      }

      const configuredCapacity = sessionPayload.reduce((sum, slot) => sum + slot.capacity, 0);
      if (targetResponses > configuredCapacity) {
        setError(
          `Target responses (${targetResponses}) exceed the configured session capacity (${configuredCapacity}).`
        );
        return;
      }
    }

    startTransition(async () => {
      const generatedStudyTitle = buildStudyTitle({
        studyMode,
        marketStudyType,
        sensoryStudyType,
        productName,
      });
      const generatedPurpose = buildStudyPurpose({
        studyMode,
        marketStudyType,
        sensoryStudyType,
        consumerObjective,
        productName,
      });

      const payload = {
        studyMode,
        marketStudyType: studyMode === "MARKET" ? marketStudyType : undefined,
        sensoryStudyType: studyMode === "SENSORY" ? sensoryStudyType : undefined,
        sensoryMethod: studyMode === "SENSORY" ? sensoryMethod : undefined,
        consumerObjective: studyMode === "SENSORY" && sensoryStudyType === "CONSUMER_TEST" ? consumerObjective : undefined,
        studyTitle: generatedStudyTitle,
        purpose: generatedPurpose,
        facilityType,
        numberOfSamples: Math.max(1, sampleSetupCount),
        targetResponses,
        productName: studyMode === "SENSORY" ? productName : undefined,
        categoryCode: studyMode === "SENSORY" ? selectedProfile.categoryCode : undefined,
        categoryLabel: studyMode === "SENSORY" ? selectedProfile.label : undefined,
        attributes: studyMode === "SENSORY" ? attributes : [],
        testingStartDate: studyMode === "SENSORY" ? testingStartDate : undefined,
        testingDurationDays: studyMode === "SENSORY" ? Math.max(1, Math.floor(testingDurationDays)) : undefined,
        sessionSlots: studyMode === "SENSORY" ? sessionPayload : [],
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

              <div className="grid md:grid-cols-2 gap-4">
                <FieldLabel text="Region" />
                <select
                  value={region}
                  onChange={(event) => setRegion(event.target.value as Region | "")}
                  className="app-select"
                  required
                >
                  <option value="">Select Region</option>
                  {REGIONS.map((regionOption) => (
                    <option key={regionOption} value={regionOption}>
                      {regionOption}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <FieldLabel text="Facility Type" />
                <select
                  value={facilityType}
                  onChange={(event) => setFacilityType(event.target.value)}
                  className="app-select"
                  required
                  disabled={!region}
                >
                  <option value="">{region ? "Select Facility" : "Select Region First"}</option>
                  {region && FACILITIES_BY_REGION[region].map((facilityOption) => (
                    <option key={facilityOption} value={facilityOption}>
                      {facilityOption}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <FieldLabel text="Number of Target Responses" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={targetResponses === 0 ? "" : String(targetResponses)}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "");
                      setTargetResponses(digits ? Number(digits) : 0);
                    }}
                    className="app-input"
                    required
                  />
                  {consumerLimit && (
                    <p className="text-xs text-gray-500">Maximum for selected objective: {consumerLimit}</p>
                  )}
                </div>
              </div>
              
              <div className="space-y-4 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-[#0f172a]">Testing Schedule (Date, Time, Session Capacity)</h3>
                  <span className="rounded-full bg-[#edf5ff] px-2.5 py-1 text-xs font-medium text-[#1e4f8f]">
                    Total session capacity: {totalSessionCapacity}
                  </span>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <FieldLabel text="Testing Start Date" />
                    <input
                      type="date"
                      value={testingStartDate}
                      onChange={(event) => setTestingStartDate(event.target.value)}
                      className="app-input"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel text="Testing Duration (Days)" />
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={testingDurationDays}
                      onChange={(event) => setTestingDurationDays(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
                      className="app-input"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel text="Timezone" />
                    <input value={STUDY_TIMEZONE} className="app-input bg-[#f1f5f9]" readOnly />
                  </div>
                </div>

                <div className="space-y-4">
                  {sessionSlotsByDay.map((day) => (
                    <div key={`session-day-${day.dayOffset}`} className="rounded-lg border border-[#dbe3ec] bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#0f172a]">
                          Day {day.dayOffset + 1} ({formatDateLabel(day.date)})
                        </p>
                        <button
                          type="button"
                          onClick={() => addSessionSlot(day.dayOffset)}
                          className="rounded-md border border-[#ed7f2a] px-3 py-1 text-xs font-semibold text-[#c2410c] hover:bg-[#fff6ed]"
                        >
                          Add Session
                        </button>
                      </div>

                      <div className="mt-3 space-y-2">
                        {day.slots.map((slot) => (
                          <div key={slot.id} className="grid gap-2 rounded-md border border-[#e2e8f0] bg-[#f8fafc] p-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
                            <input
                              value={slot.label}
                              onChange={(event) => updateSessionSlot(slot.id, "label", event.target.value)}
                              className="app-input"
                              placeholder="Session label (e.g., Morning)"
                              required
                            />
                            <input
                              type="time"
                              value={slot.startTime}
                              onChange={(event) => updateSessionSlot(slot.id, "startTime", event.target.value)}
                              className="app-input"
                              required
                            />
                            <input
                              type="time"
                              value={slot.endTime}
                              onChange={(event) => updateSessionSlot(slot.id, "endTime", event.target.value)}
                              className="app-input"
                              required
                            />
                            <input
                              type="number"
                              min={1}
                              value={slot.capacity}
                              onChange={(event) => updateSessionSlot(slot.id, "capacity", event.target.value)}
                              className="app-input"
                              required
                            />
                            <button
                              type="button"
                              onClick={() => removeSessionSlot(slot.id)}
                              disabled={day.slots.length <= 1}
                              className="rounded-md border border-[#fecaca] px-3 py-2 text-xs font-semibold text-[#b91c1c] hover:bg-[#fef2f2] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
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
            <div className={`grid gap-4 ${studyMode === "MARKET" ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
              {studyMode === "MARKET" && (
                <div className="space-y-2">
                  <FieldLabel text="Number of Target Responses" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={targetResponses === 0 ? "" : String(targetResponses)}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "");
                      setTargetResponses(digits ? Number(digits) : 0);
                    }}
                    className="app-input"
                    required
                  />
                </div>
              )}
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

function getTodayDateInput() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToDateInput(dateInput: string, dayOffset: number) {
  const base = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(base.getTime())) {
    return dateInput;
  }
  base.setDate(base.getDate() + dayOffset);
  const year = base.getFullYear();
  const month = String(base.getMonth() + 1).padStart(2, "0");
  const day = String(base.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createSessionSlotDraft(dayOffset: number, slotIndex: number): SessionSlotDraft {
  const defaults = [
    { label: "Morning", startTime: "09:00", endTime: "11:30" },
    { label: "Afternoon", startTime: "14:30", endTime: "16:00" },
    { label: "Evening", startTime: "17:30", endTime: "19:00" },
  ];
  const fallback = {
    label: `Session ${slotIndex + 1}`,
    startTime: "09:00",
    endTime: "10:00",
  };
  const template = defaults[slotIndex] ?? fallback;
  return {
    id: createId(),
    dayOffset,
    label: template.label,
    startTime: template.startTime,
    endTime: template.endTime,
    capacity: 10,
  };
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildStudyTitle(input: {
  studyMode: StudyMode;
  marketStudyType: MarketStudyType;
  sensoryStudyType: SensoryStudyType;
  productName: string;
}) {
  if (input.studyMode === "MARKET") {
    return `${humanizeEnum(input.marketStudyType)} Study`;
  }
  const product = input.productName.trim() || "Sensory Product";
  return `${product} - ${humanizeEnum(input.sensoryStudyType)}`;
}

function buildStudyPurpose(input: {
  studyMode: StudyMode;
  marketStudyType: MarketStudyType;
  sensoryStudyType: SensoryStudyType;
  consumerObjective: ConsumerObjective;
  productName: string;
}) {
  if (input.studyMode === "MARKET") {
    return `Market study for ${humanizeEnum(input.marketStudyType)} to guide product and positioning decisions.`;
  }

  const product = input.productName.trim() || "the product";
  if (input.sensoryStudyType === "CONSUMER_TEST") {
    return `Consumer sensory test for ${product} focused on ${humanizeEnum(input.consumerObjective)}.`;
  }
  return `${humanizeEnum(input.sensoryStudyType)} sensory assessment for ${product}.`;
}

function humanizeEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateLabel(dateInput: string) {
  const value = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(value.getTime())) {
    return dateInput;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

