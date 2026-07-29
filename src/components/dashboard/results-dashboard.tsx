"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { buildApiUrl } from "@/lib/api-config";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ErrorBar,
  LabelList,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { AlertTriangle, CheckCircle, Download, Lightbulb, ShieldAlert, Users } from "lucide-react";
import { PreferenceMap } from "@/components/dashboard/custom-charts";
import { AppBackButton } from "@/components/ui/app-back-button";

interface ResultsDashboardProps {
  studyId: string;
  backHref: string;
}

interface ConfidenceInterval {
  level: number;
  lower: number;
  upper: number;
  marginOfError: number;
}

interface DescriptiveStats {
  mean: number;
  stdDev: number;
  n: number;
  median?: number;
  confidenceInterval?: ConfidenceInterval | null;
}

interface SamplePerformanceRow {
  sampleNumber: number;
  sampleLabel: string;
  meanScore: number;
  n: number;
  interpretation: string;
}

interface SampleJarBreakdownRow {
  attribute: string;
  tooLowPercent: number;
  justRightPercent: number;
  tooHighPercent: number;
  tooLowPenalty: number | null;
  tooHighPenalty: number | null;
  driverLevel: "STRONG" | "MODERATE" | "NOT_ACTIONABLE";
}

interface SampleMeanDropRow {
  sampleNumber: number;
  sampleLabel: string;
  attribute: string;
  jarCount: number;
  nonJarCount: number;
  jarPercent: number;
  tooLowPercent: number;
  tooHighPercent: number;
  jarMean: number | null;
  nonJarMean: number | null;
  meanDrop: number | null;
  tooLowMeanDrop: number | null;
  tooHighMeanDrop: number | null;
  severity: "STRONG" | "MODERATE" | "NOT_ACTIONABLE";
}

interface AttributeLikingStats extends DescriptiveStats {
  stdError?: number;
}

interface SampleAttributeLikingRow {
  attribute: string;
  stats: AttributeLikingStats;
  significanceLetter?: string | null;
}

interface SampleAnalysisBlock {
  sampleNumber: number;
  sampleLabel: string;
  overallLiking: DescriptiveStats;
  overallLikingLetter?: string | null;
  interpretation: string;
  attributeLiking?: SampleAttributeLikingRow[];
  attributeLikingNote?: string;
  jarBreakdown: SampleJarBreakdownRow[];
  meanDropAnalysis?: Array<Omit<SampleMeanDropRow, "sampleNumber" | "sampleLabel">>;
  distribution?: number[];
}

interface StudyOverview {
  title: string;
  productName: string;
  status: string;
  studyDesign?: "MONADIC" | "WITHIN_SUBJECT";
  studyDesignLabel?: string;
  numberOfConsumers: number;
  targetConsumers: number;
  numberOfSamples: number;
  attributesEvaluated: Array<{ name: string; type: string }>;
  hedonicScale: string;
  jarScale: string | null;
  dateConducted: string | null;
}

interface AssumptionCheck {
  name: string;
  label: string;
  passed: boolean | null;
  pValue: number | null;
  detail: string;
}

interface AssumptionChecksSummary {
  normality: AssumptionCheck;
  homogeneity: AssumptionCheck;
  sampleSizeAdequacy: AssumptionCheck;
  recommendedPathway: "PARAMETRIC" | "NONPARAMETRIC";
  rationale: string;
}

interface EffectSizeResult {
  name: string;
  label: string;
  value: number;
  magnitude: "negligible" | "small" | "medium" | "large";
  interpretation: string;
}

interface PostHocComparison {
  pairLabel: string;
  groupA: string;
  groupB: string;
  meanDifference: number | null;
  rawPValue: number | null;
  adjustedPValue: number | null;
  significant: boolean | null;
  method: string;
  interpretation: string;
}

interface ComparisonStat {
  test: string;
  testLabel: string;
  studyDesign?: string;
  repeatedMeasures: boolean;
  pValue: number | null;
  formattedPValue: string;
  statistic: number | null;
  significant: boolean | null;
  interpretation: string;
  assumptions: string[];
  warnings: string[];
  assumptionChecks?: AssumptionChecksSummary;
  effectSize?: EffectSizeResult | null;
  postHocResults?: PostHocComparison[];
}

interface SampleComparisonRow {
  sampleNumber: number;
  sampleLabel: string;
  mean: number;
  stdDev: number;
  n: number;
  stdError?: number;
  confidenceInterval?: ConfidenceInterval | null;
  letter?: string | null;
}

interface AttributeLikingComparisonEntry {
  attribute: string;
  samples: SampleComparisonRow[];
  statisticalComparison: ComparisonStat;
}

interface OverallLikingComparison {
  samples: SampleComparisonRow[];
  statisticalComparison: ComparisonStat;
}

interface JarDistributionComparisonEntry {
  attribute: string;
  distributions: Array<{
    sampleNumber: number;
    sampleLabel: string;
    tooLowPercent: number;
    justRightPercent: number;
    tooHighPercent: number;
  }>;
}

interface ComparativeAnalysis {
  sampleOptions: Array<{ sampleNumber: number; sampleLabel: string }>;
  variableOptions: Array<{ key: string; label: string; type: string }>;
  primaryComparison: ComparisonEntry | null;
  comparisons?: ComparisonEntry[];
  defaultVariableKey?: string | null;
  overallLikingComparison?: OverallLikingComparison | null;
  attributeLikingComparison?: AttributeLikingComparisonEntry[];
  jarRatingComparison?: AttributeLikingComparisonEntry[];
  jarDistributionComparison?: JarDistributionComparisonEntry[];
}

interface ComparisonEntry {
  variableKey: string;
  variableLabel: string;
  variableType?: string;
  graphType?: string;
  samples: Array<{
    sampleNumber: number;
    sampleLabel: string;
    stats: DescriptiveStats;
    values?: number[];
  }>;
  statisticalComparison: ComparisonStat;
}

interface DataQualityFinding {
  code: string;
  label: string;
  severity: "INFO" | "WARNING" | "BLOCKING";
  message: string;
  affectedCount: number;
  affectedRespondents: string[];
}

interface DataQualityReport {
  status: "PASSED" | "PASSED_WITH_WARNINGS" | "BLOCKED";
  findings: DataQualityFinding[];
  totals: {
    respondents: number;
    samplesEvaluated: number;
    expectedSamples: number;
    incompleteRespondents: number;
    flaggedRespondents: number;
  };
  recommendation: string;
}

interface AdvancedAnalytics {
  pca: {
    components: Array<{ component: number; explainedVariance: number; loadings: Record<string, number> }>;
    sampleScores: Array<{ sampleNumber: number; sampleLabel: string; pc1: number; pc2: number }>;
    consumerScores: Array<{ respondentId: string; pc1: number; pc2: number }>;
    rationale: string;
  } | null;
  segmentation: {
    k: number;
    segments: Array<{
      label: string;
      size: number;
      centroid: Record<string, number>;
      representativeRespondents: string[];
    }>;
    rationale: string;
  } | null;
  preferenceMap: {
    samples: Array<{ sampleNumber: number; sampleLabel: string; x: number; y: number; meanLiking: number }>;
    rationale: string;
  } | null;
  warnings: string[];
}

interface AutomaticInterpretation {
  summary: string[];
  decisionSupport?: {
    formattedPrimaryPValue?: string;
    hasSignificantDifference?: boolean | null;
    primaryEffectSize?: EffectSizeResult | null;
    dataQualityStatus?: string | null;
  };
}

interface CustomQuestionOptionCount {
  option: string;
  count: number;
  percent: number;
}

interface CustomQuestionSummary {
  id: string;
  text: string;
  type: "MULTIPLE_CHOICE" | "CHECKBOXES" | "PARAGRAPH";
  responseCount: number;
  optionCounts?: CustomQuestionOptionCount[];
  textAnswers?: string[];
}

interface CataTermResult {
  term: string;
  countsBySample: number[];
  percentBySample: number[];
  totalChecks: number;
  cochranQ: number;
  df: number;
  pValue: number | null;
  significant: boolean;
  interpretation: string;
}

interface CataAnalysis {
  sampleLabels: string[];
  respondentsPerSample: number[];
  completeCaseCount: number;
  terms: CataTermResult[];
  warnings: string[];
}

interface AnalysisPayload {
  generatedAt: string;
  studyOverview?: StudyOverview | null;
  overallLiking: {
    mean: number;
    stdDev: number;
    n: number;
    median?: number;
    confidenceInterval?: ConfidenceInterval | null;
    samplePerformance?: SamplePerformanceRow[];
    bestSample?: SamplePerformanceRow | null;
    bySample?: SampleAnalysisBlock[];
    studyOverview?: StudyOverview | null;
    comparativeAnalysis?: ComparativeAnalysis | null;
    meanDropAnalysis?: SampleMeanDropRow[];
    automaticInterpretation?: AutomaticInterpretation | null;
    dataQuality?: DataQualityReport | null;
    advancedAnalytics?: AdvancedAnalytics | null;
    customQuestionSummaries?: CustomQuestionSummary[];
    cataAnalysis?: CataAnalysis | null;
    studyDesign?: "MONADIC" | "WITHIN_SUBJECT";
  };
  attributeStats: Array<{
    name: string;
    type: "LIKING" | "JAR";
    stats?: { mean: number };
    distribution?: {
      tooLow: { percent: number };
      justRight: { percent: number };
      tooHigh: { percent: number };
    };
  }>;
  penaltyAnalysis: Array<{
    attribute: string;
    tooLowPercent: number;
    tooLowPenalty: number | null;
    tooHighPercent: number;
    tooHighPenalty: number | null;
    tooLowLevel: "STRONG" | "MODERATE" | "NOT_ACTIONABLE";
    tooHighLevel: "STRONG" | "MODERATE" | "NOT_ACTIONABLE";
    driverLevel: "STRONG" | "MODERATE" | "NOT_ACTIONABLE";
    isActionable: boolean;
    isSignificant: boolean;
  }>;
  perSampleResults?: SampleAnalysisBlock[];
  comparativeAnalysis?: ComparativeAnalysis | null;
  meanDropAnalysis?: SampleMeanDropRow[];
  automaticInterpretation?: AutomaticInterpretation | null;
  dataQuality?: DataQualityReport | null;
  advancedAnalytics?: AdvancedAnalytics | null;
  aiInterpretation: string | null;
  aiRecommendation: string | null;
  decisionFlag: string | null;
}

export function ResultsDashboard({ studyId, backHref }: ResultsDashboardProps) {
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<string>("");
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "excel" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [selectedSampleNumbers, setSelectedSampleNumbers] = useState<number[]>([]);
  const [selectedVariableKey, setSelectedVariableKey] = useState<string>("");
  const [activeComparison, setActiveComparison] = useState<ComparisonEntry | null>(null);
  const [comparisonRunning, setComparisonRunning] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  const comparisonChartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(buildApiUrl(`/studies/${studyId}/analysis`), { cache: "no-store" });
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        const payload = (await response.json()) as AnalysisPayload;
        // If the cached analysis predates the per-sample / cross-sample fields, force a one-time refresh.
        const comparative = payload.comparativeAnalysis ?? payload.overallLiking?.comparativeAnalysis ?? null;
        const missingNewFields =
          !comparative ||
          comparative.overallLikingComparison === undefined ||
          comparative.attributeLikingComparison === undefined ||
          comparative.jarRatingComparison === undefined ||
          comparative.jarDistributionComparison === undefined;
        if (missingNewFields) {
          const refreshed = await fetch(buildApiUrl(`/studies/${studyId}/analysis?refresh=1`), { cache: "no-store" });
          if (refreshed.ok) {
            const refreshedPayload = (await refreshed.json()) as AnalysisPayload;
            if (isMounted) setAnalysis(refreshedPayload);
            return;
          }
        }
        if (isMounted) setAnalysis(payload);
      } catch (fetchError) {
        if (isMounted) setError(fetchError instanceof Error ? fetchError.message : "Failed to load analysis.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void run();
    return () => {
      isMounted = false;
    };
  }, [studyId]);

  const comparativeAnalysis = analysis?.comparativeAnalysis ?? analysis?.overallLiking.comparativeAnalysis ?? null;

  // Initialize sample/variable selections once analysis loads.
  useEffect(() => {
    if (!comparativeAnalysis) return;
    if (selectedSampleNumbers.length === 0) {
      setSelectedSampleNumbers(comparativeAnalysis.sampleOptions.map((sample) => sample.sampleNumber));
    }
    if (!selectedVariableKey && comparativeAnalysis.variableOptions.length > 0) {
      setSelectedVariableKey(comparativeAnalysis.defaultVariableKey ?? comparativeAnalysis.variableOptions[0].key);
    }
    if (!activeComparison) {
      setActiveComparison(comparativeAnalysis.primaryComparison);
    }
  }, [comparativeAnalysis, selectedSampleNumbers.length, selectedVariableKey, activeComparison]);

  if (loading) return <div className="px-6 py-8 text-sm text-[#64748b]">Loading analysis...</div>;
  if (error) return <div className="px-6 py-8 text-sm text-red-600">Failed to load analysis: {error}</div>;
  if (!analysis) return <div className="px-6 py-8 text-sm text-[#64748b]">No analysis available.</div>;

  const {
    overallLiking,
    aiInterpretation,
    aiRecommendation,
    decisionFlag,
  } = analysis;

  const decisionStyles = getDecisionStyle(decisionFlag);
  const samplePerformance = overallLiking.samplePerformance ?? [];
  const bySample = analysis.perSampleResults ?? overallLiking.bySample ?? [];
  const bestSample = overallLiking.bestSample;
  const studyOverview = analysis.studyOverview ?? overallLiking.studyOverview ?? null;
  const meanDropAnalysis = analysis.meanDropAnalysis ?? overallLiking.meanDropAnalysis ?? [];
  const automaticInterpretation = analysis.automaticInterpretation ?? overallLiking.automaticInterpretation ?? null;
  const dataQuality = analysis.dataQuality ?? overallLiking.dataQuality ?? null;
  const advancedAnalytics = analysis.advancedAnalytics ?? overallLiking.advancedAnalytics ?? null;
  const customQuestionSummaries = overallLiking.customQuestionSummaries ?? [];
  const cataAnalysis = overallLiking.cataAnalysis ?? null;
  const exportContext = buildAnalysisExportContext(analysis);

  const sampleTabs =
    bySample.length > 0
      ? bySample.map((sample) => ({ sampleNumber: sample.sampleNumber, sampleLabel: sample.sampleLabel }))
      : samplePerformance.map((sample) => ({ sampleNumber: sample.sampleNumber, sampleLabel: sample.sampleLabel }));
  const comparisonTabId = "comparison";
  const validResultTabs = new Set([comparisonTabId, ...sampleTabs.map((sample) => `sample-${sample.sampleNumber}`)]);
  const selectedResultTab =
    validResultTabs.has(activeResultTab)
      ? activeResultTab
      : sampleTabs.length > 0
        ? `sample-${sampleTabs[0].sampleNumber}`
        : comparisonTabId;
  const selectedSampleNumber = selectedResultTab.startsWith("sample-")
    ? Number(selectedResultTab.replace("sample-", ""))
    : null;
  const selectedSample = selectedSampleNumber !== null
    ? bySample.find((sample) => sample.sampleNumber === selectedSampleNumber) ?? null
    : null;
  const selectedSamplePerformance = selectedSampleNumber !== null
    ? samplePerformance.find((sample) => sample.sampleNumber === selectedSampleNumber) ?? null
    : null;
  const selectedMeanDropAnalysis = selectedSample
    ? selectedSample.meanDropAnalysis?.map((row) => ({
        ...row,
        sampleNumber: selectedSample.sampleNumber,
        sampleLabel: selectedSample.sampleLabel,
      })) ?? meanDropAnalysis.filter((row) => row.sampleNumber === selectedSample.sampleNumber)
    : [];
  const selectedAttributeLikingTable =
    selectedSample?.attributeLiking?.map((row) => ({
      attribute: row.attribute,
      mean: row.stats.mean,
      stdDev: row.stats.stdDev,
      stdError: row.stats.stdError ?? (row.stats.n > 0 ? Number((row.stats.stdDev / Math.sqrt(row.stats.n)).toFixed(2)) : 0),
      n: row.stats.n,
      ciLow: row.stats.confidenceInterval?.lower ?? null,
      ciHigh: row.stats.confidenceInterval?.upper ?? null,
      letter: row.significanceLetter ?? null,
    })) ?? [];
  const selectedAttributeChartData = selectedAttributeLikingTable.map((row) => ({
    attribute: row.attribute,
    mean: row.mean,
    stdError: row.stdError,
    letter: row.letter,
    valueLabel: row.letter ? `${row.mean.toFixed(2)} ${row.letter}` : row.mean.toFixed(2),
  }));
  const selectedAttributeNote = selectedSample?.attributeLikingNote ?? "Values are mean +/- SE.";

  const comparisonChartData = (activeComparison?.samples ?? []).map((sample) => ({
    name: sample.sampleLabel,
    mean: sample.stats.mean,
    stdDev: sample.stats.stdDev,
    n: sample.stats.n,
    errorMargin: sample.stats.confidenceInterval?.marginOfError ?? sample.stats.stdDev ?? 0,
  }));

  const handleToggleSample = (sampleNumber: number) => {
    setSelectedSampleNumbers((current) => {
      const next = current.includes(sampleNumber)
        ? current.filter((number) => number !== sampleNumber)
        : [...current, sampleNumber].sort((a, b) => a - b);
      return next;
    });
  };

  const handleResetSelection = () => {
    if (!comparativeAnalysis) return;
    setSelectedSampleNumbers(comparativeAnalysis.sampleOptions.map((sample) => sample.sampleNumber));
    setSelectedVariableKey(comparativeAnalysis.defaultVariableKey ?? comparativeAnalysis.variableOptions[0]?.key ?? "");
    setActiveComparison(comparativeAnalysis.primaryComparison);
    setComparisonError(null);
  };

  const handleRunComparison = async () => {
    if (!comparativeAnalysis) return;
    if (selectedSampleNumbers.length < 2) {
      setComparisonError("Select at least two samples to run a statistical comparison.");
      return;
    }
    setComparisonError(null);
    setComparisonRunning(true);
    try {
      const response = await fetch(buildApiUrl(`/studies/${studyId}/analysis/compare`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleNumbers: selectedSampleNumbers,
          variableKey: selectedVariableKey,
        }),
      });
      if (!response.ok) {
        throw new Error(`Comparison failed with status ${response.status}`);
      }
      const payload = (await response.json()) as {
        variableKey: string;
        samples: Array<{ sampleNumber: number; sampleLabel: string; mean: number; stdDev: number; n: number }>;
        statisticalComparison: ComparisonStat & { formattedPValue: string };
      };
      const variableLabel =
        comparativeAnalysis.variableOptions.find((option) => option.key === payload.variableKey)?.label ?? payload.variableKey;
      setActiveComparison({
        variableKey: payload.variableKey,
        variableLabel,
        samples: payload.samples.map((sample) => ({
          sampleNumber: sample.sampleNumber,
          sampleLabel: sample.sampleLabel,
          stats: { mean: sample.mean, stdDev: sample.stdDev, n: sample.n, confidenceInterval: null },
        })),
        statisticalComparison: payload.statisticalComparison,
      });
    } catch (failure) {
      setComparisonError(failure instanceof Error ? failure.message : "Failed to run comparison.");
    } finally {
      setComparisonRunning(false);
    }
  };

  const runExport = async (format: "pdf" | "excel") => {
    setExportError(null);
    setExportingFormat(format);
    try {
      if (format === "pdf") {
        await exportAnalysisPdf(exportContext, comparisonChartRef.current);
      } else {
        await exportAnalysisExcel(exportContext);
      }
    } catch (exportFailure) {
      console.error(`Failed to export ${format} report:`, exportFailure);
      setExportError(`Failed to export ${format === "pdf" ? "PDF" : "Excel"} report. Please try again.`);
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6 lg:p-8">
      <section className="flex flex-col gap-4 rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <AppBackButton fallbackHref={backHref} label="Back" className="mb-4" />
          <h1 className="text-3xl font-bold tracking-tight text-[#0f172a]">Sensory Analysis Results</h1>
          <p className="mt-1 text-sm text-[#64748b]">
            Generated on {new Date(analysis.generatedAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button
            type="button"
            className="app-button-secondary flex w-full items-center justify-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            disabled={exportingFormat !== null}
            onClick={() => void runExport("pdf")}
          >
            <Download size={16} />
            {exportingFormat === "pdf" ? "Preparing PDF..." : "Export PDF"}
          </button>
          <button
            type="button"
            className="app-button-secondary flex w-full items-center justify-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            disabled={exportingFormat !== null}
            onClick={() => void runExport("excel")}
          >
            <Download size={16} />
            {exportingFormat === "excel" ? "Preparing Excel..." : "Export Excel"}
          </button>
        </div>
      </section>
      {exportError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{exportError}</div>
      )}

      {studyOverview && (
        <Card title="Study Overview">
          <div className="grid gap-4 text-sm md:grid-cols-4">
            <OverviewItem label="Study" value={studyOverview.title} />
            <OverviewItem label="Product" value={studyOverview.productName || "-"} />
            <OverviewItem label="Consumers" value={`${studyOverview.numberOfConsumers}/${studyOverview.targetConsumers}`} />
            <OverviewItem label="Samples" value={studyOverview.numberOfSamples} />
            <OverviewItem label="Hedonic Scale" value={studyOverview.hedonicScale} />
            <OverviewItem label="JAR Scale" value={studyOverview.jarScale ?? "-"} />
            <OverviewItem
              label="Date Conducted"
              value={studyOverview.dateConducted ? new Date(studyOverview.dateConducted).toLocaleDateString() : "-"}
            />
            <OverviewItem label="Status" value={studyOverview.status.replace(/_/g, " ")} />
            <OverviewItem
              label="Study Design"
              value={studyOverview.studyDesignLabel ?? (studyOverview.studyDesign === "MONADIC" ? "Monadic" : "Within-subject")}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {studyOverview.attributesEvaluated.map((attribute) => (
              <span key={`${attribute.type}-${attribute.name}`} className="rounded-full border border-[#e2e8f0] px-3 py-1 text-xs text-[#475569]">
                {attribute.name}
              </span>
            ))}
          </div>
        </Card>
      )}

      {dataQuality && (
        <Card title="Data Quality">
          <DataQualityCard report={dataQuality} />
        </Card>
      )}

      {customQuestionSummaries.length > 0 && (
        <Card title="Additional Questions">
          <CustomQuestionSummariesCard summaries={customQuestionSummaries} />
        </Card>
      )}

      {cataAnalysis && (
        <Card title="Check-All-That-Apply (CATA)">
          <CataAnalysisCard analysis={cataAnalysis} />
        </Card>
      )}

      {sampleTabs.length > 0 && (
        <nav className="rounded-xl border border-[#e2e8f0] bg-white p-2 shadow-[0_1px_3px_rgba(15,23,42,0.06)]" aria-label="Analysis results by sample">
          <div className="flex flex-wrap gap-2">
            {sampleTabs.map((sample) => {
              const tabId = `sample-${sample.sampleNumber}`;
              const isActive = selectedResultTab === tabId;
              return (
                <button
                  key={tabId}
                  type="button"
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                    isActive
                      ? "bg-[#0f172a] text-white shadow-sm"
                      : "border border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f8fafc]"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setActiveResultTab(tabId)}
                >
                  {sample.sampleLabel}
                </button>
              );
            })}
            <button
              type="button"
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                selectedResultTab === comparisonTabId
                  ? "bg-[#0f172a] text-white shadow-sm"
                  : "border border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f8fafc]"
              }`}
              aria-current={selectedResultTab === comparisonTabId ? "page" : undefined}
              onClick={() => setActiveResultTab(comparisonTabId)}
            >
              Comparative Analysis
            </button>
          </div>
        </nav>
      )}

      {selectedResultTab === comparisonTabId ? (
        <>
          {comparativeAnalysis && (
            <Card title="Comparative Analysis" className="lg:col-span-2">
              <p className="mb-3 rounded-lg border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-xs text-[#1e3a8a]">
                Pick the variable to compare and the samples to include. TARAsense automatically selects the right statistical test
                (parametric vs nonparametric) and reports an effect size and post-hoc analysis when applicable.
              </p>
              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div>
                  <div className="mb-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col text-xs font-medium text-[#334155]">
                      Variable
                      <select
                        className="mt-1 rounded-md border border-[#e2e8f0] bg-white px-2 py-1 text-sm"
                        value={selectedVariableKey}
                        onChange={(event) => setSelectedVariableKey(event.target.value)}
                      >
                        {comparativeAnalysis.variableOptions.map((variable) => (
                          <option key={variable.key} value={variable.key}>
                            {variable.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="app-button-primary rounded-md px-4 py-2 text-sm disabled:opacity-60"
                      disabled={comparisonRunning || selectedSampleNumbers.length < 2}
                      onClick={() => void handleRunComparison()}
                    >
                      {comparisonRunning ? "Running..." : "Run comparison"}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#334155]"
                      onClick={handleResetSelection}
                    >
                      Reset
                    </button>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {comparativeAnalysis.sampleOptions.map((sample) => {
                      const checked = selectedSampleNumbers.includes(sample.sampleNumber);
                      return (
                        <label
                          key={`sample-toggle-${sample.sampleNumber}`}
                          className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                            checked ? "border-[#1d4ed8] bg-[#dbeafe] text-[#1e3a8a]" : "border-[#e2e8f0] bg-white text-[#334155]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mr-2"
                            checked={checked}
                            onChange={() => handleToggleSample(sample.sampleNumber)}
                          />
                          {sample.sampleLabel}
                        </label>
                      );
                    })}
                  </div>
                  {comparisonError && (
                    <p className="mb-2 text-xs text-red-600">{comparisonError}</p>
                  )}
                  <div className="h-72 min-h-72 min-w-0" ref={comparisonChartRef}>
                    <MeasuredResponsiveChart>
                      <BarChart data={comparisonChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" />
                        <YAxis domain={[0, 9]} />
                        <Tooltip />
                        <Bar dataKey="mean" fill="#2563eb" radius={[6, 6, 0, 0]}>
                          <ErrorBar dataKey="errorMargin" width={6} stroke="#1e293b" />
                        </Bar>
                      </BarChart>
                    </MeasuredResponsiveChart>
                  </div>
                </div>
                <ComparisonStatisticsPanel comparison={activeComparison} />
              </div>
              {activeComparison && (
                <ComparisonOutputTable comparison={activeComparison} />
              )}
              {activeComparison?.statisticalComparison.postHocResults && activeComparison.statisticalComparison.postHocResults.length > 0 && (
                <PostHocTable results={activeComparison.statisticalComparison.postHocResults} />
              )}
            </Card>
          )}

          {samplePerformance.length > 0 && (
            <Card title="By Sample Performance" className="lg:col-span-2">
              <p className="mb-3 rounded-lg border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-xs text-[#1e3a8a]">
                Sample-level analysis is the primary view for completed imported studies, anchored on Overall Liking and JAR penalty rules.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-[#f8fafc]">
                    <tr>
                      <th className="px-4 py-3 text-left">Sample</th>
                      <th className="px-4 py-3 text-center">Mean Overall Liking</th>
                      <th className="px-4 py-3 text-center">Respondents</th>
                      <th className="px-4 py-3 text-left">Interpretation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {samplePerformance.map((sample) => (
                      <tr key={`sample-performance-${sample.sampleNumber}`} className="border-b border-[#e2e8f0]">
                        <td className="px-4 py-3 font-medium text-[#0f172a]">
                          {sample.sampleLabel} {bestSample && bestSample.sampleNumber === sample.sampleNumber ? "(Best)" : ""}
                        </td>
                        <td className="px-4 py-3 text-center">{sample.meanScore}</td>
                        <td className="px-4 py-3 text-center">{sample.n}</td>
                        <td className="px-4 py-3">{sample.interpretation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {comparativeAnalysis?.attributeLikingComparison && comparativeAnalysis.attributeLikingComparison.length > 0 && (
            <AttributeLikingComparisonChart entries={comparativeAnalysis.attributeLikingComparison} />
          )}

          {comparativeAnalysis?.jarDistributionComparison && comparativeAnalysis.jarDistributionComparison.length > 0 && (
            <JarDistributionComparisonCard entries={comparativeAnalysis.jarDistributionComparison} />
          )}

          {advancedAnalytics && (
            <AdvancedAnalyticsSection analytics={advancedAnalytics} />
          )}
        </>
      ) : (
        <>
          {selectedSample ? (
            <>
              {/* 1. Sample Metrics */}
              <article className="rounded-lg border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[#64748b]">{selectedSample.sampleLabel}</p>
                    <p className="mt-1 text-sm font-semibold text-[#0f172a]">Sample Metrics</p>
                  </div>
                  <span className="rounded-lg bg-[#fff7ed] p-2 text-[#f97316]">
                    <Users className="h-5 w-5" />
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                  <Metric label="Participants" value={selectedSample.overallLiking.n} />
                  <Metric
                    label="Mean Overall Liking"
                    value={selectedSample.overallLikingLetter ? `${selectedSample.overallLiking.mean} (${selectedSample.overallLikingLetter})` : selectedSample.overallLiking.mean}
                  />
                  <Metric label="Std. Deviation" value={selectedSample.overallLiking.stdDev} />
                  <Metric label="Decision" value={selectedSample.interpretation} />
                  {selectedSample.overallLiking.confidenceInterval && (
                    <Metric
                      label="95% CI"
                      value={`[${selectedSample.overallLiking.confidenceInterval.lower}, ${selectedSample.overallLiking.confidenceInterval.upper}]`}
                    />
                  )}
                </div>
              </article>

              {/* 2. JAR And Penalty */}
              <Card title={`JAR And Penalty for Sample ${selectedSample.sampleLabel}`} className="lg:col-span-2">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-xs">
                    <thead className="bg-[#f8fafc]">
                      <tr>
                        <th className="px-3 py-2 text-left">Attribute</th>
                        <th className="px-3 py-2 text-center">Too Low %</th>
                        <th className="px-3 py-2 text-center">JAR %</th>
                        <th className="px-3 py-2 text-center">Too High %</th>
                        <th className="px-3 py-2 text-center">Too Low Penalty</th>
                        <th className="px-3 py-2 text-center">Too High Penalty</th>
                        <th className="px-3 py-2 text-center">Driver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSample.jarBreakdown.map((row) => (
                        <tr key={`${selectedSample.sampleNumber}-${row.attribute}`} className="border-t border-[#e2e8f0]">
                          <td className="px-3 py-2 font-medium text-[#0f172a]">{row.attribute}</td>
                          <td className="px-3 py-2 text-center">{row.tooLowPercent}%</td>
                          <td className="px-3 py-2 text-center">{row.justRightPercent}%</td>
                          <td className="px-3 py-2 text-center">{row.tooHighPercent}%</td>
                          <td className="px-3 py-2 text-center">{row.tooLowPenalty !== null ? row.tooLowPenalty : "-"}</td>
                          <td className="px-3 py-2 text-center">{row.tooHighPenalty !== null ? row.tooHighPenalty : "-"}</td>
                          <td className="px-3 py-2 text-center">
                            <DriverBadge level={row.driverLevel} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* 3. Attribute Liking chart (orange bars, with letters) */}
              {selectedAttributeChartData.length > 0 && (
                <Card title={`Attribute Liking for Sample ${selectedSample.sampleLabel}`} className="lg:col-span-2">
                  <div className="h-80 min-h-80 min-w-0">
                    <MeasuredResponsiveChart>
                      <BarChart data={selectedAttributeChartData} margin={{ top: 30, right: 16, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="attribute" />
                        <YAxis domain={[0, 9]} label={{ value: "Mean attribute liking", angle: -90, position: "insideLeft" }} />
                        <Tooltip />
                        <Bar dataKey="mean" fill="#f97316" radius={[6, 6, 0, 0]}>
                          <LabelList dataKey="valueLabel" position="top" fill="#0f172a" fontSize={11} />
                          <ErrorBar dataKey="stdError" width={6} stroke="#1e293b" />
                        </Bar>
                      </BarChart>
                    </MeasuredResponsiveChart>
                  </div>
                  {selectedAttributeChartData.some((row) => row.letter) && (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#475569]">
                      {selectedAttributeChartData
                        .filter((row) => row.letter)
                        .map((row) => (
                          <span key={`letter-${row.attribute}`}>
                            <span className="font-semibold text-[#0f172a]">{row.attribute}</span>: {row.letter}
                          </span>
                        ))}
                    </div>
                  )}
                  <p className="mt-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-xs text-[#64748b]">
                    {selectedAttributeNote}
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[420px] text-xs">
                      <thead className="bg-[#f8fafc]">
                        <tr>
                          <th className="px-3 py-2 text-left">Attribute</th>
                          <th className="px-3 py-2 text-center">Mean</th>
                          <th className="px-3 py-2 text-center">SD</th>
                          <th className="px-3 py-2 text-center">SE</th>
                          <th className="px-3 py-2 text-center">95% CI</th>
                          <th className="px-3 py-2 text-center">N</th>
                          <th className="px-3 py-2 text-center">Letter</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAttributeLikingTable.map((row) => (
                          <tr key={`attr-table-${selectedSample.sampleNumber}-${row.attribute}`} className="border-b border-[#e2e8f0]">
                            <td className="px-3 py-2 font-medium">{row.attribute}</td>
                            <td className="px-3 py-2 text-center">{row.mean}</td>
                            <td className="px-3 py-2 text-center">{row.stdDev}</td>
                            <td className="px-3 py-2 text-center">{row.stdError}</td>
                            <td className="px-3 py-2 text-center text-[#475569]">
                              {row.ciLow !== null && row.ciHigh !== null ? `[${row.ciLow}, ${row.ciHigh}]` : "-"}
                            </td>
                            <td className="px-3 py-2 text-center">{row.n}</td>
                            <td className="px-3 py-2 text-center font-semibold">{row.letter ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {/* 4. Mean Drop Analysis */}
              {selectedMeanDropAnalysis.length > 0 && (
                <Card title={`Mean Drop Analysis for Sample ${selectedSample.sampleLabel}`} className="lg:col-span-2">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-sm">
                      <thead className="bg-[#f8fafc]">
                        <tr>
                          <th className="px-4 py-3 text-left">Attribute</th>
                          <th className="px-4 py-3 text-center">JAR %</th>
                          <th className="px-4 py-3 text-center">Too Low %</th>
                          <th className="px-4 py-3 text-center">Too High %</th>
                          <th className="px-4 py-3 text-center">JAR Mean</th>
                          <th className="px-4 py-3 text-center">Non-JAR Mean</th>
                          <th className="px-4 py-3 text-center">Mean Drop</th>
                          <th className="px-4 py-3 text-center">Severity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedMeanDropAnalysis.map((row) => (
                          <tr key={`${row.sampleNumber}-${row.attribute}`} className="border-b border-[#e2e8f0]">
                            <td className="px-4 py-3">{row.attribute}</td>
                            <td className="px-4 py-3 text-center">{row.jarPercent}%</td>
                            <td className="px-4 py-3 text-center">{row.tooLowPercent}%</td>
                            <td className="px-4 py-3 text-center">{row.tooHighPercent}%</td>
                            <td className="px-4 py-3 text-center">{row.jarMean ?? "-"}</td>
                            <td className="px-4 py-3 text-center">{row.nonJarMean ?? "-"}</td>
                            <td className="px-4 py-3 text-center text-red-600">{row.meanDrop !== null ? `-${row.meanDrop}` : "-"}</td>
                            <td className="px-4 py-3 text-center">
                              <DriverBadge level={row.severity} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          ) : (
            <Card title={selectedSamplePerformance?.sampleLabel ?? "Sample Results"}>
              <p className="text-sm text-[#64748b]">
                Detailed JAR and penalty records are not available for this sample in the current analysis payload.
              </p>
              {selectedSamplePerformance && (
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                  <Metric label="Participants" value={selectedSamplePerformance.n} />
                  <Metric label="Mean Liking" value={selectedSamplePerformance.meanScore} />
                  <Metric label="Decision" value={selectedSamplePerformance.interpretation} />
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {selectedResultTab === comparisonTabId && (
        <section className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-4 text-sm text-[#9a3412]">
          <Lightbulb className="mr-2 inline h-4 w-4" />
          Tukey HSD and Dunn&apos;s adjusted p-values are computed using validated approximations for the studentized range and rank
          distributions. Effect sizes accompany every test so practical magnitude is visible alongside the p-value.
        </section>
      )}

      <section className={`rounded-xl border p-5 ${decisionStyles.wrapper}`}>
        <div className="flex items-start gap-3">
          {decisionFlag === "NEEDS_IMPROVEMENT" ? <AlertTriangle size={22} /> : <CheckCircle size={22} />}
          <div>
            <h2 className="text-lg font-semibold">AI Interpretation &amp; Recommendation: {(decisionFlag ?? "PENDING").replace(/_/g, " ")}</h2>
            <p className="mt-1 text-sm opacity-90">{aiInterpretation ?? "AI interpretation is not available yet. Review the per-sample and comparative results above before drawing conclusions."}</p>
            <p className="mt-3 rounded-lg border bg-white/60 px-3 py-2 text-sm">
              <span className="font-semibold">Action Required:</span>{" "}
              {aiRecommendation ?? "Collect more responses or configure a server-side AI provider API key."}
            </p>
            {automaticInterpretation && automaticInterpretation.summary.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
                {automaticInterpretation.summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function AttributeLikingComparisonChart({ entries }: { entries: AttributeLikingComparisonEntry[] }) {
  if (entries.length === 0) return null;
  const sampleLabels = Array.from(new Set(entries.flatMap((entry) => entry.samples.map((sample) => sample.sampleLabel))));
  const colorPalette = ["#f97316", "#1d4ed8", "#16a34a", "#dc2626", "#9333ea", "#0891b2"];
  const data = entries.map((entry) => {
    const row: Record<string, number | string> = { attribute: entry.attribute };
    entry.samples.forEach((sample) => {
      row[sample.sampleLabel] = sample.mean;
      row[`${sample.sampleLabel}__se`] = sample.stdError ?? 0;
      row[`${sample.sampleLabel}__letter`] = sample.letter ?? "";
    });
    return row;
  });

  // Adapt the axis to the liking scale actually present: imported datasets may use a 5-point
  // liking scale, while study-builder attribute liking uses the 9-point hedonic scale.
  const maxLikingValue = Math.max(
    0,
    ...entries.flatMap((entry) => entry.samples.map((sample) => sample.mean + (sample.stdError ?? 0)))
  );
  const likingAxisMax = maxLikingValue <= 5 ? 5 : 9;

  return (
    <Card title="Mean Attribute Liking Comparison Across Samples" className="lg:col-span-2">
      <div className="h-80 min-h-80 min-w-0">
        <MeasuredResponsiveChart>
          <BarChart data={data} margin={{ top: 24, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="attribute" />
            <YAxis domain={[0, likingAxisMax]} label={{ value: "Mean attribute liking", angle: -90, position: "insideLeft" }} />
            <Tooltip />
            {sampleLabels.map((label, index) => (
              <Bar key={label} dataKey={label} fill={colorPalette[index % colorPalette.length]} radius={[4, 4, 0, 0]}>
                <ErrorBar dataKey={`${label}__se`} width={4} stroke="#1e293b" />
              </Bar>
            ))}
          </BarChart>
        </MeasuredResponsiveChart>
      </div>
      <p className="mt-2 text-xs text-[#475569]">
        Values are mean +/- SE. Letters compare samples within each attribute (samples sharing a letter are not significantly different, p &gt;= 0.05).
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-[#f8fafc]">
            <tr>
              <th className="px-3 py-2 text-left">Attribute</th>
              {sampleLabels.map((label) => (
                <th key={`head-${label}`} className="px-3 py-2 text-center">{label}</th>
              ))}
              <th className="px-3 py-2 text-center">Test</th>
              <th className="px-3 py-2 text-center">p-value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={`attr-cmp-${entry.attribute}`} className="border-b border-[#e2e8f0]">
                <td className="px-3 py-2 font-medium">{entry.attribute}</td>
                {sampleLabels.map((label) => {
                  const match = entry.samples.find((sample) => sample.sampleLabel === label);
                  return (
                    <td key={`cell-${entry.attribute}-${label}`} className="px-3 py-2 text-center">
                      {match ? `${match.mean.toFixed(2)}${match.letter ? ` (${match.letter})` : ""}` : "-"}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center text-[#475569]">{entry.statisticalComparison.testLabel}</td>
                <td className="px-3 py-2 text-center">
                  {entry.statisticalComparison.formattedPValue}
                  {entry.statisticalComparison.significant ? <span className="ml-1 font-semibold text-red-600">*</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function JarDistributionComparisonCard({ entries }: { entries: JarDistributionComparisonEntry[] }) {
  return (
    <Card title="JAR Distribution Comparison" className="lg:col-span-2">
      <p className="mb-4 text-xs text-[#64748b]">
        Per-sample share of respondents rating each JAR attribute as Too Low / Just Right / Too High.
      </p>
      <div className="space-y-6">
        {entries.map((entry) => (
          <div key={`jar-row-${entry.attribute}`}>
            <h3 className="mb-3 text-sm font-semibold text-[#0f172a]">{entry.attribute} (JAR)</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {entry.distributions.map((dist) => {
                const slices = [
                  { name: "Too Low", value: dist.tooLowPercent, fill: "#ef4444" },
                  { name: "Just Right", value: dist.justRightPercent, fill: "#22c55e" },
                  { name: "Too High", value: dist.tooHighPercent, fill: "#f97316" },
                ];
                return (
                  <div key={`jar-donut-${entry.attribute}-${dist.sampleNumber}`} className="rounded-lg border border-[#e2e8f0] bg-white p-3">
                    <p className="mb-1 text-center text-xs font-semibold text-[#0f172a]">{dist.sampleLabel}</p>
                    <div className="h-40 min-h-40 min-w-0">
                      <MeasuredResponsiveChart>
                        <PieChart>
                          <Pie data={slices} cx="50%" cy="50%" innerRadius={32} outerRadius={62} paddingAngle={2} dataKey="value">
                            {slices.map((slice) => (
                              <Cell key={`cell-${entry.attribute}-${dist.sampleNumber}-${slice.name}`} fill={slice.fill} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value) => `${value}%`} />
                        </PieChart>
                      </MeasuredResponsiveChart>
                    </div>
                    <div className="mt-2 flex justify-between text-[10px]">
                      <span className="text-red-500">{dist.tooLowPercent}% Low</span>
                      <span className="font-semibold text-green-600">{dist.justRightPercent}% JAR</span>
                      <span className="text-orange-500">{dist.tooHighPercent}% High</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatisticalSummaryPanel({ variableLabel, stat }: { variableLabel: string; stat: ComparisonStat }) {
  return (
    <div className="space-y-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm">
      <div>
        <p className="text-xs uppercase text-[#64748b]">Variable</p>
        <p className="font-semibold text-[#0f172a]">{variableLabel}</p>
      </div>
      <div>
        <p className="text-xs uppercase text-[#64748b]">Test</p>
        <p className="font-semibold text-[#0f172a]">{stat.testLabel}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs uppercase text-[#64748b]">p-value</p>
          <p className="font-semibold text-[#0f172a]">
            {stat.formattedPValue}
            {stat.significant ? <span className="ml-1 text-red-600">*</span> : null}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-[#64748b]">Design</p>
          <p className="font-semibold text-[#0f172a]">{stat.repeatedMeasures ? "Repeated" : "Independent"}</p>
        </div>
        {stat.effectSize && (
          <div className="col-span-2">
            <p className="text-xs uppercase text-[#64748b]">Effect size</p>
            <p className="font-semibold text-[#0f172a]">
              {stat.effectSize.label} = {stat.effectSize.value} ({stat.effectSize.magnitude})
            </p>
          </div>
        )}
      </div>
      <p className="rounded-lg border border-[#dbeafe] bg-white px-3 py-2 text-xs text-[#1e3a8a]">
        {stat.interpretation}
      </p>
    </div>
  );
}

function ComparisonStatisticsPanel({ comparison }: { comparison: ComparisonEntry | null }) {
  if (!comparison) {
    return (
      <div className="space-y-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm text-[#64748b]">
        Select samples and a variable to run a comparison.
      </div>
    );
  }
  const { statisticalComparison } = comparison;
  return (
    <div className="space-y-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm">
      <div>
        <p className="text-xs uppercase text-[#64748b]">Variable</p>
        <p className="font-semibold text-[#0f172a]">{comparison.variableLabel}</p>
      </div>
      <div>
        <p className="text-xs uppercase text-[#64748b]">Statistical Test</p>
        <p className="font-semibold text-[#0f172a]">{statisticalComparison.testLabel}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs uppercase text-[#64748b]">P-value</p>
          <p className="font-semibold text-[#0f172a]">{statisticalComparison.formattedPValue}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-[#64748b]">Design</p>
          <p className="font-semibold text-[#0f172a]">{statisticalComparison.repeatedMeasures ? "Repeated" : "Independent"}</p>
        </div>
        {statisticalComparison.effectSize && (
          <div className="col-span-2">
            <p className="text-xs uppercase text-[#64748b]">Effect size</p>
            <p className="font-semibold text-[#0f172a]">
              {statisticalComparison.effectSize.label} = {statisticalComparison.effectSize.value} ({statisticalComparison.effectSize.magnitude})
            </p>
          </div>
        )}
      </div>
      <p className="rounded-lg border border-[#dbeafe] bg-white px-3 py-2 text-xs text-[#1e3a8a]">
        {statisticalComparison.interpretation}
      </p>
      {statisticalComparison.assumptionChecks && (
        <details className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#475569]">
          <summary className="cursor-pointer font-semibold text-[#0f172a]">Assumption checks</summary>
          <ul className="mt-2 space-y-1">
            <li>{statisticalComparison.assumptionChecks.normality.detail}</li>
            <li>{statisticalComparison.assumptionChecks.homogeneity.detail}</li>
            <li>{statisticalComparison.assumptionChecks.sampleSizeAdequacy.detail}</li>
          </ul>
          <p className="mt-2 text-[#0f172a]">{statisticalComparison.assumptionChecks.rationale}</p>
        </details>
      )}
      {statisticalComparison.warnings.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {statisticalComparison.warnings.join(" ")}
        </p>
      )}
    </div>
  );
}

function ComparisonOutputTable({ comparison }: { comparison: ComparisonEntry }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-[#f8fafc]">
          <tr>
            <th className="px-4 py-3 text-left">Sample</th>
            <th className="px-4 py-3 text-center">Mean</th>
            <th className="px-4 py-3 text-center">Std. Dev.</th>
            <th className="px-4 py-3 text-center">N</th>
            <th className="px-4 py-3 text-center">95% CI</th>
          </tr>
        </thead>
        <tbody>
          {comparison.samples.map((sample) => (
            <tr key={`comparison-${sample.sampleNumber}`} className="border-b border-[#e2e8f0]">
              <td className="px-4 py-3 font-medium text-[#0f172a]">{sample.sampleLabel}</td>
              <td className="px-4 py-3 text-center">{sample.stats.mean}</td>
              <td className="px-4 py-3 text-center">{sample.stats.stdDev}</td>
              <td className="px-4 py-3 text-center">{sample.stats.n}</td>
              <td className="px-4 py-3 text-center text-xs text-[#475569]">
                {sample.stats.confidenceInterval
                  ? `[${sample.stats.confidenceInterval.lower}, ${sample.stats.confidenceInterval.upper}]`
                  : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PostHocTable({ results }: { results: PostHocComparison[] }) {
  return (
    <div className="mt-4 rounded-lg border border-[#e2e8f0] bg-white p-3">
      <h3 className="text-sm font-semibold text-[#0f172a]">Post-hoc comparisons</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-[#f8fafc]">
            <tr>
              <th className="px-3 py-2 text-left">Pair</th>
              <th className="px-3 py-2 text-center">Mean diff</th>
              <th className="px-3 py-2 text-center">Adjusted p</th>
              <th className="px-3 py-2 text-center">Significant</th>
              <th className="px-3 py-2 text-left">Method</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr key={row.pairLabel} className="border-t border-[#e2e8f0]">
                <td className="px-3 py-2">{row.pairLabel}</td>
                <td className="px-3 py-2 text-center">{row.meanDifference ?? "-"}</td>
                <td className="px-3 py-2 text-center">{row.adjustedPValue !== null ? row.adjustedPValue.toFixed(3) : "-"}</td>
                <td className="px-3 py-2 text-center">
                  {row.significant === null ? "-" : row.significant ? "Yes" : "No"}
                </td>
                <td className="px-3 py-2 text-[#475569]">{row.method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataQualityCard({ report }: { report: DataQualityReport }) {
  const headlineColor =
    report.status === "PASSED"
      ? "text-emerald-700"
      : report.status === "BLOCKED"
        ? "text-red-700"
        : "text-amber-700";
  const Icon = report.status === "BLOCKED" ? AlertTriangle : report.status === "PASSED" ? CheckCircle : ShieldAlert;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5" />
        <div>
          <p className={`font-semibold ${headlineColor}`}>
            {report.status === "PASSED"
              ? "Passed"
              : report.status === "BLOCKED"
                ? "Blocked"
                : "Passed with warnings"}
          </p>
          <p className="text-xs text-[#475569]">{report.recommendation}</p>
        </div>
      </div>
      <div className="grid gap-2 text-xs md:grid-cols-4">
        <Metric label="Respondents" value={report.totals.respondents} />
        <Metric label="Samples evaluated" value={report.totals.samplesEvaluated} />
        <Metric label="Incomplete" value={report.totals.incompleteRespondents} />
        <Metric label="Flagged" value={report.totals.flaggedRespondents} />
      </div>
      {report.findings.length > 0 ? (
        <ul className="space-y-2 text-xs">
          {report.findings.map((finding) => (
            <li key={finding.code} className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
              <p className="font-semibold text-[#0f172a]">
                {finding.label} <span className="ml-2 rounded-full bg-[#e2e8f0] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#475569]">{finding.severity}</span>
              </p>
              <p className="mt-1 text-[#475569]">{finding.message}</p>
              <p className="mt-1 text-[#0f172a]">{finding.affectedCount} respondent(s) affected.</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          No data quality issues detected.
        </p>
      )}
    </div>
  );
}

function CataAnalysisCard({ analysis }: { analysis: CataAnalysis }) {
  if (analysis.terms.length === 0) {
    const messages = analysis.warnings.length > 0 ? analysis.warnings : ["No CATA data available yet."];
    return (
      <div className="space-y-2 text-sm text-[#64748b]">
        {messages.map((warning, index) => (
          <p key={index}>{warning}</p>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-[#64748b]">
        Percentage of panelists who selected each term per sample (Frequency Analysis). Cochran&apos;s Q tests whether the
        selection rate differs across samples (complete cases: {analysis.completeCaseCount}).
      </p>
      <div className="overflow-x-auto rounded-lg border border-[#e2e8f0]">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-[#f8fafc] text-left text-xs uppercase tracking-wide text-[#64748b]">
            <tr>
              <th className="px-3 py-2 font-semibold">Term</th>
              {analysis.sampleLabels.map((label) => (
                <th key={label} className="px-3 py-2 font-semibold">
                  {label}
                </th>
              ))}
              <th className="px-3 py-2 font-semibold">Cochran&apos;s Q</th>
              <th className="px-3 py-2 font-semibold">p-value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f1f5f9]">
            {analysis.terms.map((term) => (
              <tr key={term.term}>
                <td className="px-3 py-2 font-medium text-[#1e293b]">
                  {term.term}
                  {term.significant && (
                    <span className="ml-2 rounded-full bg-[#fff7ed] px-2 py-0.5 text-[10px] font-semibold text-[#c2410c]">
                      Differs
                    </span>
                  )}
                </td>
                {term.percentBySample.map((percent, index) => (
                  <td key={index} className="px-3 py-2 tabular-nums text-[#475569]">
                    {percent}% <span className="text-[#94a3b8]">({term.countsBySample[index] ?? 0})</span>
                  </td>
                ))}
                <td className="px-3 py-2 tabular-nums text-[#475569]">{term.pValue === null ? "—" : term.cochranQ}</td>
                <td className={`px-3 py-2 tabular-nums ${term.significant ? "font-semibold text-[#c2410c]" : "text-[#64748b]"}`}>
                  {term.pValue === null ? "—" : term.pValue < 0.001 ? "<0.001" : term.pValue.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {analysis.warnings.length > 0 && (
        <div className="space-y-1">
          {analysis.warnings.map((warning, index) => (
            <p key={index} className="text-xs text-[#94a3b8]">
              {warning}
            </p>
          ))}
        </div>
      )}
      <p className="text-[11px] text-[#64748b]">
        A significant Cochran&apos;s Q (p &lt; 0.05) means the term was selected at different rates across samples.
      </p>
    </div>
  );
}

function CustomQuestionSummariesCard({ summaries }: { summaries: CustomQuestionSummary[] }) {
  const typeLabels: Record<CustomQuestionSummary["type"], string> = {
    MULTIPLE_CHOICE: "Multiple Choice",
    CHECKBOXES: "Checkboxes",
    PARAGRAPH: "Paragraph",
  };
  return (
    <div className="space-y-5 text-sm">
      {summaries.map((summary) => (
        <div key={summary.id} className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-[#0f172a]">{summary.text}</p>
            <span className="shrink-0 rounded-full bg-[#e2e8f0] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#475569]">
              {typeLabels[summary.type]}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#64748b]">
            {summary.responseCount} response{summary.responseCount === 1 ? "" : "s"}
          </p>

          {summary.type === "PARAGRAPH" ? (
            summary.textAnswers && summary.textAnswers.length > 0 ? (
              <ul className="mt-3 max-h-60 space-y-2 overflow-y-auto">
                {summary.textAnswers.map((answer, index) => (
                  <li
                    key={`${summary.id}-answer-${index}`}
                    className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#334155]"
                  >
                    {answer}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-[#94a3b8]">No responses yet.</p>
            )
          ) : (
            <div className="mt-3 space-y-2">
              {(summary.optionCounts ?? []).map((option) => (
                <div key={option.option}>
                  <div className="flex items-center justify-between gap-3 text-xs text-[#334155]">
                    <span className="truncate">{option.option}</span>
                    <span className="shrink-0 tabular-nums text-[#64748b]">
                      {option.count} ({option.percent}%)
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
                    <div
                      className="h-full rounded-full bg-[#f97316]"
                      style={{ width: `${Math.min(100, Math.max(0, option.percent))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AdvancedAnalyticsSection({ analytics }: { analytics: AdvancedAnalytics }) {
  return (
    <Card title="Advanced exploratory analysis" className="lg:col-span-2">
      <p className="mb-3 rounded-lg border border-[#fef3c7] bg-[#fffbeb] px-3 py-2 text-xs text-[#92400e]">
        These views are exploratory: PCA, clustering, and preference mapping highlight structure but do not replace the primary
        statistical comparison above.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        {analytics.preferenceMap ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-[#0f172a]">Preference map</h3>
            <PreferenceMap samples={analytics.preferenceMap.samples} />
            <p className="mt-2 text-xs text-[#475569]">{analytics.preferenceMap.rationale}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[#cbd5e1] p-4 text-xs text-[#64748b]">
            Preference map could not be computed for this study.
          </div>
        )}
        {analytics.pca ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-[#0f172a]">PCA on attribute means</h3>
            <ul className="space-y-1 text-xs text-[#475569]">
              {analytics.pca.components.map((component) => (
                <li key={`pc-${component.component}`}>
                  PC{component.component}: explains {(component.explainedVariance * 100).toFixed(1)}% of variance.
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[#475569]">{analytics.pca.rationale}</p>
          </div>
        ) : null}
      </div>
      {analytics.segmentation && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-[#0f172a]">Consumer segmentation (k-means)</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {analytics.segmentation.segments.map((segment) => (
              <div key={segment.label} className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 text-xs">
                <p className="font-semibold text-[#0f172a]">{segment.label} · {segment.size} consumer(s)</p>
                <p className="mt-1 text-[#475569]">
                  Centroid:{" "}
                  {Object.entries(segment.centroid)
                    .slice(0, 4)
                    .map(([attribute, value]) => `${attribute} ${value.toFixed(1)}`)
                    .join(" · ")}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-[#475569]">{analytics.segmentation.rationale}</p>
        </div>
      )}
      {analytics.warnings.length > 0 && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {analytics.warnings.join(" ")}
        </p>
      )}
    </Card>
  );
}

function getDecisionStyle(flag: string | null) {
  switch (flag) {
    case "READY_FOR_COMMERCIALIZATION":
      return { wrapper: "border-emerald-200 bg-emerald-50 text-emerald-800" };
    case "READY_FOR_READINESS":
      return { wrapper: "border-green-200 bg-green-50 text-green-800" };
    case "CONTINUE_REFINEMENT":
      return { wrapper: "border-amber-200 bg-amber-50 text-amber-800" };
    case "NEEDS_IMPROVEMENT":
      return { wrapper: "border-rose-200 bg-rose-50 text-rose-800" };
    default:
      return { wrapper: "border-slate-200 bg-slate-100 text-slate-800" };
  }
}

type ExportCellValue = string | number | null;
type ExportRow = Record<string, ExportCellValue>;
type ExportSection = {
  title: string;
  rows: ExportRow[];
};
type AnalysisExportContext = {
  title: string;
  generatedAt: string;
  fileBaseName: string;
  sections: ExportSection[];
};

function buildAnalysisExportContext(analysis: AnalysisPayload): AnalysisExportContext {
  const overallLiking = analysis.overallLiking;
  const studyOverview = analysis.studyOverview ?? overallLiking.studyOverview ?? null;
  const comparativeAnalysis = analysis.comparativeAnalysis ?? overallLiking.comparativeAnalysis ?? null;
  const primaryComparison = comparativeAnalysis?.primaryComparison ?? null;
  const bySample = analysis.perSampleResults ?? overallLiking.bySample ?? [];
  const samplePerformance = overallLiking.samplePerformance ?? [];
  const meanDropAnalysis = analysis.meanDropAnalysis ?? overallLiking.meanDropAnalysis ?? [];
  const automaticInterpretation = analysis.automaticInterpretation ?? overallLiking.automaticInterpretation ?? null;
  const dataQuality = analysis.dataQuality ?? overallLiking.dataQuality ?? null;
  const advancedAnalytics = analysis.advancedAnalytics ?? overallLiking.advancedAnalytics ?? null;
  const generatedAt = formatExportDate(analysis.generatedAt);
  const reportTitle = studyOverview?.title ? `${studyOverview.title} - Sensory Analysis Results` : "Sensory Analysis Results";
  const fileBaseName = sanitizeFileName(`${studyOverview?.title ?? "sensory-analysis"}-${studyOverview?.productName ?? "results"}`);

  const overviewRows: ExportRow[] = [
    { Field: "Study", Value: studyOverview?.title ?? "-" },
    { Field: "Product", Value: studyOverview?.productName || "-" },
    { Field: "Status", Value: studyOverview?.status ? studyOverview.status.replace(/_/g, " ") : "-" },
    { Field: "Study Design", Value: studyOverview?.studyDesignLabel ?? (studyOverview?.studyDesign ?? "-") },
    { Field: "Consumers", Value: studyOverview ? `${studyOverview.numberOfConsumers}/${studyOverview.targetConsumers}` : overallLiking.n },
    { Field: "Samples", Value: studyOverview?.numberOfSamples ?? bySample.length },
    { Field: "Hedonic Scale", Value: studyOverview?.hedonicScale ?? "-" },
    { Field: "JAR Scale", Value: studyOverview?.jarScale ?? "-" },
    { Field: "Date Conducted", Value: studyOverview?.dateConducted ? formatExportDate(studyOverview.dateConducted) : "-" },
    { Field: "Report Generated", Value: generatedAt },
  ];
  const dataQualityRows = dataQuality
    ? [
        { Field: "Status", Value: dataQuality.status },
        { Field: "Recommendation", Value: dataQuality.recommendation },
        { Field: "Respondents", Value: dataQuality.totals.respondents },
        { Field: "Samples Evaluated", Value: dataQuality.totals.samplesEvaluated },
        { Field: "Incomplete Respondents", Value: dataQuality.totals.incompleteRespondents },
        { Field: "Flagged Respondents", Value: dataQuality.totals.flaggedRespondents },
      ]
    : [];
  const dataQualityFindingRows = dataQuality
    ? dataQuality.findings.map((finding) => ({
        Code: finding.code,
        Label: finding.label,
        Severity: finding.severity,
        "Affected Respondents": finding.affectedCount,
        Message: finding.message,
      }))
    : [];
  const interpretationRows =
    automaticInterpretation?.summary.map((line, index) => ({ No: index + 1, Insight: line })) ?? [];
  const recommendationRows: ExportRow[] = [
    { Field: "Decision Flag", Value: analysis.decisionFlag ? analysis.decisionFlag.replace(/_/g, " ") : "-" },
    { Field: "AI Interpretation", Value: analysis.aiInterpretation ?? "AI interpretation is not available." },
    {
      Field: "Action Required",
      Value: analysis.aiRecommendation ?? "Collect more responses or configure a server-side AI provider API key.",
    },
  ];
  const comparisonRows =
    primaryComparison?.samples.map((sample) => ({
      Sample: sample.sampleLabel,
      "Sample No.": sample.sampleNumber,
      Mean: roundMetric(sample.stats.mean),
      "Std. Dev.": roundMetric(sample.stats.stdDev),
      N: sample.stats.n,
      "95% CI Lower": sample.stats.confidenceInterval?.lower ?? null,
      "95% CI Upper": sample.stats.confidenceInterval?.upper ?? null,
    })) ?? [];
  const statisticalComparisonRows = primaryComparison
    ? [
        { Field: "Variable", Value: primaryComparison.variableLabel },
        { Field: "Statistical Test", Value: primaryComparison.statisticalComparison.testLabel },
        { Field: "P-value", Value: primaryComparison.statisticalComparison.formattedPValue },
        { Field: "Design", Value: primaryComparison.statisticalComparison.repeatedMeasures ? "Repeated measures" : "Independent samples" },
        {
          Field: "Effect Size",
          Value: primaryComparison.statisticalComparison.effectSize
            ? `${primaryComparison.statisticalComparison.effectSize.label} = ${primaryComparison.statisticalComparison.effectSize.value} (${primaryComparison.statisticalComparison.effectSize.magnitude})`
            : "-",
        },
        { Field: "Assumption Pathway", Value: primaryComparison.statisticalComparison.assumptionChecks?.recommendedPathway ?? "-" },
        { Field: "Assumption Rationale", Value: primaryComparison.statisticalComparison.assumptionChecks?.rationale ?? "-" },
        {
          Field: "Significant",
          Value: primaryComparison.statisticalComparison.significant === null ? "Not determined" : primaryComparison.statisticalComparison.significant ? "Yes" : "No",
        },
        { Field: "Interpretation", Value: primaryComparison.statisticalComparison.interpretation },
        { Field: "Warnings", Value: primaryComparison.statisticalComparison.warnings.join(" ") || "-" },
      ]
    : [];
  const postHocRows = primaryComparison?.statisticalComparison.postHocResults?.map((row) => ({
    Pair: row.pairLabel,
    Method: row.method,
    "Mean Difference": row.meanDifference,
    "Raw p": row.rawPValue,
    "Adjusted p": row.adjustedPValue,
    Significant: row.significant === null ? "-" : row.significant ? "Yes" : "No",
  })) ?? [];
  const samplePerformanceRows = samplePerformance.map((sample) => ({
    Sample: sample.sampleLabel,
    "Sample No.": sample.sampleNumber,
    "Mean Overall Liking": roundMetric(sample.meanScore),
    Respondents: sample.n,
    Interpretation: sample.interpretation,
  }));
  const attributeLikingRows = analysis.attributeStats
    .filter((attribute) => attribute.type === "LIKING")
    .map((attribute) => ({
      Attribute: attribute.name,
      Mean: roundMetric(attribute.stats?.mean),
    }));
  const jarDistributionRows = analysis.attributeStats
    .filter((attribute) => attribute.type === "JAR")
    .map((attribute) => ({
      Attribute: attribute.name,
      "Too Low %": roundMetric(attribute.distribution?.tooLow.percent),
      "Just Right %": roundMetric(attribute.distribution?.justRight.percent),
      "Too High %": roundMetric(attribute.distribution?.tooHigh.percent),
    }));
  const penaltyRows = analysis.penaltyAnalysis.map((penalty) => ({
    Attribute: penalty.attribute,
    "Too Low %": roundMetric(penalty.tooLowPercent),
    "Too Low Penalty": roundMetric(penalty.tooLowPenalty),
    "Too High %": roundMetric(penalty.tooHighPercent),
    "Too High Penalty": roundMetric(penalty.tooHighPenalty),
    "Driver Level": formatDriverLevel(penalty.driverLevel),
    Actionable: penalty.isActionable ? "Yes" : "No",
    Significant: penalty.isSignificant ? "Yes" : "No",
  }));
  const perSampleMetricRows = bySample.map((sample) => ({
    Sample: sample.sampleLabel,
    "Sample No.": sample.sampleNumber,
    Participants: sample.overallLiking.n,
    "Mean Liking": roundMetric(sample.overallLiking.mean),
    "Std. Dev.": roundMetric(sample.overallLiking.stdDev),
    Median: roundMetric(sample.overallLiking.median),
    "95% CI Lower": sample.overallLiking.confidenceInterval?.lower ?? null,
    "95% CI Upper": sample.overallLiking.confidenceInterval?.upper ?? null,
    Interpretation: sample.interpretation,
  }));
  const perSampleAttributeRows = bySample.flatMap((sample) =>
    sample.attributeLiking?.map((row) => ({
      Sample: sample.sampleLabel,
      "Sample No.": sample.sampleNumber,
      Attribute: row.attribute,
      Mean: roundMetric(row.stats.mean),
      "Std. Dev.": roundMetric(row.stats.stdDev),
      "95% CI Lower": row.stats.confidenceInterval?.lower ?? null,
      "95% CI Upper": row.stats.confidenceInterval?.upper ?? null,
      N: row.stats.n,
    })) ?? [],
  );
  const perSampleJarRows = bySample.flatMap((sample) =>
    sample.jarBreakdown.map((row) => ({
      Sample: sample.sampleLabel,
      "Sample No.": sample.sampleNumber,
      Attribute: row.attribute,
      "Too Low %": roundMetric(row.tooLowPercent),
      "Just Right %": roundMetric(row.justRightPercent),
      "Too High %": roundMetric(row.tooHighPercent),
      "Too Low Penalty": roundMetric(row.tooLowPenalty),
      "Too High Penalty": roundMetric(row.tooHighPenalty),
      Driver: formatDriverLevel(row.driverLevel),
    })),
  );
  const meanDropRows = meanDropAnalysis.map((row) => ({
    Sample: row.sampleLabel,
    "Sample No.": row.sampleNumber,
    Attribute: row.attribute,
    "JAR Count": row.jarCount,
    "Non-JAR Count": row.nonJarCount,
    "JAR %": roundMetric(row.jarPercent),
    "Too Low %": roundMetric(row.tooLowPercent),
    "Too High %": roundMetric(row.tooHighPercent),
    "JAR Mean": roundMetric(row.jarMean),
    "Non-JAR Mean": roundMetric(row.nonJarMean),
    "Mean Drop": roundMetric(row.meanDrop),
    "Too Low Mean Drop": roundMetric(row.tooLowMeanDrop),
    "Too High Mean Drop": roundMetric(row.tooHighMeanDrop),
    Severity: formatDriverLevel(row.severity),
  }));
  const advancedRows: ExportRow[] = [];
  if (advancedAnalytics?.pca) {
    advancedAnalytics.pca.components.forEach((component) => {
      advancedRows.push({
        Field: `PC${component.component} explained variance`,
        Value: roundMetric(component.explainedVariance),
      });
    });
  }
  if (advancedAnalytics?.segmentation) {
    advancedAnalytics.segmentation.segments.forEach((segment) => {
      advancedRows.push({ Field: segment.label, Value: `n=${segment.size}` });
    });
  }
  if (advancedAnalytics?.preferenceMap) {
    advancedAnalytics.preferenceMap.samples.forEach((sample) => {
      advancedRows.push({
        Field: `${sample.sampleLabel} (PC1, PC2)`,
        Value: `(${sample.x.toFixed(2)}, ${sample.y.toFixed(2)}) — mean liking ${sample.meanLiking.toFixed(2)}`,
      });
    });
  }

  // Comparative analysis: overall liking, attribute liking, JAR distribution.
  const overallLikingComparisonRows = comparativeAnalysis?.overallLikingComparison?.samples.map((sample) => ({
    Sample: sample.sampleLabel,
    "Sample No.": sample.sampleNumber,
    Mean: roundMetric(sample.mean),
    "Std. Error": roundMetric(sample.stdError ?? null),
    N: sample.n,
    Letter: sample.letter ?? "-",
  })) ?? [];
  const attributeLikingComparisonRows = comparativeAnalysis?.attributeLikingComparison?.flatMap((entry) =>
    entry.samples.map((sample) => ({
      Attribute: entry.attribute,
      Sample: sample.sampleLabel,
      "Sample No.": sample.sampleNumber,
      Mean: roundMetric(sample.mean),
      "Std. Error": roundMetric(sample.stdError ?? null),
      N: sample.n,
      Letter: sample.letter ?? "-",
      Test: entry.statisticalComparison.testLabel,
      "p-value": entry.statisticalComparison.formattedPValue,
    })),
  ) ?? [];
  const jarRatingComparisonRows = comparativeAnalysis?.jarRatingComparison?.flatMap((entry) =>
    entry.samples.map((sample) => ({
      Attribute: entry.attribute,
      Sample: sample.sampleLabel,
      "Sample No.": sample.sampleNumber,
      "Mean JAR (1-5)": roundMetric(sample.mean),
      "Std. Error": roundMetric(sample.stdError ?? null),
      N: sample.n,
      Letter: sample.letter ?? "-",
      Test: entry.statisticalComparison.testLabel,
      "p-value": entry.statisticalComparison.formattedPValue,
    })),
  ) ?? [];
  const jarDistributionComparisonRows = comparativeAnalysis?.jarDistributionComparison?.flatMap((entry) =>
    entry.distributions.map((dist) => ({
      Attribute: entry.attribute,
      Sample: dist.sampleLabel,
      "Sample No.": dist.sampleNumber,
      "Too Low %": dist.tooLowPercent,
      "Just Right %": dist.justRightPercent,
      "Too High %": dist.tooHighPercent,
    })),
  ) ?? [];

  return {
    title: reportTitle,
    generatedAt,
    fileBaseName,
    sections: [
      { title: "Study Overview", rows: overviewRows },
      { title: "Data Quality", rows: dataQualityRows },
      { title: "Data Quality Findings", rows: dataQualityFindingRows },
      // Per-sample first (sample-first reporting order).
      { title: "Per Sample Metrics", rows: perSampleMetricRows },
      { title: "Per Sample JAR And Penalty", rows: perSampleJarRows },
      { title: "Per Sample Attribute Liking", rows: perSampleAttributeRows },
      { title: "Mean Drop Analysis", rows: meanDropRows },
      // Comparative analysis.
      { title: "Overall Liking Comparison", rows: overallLikingComparisonRows },
      { title: "Mean Attribute Liking Comparison", rows: attributeLikingComparisonRows },
      { title: "Mean JAR Rating Comparison", rows: jarRatingComparisonRows },
      { title: "JAR Distribution Comparison", rows: jarDistributionComparisonRows },
      { title: "Statistical Test (Primary)", rows: statisticalComparisonRows },
      { title: "Comparative Analysis Samples", rows: comparisonRows },
      { title: "Post-hoc Comparisons", rows: postHocRows },
      // Aggregate sections.
      { title: "By Sample Performance", rows: samplePerformanceRows },
      { title: "Attribute Liking Scores (Overall)", rows: attributeLikingRows },
      { title: "JAR Distribution (Overall)", rows: jarDistributionRows },
      { title: "Penalty Analysis", rows: penaltyRows },
      { title: "Advanced Analytics", rows: advancedRows },
      // AI interpretation/recommendation at the bottom.
      { title: "Automatic Interpretation", rows: interpretationRows },
      { title: "AI Recommendation", rows: recommendationRows },
    ],
  };
}

async function exportAnalysisExcel(context: AnalysisExportContext) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  context.sections.forEach((section) => {
    const rows = section.rows.length > 0 ? section.rows.map(sanitizeExcelRow) : [{ Message: "No records available" }];
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = Object.keys(rows[0] ?? {}).map((column) => ({
      wch: Math.min(Math.max(column.length + 4, 14), 42),
    }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeWorksheetName(section.title, workbook.SheetNames));
  });
  XLSX.writeFile(workbook, `${context.fileBaseName}-sensory-analysis.xlsx`, { compression: true });
}

async function exportAnalysisPdf(context: AnalysisExportContext, comparisonChartElement: HTMLElement | null) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let currentY = 46;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(context.title, margin, currentY, { maxWidth: pageWidth - margin * 2 });
  currentY += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`Generated: ${context.generatedAt}`, margin, currentY);
  currentY += 22;

  const chartImage = comparisonChartElement ? await captureSvgAsPng(comparisonChartElement) : null;
  if (chartImage) {
    if (currentY > pageHeight - 220) {
      doc.addPage();
      currentY = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Comparative Analysis Chart", margin, currentY);
    currentY += 8;
    const imageWidth = pageWidth - margin * 2;
    const imageHeight = (imageWidth * chartImage.height) / chartImage.width;
    doc.addImage(chartImage.dataUrl, "PNG", margin, currentY, imageWidth, imageHeight);
    currentY += imageHeight + 18;
  }

  context.sections.forEach((section) => {
    const columns = getExportColumns(section.rows);
    const body = section.rows.length > 0 ? section.rows.map((row) => columns.map((column) => formatPdfCell(row[column]))) : [["No records available"]];
    const head = section.rows.length > 0 ? [columns] : [["Status"]];
    if (currentY > pageHeight - 110) {
      doc.addPage();
      currentY = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(section.title, margin, currentY);
    currentY += 8;
    autoTable(doc, {
      startY: currentY,
      head,
      body,
      theme: "grid",
      margin: { left: margin, right: margin },
      styles: { font: "helvetica", fontSize: 7, cellPadding: 4, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
    currentY = ((doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? currentY) + 20;
  });

  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`TARAsense Sensory Analysis Results | Page ${pageNumber} of ${pageCount}`, margin, pageHeight - 24);
  }

  doc.save(`${context.fileBaseName}-sensory-analysis.pdf`);
}

async function captureSvgAsPng(element: HTMLElement): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const svg = element.querySelector("svg");
  if (!svg) return null;
  const cloned = svg.cloneNode(true) as SVGSVGElement;
  const widthAttr = cloned.getAttribute("width");
  const heightAttr = cloned.getAttribute("height");
  const viewBox = cloned.viewBox.baseVal;
  const width = Math.round(Number(widthAttr) || viewBox?.width || 800);
  const height = Math.round(Number(heightAttr) || viewBox?.height || 320);
  cloned.setAttribute("width", String(width));
  cloned.setAttribute("height", String(height));
  cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const svgString = new XMLSerializer().serializeToString(cloned);
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const dataUrl = await new Promise<string>((resolve, reject) => {
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context unavailable"));
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = (event) => reject(event);
      image.src = url;
    });
    return { dataUrl, width, height };
  } catch (error) {
    console.warn("Could not capture chart for PDF embedding:", error);
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function getExportColumns(rows: ExportRow[]) {
  const columnSet = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((column) => columnSet.add(column));
  });
  return Array.from(columnSet);
}

function sanitizeExcelRow(row: ExportRow): ExportRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? sanitizeExcelText(value) : value ?? "-"]),
  );
}

function sanitizeExcelText(value: string) {
  const normalized = value.replace(/[ --]/g, " ").trim();
  return /^[=+\-@\t\r]/.test(normalized) ? `'${normalized}` : normalized;
}

function sanitizeFileName(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "sensory-analysis-results";
}

function sanitizeWorksheetName(value: string, existingNames: string[]) {
  const baseName = value.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let worksheetName = baseName;
  let suffix = 1;
  while (existingNames.includes(worksheetName)) {
    const suffixText = ` ${suffix}`;
    worksheetName = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  return worksheetName;
}

function roundMetric(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function formatExportDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString("en-US", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDriverLevel(level: "STRONG" | "MODERATE" | "NOT_ACTIONABLE") {
  if (level === "STRONG") return "Strong Driver";
  if (level === "MODERATE") return "Moderate Driver";
  return "Not Actionable";
}

function formatPdfCell(value: ExportCellValue | undefined) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function MeasuredResponsiveChart({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setReady(rect.width > 0 && rect.height > 0);
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full min-w-0">
      {ready ? (
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}

function Card({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ${className ?? ""}`}>
      <h2 className="mb-4 text-lg font-semibold text-[#0f172a]">{title}</h2>
      {children}
    </section>
  );
}

function OverviewItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-[#64748b]">{label}</p>
      <p className="mt-1 truncate font-semibold text-[#0f172a]">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2">
      <p className="text-xs text-[#64748b]">{label}</p>
      <p className="mt-1 truncate font-semibold text-[#0f172a]">{value}</p>
    </div>
  );
}

function DriverBadge({ level }: { level: "STRONG" | "MODERATE" | "NOT_ACTIONABLE" }) {
  if (level === "STRONG") {
    return <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">Strong Driver</span>;
  }
  if (level === "MODERATE") {
    return <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">Moderate Driver</span>;
  }
  return <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">Not Actionable</span>;
}
