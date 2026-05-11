"use client";

import { useEffect, useState } from "react";
import { buildApiUrl } from "@/lib/api-config";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { AlertTriangle, CheckCircle, Download, Lightbulb, Users } from "lucide-react";

interface ResultsDashboardProps {
  studyId: string;
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

interface SampleAnalysisBlock {
  sampleNumber: number;
  sampleLabel: string;
  overallLiking: { mean: number; stdDev: number; n: number; median?: number };
  interpretation: string;
  attributeLiking?: Array<{ attribute: string; stats: { mean: number; stdDev: number; n: number } }>;
  jarBreakdown: SampleJarBreakdownRow[];
  meanDropAnalysis?: Array<Omit<SampleMeanDropRow, "sampleNumber" | "sampleLabel">>;
}

interface StudyOverview {
  title: string;
  productName: string;
  status: string;
  numberOfConsumers: number;
  targetConsumers: number;
  numberOfSamples: number;
  attributesEvaluated: Array<{ name: string; type: string }>;
  hedonicScale: string;
  jarScale: string | null;
  dateConducted: string | null;
}

interface ComparativeAnalysis {
  sampleOptions: Array<{ sampleNumber: number; sampleLabel: string }>;
  variableOptions: Array<{ key: string; label: string; type: string }>;
  primaryComparison: {
    variableKey: string;
    variableLabel: string;
    samples: Array<{
      sampleNumber: number;
      sampleLabel: string;
      stats: { mean: number; stdDev: number; n: number };
    }>;
    statisticalComparison: {
      testLabel: string;
      repeatedMeasures: boolean;
      pValue: number | null;
      formattedPValue: string;
      statistic: number | null;
      significant: boolean | null;
      interpretation: string;
      assumptions: string[];
      warnings: string[];
    };
  } | null;
}

interface AutomaticInterpretation {
  summary: string[];
  decisionSupport?: {
    formattedPrimaryPValue?: string;
    hasSignificantDifference?: boolean | null;
  };
}

interface AnalysisPayload {
  generatedAt: string;
  studyOverview?: StudyOverview | null;
  overallLiking: {
    mean: number;
    stdDev: number;
    n: number;
    median?: number;
    samplePerformance?: SamplePerformanceRow[];
    bestSample?: SamplePerformanceRow | null;
    bySample?: SampleAnalysisBlock[];
    studyOverview?: StudyOverview | null;
    comparativeAnalysis?: ComparativeAnalysis | null;
    meanDropAnalysis?: SampleMeanDropRow[];
    automaticInterpretation?: AutomaticInterpretation | null;
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
  aiInterpretation: string | null;
  aiRecommendation: string | null;
  decisionFlag: string | null;
}

export function ResultsDashboard({ studyId }: ResultsDashboardProps) {
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<string>("");
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "excel" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(buildApiUrl(`/studies/${studyId}/analysis`), { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as AnalysisPayload;
        if (isMounted) {
          setAnalysis(payload);
        }
      } catch (fetchError) {
        if (isMounted) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load analysis.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [studyId]);

  if (loading) return <div className="px-6 py-8 text-sm text-[#64748b]">Loading analysis...</div>;
  if (error) return <div className="px-6 py-8 text-sm text-red-600">Failed to load analysis: {error}</div>;
  if (!analysis) return <div className="px-6 py-8 text-sm text-[#64748b]">No analysis available.</div>;

  const {
    overallLiking,
    attributeStats,
    penaltyAnalysis,
    aiInterpretation,
    aiRecommendation,
    decisionFlag,
  } = analysis;

  const decisionStyles = getDecisionStyle(decisionFlag);
  const actionableDrivers = penaltyAnalysis.filter((penalty) => penalty.isActionable);
  const samplePerformance = overallLiking.samplePerformance ?? [];
  const bySample = analysis.perSampleResults ?? overallLiking.bySample ?? [];
  const bestSample = overallLiking.bestSample;
  const studyOverview = analysis.studyOverview ?? overallLiking.studyOverview ?? null;
  const comparativeAnalysis = analysis.comparativeAnalysis ?? overallLiking.comparativeAnalysis ?? null;
  const primaryComparison = comparativeAnalysis?.primaryComparison ?? null;
  const meanDropAnalysis = analysis.meanDropAnalysis ?? overallLiking.meanDropAnalysis ?? [];
  const automaticInterpretation = analysis.automaticInterpretation ?? overallLiking.automaticInterpretation ?? null;
  const exportContext = buildAnalysisExportContext(analysis);
  const comparisonChartData =
    primaryComparison?.samples.map((sample) => ({
      name: sample.sampleLabel,
      mean: sample.stats.mean,
      stdDev: sample.stats.stdDev,
      n: sample.stats.n,
    })) ?? [];
  const sampleTabs =
    bySample.length > 0
      ? bySample.map((sample) => ({
          sampleNumber: sample.sampleNumber,
          sampleLabel: sample.sampleLabel,
        }))
      : samplePerformance.map((sample) => ({
          sampleNumber: sample.sampleNumber,
          sampleLabel: sample.sampleLabel,
        }));
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
  const selectedAttributeLikingData =
    selectedSample?.attributeLiking?.map((row) => ({
      name: row.attribute,
      mean: row.stats.mean,
      stdDev: row.stats.stdDev,
      n: row.stats.n,
    })) ?? [];
  const sampleMetricCards =
    bySample.length > 0
      ? bySample.map((sample) => ({
          sampleNumber: sample.sampleNumber,
          sampleLabel: sample.sampleLabel,
          participants: sample.overallLiking.n,
          mean: sample.overallLiking.mean,
          stdDev: sample.overallLiking.stdDev,
          decision: sample.interpretation,
        }))
      : samplePerformance.map((sample) => ({
          sampleNumber: sample.sampleNumber,
          sampleLabel: sample.sampleLabel,
          participants: sample.n,
          mean: sample.meanScore,
          stdDev: "-",
          decision: sample.interpretation,
        }));
  const runExport = async (format: "pdf" | "excel") => {
    setExportError(null);
    setExportingFormat(format);

    try {
      if (format === "pdf") {
        await exportAnalysisPdf(exportContext);
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
        <div>
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
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {exportError}
        </div>
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

      {automaticInterpretation && automaticInterpretation.summary.length > 0 && (
        <Card title="Automatic Interpretation">
          <div className="space-y-2 text-sm text-[#334155]">
            {automaticInterpretation.summary.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
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
              All Samples Comparison
            </button>
          </div>
        </nav>
      )}

      {selectedResultTab === comparisonTabId ? (
        <>
          <section className={`rounded-xl border p-5 ${decisionStyles.wrapper}`}>
            <div className="flex items-start gap-3">
              {decisionFlag === "NEEDS_IMPROVEMENT" ? <AlertTriangle size={22} /> : <CheckCircle size={22} />}
              <div>
                <h2 className="text-lg font-semibold">AI Recommendation: {(decisionFlag ?? "PENDING").replace(/_/g, " ")}</h2>
                <p className="mt-1 text-sm opacity-90">{aiInterpretation ?? "AI interpretation is not available yet."}</p>
                <p className="mt-3 rounded-lg border bg-white/60 px-3 py-2 text-sm">
                  <span className="font-semibold">Action Required:</span>{" "}
                  {aiRecommendation ?? "Collect more responses or configure OPENAI_API_KEY."}
                </p>
              </div>
            </div>
          </section>

          {primaryComparison && (
            <Card title="Comparative Analysis" className="lg:col-span-2">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="h-72 min-h-72 min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <BarChart data={comparisonChartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" />
                      <YAxis domain={[0, 9]} />
                      <Tooltip />
                      <Bar dataKey="mean" fill="#2563eb" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm">
                  <div>
                    <p className="text-xs uppercase text-[#64748b]">Variable</p>
                    <p className="font-semibold text-[#0f172a]">{primaryComparison.variableLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-[#64748b]">Statistical Test</p>
                    <p className="font-semibold text-[#0f172a]">{primaryComparison.statisticalComparison.testLabel}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs uppercase text-[#64748b]">P-value</p>
                      <p className="font-semibold text-[#0f172a]">{primaryComparison.statisticalComparison.formattedPValue}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-[#64748b]">Design</p>
                      <p className="font-semibold text-[#0f172a]">
                        {primaryComparison.statisticalComparison.repeatedMeasures ? "Repeated" : "Independent"}
                      </p>
                    </div>
                  </div>
                  <p className="rounded-lg border border-[#dbeafe] bg-white px-3 py-2 text-xs text-[#1e3a8a]">
                    {primaryComparison.statisticalComparison.interpretation}
                  </p>
                  {primaryComparison.statisticalComparison.warnings.length > 0 && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {primaryComparison.statisticalComparison.warnings.join(" ")}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-[#f8fafc]">
                    <tr>
                      <th className="px-4 py-3 text-left">Sample</th>
                      <th className="px-4 py-3 text-center">Mean</th>
                      <th className="px-4 py-3 text-center">Std. Dev.</th>
                      <th className="px-4 py-3 text-center">N</th>
                    </tr>
                  </thead>
                  <tbody>
                    {primaryComparison.samples.map((sample) => (
                      <tr key={`comparison-${sample.sampleNumber}`} className="border-b border-[#e2e8f0]">
                        <td className="px-4 py-3 font-medium text-[#0f172a]">{sample.sampleLabel}</td>
                        <td className="px-4 py-3 text-center">{sample.stats.mean}</td>
                        <td className="px-4 py-3 text-center">{sample.stats.stdDev}</td>
                        <td className="px-4 py-3 text-center">{sample.stats.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

          {sampleMetricCards.length > 0 && (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sampleMetricCards.map((sample) => (
                <article key={`sample-metric-${sample.sampleNumber}`} className="rounded-lg border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[#64748b]">{sample.sampleLabel}</p>
                      <p className="mt-1 text-sm font-semibold text-[#0f172a]">Sample Metrics</p>
                    </div>
                    <span className="rounded-lg bg-[#fff7ed] p-2 text-[#f97316]">
                      <Users className="h-5 w-5" />
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <Metric label="Participants" value={sample.participants} />
                    <Metric label="Mean Liking" value={sample.mean} />
                    <Metric label="Std. Deviation" value={sample.stdDev} />
                    <Metric label="Decision" value={sample.decision} />
                  </div>
                </article>
              ))}
            </section>
          )}

          {automaticInterpretation && automaticInterpretation.summary.length > 0 && (
            <Card title="Summary Comparison Insights">
              <div className="space-y-2 text-sm text-[#334155]">
                {automaticInterpretation.summary.map((line) => (
                  <p key={`comparison-insight-${line}`}>{line}</p>
                ))}
              </div>
            </Card>
          )}

          <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Attribute Liking Scores">
              <div className="h-64 min-h-64 min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart data={attributeStats.filter((attribute) => attribute.type === "LIKING")} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} />
                    <XAxis type="number" domain={[0, 9]} />
                    <YAxis dataKey="name" type="category" width={84} />
                    <Tooltip />
                    <Bar dataKey="stats.mean" fill="#f97316" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="JAR Distribution" className="lg:col-span-2">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {attributeStats
                  .filter((attribute) => attribute.type === "JAR")
                  .map((attribute) => (
                    <div key={attribute.name} className="min-w-0 rounded-lg border border-[#e2e8f0] p-4">
                      <h3 className="font-semibold text-[#0f172a]">{attribute.name}</h3>
                      <div className="h-40 min-h-40 min-w-0">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                          <PieChart>
                            <Pie
                              data={[
                                {
                                  name: "Too Low",
                                  value: attribute.distribution?.tooLow.percent ?? 0,
                                },
                                {
                                  name: "Just Right",
                                  value: attribute.distribution?.justRight.percent ?? 0,
                                },
                                {
                                  name: "Too High",
                                  value: attribute.distribution?.tooHigh.percent ?? 0,
                                },
                              ]}
                              cx="50%"
                              cy="50%"
                              innerRadius={30}
                              outerRadius={60}
                              paddingAngle={2}
                              dataKey="value"
                            >
                              {["#ef4444", "#22c55e", "#f97316"].map((color, index) => (
                                <Cell key={`cell-${index}`} fill={color} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-2 flex justify-between text-xs">
                        <span className="text-red-500">{attribute.distribution?.tooLow.percent ?? 0}% Low</span>
                        <span className="font-semibold text-green-600">{attribute.distribution?.justRight.percent ?? 0}% JAR</span>
                        <span className="text-orange-500">{attribute.distribution?.tooHigh.percent ?? 0}% High</span>
                      </div>
                    </div>
                  ))}
              </div>
            </Card>

            <Card title="Penalty Analysis" className="lg:col-span-2">
              <p className="mb-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-xs text-[#64748b]">
                What does this mean? Attributes marked as drivers are those where many participants felt the level was not right and overall liking dropped.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-[#f8fafc]">
                    <tr>
                      <th className="px-4 py-3 text-left">Attribute</th>
                      <th className="px-4 py-3 text-center">Too Low %</th>
                      <th className="px-4 py-3 text-center">Penalty</th>
                      <th className="px-4 py-3 text-center">Too High %</th>
                      <th className="px-4 py-3 text-center">Penalty</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {penaltyAnalysis.map((penalty) => (
                      <tr key={penalty.attribute} className="border-b border-[#e2e8f0]">
                        <td className="px-4 py-3 font-medium">{penalty.attribute}</td>
                        <td className="px-4 py-3 text-center">{penalty.tooLowPercent}%</td>
                        <td className="px-4 py-3 text-center text-red-600">
                          {penalty.tooLowPenalty !== null ? `-${penalty.tooLowPenalty}` : "-"}
                        </td>
                        <td className="px-4 py-3 text-center">{penalty.tooHighPercent}%</td>
                        <td className="px-4 py-3 text-center text-red-600">
                          {penalty.tooHighPenalty !== null ? `-${penalty.tooHighPenalty}` : "-"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <DriverBadge level={penalty.driverLevel} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {actionableDrivers.length === 0 && (
                <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  No strong drivers detected. This suggests the product is generally well balanced, or changes may not significantly improve liking.
                </p>
              )}
              <p className="mt-4 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-xs text-[#64748b]">
                * Penalty = Mean liking (JAR group) - Mean liking (non-JAR group). Strong: penalty &gt;= 1.0 with &gt;= 20% non-JAR. Moderate: 0.5-0.99 with &gt;= 20% non-JAR.
              </p>
            </Card>
          </div>
        </>
      ) : (
        <>
          {selectedSample ? (
            <>
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
                  <Metric label="Mean Liking" value={selectedSample.overallLiking.mean} />
                  <Metric label="Std. Deviation" value={selectedSample.overallLiking.stdDev} />
                  <Metric label="Decision" value={selectedSample.interpretation} />
                </div>
              </article>

              {selectedAttributeLikingData.length > 0 && (
                <Card title={`${selectedSample.sampleLabel} Attribute Liking Scores`}>
                  <div className="h-64 min-h-64 min-w-0">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                      <BarChart data={selectedAttributeLikingData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} />
                        <XAxis type="number" domain={[0, 9]} />
                        <YAxis dataKey="name" type="category" width={84} />
                        <Tooltip />
                        <Bar dataKey="mean" fill="#f97316" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              )}

              <Card title={`${selectedSample.sampleLabel} JAR And Penalty`} className="lg:col-span-2">
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

              {selectedMeanDropAnalysis.length > 0 && (
                <Card title={`${selectedSample.sampleLabel} Mean Drop Analysis`} className="lg:col-span-2">
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
          This screen is now styled to match the Lovable dashboard language while still using your live analysis endpoint.
        </section>
      )}
    </div>
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
  const generatedAt = formatExportDate(analysis.generatedAt);
  const reportTitle = studyOverview?.title ? `${studyOverview.title} - Sensory Analysis Results` : "Sensory Analysis Results";
  const fileBaseName = sanitizeFileName(`${studyOverview?.title ?? "sensory-analysis"}-${studyOverview?.productName ?? "results"}`);
  const overviewRows: ExportRow[] = [
    { Field: "Study", Value: studyOverview?.title ?? "-" },
    { Field: "Product", Value: studyOverview?.productName || "-" },
    { Field: "Status", Value: studyOverview?.status ? studyOverview.status.replace(/_/g, " ") : "-" },
    { Field: "Consumers", Value: studyOverview ? `${studyOverview.numberOfConsumers}/${studyOverview.targetConsumers}` : overallLiking.n },
    { Field: "Samples", Value: studyOverview?.numberOfSamples ?? bySample.length },
    { Field: "Hedonic Scale", Value: studyOverview?.hedonicScale ?? "-" },
    { Field: "JAR Scale", Value: studyOverview?.jarScale ?? "-" },
    {
      Field: "Date Conducted",
      Value: studyOverview?.dateConducted ? formatExportDate(studyOverview.dateConducted) : "-",
    },
    { Field: "Report Generated", Value: generatedAt },
  ];
  const attributeOverviewRows =
    studyOverview?.attributesEvaluated.map((attribute) => ({
      Attribute: attribute.name,
      Type: attribute.type,
    })) ?? [];
  const interpretationRows =
    automaticInterpretation?.summary.map((line, index) => ({
      No: index + 1,
      Insight: line,
    })) ?? [];
  const recommendationRows: ExportRow[] = [
    { Field: "Decision Flag", Value: analysis.decisionFlag ? analysis.decisionFlag.replace(/_/g, " ") : "-" },
    { Field: "AI Interpretation", Value: analysis.aiInterpretation ?? "AI interpretation is not available." },
    { Field: "Action Required", Value: analysis.aiRecommendation ?? "Collect more responses or configure OPENAI_API_KEY." },
  ];
  const comparisonRows =
    primaryComparison?.samples.map((sample) => ({
      Sample: sample.sampleLabel,
      "Sample No.": sample.sampleNumber,
      Mean: roundMetric(sample.stats.mean),
      "Std. Dev.": roundMetric(sample.stats.stdDev),
      N: sample.stats.n,
    })) ?? [];
  const statisticalComparisonRows = primaryComparison
    ? [
        { Field: "Variable", Value: primaryComparison.variableLabel },
        { Field: "Statistical Test", Value: primaryComparison.statisticalComparison.testLabel },
        { Field: "P-value", Value: primaryComparison.statisticalComparison.formattedPValue },
        {
          Field: "Design",
          Value: primaryComparison.statisticalComparison.repeatedMeasures ? "Repeated measures" : "Independent samples",
        },
        {
          Field: "Significant",
          Value:
            primaryComparison.statisticalComparison.significant === null
              ? "Not determined"
              : primaryComparison.statisticalComparison.significant
                ? "Yes"
                : "No",
        },
        { Field: "Interpretation", Value: primaryComparison.statisticalComparison.interpretation },
        { Field: "Warnings", Value: primaryComparison.statisticalComparison.warnings.join(" ") || "-" },
      ]
    : [];
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
    Interpretation: sample.interpretation,
  }));
  const perSampleAttributeRows = bySample.flatMap((sample) =>
    sample.attributeLiking?.map((row) => ({
      Sample: sample.sampleLabel,
      "Sample No.": sample.sampleNumber,
      Attribute: row.attribute,
      Mean: roundMetric(row.stats.mean),
      "Std. Dev.": roundMetric(row.stats.stdDev),
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

  return {
    title: reportTitle,
    generatedAt,
    fileBaseName,
    sections: [
      { title: "Study Overview", rows: overviewRows },
      { title: "Attributes Evaluated", rows: attributeOverviewRows },
      { title: "Automatic Interpretation", rows: interpretationRows },
      { title: "AI Recommendation", rows: recommendationRows },
      { title: "Comparative Analysis", rows: comparisonRows },
      { title: "Statistical Test", rows: statisticalComparisonRows },
      { title: "By Sample Performance", rows: samplePerformanceRows },
      { title: "Attribute Liking Scores", rows: attributeLikingRows },
      { title: "JAR Distribution", rows: jarDistributionRows },
      { title: "Penalty Analysis", rows: penaltyRows },
      { title: "Per Sample Metrics", rows: perSampleMetricRows },
      { title: "Per Sample Attribute Liking", rows: perSampleAttributeRows },
      { title: "Per Sample JAR And Penalty", rows: perSampleJarRows },
      { title: "Mean Drop Analysis", rows: meanDropRows },
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

async function exportAnalysisPdf(context: AnalysisExportContext) {
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

  context.sections.forEach((section) => {
    const columns = getExportColumns(section.rows);
    const body = section.rows.length > 0
      ? section.rows.map((row) => columns.map((column) => formatPdfCell(row[column])))
      : [["No records available"]];
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
      styles: {
        font: "helvetica",
        fontSize: 7,
        cellPadding: 4,
        overflow: "linebreak",
        valign: "top",
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
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
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").trim();
  return /^[=+\-@\t\r]/.test(normalized) ? `'${normalized}` : normalized;
}

function sanitizeFileName(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    : date.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function formatDriverLevel(level: "STRONG" | "MODERATE" | "NOT_ACTIONABLE") {
  if (level === "STRONG") return "Strong Driver";
  if (level === "MODERATE") return "Moderate Driver";
  return "Not Actionable";
}

function formatPdfCell(value: ExportCellValue | undefined) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
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
