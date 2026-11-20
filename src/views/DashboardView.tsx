import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FolderPlus,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { AgentActivitySection } from '../components/analysis/AgentActivitySection';
import { IssueSeverityChart } from '../components/charts/IssueSeverityChart';
import { RepositoryActivityChart } from '../components/charts/RepositoryActivityChart';
import { DashboardSkeleton, EmptyState, ErrorBanner } from '../components/ui/DataState';
import { StatusText } from '../components/ui/SeverityText';
import { StatCard } from '../components/ui/StatCard';
import type {
  AIAgent,
  CodeReview,
  DashboardPayload,
  NavSection,
  Repository,
  RepositoryAnalysisJob,
  ReviewStatus,
  Severity,
} from '../types';
import {
  formatCommitSha,
  formatDurationMs,
  formatRelativeTime,
  getJobStatusColorClass,
  getJobStatusLabel,
  getScoreColorClass,
  getSourceLabel,
} from '../utils/formatters';
import {
  filterDailyActivityByRange,
  isWithinDateRange,
  type DateRangeFilter,
} from '../utils/workspaceMetrics';

interface DashboardViewProps {
  data: DashboardPayload | null;
  reviews?: CodeReview[];
  agents?: AIAgent[];
  analysisJobs?: RepositoryAnalysisJob[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectReview: (review: CodeReview) => void;
  onSelectRepository: (repo: Repository) => void;
  onNavigate: (section: NavSection) => void;
  onNavigateFilteredReviews?: (options?: {
    status?: ReviewStatus;
    severity?: Severity;
  }) => void;
  onOpenConnectRepo: () => void;
  onRunReview: (agentId?: string) => void;
}

const DATE_RANGE_OPTIONS: Array<{ id: DateRangeFilter; label: string }> = [
  { id: '7d', label: '7 Days' },
  { id: '14d', label: '14 Days' },
  { id: '30d', label: '30 Days' },
  { id: 'all', label: 'All Time' },
];

export function DashboardView({
  data,
  reviews,
  agents = [],
  analysisJobs = [],
  loading,
  error,
  onRetry,
  onSelectReview,
  onSelectRepository,
  onNavigate,
  onNavigateFilteredReviews,
  onOpenConnectRepo,
  onRunReview,
}: DashboardViewProps) {
  const [dateRange, setDateRange] = useState<DateRangeFilter>('14d');

  if (loading && !data) {
    return <DashboardSkeleton />;
  }

  if (error && !data) {
    return <ErrorBanner message={error} onRetry={onRetry} />;
  }

  if (!data) {
    return (
      <EmptyState
        title="No workspace metrics yet"
        description="Connect a GitHub repository or run an AI code review to populate your dashboard."
        actionLabel="Run First AI Review"
        onAction={() => onRunReview()}
      />
    );
  }

  const { overview, severityTotals, dailyActivity, recentReviews, repositories, hasDemoData } =
    data;

  const allReviewsSource = reviews && reviews.length > 0 ? reviews : recentReviews;
  const scopedReviews =
    dateRange === 'all'
      ? allReviewsSource
      : allReviewsSource.filter((r) => isWithinDateRange(r.createdAt, dateRange));

  const isFilteredByRange = dateRange !== 'all' && reviews !== undefined;

  const totalReviewsValue = isFilteredByRange ? scopedReviews.length : overview.totalReviews;
  const scopedOpenFindings = scopedReviews.flatMap((r) => r.findings).filter((f) => !f.resolved);
  const openFindingsValue = isFilteredByRange
    ? scopedOpenFindings.length
    : overview.openFindingsCount;
  const criticalOpenValue = isFilteredByRange
    ? scopedOpenFindings.filter((f) => f.severity === 'critical').length
    : overview.criticalOpenCount;
  const highOpenValue = isFilteredByRange
    ? scopedOpenFindings.filter((f) => f.severity === 'high').length
    : overview.highOpenCount;
  const meanScoreValue = isFilteredByRange
    ? scopedReviews.length > 0
      ? Number(
          (
            scopedReviews.reduce((sum, r) => sum + r.score, 0) / scopedReviews.length
          ).toFixed(1)
        )
      : 0
    : overview.meanScore;
  const approvalRateValue = isFilteredByRange
    ? scopedReviews.length > 0
      ? Math.round(
          (scopedReviews.filter((r) => r.status === 'approved').length /
            scopedReviews.length) *
            100
        )
      : 0
    : overview.approvalRate;

  const repoAnalyses = scopedReviews
    .filter((rev) => rev.reviewScope === 'repository')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const recentJobs = [...analysisJobs]
    .filter((job) => isWithinDateRange(job.updatedAt || job.createdAt, dateRange))
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt).getTime() -
        new Date(a.updatedAt || a.createdAt).getTime()
    )
    .slice(0, 4);

  const visibleDailyActivity = filterDailyActivityByRange(dailyActivity, dateRange);
  const chartRange: '7d' | '14d' = dateRange === '7d' || dateRange === '24h' ? '7d' : '14d';
  const displayedRecentReviews = scopedReviews.slice(0, 6);

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} onRetry={onRetry} />}

      {/* Top Interactive Controls: Demo Attribution, Date Range Filter, Quick Actions */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          {hasDemoData ? (
            <p className="text-xs text-slate-300">
              <span className="font-semibold text-slate-100">Demo + Live Workspace:</span>{' '}
              Sample items marked <span className="font-mono text-slate-200">Demo data</span> are included alongside real GitHub &amp; Gemini results.
            </p>
          ) : (
            <p className="text-xs text-slate-300">
              Showing live GitHub repository audits and Gemini code review telemetry.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div
            role="group"
            aria-label="Dashboard date range filter"
            className="inline-flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md"
          >
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDateRange(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  dateRange === opt.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onOpenConnectRepo}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 rounded-md transition-colors whitespace-nowrap"
          >
            <FolderPlus className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
            <span>Connect Repo</span>
          </button>

          <button
            type="button"
            onClick={() => onRunReview()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Start Review</span>
          </button>
        </div>
      </div>

      {/* 4-Column Animated & Clickable KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Reviews Completed"
          value={totalReviewsValue}
          numericValue={totalReviewsValue}
          detail={`${overview.weeklyReviews} in last 7d · ${approvalRateValue}% approved${hasDemoData ? ' · Demo + Live' : ''}`}
          emphasis="positive"
          actionLabel="View"
          onClick={() =>
            onNavigateFilteredReviews ? onNavigateFilteredReviews() : onNavigate('reviews')
          }
        />
        <StatCard
          label="Open Findings"
          value={openFindingsValue}
          numericValue={openFindingsValue}
          detail={`${criticalOpenValue} critical · ${highOpenValue} high${hasDemoData ? ' · Demo + Live' : ''}`}
          emphasis={criticalOpenValue > 0 ? 'warning' : 'default'}
          actionLabel="Inspect"
          onClick={() =>
            onNavigateFilteredReviews
              ? onNavigateFilteredReviews({
                  severity: criticalOpenValue > 0 ? 'critical' : undefined,
                })
              : onNavigate('reviews')
          }
        />
        <StatCard
          label="Mean Rubric Score"
          value={`${meanScoreValue} / 100`}
          numericValue={meanScoreValue}
          decimals={1}
          suffix=" / 100"
          detail={`Across ${totalReviewsValue} reviews${hasDemoData ? ' · Demo + Live' : ''}`}
          emphasis={meanScoreValue >= 80 ? 'positive' : 'warning'}
          actionLabel="Trends"
          onClick={() => onNavigate('analytics')}
        />
        <StatCard
          label="Connected Repositories"
          value={overview.connectedReposCount}
          numericValue={overview.connectedReposCount}
          detail={`${overview.openPrsCount} open PRs · ${data.activeAgentsCount} active agents`}
          emphasis="violet"
          actionLabel="Repos"
          onClick={() => onNavigate('repositories')}
        />
      </div>

      {/* Charts Row: Issue Severity Distribution & Repository Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-7">
          <IssueSeverityChart
            dailyActivity={visibleDailyActivity}
            severityTotals={severityTotals}
            range={chartRange}
            onRangeChange={(next) => setDateRange(next)}
          />
        </div>
        <div className="lg:col-span-5">
          <RepositoryActivityChart
            repositories={repositories}
            onSelectRepository={onSelectRepository}
          />
        </div>
      </div>

      {/* AI Agent Activity & Performance Section */}
      {agents.length > 0 && (
        <AgentActivitySection
          agents={agents}
          reviews={allReviewsSource}
          analysisJobs={analysisJobs}
          onManageAgents={() => onNavigate('agents')}
          onRunWithAgent={(agentId) => onRunReview(agentId)}
        />
      )}

      {/* Recent Repository Analysis Activity */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Recent Repository Analysis Activity
              </h2>
              <p className="text-xs text-slate-400">
                Multi-agent source-tree audits and background collection jobs across connected GitHub repositories
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('repositories')}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap shrink-0"
          >
            <span>Open Repositories</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {recentJobs.length > 0 && (
          <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-md bg-[#0B0F17]">
            {recentJobs.map((job) => {
              const matchedRepo = repositories.find(
                (r) =>
                  r.id === job.repositoryId ||
                  r.fullName.toLowerCase() === job.repositoryFullName.toLowerCase()
              );
              return (
                <div
                  key={job.id}
                  className="px-4 py-3 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`font-medium ${getJobStatusColorClass(job.status)}`}>
                        {getJobStatusLabel(job.status)}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-slate-100">
                        {job.repositoryFullName}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="font-mono text-slate-300">{job.branch}</span>
                      {job.analyzedCommitSha && (
                        <>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="font-mono text-slate-400 tabular-nums">
                            {formatCommitSha(job.analyzedCommitSha)}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {job.progress}% · {job.filesAnalyzed}/{job.eligibleFiles || job.filesCollected}{' '}
                      files · {job.completedAgents}/{job.totalAgents} agents ·{' '}
                      {formatRelativeTime(job.updatedAt || job.createdAt)}
                    </div>
                  </div>

                  {matchedRepo && (
                    <button
                      type="button"
                      onClick={() => onSelectRepository(matchedRepo)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#111827] hover:bg-slate-800 border border-slate-800 rounded-md whitespace-nowrap"
                    >
                      Inspect Repo
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {repoAnalyses.length > 0 ? (
          <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-md bg-[#0B0F17]">
            {repoAnalyses.slice(0, 4).map((audit) => (
              <div
                key={audit.id}
                className="p-4 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-800/30 transition-colors"
              >
                <div className="min-w-0 space-y-1 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {audit.analysisStatus === 'partial' ? (
                      <AlertTriangle
                        className="w-3.5 h-3.5 text-amber-400 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <CheckCircle2
                        className="w-3.5 h-3.5 text-emerald-400 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="font-mono font-semibold text-slate-100">
                      {audit.repositoryFullName}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="font-mono text-slate-300">{audit.branch}</span>
                    {audit.analyzedCommitSha && (
                      <>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="font-mono text-slate-400 tabular-nums">
                          Commit {formatCommitSha(audit.analyzedCommitSha)}
                        </span>
                      </>
                    )}
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span
                      className={
                        audit.analysisStatus === 'partial'
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }
                    >
                      {audit.analysisStatus === 'partial' ? 'Partial' : 'Completed'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 line-clamp-1">{audit.summary}</p>

                  <div className="text-[11px] font-mono text-slate-400 tabular-nums flex flex-wrap items-center gap-2">
                    <span>{formatRelativeTime(audit.createdAt)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{audit.findings.length} findings</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {audit.collectionCoverage?.totalFilesAnalyzed ?? audit.filesChanged} files
                      analyzed
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDurationMs(audit.durationMs)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <div className="text-[11px] text-slate-400">Score</div>
                    <div
                      className={`text-lg font-mono font-semibold tabular-nums ${getScoreColorClass(
                        audit.score
                      )}`}
                    >
                      {audit.score}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectReview(audit)}
                    className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap"
                  >
                    Open Review
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : recentJobs.length === 0 ? (
          <div className="bg-[#0B0F17] border border-slate-800 rounded-md px-4 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <span>
              No full-repository audits executed in this date range yet. Open Repositories and select Analyze Repository on any connected GitHub codebase.
            </span>
            <button
              type="button"
              onClick={() => onNavigate('repositories')}
              className="text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap shrink-0"
            >
              Go to Repositories →
            </button>
          </div>
        ) : null}
      </section>

      {/* Recent Code Reviews Table */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Recent Review Activity</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Click any pull request or repository review to inspect AI findings, rubric scores, and evidence
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('reviews')}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap shrink-0"
          >
            <span>View all reviews</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {displayedRecentReviews.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No reviews found for this timeframe. Switch the date filter or run an AI review.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 text-[12px] font-medium text-slate-400 bg-[#0E1420]">
                  <th className="py-2.5 px-5">Pull Request / Audit</th>
                  <th className="py-2.5 px-4">Agent</th>
                  <th className="py-2.5 px-4">Decision</th>
                  <th className="py-2.5 px-4 text-right">Findings</th>
                  <th className="py-2.5 px-4 text-right">Score</th>
                  <th className="py-2.5 px-5 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {displayedRecentReviews.map((review) => {
                  const openCount = review.findings.filter((f) => !f.resolved).length;
                  return (
                    <tr
                      key={review.id}
                      onClick={() => onSelectReview(review)}
                      className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-5 max-w-[360px]">
                        <div className="font-medium text-slate-100 truncate">
                          <span className="font-mono text-slate-400 mr-2">
                            {review.reviewScope === 'repository'
                              ? 'Repo'
                              : `#${review.prNumber}`}
                          </span>
                          {review.title}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 truncate">
                          <span className="font-mono">{review.repositoryFullName}</span>
                          <span aria-hidden="true">·</span>
                          <span>{review.author}</span>
                          <span aria-hidden="true">·</span>
                          <span>{getSourceLabel(review)}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-300 whitespace-nowrap">
                        {review.agentName}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <StatusText status={review.status} />
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-300 tabular-nums whitespace-nowrap">
                        {openCount} open / {review.findings.length}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono font-semibold text-sm tabular-nums whitespace-nowrap ${getScoreColorClass(
                          review.score
                        )}`}
                      >
                        {review.score}
                      </td>
                      <td className="py-3 px-5 text-right text-xs text-slate-400 tabular-nums whitespace-nowrap">
                        {formatRelativeTime(review.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
