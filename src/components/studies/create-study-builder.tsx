"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStudyFromBuilder } from "@/app/actions/study-builder-actions";
import { createStudyAndImportFromFile } from "@/app/actions/study-import-actions";
import { FACILITIES_BY_REGION, REGIONS, getRegionForFacility } from "@/lib/facility-constants";
import type { Region } from "@/lib/facility-constants";
import {
  getAvailableFics,
  getFacilityAvailabilityOverview,
  getFicCalendar,
  type AvailableFic,
  type FacilityAssignedFic,
  type FicAvailability,
} from "@/lib/services/fic-availability-service";

type StudyMode = "MARKET" | "SENSORY";
type CoordinationMode = "FIC_ASSISTED" | "SELF_MANAGED_PUBLIC";
type MarketStudyType =
  | "PACKAGING_EVALUATION"
  | "PRICE_SENSITIVITY"
  | "PRODUCT_INTENT"
  | "CONSUMER_USAGE_HABIT";
type SensoryStudyType = "DISCRIMINATIVE" | "DESCRIPTIVE" | "CONSUMER_TEST";
type ConsumerObjective =
  | "CHECK_ACCEPTABILITY"
  | "IMPROVE_TASTE"
  | "IMPROVE_TEXTURE"
  | "FINE_TUNE"
  | "FAST_ITERATION";
type AttributeDimension = "Taste" | "Texture" | "Aftertaste" | "Mouthfeel";

interface AttributeRow {
  name: string;
  dimension: AttributeDimension;
  isJarTarget: boolean;
  isCustom: boolean;
  actionable: boolean;
}

interface ProfileAttributeRow {
  name: string;
  dimension: AttributeDimension;
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

interface ImportCreateResult {
  success?: boolean;
  valid?: boolean;
  error?: string;
  rowsRead?: number;
  rowsParsed?: number;
  rowsRejected?: number;
  respondents?: number;
  sampleCount?: number;
  attributeCount?: number;
  sampleLabels?: string[];
  warnings?: Array<{ rowNumber?: number; field?: string; message: string }>;
  errors?: Array<{ rowNumber?: number; field?: string; message: string }>;
  redirectPath?: string;
}

interface CategoryProfile {
  key: string;
  label: string;
  categoryCode: "BEVERAGE" | "SNACK" | "DESSERT" | "FUNCTIONAL_FOOD" | "DAIRY" | "BAKERY";
  attributes: ProfileAttributeRow[];
}

type FicDateStatus = "AVAILABLE" | "UNAVAILABLE" | "LOCKED";

const MARKET_TYPE_OPTIONS: Array<{ value: MarketStudyType; label: string }> = [
  { value: "PACKAGING_EVALUATION", label: "Packaging Evaluation" },
  { value: "PRICE_SENSITIVITY", label: "Price Sensitivity Study" },
  { value: "PRODUCT_INTENT", label: "Product Intent Study" },
  { value: "CONSUMER_USAGE_HABIT", label: "Consumer Usage & Habit Study" },
];

const DISCRIMINATIVE_METHODS = ["Triangle Test", "Duo-trio", "Tetrad", "Multiple Ranking"];
const DESCRIPTIVE_METHODS = ["QDA", "Spectrum Method", "Similarity Measures"];

const CONSUMER_OBJECTIVES: Array<{ value: ConsumerObjective; label: string; max: number; defaultTarget: number }> = [
  { value: "CHECK_ACCEPTABILITY", label: "Check acceptability", max: 110, defaultTarget: 80 },
  { value: "IMPROVE_TASTE", label: "Improve taste", max: 60, defaultTarget: 50 },
  { value: "IMPROVE_TEXTURE", label: "Improve texture", max: 60, defaultTarget: 50 },
  { value: "FINE_TUNE", label: "Fine-tune", max: 60, defaultTarget: 50 },
  { value: "FAST_ITERATION", label: "FAST iteration", max: 35, defaultTarget: 30 },
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
const ATTRIBUTE_DIMENSIONS: AttributeDimension[] = ["Taste", "Texture", "Aftertaste", "Mouthfeel"];

export function CreateStudyBuilder({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [studyMode, setStudyMode] = useState<StudyMode>("SENSORY");
  const [coordinationMode, setCoordinationMode] = useState<CoordinationMode>("FIC_ASSISTED");
  const [marketStudyType, setMarketStudyType] = useState<MarketStudyType>("PACKAGING_EVALUATION");

  const [sensoryStudyType, setSensoryStudyType] = useState<SensoryStudyType>("CONSUMER_TEST");
  const [sensoryMethod, setSensoryMethod] = useState("Triangle Test");
  const [consumerObjective, setConsumerObjective] = useState<ConsumerObjective>("FAST_ITERATION");

  const [region, setRegion] = useState<Region | "">("");
  const [facilityType, setFacilityType] = useState<string>("");
  const [publicVenueName, setPublicVenueName] = useState("");
  const [publicCityMunicipality, setPublicCityMunicipality] = useState("");
  const [publicAddressDetails, setPublicAddressDetails] = useState("");
  const [targetResponses, setTargetResponses] = useState(30);

  const [productName, setProductName] = useState("");
  const [profileKey, setProfileKey] = useState(CATEGORY_PROFILES[0].key);
  const [attributes, setAttributes] = useState<AttributeRow[]>(
    createAttributeRowsFromProfile(CATEGORY_PROFILES[0].attributes)
  );
  const [customAttributeName, setCustomAttributeName] = useState("");
  const [customAttributeType, setCustomAttributeType] = useState<AttributeDimension>("Taste");
  const [customAttributeActionable, setCustomAttributeActionable] = useState(false);
  const [testingStartDate, setTestingStartDate] = useState(() => getTodayDateInput());
  const [testingDurationDays, setTestingDurationDays] = useState(1);
  const [sessionSlots, setSessionSlots] = useState<SessionSlotDraft[]>([
    createSessionSlotDraft(0, 0),
  ]);

  const [sampleSetupCount, setSampleSetupCount] = useState(1);
  const [sampleSetups, setSampleSetups] = useState<SampleSetupRow[]>([{ ...EMPTY_SAMPLE_SETUP }]);
  const [marketQuestions, setMarketQuestions] = useState(DEFAULT_MARKET_QUESTIONS);
  const [error, setError] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportCreateResult | null>(null);
  const [assignedFicUsers, setAssignedFicUsers] = useState<FacilityAssignedFic[]>([]);
  const [ficOptions, setFicOptions] = useState<AvailableFic[]>([]);
  const [selectedFicUserId, setSelectedFicUserId] = useState("");
  const [ficCalendarRows, setFicCalendarRows] = useState<FicAvailability[]>([]);
  const [facilityAvailabilityByDate, setFacilityAvailabilityByDate] = useState<Map<string, number>>(new Map());
  const [facilityOverviewLoading, setFacilityOverviewLoading] = useState(false);
  const [facilityOverviewError, setFacilityOverviewError] = useState<string | null>(null);
  const [ficOptionsLoading, setFicOptionsLoading] = useState(false);
  const [ficCalendarLoading, setFicCalendarLoading] = useState(false);
  const [ficError, setFicError] = useState<string | null>(null);
  const [facilityCalendarYear, setFacilityCalendarYear] = useState(() => new Date().getFullYear());
  const [facilityCalendarMonth, setFacilityCalendarMonth] = useState(() => new Date().getMonth());

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

  useEffect(() => {
    if (coordinationMode === "SELF_MANAGED_PUBLIC") {
      setRegion("");
      setFacilityType("");
      setSelectedFicUserId("");
      setAssignedFicUsers([]);
      setFicOptions([]);
      setFicCalendarRows([]);
      setFicError(null);
      setFacilityOverviewError(null);
      setFacilityAvailabilityByDate(new Map());
      return;
    }

    setPublicVenueName("");
    setPublicCityMunicipality("");
    setPublicAddressDetails("");
  }, [coordinationMode]);

  const requiresFicBooking = useMemo(
    () => studyMode === "SENSORY" && coordinationMode === "FIC_ASSISTED",
    [coordinationMode, studyMode]
  );
  const scheduleDateRange = useMemo(() => {
    if (!testingStartDate) {
      return null;
    }
    const duration = Math.max(1, Math.floor(testingDurationDays));
    return {
      startDate: testingStartDate,
      endDate: addDaysToDateInput(testingStartDate, duration - 1),
      duration,
    };
  }, [testingDurationDays, testingStartDate]);
  const facilityCalendarRange = useMemo(() => {
    const start = new Date(facilityCalendarYear, facilityCalendarMonth, 1);
    const end = new Date(facilityCalendarYear, facilityCalendarMonth + 1, 0);
    return {
      startDate: formatDateInputFromDate(start),
      endDate: formatDateInputFromDate(end),
    };
  }, [facilityCalendarMonth, facilityCalendarYear]);

  useEffect(() => {
    const parsed = parseDateInput(testingStartDate);
    if (!parsed) {
      return;
    }
    setFacilityCalendarYear(parsed.getFullYear());
    setFacilityCalendarMonth(parsed.getMonth());
  }, [testingStartDate]);

  useEffect(() => {
    if (!requiresFicBooking || !region || !facilityType) {
      setAssignedFicUsers([]);
      setFacilityAvailabilityByDate(new Map());
      setFacilityOverviewError(null);
      setFacilityOverviewLoading(false);
      return;
    }

    let cancelled = false;
    setFacilityOverviewLoading(true);
    setFacilityOverviewError(null);
    setAssignedFicUsers([]);
    setFacilityAvailabilityByDate(new Map());

    void getFacilityAvailabilityOverview(
      facilityCalendarRange.startDate,
      facilityCalendarRange.endDate,
      region,
      facilityType
    )
      .then((overview) => {
        if (cancelled) {
          return;
        }
        if (!overview) {
          setAssignedFicUsers([]);
          setFacilityAvailabilityByDate(new Map());
          setFacilityOverviewError("Failed to load facility availability.");
          return;
        }

        setAssignedFicUsers(overview.assignedFics);
        setFacilityAvailabilityByDate(
          new Map(overview.availabilityByDate.map((row) => [row.date, row.availableFicCount]))
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setAssignedFicUsers([]);
        setFacilityAvailabilityByDate(new Map());
        setFacilityOverviewError("Failed to load facility availability.");
      })
      .finally(() => {
        if (!cancelled) {
          setFacilityOverviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [facilityCalendarRange.endDate, facilityCalendarRange.startDate, facilityType, region, requiresFicBooking]);

  useEffect(() => {
    if (!requiresFicBooking || !scheduleDateRange || !region || !facilityType) {
      setFicOptions([]);
      setFicCalendarRows([]);
      setFicError(null);
      return;
    }

    let cancelled = false;
    setFicOptionsLoading(true);
    setFicError(null);
    setFicOptions([]);

    void getAvailableFics(scheduleDateRange.startDate, scheduleDateRange.endDate, region, facilityType)
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setFicOptions(rows);
        if (rows.length === 0) {
          setFicError("No assigned FIC user has availability in the selected testing window.");
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setFicOptions([]);
        setFicError("Failed to load FIC availability options.");
      })
      .finally(() => {
        if (!cancelled) {
          setFicOptionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [facilityType, region, requiresFicBooking, scheduleDateRange]);

  useEffect(() => {
    if (!requiresFicBooking) {
      setSelectedFicUserId("");
      return;
    }

    setSelectedFicUserId((previous) => {
      if (previous && assignedFicUsers.some((fic) => fic.id === previous)) {
        return previous;
      }
      if (ficOptions.length > 0) {
        return ficOptions[0].id;
      }
      return assignedFicUsers[0]?.id ?? "";
    });
  }, [assignedFicUsers, ficOptions, requiresFicBooking]);

  useEffect(() => {
    if (!requiresFicBooking || !scheduleDateRange || !selectedFicUserId) {
      setFicCalendarRows([]);
      return;
    }

    let cancelled = false;
    setFicCalendarLoading(true);

    void getFicCalendar(selectedFicUserId, scheduleDateRange.startDate, scheduleDateRange.endDate)
      .then((rows) => {
        if (!cancelled) {
          setFicCalendarRows(rows);
          setFicError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFicCalendarRows([]);
          setFicError("Failed to load selected FIC calendar data.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFicCalendarLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [requiresFicBooking, scheduleDateRange, selectedFicUserId]);

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

  const ficCalendarByDate = useMemo(() => {
    return ficCalendarRows.reduce<Map<string, FicAvailability>>((accumulator, row) => {
      accumulator.set(row.date, row);
      return accumulator;
    }, new Map());
  }, [ficCalendarRows]);
  const getFicDateStatus = (dateKey: string): FicDateStatus => {
    if (!requiresFicBooking) {
      return "AVAILABLE";
    }
    const row = ficCalendarByDate.get(dateKey);
    if (row?.isLocked) {
      return "LOCKED";
    }
    if (row?.isAvailable) {
      return "AVAILABLE";
    }
    return "UNAVAILABLE";
  };
  const blockedScheduleDates = useMemo(() => {
    return sessionSlotsByDay
      .map((day) => day.date)
      .filter((dateKey) => {
        if (!requiresFicBooking) {
          return false;
        }
        const row = ficCalendarByDate.get(dateKey);
        return !row || row.isLocked || !row.isAvailable;
      });
  }, [sessionSlotsByDay, requiresFicBooking, ficCalendarByDate]);
  const rangeAvailabilityByFicId = useMemo(
    () => new Map(ficOptions.map((row) => [row.id, row])),
    [ficOptions]
  );
  const assignedFicById = useMemo(
    () => new Map(assignedFicUsers.map((row) => [row.id, row])),
    [assignedFicUsers]
  );
  const selectedFic = useMemo(
    () => assignedFicById.get(selectedFicUserId) ?? rangeAvailabilityByFicId.get(selectedFicUserId) ?? null,
    [assignedFicById, rangeAvailabilityByFicId, selectedFicUserId]
  );
  const todayDateKey = useMemo(() => getTodayDateInput(), []);
  const facilityCalendarDays = useMemo(() => {
    const firstDay = new Date(facilityCalendarYear, facilityCalendarMonth, 1);
    const lastDay = new Date(facilityCalendarYear, facilityCalendarMonth + 1, 0);
    const days: Array<{
      date: string;
      dayOfMonth: number;
      availableFicCount: number;
      isCurrentMonth: boolean;
    }> = [];

    for (let padding = firstDay.getDay() - 1; padding >= 0; padding -= 1) {
      const date = new Date(facilityCalendarYear, facilityCalendarMonth, -padding);
      const dateKey = formatDateInputFromDate(date);
      days.push({
        date: dateKey,
        dayOfMonth: date.getDate(),
        availableFicCount: facilityAvailabilityByDate.get(dateKey) ?? 0,
        isCurrentMonth: false,
      });
    }

    for (let day = 1; day <= lastDay.getDate(); day += 1) {
      const date = new Date(facilityCalendarYear, facilityCalendarMonth, day);
      const dateKey = formatDateInputFromDate(date);
      days.push({
        date: dateKey,
        dayOfMonth: day,
        availableFicCount: facilityAvailabilityByDate.get(dateKey) ?? 0,
        isCurrentMonth: true,
      });
    }

    while (days.length % 7 !== 0) {
      const day = days.length - firstDay.getDay() - lastDay.getDate() + 1;
      const date = new Date(facilityCalendarYear, facilityCalendarMonth + 1, day);
      const dateKey = formatDateInputFromDate(date);
      days.push({
        date: dateKey,
        dayOfMonth: date.getDate(),
        availableFicCount: facilityAvailabilityByDate.get(dateKey) ?? 0,
        isCurrentMonth: false,
      });
    }

    return days;
  }, [facilityAvailabilityByDate, facilityCalendarMonth, facilityCalendarYear]);
  const selectedStartDateFacilityAvailability = useMemo(
    () => facilityAvailabilityByDate.get(testingStartDate) ?? 0,
    [facilityAvailabilityByDate, testingStartDate]
  );

  useEffect(() => {
    setAttributes(createAttributeRowsFromProfile(selectedProfile.attributes));
    setCustomAttributeName("");
    setCustomAttributeType("Taste");
    setCustomAttributeActionable(false);
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

  useEffect(() => {
    if (studyMode !== "SENSORY" || sensoryStudyType !== "CONSUMER_TEST") {
      return;
    }
    setAttributes((previous) => applyObjectiveJarDefaults(previous, consumerObjective));
  }, [consumerObjective, sensoryStudyType, studyMode]);

  const updateAttributeName = (index: number, value: string) => {
    setAttributes((previous) =>
      previous.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return { ...row, name: value };
      })
    );
  };

  const updateAttributeDimension = (index: number, value: AttributeDimension) => {
    setAttributes((previous) =>
      previous.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return { ...row, dimension: value };
      })
    );
  };

  const toggleJarTarget = (index: number) => {
    setAttributes((previous) => {
      const current = previous[index];
      if (!current) return previous;

      const selectedCount = previous.filter((row) => row.isJarTarget).length;
      if (!current.isJarTarget && selectedCount >= 3) {
        setError("Only the TOP 3 attributes can be selected for JAR.");
        return previous;
      }

      setError(null);
      return previous.map((row, rowIndex) =>
        rowIndex === index ? { ...row, isJarTarget: !row.isJarTarget } : row
      );
    });
  };

  const removeAttribute = (index: number) => {
    setAttributes((previous) => {
      if (previous.length <= 1) {
        return previous;
      }
      return previous.filter((_, rowIndex) => rowIndex !== index);
    });
  };

  const addCustomAttribute = () => {
    const trimmed = customAttributeName.trim();
    if (!trimmed) {
      setError("Custom attribute name is required.");
      return;
    }
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length > 2) {
      setError("Custom attribute name must be at most 2 words.");
      return;
    }
    if (!customAttributeActionable) {
      setError("Confirm that the custom attribute is actionable.");
      return;
    }

    setAttributes((previous) => {
      if (previous.some((row) => row.isCustom)) {
        setError("Only one custom attribute can be added per test.");
        return previous;
      }
      if (previous.length >= 5) {
        setError("Maximum of 5 attributes reached. Remove one before adding a custom attribute.");
        return previous;
      }
      if (previous.some((row) => row.name.trim().toLowerCase() === trimmed.toLowerCase())) {
        setError("Attribute already exists in the list.");
        return previous;
      }

      setError(null);
      return [
        ...previous,
        {
          name: trimmed,
          dimension: customAttributeType,
          isJarTarget: false,
          isCustom: true,
          actionable: true,
        },
      ];
    });

    setCustomAttributeName("");
    setCustomAttributeType("Taste");
    setCustomAttributeActionable(false);
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
    if (requiresFicBooking) {
      const targetDate = addDaysToDateInput(testingStartDate, dayOffset);
      if (getFicDateStatus(targetDate) !== "AVAILABLE") {
        setError("Cannot add a session on a date that is unavailable in the selected FIC calendar.");
        return;
      }
    }

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

    if (coordinationMode === "FIC_ASSISTED") {
      if (!region) {
        setError("Please select a region.");
        return;
      }
      if (!facilityType) {
        setError("Please select a facility type.");
        return;
      }
      if (requiresFicBooking && !selectedFicUserId) {
        setError("Select a FIC assignee before setting a final schedule.");
        return;
      }
    } else {
      if (!publicVenueName.trim()) {
        setError("Please enter a public venue name.");
        return;
      }
      if (!publicCityMunicipality.trim()) {
        setError("Please enter city/municipality for the public venue.");
        return;
      }
    }

    if (!Number.isInteger(targetResponses) || targetResponses < 1) {
      setError("Target responses must be at least 1.");
      return;
    }

    if (studyMode === "SENSORY" && targetResponses < 10) {
      setError("Sensory studies require at least 10 target responses.");
      return;
    }

    if (studyMode === "SENSORY" && targetResponses > 200) {
      setError("Sensory studies support up to 200 target responses.");
      return;
    }

    if (studyMode === "SENSORY" && sensoryStudyType === "CONSUMER_TEST" && consumerLimit && targetResponses > consumerLimit) {
      setError(`Target responses exceed the ${consumerLimit} maximum for this consumer test objective.`);
      return;
    }

    if (studyMode === "SENSORY" && sensoryStudyType === "CONSUMER_TEST") {
      const planValidation = validateObjectiveSelection(attributes, consumerObjective);
      if (!planValidation.valid) {
        setError(planValidation.error);
        return;
      }
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

      if (requiresFicBooking) {
        const bookingDates = Array.from(
          new Set(
            sessionPayload.map((slot) => addDaysToDateInput(testingStartDate, slot.dayOffset))
          )
        ).sort((left, right) => left.localeCompare(right));

        const blockedDates = bookingDates.filter((dateKey) => getFicDateStatus(dateKey) !== "AVAILABLE");
        if (blockedDates.length > 0) {
          setError(
            `Selected FIC is unavailable for these date(s): ${blockedDates.slice(0, 6).join(", ")}${blockedDates.length > 6 ? ` (+${blockedDates.length - 6} more)` : ""}.`
          );
          return;
        }
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
        coordinationMode,
        marketStudyType: studyMode === "MARKET" ? marketStudyType : undefined,
        sensoryStudyType: studyMode === "SENSORY" ? sensoryStudyType : undefined,
        sensoryMethod: studyMode === "SENSORY" ? sensoryMethod : undefined,
        consumerObjective: studyMode === "SENSORY" && sensoryStudyType === "CONSUMER_TEST" ? consumerObjective : undefined,
        studyTitle: generatedStudyTitle,
        purpose: generatedPurpose,
        region: coordinationMode === "FIC_ASSISTED" ? region : undefined,
        facilityType: coordinationMode === "FIC_ASSISTED" ? facilityType : undefined,
        publicVenueName: coordinationMode === "SELF_MANAGED_PUBLIC" ? publicVenueName.trim() : undefined,
        publicCityMunicipality: coordinationMode === "SELF_MANAGED_PUBLIC" ? publicCityMunicipality.trim() : undefined,
        publicAddressDetails: coordinationMode === "SELF_MANAGED_PUBLIC" ? publicAddressDetails.trim() : undefined,
        ficUserId: studyMode === "SENSORY" && requiresFicBooking ? selectedFicUserId : undefined,
        numberOfSamples: Math.max(1, sampleSetupCount),
        targetResponses,
        productName: studyMode === "SENSORY" ? productName : undefined,
        categoryCode: studyMode === "SENSORY" ? selectedProfile.categoryCode : undefined,
        categoryLabel: studyMode === "SENSORY" ? selectedProfile.label : undefined,
        attributes:
          studyMode === "SENSORY"
            ? attributes.map((attribute) => ({
                name: attribute.name.trim(),
                dimension: attribute.dimension,
                isJarTarget: attribute.isJarTarget,
                isCustom: attribute.isCustom,
                actionable: attribute.isCustom ? attribute.actionable : true,
              })).filter((attribute) => attribute.name.length > 0)
            : [],
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

  const onCreateFromImportFile = () => {
    setError(null);
    if (!importFile) {
      setImportResult({ success: false, error: "Choose an Excel/CSV file first." });
      return;
    }

    // Validate file extension
    const validExtensions = [".xlsx", ".xls", ".csv"];
    const fileName = importFile.name.toLowerCase();
    const isValidExtension = validExtensions.some(ext => fileName.endsWith(ext));
    
    if (!isValidExtension) {
      setImportResult({ 
        success: false, 
        error: "Invalid file type. Please upload an Excel (.xlsx, .xls) or CSV (.csv) file." 
      });
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", importFile);
      const result = await createStudyAndImportFromFile(formData);
      const actionResult = result as ImportCreateResult;
      setImportResult(actionResult);

      if (actionResult.success && actionResult.valid && actionResult.redirectPath) {
        router.push(actionResult.redirectPath);
      }
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

        <section className="space-y-3 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-4">
          <h2 className="text-lg font-semibold text-[#1e3a8a]">Import Existing Sensory Dataset</h2>
          <p className="text-sm text-[#334155]">
            Upload a completed sensory Excel/CSV file and TARAsense will auto-create the study, import respondents,
            compute analysis, and mark the study as completed.
          </p>
          <p className="text-xs text-[#475569]">
            Required columns: Respondent_ID, Sample, Overall_Liking, Attribute, JAR_Score
          </p>
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={(event) => {
                setImportFile(event.target.files?.[0] ?? null);
                setImportResult(null);
              }}
              className="block w-full rounded-md border border-[#93c5fd] bg-white px-3 py-2 text-sm text-[#334155] file:mr-3 file:rounded file:border-0 file:bg-[#2563eb] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
            <button
              type="button"
              onClick={onCreateFromImportFile}
              disabled={isPending}
              className="rounded-md border border-[#1d4ed8] bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Processing..." : "Create Study + Import + Analyze"}
            </button>
          </div>

          {importResult?.error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{importResult.error}</p>
          )}

          {importResult && !importResult.error && (
            <div className="space-y-2 rounded-md border border-[#dbeafe] bg-white px-3 py-2 text-xs text-[#334155]">
              <p className="font-medium text-[#0f172a]">
                Import Preview: {importResult.valid ? "Ready/Completed" : "Validation issues found"}
              </p>
              <p>
                Rows read: {importResult.rowsRead ?? 0} | Parsed: {importResult.rowsParsed ?? 0} | Rejected: {importResult.rowsRejected ?? 0}
              </p>
              <p>
                Respondents: {importResult.respondents ?? 0} | Samples: {importResult.sampleCount ?? 0} | Attributes: {importResult.attributeCount ?? 0}
              </p>
              {importResult.sampleLabels && importResult.sampleLabels.length > 0 && (
                <p>Sample labels: {importResult.sampleLabels.join(", ")}</p>
              )}
              {importResult.warnings && importResult.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  {importResult.warnings.slice(0, 6).map((warning, index) => (
                    <p key={`create-import-warning-${index}`}>{formatImportIssue(warning)}</p>
                  ))}
                  {importResult.warnings.length > 6 && <p>...and {importResult.warnings.length - 6} more warning(s).</p>}
                </div>
              )}
              {importResult.errors && importResult.errors.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                  {importResult.errors.slice(0, 8).map((issue, index) => (
                    <p key={`create-import-error-${index}`}>{formatImportIssue(issue)}</p>
                  ))}
                  {importResult.errors.length > 8 && <p>...and {importResult.errors.length - 8} more error(s).</p>}
                </div>
              )}
            </div>
          )}
        </section>

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

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Study Coordination</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <label className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] bg-white px-4 py-3">
                <input
                  type="radio"
                  checked={coordinationMode === "FIC_ASSISTED"}
                  onChange={() => setCoordinationMode("FIC_ASSISTED")}
                />
                <span>Coordinate with FIC</span>
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] bg-white px-4 py-3">
                <input
                  type="radio"
                  checked={coordinationMode === "SELF_MANAGED_PUBLIC"}
                  onChange={() => setCoordinationMode("SELF_MANAGED_PUBLIC")}
                />
                <span>Self-managed Public Recruitment</span>
              </label>
            </div>

            {coordinationMode === "FIC_ASSISTED" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
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
                <div className="space-y-1">
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
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <FieldLabel text="Public Venue Name" />
                  <input
                    value={publicVenueName}
                    onChange={(event) => setPublicVenueName(event.target.value)}
                    className="app-input"
                    placeholder="e.g., City Mall Atrium"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel text="City / Municipality" />
                  <input
                    value={publicCityMunicipality}
                    onChange={(event) => setPublicCityMunicipality(event.target.value)}
                    className="app-input"
                    placeholder="e.g., Butuan City"
                    required
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <FieldLabel text="Address Details (Optional)" />
                  <input
                    value={publicAddressDetails}
                    onChange={(event) => setPublicAddressDetails(event.target.value)}
                    className="app-input"
                    placeholder="e.g., near entrance gate 2"
                  />
                </div>
              </div>
            )}
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
                <div className="rounded-lg border border-[#dbe3ec] bg-[#f8fafc] p-3">
                  <p className="text-sm font-semibold text-[#0f172a]">Choose what to test</p>
                  <p className="mt-1 text-xs text-[#64748b]">
                    Select up to 3 attributes that you most want to improve in this test.
                    Testing too many attributes at once can make results unclear.
                  </p>
                  <p className="mt-2 text-xs text-[#64748b]">
                    What is JAR (Just-About-Right)? JAR helps you see whether an attribute is too low, too high, or just right for most consumers.
                  </p>
                  <p className="mt-1 text-xs text-[#64748b]">
                    Why can I only select 3? Limiting attributes helps ensure participants give reliable feedback and makes it easier to identify what truly affects liking.
                  </p>
                </div>
                <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="bg-[#f8fafc]">
                      <tr>
                        <th className="px-4 py-2 text-left">Attribute</th>
                        <th className="px-4 py-2 text-left">Type</th>
                        <th className="px-4 py-2 text-left">Top 3 JAR</th>
                        <th className="px-4 py-2 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attributes.map((attribute, index) => {
                        return (
                          <tr key={`${attribute.name}-${index}`} className="border-t">
                            <td className="px-4 py-2">
                              <input
                                value={attribute.name}
                                onChange={(event) => updateAttributeName(index, event.target.value)}
                                className="app-input bg-white"
                              />
                              {attribute.isCustom && (
                                <p className="mt-1 text-[11px] font-medium text-[#c2410c]">Custom attribute added</p>
                              )}
                            </td>
                            <td className="px-4 py-2 text-gray-700">
                              <select
                                value={attribute.dimension}
                                onChange={(event) => updateAttributeDimension(index, event.target.value as AttributeDimension)}
                                className="app-select"
                              >
                                {ATTRIBUTE_DIMENSIONS.map((dimension) => (
                                  <option key={`${attribute.name}-${dimension}`} value={dimension}>
                                    {dimension}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2 text-gray-700">
                              <label className="inline-flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={attribute.isJarTarget}
                                  onChange={() => toggleJarTarget(index)}
                                />
                                <span className="text-xs">Optimize</span>
                              </label>
                            </td>
                            <td className="px-4 py-2 text-gray-700">
                              <button
                                type="button"
                                onClick={() => removeAttribute(index)}
                                disabled={attributes.length <= 1}
                                className="rounded-md border border-[#fecaca] px-2.5 py-1 text-xs font-semibold text-[#b91c1c] hover:bg-[#fef2f2] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-[#64748b]">
                  Selected for JAR: {attributes.filter((attribute) => attribute.isJarTarget).length}/3
                </p>
                <div className="rounded-lg border border-[#e2e8f0] bg-white p-3">
                  <p className="text-sm font-semibold text-[#0f172a]">Add custom attribute (max 1)</p>
                  <p className="mt-1 text-xs text-[#64748b]">
                    Make sure this is something you can realistically adjust in your formulation.
                  </p>
                  <div className="mt-3 grid gap-2 md:grid-cols-[1.2fr_1fr]">
                    <input
                      value={customAttributeName}
                      onChange={(event) => setCustomAttributeName(event.target.value)}
                      placeholder="Attribute name (max 2 words)"
                      className="app-input"
                    />
                    <select
                      value={customAttributeType}
                      onChange={(event) => setCustomAttributeType(event.target.value as AttributeDimension)}
                      className="app-select"
                    >
                      {ATTRIBUTE_DIMENSIONS.map((dimension) => (
                        <option key={`custom-${dimension}`} value={dimension}>
                          {dimension}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="mt-3 inline-flex items-center gap-2 text-xs text-[#334155]">
                    <input
                      type="checkbox"
                      checked={customAttributeActionable}
                      onChange={(event) => setCustomAttributeActionable(event.target.checked)}
                    />
                    This attribute is actionable and can be adjusted in formulation.
                  </label>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={addCustomAttribute}
                      className="rounded-md border border-[#ed7f2a] px-3 py-1 text-xs font-semibold text-[#c2410c] hover:bg-[#fff6ed]"
                    >
                      Add Custom Attribute
                    </button>
                  </div>
                </div>
              </div>

              {requiresFicBooking && (
                <div className="space-y-3 rounded-xl border border-[#c7d2fe] bg-[#eef2ff] p-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <FieldLabel text="Assigned FIC User" />
                      <select
                        value={selectedFicUserId}
                        onChange={(event) => setSelectedFicUserId(event.target.value)}
                        className="app-select"
                        required
                        disabled={facilityOverviewLoading || assignedFicUsers.length === 0}
                      >
                        <option value="">
                          {facilityOverviewLoading ? "Loading assigned FIC users..." : "Select FIC assignee"}
                        </option>
                        {assignedFicUsers.map((fic) => {
                          const rangeAvailability = rangeAvailabilityByFicId.get(fic.id);
                          const rangeAvailableCount = rangeAvailability?.availableDates.length ?? 0;
                          const rangeWindowDays = scheduleDateRange?.duration ?? 0;
                          const availabilityLabel =
                            rangeWindowDays > 0
                              ? `${rangeAvailableCount}/${rangeWindowDays} day(s) available in selected window`
                              : `${fic.availableDateCount} day(s) available this month`;

                          return (
                            <option key={fic.id} value={fic.id}>
                              {fic.name} ({availabilityLabel})
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div className="rounded-lg border border-[#dbeafe] bg-white p-3 text-xs text-[#1e3a8a]">
                      <p className="font-semibold">FIC Calendar Rules</p>
                      <p className="mt-1">Select Region + Facility first, then choose one assigned FIC user.</p>
                      <p className="mt-1">MSME can schedule sessions only on dates marked Available by selected FIC.</p>
                      <p className="mt-1">Locked dates are already booked by other studies.</p>
                    </div>
                  </div>

                  {(facilityOverviewError || ficError || ficCalendarLoading || ficOptionsLoading) && (
                    <p className="text-xs font-medium text-[#b45309]">
                      {facilityOverviewError
                        ? facilityOverviewError
                        : ficCalendarLoading
                          ? "Loading selected FIC calendar..."
                          : ficOptionsLoading
                            ? "Checking selected testing window against assigned FIC calendars..."
                            : ficError}
                    </p>
                  )}
                  {!facilityOverviewLoading && !facilityOverviewError && assignedFicUsers.length === 0 && (
                    <p className="text-xs font-medium text-[#b45309]">
                      No FIC user is currently assigned to this facility. Ask admin to assign at least one FIC user first.
                    </p>
                  )}

                  {assignedFicUsers.length > 0 && (
                    <div className="rounded-lg border border-[#dbeafe] bg-white p-3">
                      <p className="text-xs font-semibold text-[#1e3a8a]">
                        Assigned FIC users for {facilityType} ({region})
                      </p>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        {assignedFicUsers.map((fic) => {
                          const rangeAvailability = rangeAvailabilityByFicId.get(fic.id);
                          const rangeAvailableCount = rangeAvailability?.availableDates.length ?? 0;
                          const isActive = fic.id === selectedFicUserId;
                          return (
                            <button
                              key={`assigned-fic-card-${fic.id}`}
                              type="button"
                              onClick={() => setSelectedFicUserId(fic.id)}
                              className={`rounded-lg border p-2 text-left text-xs transition-colors ${
                                isActive
                                  ? "border-[#60a5fa] bg-[#eff6ff] text-[#1e3a8a]"
                                  : "border-[#dbeafe] bg-[#f8fbff] text-[#1f2937] hover:border-[#93c5fd]"
                              }`}
                            >
                              <p className="font-semibold">{fic.name}</p>
                              <p className="mt-0.5 text-[11px] text-[#64748b]">{fic.email}</p>
                              <p className="mt-1">
                                Window availability: {rangeAvailableCount}/{scheduleDateRange?.duration ?? 0} day(s)
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {selectedFic && scheduleDateRange && (
                    <div className="rounded-lg border border-[#dbeafe] bg-white p-3">
                      <p className="text-xs font-semibold text-[#1e3a8a]">
                        Availability for {selectedFic.name} ({scheduleDateRange.startDate} to {scheduleDateRange.endDate})
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {sessionSlotsByDay.map((day) => {
                          const status = getFicDateStatus(day.date);
                          const style =
                            status === "AVAILABLE"
                              ? "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]"
                              : status === "LOCKED"
                                ? "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]"
                                : "border-[#fde68a] bg-[#fffbeb] text-[#92400e]";

                          return (
                            <span
                              key={`fic-availability-${day.date}`}
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${style}`}
                            >
                              {day.date}: {status === "AVAILABLE" ? "Available" : status === "LOCKED" ? "Locked" : "Unavailable"}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

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
                {requiresFicBooking && blockedScheduleDates.length > 0 && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    Selected FIC cannot host sessions on: {blockedScheduleDates.join(", ")}. Update dates or choose another FIC.
                  </p>
                )}

                <div className="grid md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <FieldLabel text="Testing Start Date" />
                    <input
                      type="date"
                      value={testingStartDate}
                      onChange={(event) => setTestingStartDate(event.target.value)}
                      className="app-input"
                      min={todayDateKey}
                      required
                    />
                    {requiresFicBooking && selectedStartDateFacilityAvailability === 0 && (
                      <p className="text-[11px] text-amber-700">
                        No assigned FIC is available on this start date. Pick an available date from the facility calendar below.
                      </p>
                    )}
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

                {requiresFicBooking && (
                  <div className="rounded-lg border border-[#dbeafe] bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[#1e3a8a]">
                        Facility Availability Calendar ({facilityType})
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const month = facilityCalendarMonth === 0 ? 11 : facilityCalendarMonth - 1;
                            const year = facilityCalendarMonth === 0 ? facilityCalendarYear - 1 : facilityCalendarYear;
                            setFacilityCalendarYear(year);
                            setFacilityCalendarMonth(month);
                          }}
                          className="rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-2 py-1 text-xs font-medium text-[#1d4ed8] hover:bg-[#dbeafe]"
                        >
                          Prev
                        </button>
                        <span className="text-xs font-medium text-[#1e3a8a]">
                          {new Date(facilityCalendarYear, facilityCalendarMonth, 1).toLocaleString("en-US", {
                            month: "long",
                            year: "numeric",
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const month = facilityCalendarMonth === 11 ? 0 : facilityCalendarMonth + 1;
                            const year = facilityCalendarMonth === 11 ? facilityCalendarYear + 1 : facilityCalendarYear;
                            setFacilityCalendarYear(year);
                            setFacilityCalendarMonth(month);
                          }}
                          className="rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-2 py-1 text-xs font-medium text-[#1d4ed8] hover:bg-[#dbeafe]"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-[#475569]">
                      Click a date with available capacity to set your testing start date. Indicator shows how many assigned FIC users can host that date.
                    </p>

                    <div className="mt-3 grid grid-cols-7 gap-1">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
                        <div key={`facility-calendar-header-${label}`} className="py-1 text-center text-[11px] font-semibold text-[#64748b]">
                          {label}
                        </div>
                      ))}
                      {facilityCalendarDays.map((day) => {
                        const isPast = day.date < todayDateKey;
                        const isSelected = day.date === testingStartDate;
                        const disabled = !day.isCurrentMonth || isPast || day.availableFicCount === 0;
                        const baseClasses = "flex aspect-square flex-col items-center justify-center rounded-md border text-[11px] transition-colors";
                        const statusClasses = disabled
                          ? "border-[#e2e8f0] bg-[#f8fafc] text-[#94a3b8]"
                          : "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534] hover:bg-[#dcfce7]";

                        return (
                          <button
                            key={`facility-calendar-day-${day.date}`}
                            type="button"
                            disabled={disabled}
                            onClick={() => setTestingStartDate(day.date)}
                            className={`${baseClasses} ${statusClasses} ${isSelected ? "ring-2 ring-[#2563eb]" : ""}`}
                          >
                            <span className="font-semibold">{day.dayOfMonth}</span>
                            <span>{day.availableFicCount > 0 ? `${day.availableFicCount} FIC` : "-"}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[#475569]">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-3 w-3 rounded-sm border border-[#bbf7d0] bg-[#f0fdf4]" />
                        Available facility date
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-3 w-3 rounded-sm border border-[#e2e8f0] bg-[#f8fafc]" />
                        No available FIC / not selectable
                      </span>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  {sessionSlotsByDay.map((day) => {
                    const dayStatus = getFicDateStatus(day.date);
                    const dayBlocked = requiresFicBooking && dayStatus !== "AVAILABLE";

                    return (
                      <div key={`session-day-${day.dayOffset}`} className="rounded-lg border border-[#dbe3ec] bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#0f172a]">
                          Day {day.dayOffset + 1} ({formatDateLabel(day.date)})
                        </p>
                        {requiresFicBooking && (
                          <span
                            className={
                              dayStatus === "AVAILABLE"
                                ? "rounded-full bg-[#dcfce7] px-2.5 py-1 text-[11px] font-medium text-[#166534]"
                                : dayStatus === "LOCKED"
                                  ? "rounded-full bg-[#fee2e2] px-2.5 py-1 text-[11px] font-medium text-[#991b1b]"
                                  : "rounded-full bg-[#fef3c7] px-2.5 py-1 text-[11px] font-medium text-[#92400e]"
                            }
                          >
                            {dayStatus === "AVAILABLE" ? "FIC Available" : dayStatus === "LOCKED" ? "FIC Locked" : "FIC Unavailable"}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => addSessionSlot(day.dayOffset)}
                          disabled={dayBlocked}
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
                              disabled={dayBlocked}
                              required
                            />
                            <input
                              type="time"
                              value={slot.startTime}
                              onChange={(event) => updateSessionSlot(slot.id, "startTime", event.target.value)}
                              className="app-input"
                              disabled={dayBlocked}
                              required
                            />
                            <input
                              type="time"
                              value={slot.endTime}
                              onChange={(event) => updateSessionSlot(slot.id, "endTime", event.target.value)}
                              className="app-input"
                              disabled={dayBlocked}
                              required
                            />
                            <input
                              type="number"
                              min={1}
                              value={slot.capacity}
                              onChange={(event) => updateSessionSlot(slot.id, "capacity", event.target.value)}
                              className="app-input"
                              disabled={dayBlocked}
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
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm text-[#334155]">
                Questionnaire Logic generated on create:
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Overall Acceptability (9-point hedonic scale, mandatory)</li>
                  <li>JAR only for selected TOP attributes (max 3)</li>
                  <li>5-point standardized JAR scale: Much too low → Much too high</li>
                  <li>Reporting collapses to Too Low (1-2), JAR (3), Too High (4-5)</li>
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

function createAttributeRowsFromProfile(profileAttributes: ProfileAttributeRow[]) {
  return profileAttributes.slice(0, 5).map((attribute, index) => ({
    name: attribute.name,
    dimension: attribute.dimension,
    isJarTarget: index < 2,
    isCustom: false,
    actionable: true,
  }));
}

function applyObjectiveJarDefaults(attributes: AttributeRow[], objective: ConsumerObjective) {
  const next = attributes.map((attribute) => ({ ...attribute, isJarTarget: false }));
  if (objective === "CHECK_ACCEPTABILITY") {
    return next;
  }

  if (objective === "IMPROVE_TASTE") {
    const firstTasteIndex = next.findIndex((attribute) => attribute.dimension === "Taste");
    if (firstTasteIndex >= 0) next[firstTasteIndex].isJarTarget = true;
    return next;
  }

  if (objective === "IMPROVE_TEXTURE") {
    const firstTextureIndex = next.findIndex((attribute) => attribute.dimension === "Texture");
    if (firstTextureIndex >= 0) next[firstTextureIndex].isJarTarget = true;
    return next;
  }

  if (objective === "FINE_TUNE") {
    next.slice(0, 2).forEach((attribute) => {
      attribute.isJarTarget = true;
    });
    return next;
  }

  next.slice(0, 2).forEach((attribute) => {
    attribute.isJarTarget = true;
  });
  return next;
}

function validateObjectiveSelection(attributes: AttributeRow[], objective: ConsumerObjective) {
  if (attributes.length === 0) {
    return { valid: false, error: "Select at least one candidate attribute." };
  }
  if (attributes.length > 5) {
    return { valid: false, error: "A maximum of 5 attributes may be selected per test." };
  }

  const customAttributes = attributes.filter((attribute) => attribute.isCustom);
  if (customAttributes.length > 1) {
    return { valid: false, error: "Only one custom attribute is allowed per test." };
  }

  for (const custom of customAttributes) {
    const words = custom.name.trim().split(/\s+/).filter(Boolean);
    if (words.length > 2) {
      return { valid: false, error: "Custom attribute name must be at most 2 words." };
    }
    if (!custom.actionable) {
      return { valid: false, error: "Custom attributes must be marked actionable." };
    }
  }

  const jarTargets = attributes.filter((attribute) => attribute.isJarTarget);
  if (jarTargets.length > 3) {
    return { valid: false, error: "Only the TOP 3 attributes can be selected for JAR questions." };
  }

  if (objective === "CHECK_ACCEPTABILITY" && jarTargets.length !== 0) {
    return { valid: false, error: "Check acceptability requires Overall Acceptability only (no JAR attributes)." };
  }
  if (objective === "IMPROVE_TASTE") {
    if (jarTargets.length !== 1 || jarTargets[0].dimension !== "Taste") {
      return { valid: false, error: "Improve taste requires exactly 1 Taste JAR attribute." };
    }
  }
  if (objective === "IMPROVE_TEXTURE") {
    if (jarTargets.length !== 1 || jarTargets[0].dimension !== "Texture") {
      return { valid: false, error: "Improve texture requires exactly 1 Texture JAR attribute." };
    }
  }
  if (objective === "FINE_TUNE" && jarTargets.length !== 2) {
    return { valid: false, error: "Fine-tune requires exactly 2 JAR attributes." };
  }
  if (objective === "FAST_ITERATION" && (jarTargets.length < 1 || jarTargets.length > 2)) {
    return { valid: false, error: "FAST iteration requires 1 to 2 JAR attributes." };
  }

  return { valid: true, error: "" };
}

function formatImportIssue(issue: { rowNumber?: number; field?: string; message: string }) {
  const rowPrefix = issue.rowNumber ? `Row ${issue.rowNumber}: ` : "";
  const fieldPrefix = issue.field ? `${issue.field} - ` : "";
  return `${rowPrefix}${fieldPrefix}${issue.message}`;
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

function formatDateInputFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(dateInput: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return null;
  }
  const [yearPart, monthPart, dayPart] = dateInput.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
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
