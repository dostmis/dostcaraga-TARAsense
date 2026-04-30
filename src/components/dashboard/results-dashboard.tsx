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

interface SampleAnalysisBlock {
  sampleNumber: number;
  sampleLabel: string;
  overallLiking: { mean: number; stdDev: number; n: number; median?: number };
  interpretation: string;
  jarBreakdown: SampleJarBreakdownRow[];
}

interface AnalysisPayload {
  generatedAt: string;
  overallLiking: {
    mean: number;
    stdDev: number;
    n: number;
    median?: number;
    samplePerformance?: SamplePerformanceRow[];
    bestSample?: SamplePerformanceRow | null;
    bySample?: SampleAnalysisBlock[];
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
  aiInterpretation: string | null;
  aiRecommendation: string | null;
  decisionFlag: string | null;
}

export function ResultsDashboard({ studyId }: ResultsDashboardProps) {
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const hedonicData = [
    { name: "Mean Score", value: overallLiking.mean, fill: "#f97316" },
    { name: "Benchmark", value: 7.0, fill: "#e2e8f0" },
  ];

  const decisionStyles = getDecisionStyle(decisionFlag);
  const actionableDrivers = penaltyAnalysis.filter((penalty) => penalty.isActionable);
  const samplePerformance = overallLiking.samplePerformance ?? [];
  const bySample = overallLiking.bySample ?? [];
  const bestSample = overallLiking.bestSample;

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
          <button className="app-button-secondary flex w-full items-center justify-center gap-2 px-4 py-2 text-sm sm:w-auto" disabled>
            <Download size={16} />
            Export PDF
          </button>
          <button className="app-button-secondary flex w-full items-center justify-center gap-2 px-4 py-2 text-sm sm:w-auto" disabled>
            <Download size={16} />
            Export Excel
          </button>
        </div>
      </section>

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

      {bySample.length > 0 && (
        <Card title="By Sample JAR And Penalty" className="lg:col-span-2">
          <div className="space-y-4">
            {bySample.map((sample) => (
              <section key={`sample-block-${sample.sampleNumber}`} className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4">
                <h3 className="text-base font-semibold text-[#0f172a]">
                  {sample.sampleLabel} | Mean: {sample.overallLiking.mean} ({sample.interpretation})
                </h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[700px] text-xs">
                    <thead className="bg-white">
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
                      {sample.jarBreakdown.map((row) => (
                        <tr key={`${sample.sampleNumber}-${row.attribute}`} className="border-t border-[#e2e8f0]">
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
              </section>
            ))}
          </div>
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title="Participants" value={overallLiking.n} icon={<Users className="h-5 w-5" />} />
        <Stat title="Mean Liking" value={overallLiking.mean} />
        <Stat title="Std. Deviation" value={overallLiking.stdDev} />
        <Stat title="Decision" value={(decisionFlag ?? "PENDING").replace(/_/g, " ")} />
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Consumer Reaction">
          <div className="h-64 min-h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={hedonicData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis domain={[0, 9]} />
                <Tooltip />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

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

      <section className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-4 text-sm text-[#9a3412]">
        <Lightbulb className="mr-2 inline h-4 w-4" />
        This screen is now styled to match the Lovable dashboard language while still using your live analysis endpoint.
      </section>
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

function Card({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ${className ?? ""}`}>
      <h2 className="mb-4 text-lg font-semibold text-[#0f172a]">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ title, value, icon }: { title: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <article className="rounded-lg border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-[#64748b]">{title}</p>
          <p className="mt-1 text-2xl font-semibold text-[#0f172a]">{value}</p>
        </div>
        {icon && <span className="rounded-lg bg-[#fff7ed] p-2 text-[#f97316]">{icon}</span>}
      </div>
    </article>
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
