import { useState } from 'react';
import type { DailyActivityPoint } from '../../types';

interface IssueSeverityChartProps {
  dailyActivity: DailyActivityPoint[];
  severityTotals: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  range?: '7d' | '14d';
  onRangeChange?: (next: '7d' | '14d') => void;
}

export function IssueSeverityChart({
  dailyActivity,
  severityTotals,
  range: controlledRange,
  onRangeChange,
}: IssueSeverityChartProps) {
  const [localRange, setLocalRange] = useState<'7d' | '14d'>('14d');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const range = controlledRange ?? localRange;
  const setRange = (next: '7d' | '14d') => {
    setLocalRange(next);
    onRangeChange?.(next);
  };

  const visiblePoints = range === '7d' ? dailyActivity.slice(-7) : dailyActivity;

  const totals = visiblePoints.reduce(
    (acc, pt) => {
      acc.critical += pt.critical;
      acc.high += pt.high;
      acc.medium += pt.medium;
      acc.low += pt.low;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 }
  );

  const maxStack = Math.max(
    1,
    ...visiblePoints.map((p) => p.critical + p.high + p.medium + p.low)
  );

  const chartHeight = 168;
  const chartWidth = 560;
  const barSlotWidth = chartWidth / Math.max(1, visiblePoints.length);
  const barWidth = Math.min(24, Math.max(12, barSlotWidth * 0.56));

  const grandTotal =
    totals.critical + totals.high + totals.medium + totals.low || 1;

  const legendItems = [
    {
      label: 'Critical',
      count: totals.critical,
      reviewCount: severityTotals.critical,
      colorClass: 'bg-red-500',
      textClass: 'text-red-400',
    },
    {
      label: 'High',
      count: totals.high,
      reviewCount: severityTotals.high,
      colorClass: 'bg-orange-500',
      textClass: 'text-orange-400',
    },
    {
      label: 'Medium',
      count: totals.medium,
      reviewCount: severityTotals.medium,
      colorClass: 'bg-amber-500',
      textClass: 'text-amber-400',
    },
    {
      label: 'Low',
      count: totals.low,
      reviewCount: severityTotals.low,
      colorClass: 'bg-slate-500',
      textClass: 'text-slate-400',
    },
  ];

  const hoveredPoint = hoveredIdx !== null ? visiblePoints[hoveredIdx] : null;
  const tooltipLeftPct =
    hoveredIdx !== null && visiblePoints.length > 0
      ? Math.min(82, Math.max(18, ((hoveredIdx + 0.5) / visiblePoints.length) * 100))
      : 50;

  return (
    <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 flex flex-col justify-between h-full">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Issue Severity Distribution</h2>
          <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
            Findings detected across pull requests · Last {range === '7d' ? '7' : '14'} days
          </p>
        </div>

        <div
          className="inline-flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md"
          role="group"
          aria-label="Chart date range"
        >
          <button
            type="button"
            onClick={() => setRange('7d')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              range === '7d'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            7 Days
          </button>
          <button
            type="button"
            onClick={() => setRange('14d')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              range === '14d'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            14 Days
          </button>
        </div>
      </div>

      {/* Hover readout bar */}
      <div className="h-6 mb-2 flex items-center justify-between text-xs text-slate-400 tabular-nums">
        {hoveredPoint ? (
          <div className="flex flex-wrap items-center gap-2.5 text-slate-200 font-mono">
            <span>{hoveredPoint.label}</span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span>{hoveredPoint.reviews} reviews</span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span>Avg {hoveredPoint.avgScore}/100</span>
          </div>
        ) : (
          <span>Hover a day bar to inspect exact severity breakdown</span>
        )}
        <span className="font-mono text-slate-400">
          {totals.critical + totals.high + totals.medium + totals.low} findings
        </span>
      </div>

      {/* Stacked SVG Chart with Floating Hover Tooltip */}
      <div className="relative w-full overflow-x-auto">
        {hoveredPoint && (
          <div
            role="status"
            style={{ left: `${tooltipLeftPct}%` }}
            className="pointer-events-none absolute top-1 -translate-x-1/2 z-10 bg-[#0B0F17]/95 border border-slate-700 rounded-md px-3 py-2 shadow-xl shadow-black/50 text-[11px] font-mono tabular-nums whitespace-nowrap"
          >
            <div className="font-semibold text-slate-100 mb-1">
              {hoveredPoint.label} · {hoveredPoint.reviews} reviews
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-red-400">Crit {hoveredPoint.critical}</span>
              <span className="text-orange-400">High {hoveredPoint.high}</span>
              <span className="text-amber-400">Med {hoveredPoint.medium}</span>
              <span className="text-slate-400">Low {hoveredPoint.low}</span>
            </div>
          </div>
        )}

        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight + 28}`}
          className="w-full h-[196px]"
          role="img"
          aria-label="Stacked bar chart of code review issue severities over time"
        >
          {[0.25, 0.5, 0.75, 1].map((frac) => {
            const y = chartHeight - frac * (chartHeight - 12);
            return (
              <line
                key={frac}
                x1={0}
                y1={y}
                x2={chartWidth}
                y2={y}
                stroke="#1E293B"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            );
          })}

          {visiblePoints.map((pt, idx) => {
            const total = pt.critical + pt.high + pt.medium + pt.low;
            const scale = (chartHeight - 14) / maxStack;
            const x = idx * barSlotWidth + (barSlotWidth - barWidth) / 2;

            const hLow = pt.low * scale;
            const hMed = pt.medium * scale;
            const hHigh = pt.high * scale;
            const hCrit = pt.critical * scale;

            const yLow = chartHeight - hLow;
            const yMed = yLow - hMed;
            const yHigh = yMed - hHigh;
            const yCrit = yHigh - hCrit;

            const isHovered = hoveredIdx === idx;
            const isDimmed = hoveredIdx !== null && hoveredIdx !== idx;
            const showLabel =
              visiblePoints.length <= 7 || idx % 2 === 0 || idx === visiblePoints.length - 1;

            return (
              <g
                key={pt.date}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="cursor-pointer"
                style={{ opacity: isDimmed ? 0.55 : 1, transition: 'opacity 140ms ease' }}
              >
                <rect
                  x={idx * barSlotWidth + 2}
                  y={4}
                  width={barSlotWidth - 4}
                  height={chartHeight - 4}
                  rx={4}
                  fill={isHovered ? '#1E293B' : 'transparent'}
                  fillOpacity={isHovered ? 0.55 : 0}
                />
                {total > 0 && (
                  <>
                    <rect x={x} y={yLow} width={barWidth} height={hLow} fill="#64748B" rx={1} />
                    <rect x={x} y={yMed} width={barWidth} height={hMed} fill="#D97706" rx={1} />
                    <rect x={x} y={yHigh} width={barWidth} height={hHigh} fill="#F97316" rx={1} />
                    <rect x={x} y={yCrit} width={barWidth} height={hCrit} fill="#EF4444" rx={1} />
                  </>
                )}
                {showLabel && (
                  <text
                    x={idx * barSlotWidth + barSlotWidth / 2}
                    y={chartHeight + 18}
                    textAnchor="middle"
                    fill={isHovered ? '#F8FAFC' : '#64748B'}
                    fontSize={10}
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {pt.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Accessible explicit breakdown footer */}
      <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {legendItems.map((item) => {
          const pct = Math.round((item.count / grandTotal) * 100);
          return (
            <div key={item.label} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-xs shrink-0 ${item.colorClass}`} />
                <span className="text-xs text-slate-300">{item.label}</span>
              </div>
              <span className={`text-xs font-mono tabular-nums ${item.textClass}`}>
                {item.count} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
