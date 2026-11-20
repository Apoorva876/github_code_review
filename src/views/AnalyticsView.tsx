import { useState } from 'react';
import { DashboardSkeleton, EmptyState, ErrorBanner } from '../components/ui/DataState';
import { StatCard } from '../components/ui/StatCard';
import type { CodeReview, DailyActivityPoint, Repository } from '../types';
import { getScoreColorClass } from '../utils/formatters';

interface AnalyticsViewProps {
  reviews: CodeReview[];
  repositories: Repository[];
  dailyActivity: DailyActivityPoint[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function AnalyticsView({
  reviews,
  repositories,
  dailyActivity,
  loading,
  error,
  onRetry,
}: AnalyticsViewProps) {
  const [range, setRange] = useState<'7d' | '14d'>('14d');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (loading && reviews.length === 0) {
    return <DashboardSkeleton />;
  }

  if (error && reviews.length === 0) {
    return <ErrorBanner message={error} onRetry={onRetry} />;
  }

  if (reviews.length === 0 && dailyActivity.length === 0) {
    return (
      <EmptyState
        title="No analytics data available"
        description="Run your first AI code review to start tracking rubric pillar benchmarks and quality trends."
      />
    );
  }

  const hasDemoData = reviews.some((r) => r.isDemo) || repositories.some((r) => r.isDemo);
  const count = reviews.length || 1;
  const meanSecurity = Math.round(
    reviews.reduce((s, r) => s + r.rubricBreakdown.security, 0) / count
  );
  const meanReliability = Math.round(
    reviews.reduce((s, r) => s + r.rubricBreakdown.reliability, 0) / count
  );
  const meanMaintainability = Math.round(
    reviews.reduce((s, r) => s + r.rubricBreakdown.maintainability, 0) / count
  );
  const meanPerformance = Math.round(
    reviews.reduce((s, r) => s + r.rubricBreakdown.performance, 0) / count
  );

  const avgDurationMs = Math.round(
    reviews.reduce((s, r) => s + r.durationMs, 0) / count
  );

  const allFindings = reviews.flatMap((r) => r.findings);
  const resolvedRate =
    allFindings.length > 0
      ? Math.round(
          (allFindings.filter((f) => f.resolved).length / allFindings.length) * 100
        )
      : 100;

  const visibleActivity = range === '7d' ? dailyActivity.slice(-7) : dailyActivity;

  // Score Trend Polyline SVG
  const width = 640;
  const height = 180;
  const padX = 28;
  const padY = 20;
  const points = visibleActivity.map((pt, i) => {
    const x =
      padX + (i / Math.max(1, visibleActivity.length - 1)) * (width - padX * 2);
    const y =
      height - padY - ((pt.avgScore - 50) / 50) * (height - padY * 2);
    return { x, y: Math.max(padY, Math.min(height - padY, y)), pt };
  });

  const polylineStr = points.map((p) => `${p.x},${p.y}`).join(' ');
  const hoveredPoint = hoveredIdx !== null ? visibleActivity[hoveredIdx] : null;

  const pillars = [
    { label: 'Security', score: meanSecurity, description: 'AuthN/AuthZ, input validation, secret hygiene' },
    { label: 'Reliability', score: meanReliability, description: 'Error propagation, retries, idempotency' },
    { label: 'Maintainability', score: meanMaintainability, description: 'Type safety, modularity, test clarity' },
    { label: 'Performance', score: meanPerformance, description: 'Query efficiency, memory bounds, latency' },
  ];

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} onRetry={onRetry} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Finding Resolution Rate"
          value={`${resolvedRate}%`}
          detail={`${allFindings.filter((f) => f.resolved).length} of ${allFindings.length} resolved${hasDemoData ? ' · Demo + Live' : ''}`}
          emphasis="positive"
        />
        <StatCard
          label="Median Review Latency"
          value={`${(avgDurationMs / 1000).toFixed(1)}s`}
          detail="Server-side Gemini rubric execution"
        />
        <StatCard
          label="Security Pillar Mean"
          value={`${meanSecurity} / 100`}
          detail={`Across ${reviews.length} evaluated PRs`}
          emphasis={meanSecurity >= 80 ? 'positive' : 'warning'}
        />
        <StatCard
          label="Reliability Pillar Mean"
          value={`${meanReliability} / 100`}
          detail="Failure handling & boundary checks"
          emphasis={meanReliability >= 80 ? 'positive' : 'warning'}
        />
      </div>

      {/* Rubric Score Trend Line Chart */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Mean Rubric Score Trajectory
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Daily average pull request score · Last {range === '7d' ? '7' : '14'} days
              {hasDemoData ? ' (Demo + Live)' : ''}
            </p>
          </div>

          <div
            className="inline-flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md"
            role="group"
            aria-label="Analytics timeframe"
          >
            <button
              type="button"
              onClick={() => {
                setRange('7d');
                setHoveredIdx(null);
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                range === '7d'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              7 Days
            </button>
            <button
              type="button"
              onClick={() => {
                setRange('14d');
                setHoveredIdx(null);
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                range === '14d'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              14 Days
            </button>
          </div>
        </div>

        <div className="h-5 mb-2 text-xs font-mono text-slate-400 tabular-nums">
          {hoveredPoint ? (
            <span className="text-slate-200">
              {hoveredPoint.label} · Mean Score {hoveredPoint.avgScore}/100 · {hoveredPoint.reviews} reviews
            </span>
          ) : (
            <span>Hover a data point for daily rubric score</span>
          )}
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height + 24}`}
            className="w-full h-[210px]"
            role="img"
            aria-label="Mean rubric score trend line chart"
          >
            {[60, 75, 90, 100].map((tick) => {
              const y = height - padY - ((tick - 50) / 50) * (height - padY * 2);
              return (
                <g key={tick}>
                  <line
                    x1={padX}
                    y1={y}
                    x2={width - padX}
                    y2={y}
                    stroke="#1E293B"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={4}
                    y={y + 3}
                    fill="#64748B"
                    fontSize={10}
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {tick}
                  </text>
                </g>
              );
            })}

            {points.length > 1 && (
              <polyline
                fill="none"
                stroke="#3B82F6"
                strokeWidth={2}
                strokeLinejoin="round"
                points={polylineStr}
              />
            )}

            {points.map(({ x, y, pt }, idx) => {
              const isHovered = hoveredIdx === idx;
              return (
                <g
                  key={pt.date}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="cursor-pointer"
                >
                  <circle cx={x} cy={y} r={10} fill="transparent" />
                  <circle
                    cx={x}
                    cy={y}
                    r={isHovered ? 5 : 3.5}
                    fill="#0B0F17"
                    stroke={isHovered ? '#60A5FA' : '#3B82F6'}
                    strokeWidth={2}
                  />
                  {(visibleActivity.length <= 7 || idx % 2 === 0 || idx === points.length - 1) && (
                    <text
                      x={x}
                      y={height + 14}
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
      </section>

      {/* Pillar Benchmarks + Repo Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Rubric Pillar Benchmarks</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Mean quality dimension scores across evaluated pull requests
            </p>
          </div>

          <div className="space-y-4">
            {pillars.map((pillar) => (
              <div key={pillar.label} className="space-y-1.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium text-slate-200">{pillar.label}</span>
                  <span
                    className={`font-mono font-semibold tabular-nums ${getScoreColorClass(
                      pillar.score
                    )}`}
                  >
                    {pillar.score} / 100
                  </span>
                </div>
                <div className="h-2 bg-[#0B0F17] border border-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${pillar.score}%` }}
                  />
                </div>
                <div className="text-xs text-slate-400">{pillar.description}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-100">
              Repository Health Ranking
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Sorted by rolling CodeRubric health score
            </p>
          </div>

          <div className="divide-y divide-slate-800/80">
            {[...repositories]
              .sort((a, b) => b.healthScore - a.healthScore)
              .map((repo, idx) => (
                <div
                  key={repo.id}
                  className="py-3 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs text-slate-500 w-5 tabular-nums">
                      0{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-mono text-slate-100 truncate">
                        {repo.fullName}
                      </div>
                      <div className="text-xs text-slate-400">
                        {repo.isDemo ? 'Demo' : 'Live GitHub'} · {repo.language}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`font-mono text-sm font-semibold tabular-nums ${getScoreColorClass(
                      repo.healthScore
                    )}`}
                  >
                    {repo.healthScore}
                  </div>
                </div>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}
