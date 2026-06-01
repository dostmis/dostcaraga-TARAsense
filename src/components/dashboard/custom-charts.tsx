"use client";

// Lightweight SVG-based charts for visualizations Recharts does not provide
// out of the box (boxplot, histogram, penalty plot). Each component is
// presentation-only and reads pre-aggregated data props.

import type React from "react";

interface BoxPlotDatum {
  label: string;
  values: number[];
}

interface HistogramDatum {
  label: string;
  values: number[];
}

interface PenaltyDatum {
  label: string;
  meanDrop: number;
  nonJarPercent: number;
  severity?: "STRONG" | "MODERATE" | "NOT_ACTIONABLE";
}

const CHART_PADDING = { top: 24, right: 24, bottom: 36, left: 44 };

export function Boxplot({ data, width = 560, height = 240, domain }: {
  data: BoxPlotDatum[];
  width?: number;
  height?: number;
  domain?: [number, number];
}) {
  if (data.length === 0) return <EmptyState message="No distribution data available." />;
  const stats = data.map((entry) => buildBoxStats(entry.values));
  const yDomain = domain ?? computeDomain(stats.flatMap((stat) => [stat.min, stat.max]));
  const innerHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;
  const innerWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const groupWidth = innerWidth / data.length;
  const yScale = (value: number) => {
    const range = yDomain[1] - yDomain[0] || 1;
    return CHART_PADDING.top + innerHeight - ((value - yDomain[0]) / range) * innerHeight;
  };
  const yTicks = buildTicks(yDomain);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Boxplot">
      {yTicks.map((tick) => (
        <g key={`tick-${tick}`}>
          <line
            x1={CHART_PADDING.left}
            x2={width - CHART_PADDING.right}
            y1={yScale(tick)}
            y2={yScale(tick)}
            stroke="#e2e8f0"
            strokeDasharray="3 3"
          />
          <text x={CHART_PADDING.left - 8} y={yScale(tick) + 4} textAnchor="end" fontSize="10" fill="#64748b">
            {tick}
          </text>
        </g>
      ))}
      {stats.map((stat, index) => {
        const xCenter = CHART_PADDING.left + groupWidth * (index + 0.5);
        const boxLeft = xCenter - 18;
        const boxRight = xCenter + 18;
        return (
          <g key={`box-${index}`}>
            <line x1={xCenter} x2={xCenter} y1={yScale(stat.min)} y2={yScale(stat.max)} stroke="#475569" />
            <rect
              x={boxLeft}
              y={yScale(stat.q3)}
              width={boxRight - boxLeft}
              height={Math.max(2, yScale(stat.q1) - yScale(stat.q3))}
              fill="#bfdbfe"
              stroke="#1d4ed8"
            />
            <line x1={boxLeft} x2={boxRight} y1={yScale(stat.median)} y2={yScale(stat.median)} stroke="#1d4ed8" strokeWidth={2} />
            <line x1={boxLeft + 4} x2={boxRight - 4} y1={yScale(stat.min)} y2={yScale(stat.min)} stroke="#475569" />
            <line x1={boxLeft + 4} x2={boxRight - 4} y1={yScale(stat.max)} y2={yScale(stat.max)} stroke="#475569" />
            <text x={xCenter} y={height - CHART_PADDING.bottom + 16} textAnchor="middle" fontSize="11" fill="#0f172a">
              {data[index].label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Histogram({ data, width = 480, height = 200, bins = 9, domain = [1, 9] }: {
  data: HistogramDatum;
  width?: number;
  height?: number;
  bins?: number;
  domain?: [number, number];
}) {
  if (data.values.length === 0) return <EmptyState message="No distribution data for this sample." />;
  const counts = Array.from({ length: bins }, () => 0);
  const range = domain[1] - domain[0];
  data.values.forEach((value) => {
    if (value < domain[0] || value > domain[1]) return;
    const index = Math.min(bins - 1, Math.floor(((value - domain[0]) / range) * bins));
    counts[index] += 1;
  });
  const maxCount = Math.max(...counts, 1);
  const innerHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;
  const innerWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const barWidth = innerWidth / bins;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Histogram for ${data.label}`}>
      <line x1={CHART_PADDING.left} x2={width - CHART_PADDING.right} y1={CHART_PADDING.top + innerHeight} y2={CHART_PADDING.top + innerHeight} stroke="#cbd5e1" />
      {counts.map((count, index) => {
        const barHeight = (count / maxCount) * innerHeight;
        return (
          <g key={`bar-${index}`}>
            <rect
              x={CHART_PADDING.left + index * barWidth + 2}
              y={CHART_PADDING.top + innerHeight - barHeight}
              width={Math.max(2, barWidth - 4)}
              height={barHeight}
              fill="#f97316"
              opacity={0.85}
            />
            <text
              x={CHART_PADDING.left + index * barWidth + barWidth / 2}
              y={height - CHART_PADDING.bottom + 14}
              textAnchor="middle"
              fontSize="10"
              fill="#475569"
            >
              {Math.round(domain[0] + (range / bins) * (index + 0.5))}
            </text>
            {count > 0 && (
              <text
                x={CHART_PADDING.left + index * barWidth + barWidth / 2}
                y={CHART_PADDING.top + innerHeight - barHeight - 4}
                textAnchor="middle"
                fontSize="10"
                fill="#0f172a"
              >
                {count}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function PenaltyPlot({ data, width = 520, height = 280 }: {
  data: PenaltyDatum[];
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return <EmptyState message="No penalty drivers to plot." />;
  const innerHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;
  const innerWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const xDomain: [number, number] = [0, Math.max(60, ...data.map((entry) => entry.nonJarPercent))];
  const yDomain: [number, number] = [0, Math.max(2, ...data.map((entry) => entry.meanDrop))];

  const xScale = (value: number) => CHART_PADDING.left + (value / xDomain[1]) * innerWidth;
  const yScale = (value: number) => CHART_PADDING.top + innerHeight - (value / yDomain[1]) * innerHeight;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Penalty plot">
      {/* Threshold lines */}
      <rect
        x={xScale(20)}
        y={yScale(yDomain[1])}
        width={innerWidth - (xScale(20) - CHART_PADDING.left)}
        height={yScale(0.5) - yScale(yDomain[1])}
        fill="#fef3c7"
        opacity={0.4}
      />
      <rect
        x={xScale(20)}
        y={yScale(yDomain[1])}
        width={innerWidth - (xScale(20) - CHART_PADDING.left)}
        height={yScale(1.0) - yScale(yDomain[1])}
        fill="#fee2e2"
        opacity={0.5}
      />
      <line x1={CHART_PADDING.left} x2={width - CHART_PADDING.right} y1={CHART_PADDING.top + innerHeight} y2={CHART_PADDING.top + innerHeight} stroke="#cbd5e1" />
      <line x1={CHART_PADDING.left} x2={CHART_PADDING.left} y1={CHART_PADDING.top} y2={CHART_PADDING.top + innerHeight} stroke="#cbd5e1" />
      {data.map((entry, index) => {
        const fill = entry.severity === "STRONG" ? "#dc2626" : entry.severity === "MODERATE" ? "#f97316" : "#10b981";
        return (
          <g key={`penalty-${index}`}>
            <circle cx={xScale(entry.nonJarPercent)} cy={yScale(entry.meanDrop)} r={6} fill={fill} fillOpacity={0.85} />
            <text x={xScale(entry.nonJarPercent) + 8} y={yScale(entry.meanDrop) - 6} fontSize="10" fill="#0f172a">
              {entry.label}
            </text>
          </g>
        );
      })}
      <text x={CHART_PADDING.left} y={height - 8} fontSize="11" fill="#475569">% non-JAR</text>
      <text x={6} y={CHART_PADDING.top + 12} fontSize="11" fill="#475569">Mean drop</text>
    </svg>
  );
}

export function PreferenceMap({ samples, width = 520, height = 320 }: {
  samples: Array<{ sampleNumber: number; sampleLabel: string; x: number; y: number; meanLiking: number }>;
  width?: number;
  height?: number;
}) {
  if (samples.length === 0) return <EmptyState message="Preference map could not be computed for this study." />;
  const innerHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;
  const innerWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const xValues = samples.map((sample) => sample.x);
  const yValues = samples.map((sample) => sample.y);
  const xDomain: [number, number] = [Math.min(...xValues, -1), Math.max(...xValues, 1)];
  const yDomain: [number, number] = [Math.min(...yValues, -1), Math.max(...yValues, 1)];
  const xScale = (value: number) => CHART_PADDING.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * innerWidth;
  const yScale = (value: number) => CHART_PADDING.top + innerHeight - ((value - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * innerHeight;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Preference map">
      <line x1={CHART_PADDING.left} x2={width - CHART_PADDING.right} y1={yScale(0)} y2={yScale(0)} stroke="#cbd5e1" strokeDasharray="3 3" />
      <line x1={xScale(0)} x2={xScale(0)} y1={CHART_PADDING.top} y2={CHART_PADDING.top + innerHeight} stroke="#cbd5e1" strokeDasharray="3 3" />
      {samples.map((sample) => (
        <g key={`pref-${sample.sampleNumber}`}>
          <circle cx={xScale(sample.x)} cy={yScale(sample.y)} r={6 + Math.max(0, sample.meanLiking - 5)} fill="#2563eb" fillOpacity={0.65} />
          <text x={xScale(sample.x) + 8} y={yScale(sample.y) + 4} fontSize="11" fill="#0f172a">
            {sample.sampleLabel} · {sample.meanLiking.toFixed(1)}
          </text>
        </g>
      ))}
      <text x={CHART_PADDING.left} y={height - 8} fontSize="11" fill="#475569">Principal Component 1</text>
      <text x={6} y={CHART_PADDING.top + 12} fontSize="11" fill="#475569">Principal Component 2</text>
    </svg>
  );
}

function EmptyState({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] text-xs text-[#64748b]">
      {message}
    </div>
  );
}

function buildBoxStats(values: number[]) {
  if (values.length === 0) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return {
    min: sorted[0],
    q1,
    median,
    q3,
    max: sorted[sorted.length - 1],
  };
}

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function computeDomain(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  const min = Math.floor(Math.min(...values));
  const max = Math.ceil(Math.max(...values));
  return [Math.min(min, 0), Math.max(max, min + 1)];
}

function buildTicks([min, max]: [number, number]) {
  const span = max - min;
  const step = span <= 5 ? 1 : Math.ceil(span / 5);
  const ticks: number[] = [];
  for (let value = min; value <= max; value += step) ticks.push(value);
  return ticks;
}
