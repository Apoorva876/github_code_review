import { useState } from 'react';
import type { Repository } from '../../types';
import { formatRelativeTime, getScoreColorClass } from '../../utils/formatters';

interface RepositoryActivityChartProps {
  repositories: Repository[];
  onSelectRepository: (repo: Repository) => void;
}

export function RepositoryActivityChart({
  repositories,
  onSelectRepository,
}: RepositoryActivityChartProps) {
  const [hoveredBar, setHoveredBar] = useState<{
    repoId: string;
    repoName: string;
    dayIdx: number;
    ops: number;
  } | null>(null);

  const maxActivity = Math.max(
    1,
    ...repositories.flatMap((r) => r.activitySeries)
  );

  return (
    <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 flex flex-col justify-between h-full">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Repository Activity</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {hoveredBar
              ? `${hoveredBar.repoName} · Day ${hoveredBar.dayIdx + 1}: ${hoveredBar.ops} ops`
              : '7-day commit & PR review cadence per connected repository'}
          </p>
        </div>
      </div>

      <div className="divide-y divide-slate-800/80">
        {repositories.map((repo) => {
          const totalWeek = repo.activitySeries.reduce((s, n) => s + n, 0);
          const scoreColor = getScoreColorClass(repo.healthScore);

          return (
            <button
              key={repo.id}
              type="button"
              onClick={() => onSelectRepository(repo)}
              className="w-full py-3 flex items-center justify-between gap-4 text-left hover:bg-slate-800/35 px-2 -mx-2 rounded-md transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-100 truncate">
                    {repo.fullName}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 truncate">
                  <span>{repo.isDemo ? 'Demo' : 'Live GitHub'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{repo.language}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{repo.openPrsCount} open PRs</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{formatRelativeTime(repo.lastReviewedAt)}</span>
                </div>
              </div>

              {/* Mini 7-bar interactive activity sparkline */}
              <div
                className="flex items-end gap-1 h-7 shrink-0"
                onMouseLeave={() => setHoveredBar(null)}
              >
                {repo.activitySeries.map((val, idx) => {
                  const pct = Math.max(14, Math.round((val / maxActivity) * 100));
                  const isBarHovered =
                    hoveredBar?.repoId === repo.id && hoveredBar.dayIdx === idx;
                  return (
                    <span
                      key={idx}
                      title={`Day ${idx + 1}: ${val} ops`}
                      onMouseEnter={() =>
                        setHoveredBar({
                          repoId: repo.id,
                          repoName: repo.name,
                          dayIdx: idx,
                          ops: val,
                        })
                      }
                      style={{ height: `${pct}%` }}
                      className={`w-1.5 rounded-xs transition-colors ${
                        isBarHovered
                          ? 'bg-purple-400'
                          : idx === repo.activitySeries.length - 1
                            ? 'bg-blue-500'
                            : 'bg-slate-700 hover:bg-slate-500'
                      }`}
                    />
                  );
                })}
              </div>

              <div className="text-right shrink-0 w-16">
                <div className={`text-sm font-mono font-semibold tabular-nums ${scoreColor}`}>
                  {repo.healthScore}
                </div>
                <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {totalWeek} ops
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
