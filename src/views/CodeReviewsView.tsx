import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Search,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ExpandableReviewDetails } from '../components/reviews/ExpandableReviewDetails';
import { EmptyState, ErrorBanner, TableSkeleton } from '../components/ui/DataState';
import { StatusText } from '../components/ui/SeverityText';
import type { CodeReview, ReviewStatus, Severity } from '../types';
import {
  formatDurationMs,
  formatRelativeTime,
  getScoreColorClass,
  getSourceLabel,
} from '../utils/formatters';
import {
  sortAndFilterReviews,
  type DateRangeFilter,
  type ReviewSortField,
  type SortDirection,
} from '../utils/workspaceMetrics';

interface CodeReviewsViewProps {
  reviews: CodeReview[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectReview: (review: CodeReview) => void;
  onReviewUpdated?: (updated: CodeReview) => void;
  onRunReview: () => void;
  initialStatusFilter?: 'all' | ReviewStatus;
  initialSeverityFilter?: 'all' | Severity;
  filterPresetKey?: number;
}

function SortIcon({
  field,
  activeField,
  direction,
}: {
  field: ReviewSortField;
  activeField: ReviewSortField;
  direction: SortDirection;
}) {
  if (field !== activeField) {
    return <ArrowUpDown className="w-3 h-3 text-slate-500" aria-hidden="true" />;
  }
  return direction === 'asc' ? (
    <ArrowUp className="w-3 h-3 text-blue-400" aria-hidden="true" />
  ) : (
    <ArrowDown className="w-3 h-3 text-blue-400" aria-hidden="true" />
  );
}

export function CodeReviewsView({
  reviews,
  loading,
  error,
  onRefresh,
  onSelectReview,
  onReviewUpdated,
  onRunReview,
  initialStatusFilter = 'all',
  initialSeverityFilter = 'all',
  filterPresetKey = 0,
}: CodeReviewsViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ReviewStatus>(initialStatusFilter);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'live' | 'demo'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>(initialSeverityFilter);
  const [agentFilter, setAgentFilter] = useState('all');
  const [repoFilter, setRepoFilter] = useState('all');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [sortField, setSortField] = useState<ReviewSortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);

  useEffect(() => {
    if (filterPresetKey === 0) return;
    setStatusFilter(initialStatusFilter);
    setSeverityFilter(initialSeverityFilter);
  }, [filterPresetKey, initialStatusFilter, initialSeverityFilter]);

  const uniqueAgents = useMemo(() => {
    const names = new Set<string>();
    for (const r of reviews) {
      if (r.agentName) names.add(r.agentName);
      r.agentBreakdown?.forEach((b) => names.add(b.agentName));
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [reviews]);

  const uniqueRepos = useMemo(
    () =>
      Array.from(new Set(reviews.map((r) => r.repositoryFullName))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [reviews]
  );

  const filtered = useMemo(
    () =>
      sortAndFilterReviews(reviews, {
        search,
        status: statusFilter,
        source: sourceFilter,
        severity: severityFilter,
        agent: agentFilter,
        repository: repoFilter,
        dateRange,
        sortField,
        sortDirection,
      }),
    [
      reviews,
      search,
      statusFilter,
      sourceFilter,
      severityFilter,
      agentFilter,
      repoFilter,
      dateRange,
      sortField,
      sortDirection,
    ]
  );

  function handleSort(field: ReviewSortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'title' ? 'asc' : 'desc');
    }
  }

  function handleResetFilters() {
    setSearch('');
    setStatusFilter('all');
    setSourceFilter('all');
    setSeverityFilter('all');
    setAgentFilter('all');
    setRepoFilter('all');
    setDateRange('all');
  }

  const hasActiveFilters =
    search !== '' ||
    statusFilter !== 'all' ||
    sourceFilter !== 'all' ||
    severityFilter !== 'all' ||
    agentFilter !== 'all' ||
    repoFilter !== 'all' ||
    dateRange !== 'all';

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} onRetry={onRefresh} />}

      {/* Search, Segmented Controls, and Multi-Facet Filters */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
            <div className="relative w-full sm:w-72">
              <Search
                className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search PR, repo, author, file path, or finding..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md">
              {(['all', 'approved', 'changes_requested', 'in_review'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    statusFilter === status
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {status === 'all'
                    ? 'All Decisions'
                    : status === 'approved'
                      ? 'Approved'
                      : status === 'changes_requested'
                        ? 'Changes Requested'
                        : 'In Review'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md">
              {(['all', 'live', 'demo'] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSourceFilter(src)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    sourceFilter === src
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {src === 'all' ? 'All Sources' : src === 'live' ? 'Live Gemini' : 'Demo'}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onRunReview}
            className="px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            New AI Review
          </button>
        </div>

        {/* Secondary Facet Row: Severity, Agent, Repository, Date */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/70">
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Filter reviews by finding severity"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as 'all' | Severity)}
              className="px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All Severities</option>
              <option value="critical">Has Critical</option>
              <option value="high">Has High</option>
              <option value="medium">Has Medium</option>
              <option value="low">Has Low</option>
            </select>

            <select
              aria-label="Filter reviews by AI agent"
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All AI Agents</option>
              {uniqueAgents.map((agentName) => (
                <option key={agentName} value={agentName}>
                  {agentName}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter reviews by repository"
              value={repoFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-200 font-mono focus:outline-none focus:border-blue-500"
            >
              <option value="all">All Repositories</option>
              {uniqueRepos.map((repoName) => (
                <option key={repoName} value={repoName}>
                  {repoName}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter reviews by date range"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRangeFilter)}
              className="px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All Time</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-2.5 py-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap"
              >
                Reset filters
              </button>
            )}
          </div>

          <span className="text-xs font-mono text-slate-400 tabular-nums">
            Showing {filtered.length} of {reviews.length} reviews
          </span>
        </div>
      </div>

      {/* Reviews Table with Sortable Headers & Expandable Inline Evidence */}
      {loading && reviews.length === 0 ? (
        <div className="bg-[#111827] border border-slate-800/90 rounded-lg">
          <TableSkeleton rows={6} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No code reviews match your filters"
          description="Try clearing your active filters or run a fresh Gemini AI review on a GitHub PR or code diff."
          actionLabel={hasActiveFilters ? 'Reset Filters' : 'Run AI Review'}
          onAction={hasActiveFilters ? handleResetFilters : onRunReview}
        />
      ) : (
        <div className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 text-[12px] font-medium text-slate-400 bg-[#0E1420]">
                  <th className="py-2.5 pl-4 pr-2 w-9" aria-label="Expand inline details" />
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => handleSort('title')}
                      className="inline-flex items-center gap-1 hover:text-slate-100 transition-colors"
                    >
                      <span>Pull Request / Audit</span>
                      <SortIcon field="title" activeField={sortField} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="py-2.5 px-4">Agent</th>
                  <th className="py-2.5 px-4">Decision</th>
                  <th className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('findings')}
                      className="inline-flex items-center gap-1 hover:text-slate-100 transition-colors ml-auto"
                    >
                      <span>Findings</span>
                      <SortIcon
                        field="findings"
                        activeField={sortField}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                  <th className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('duration')}
                      className="inline-flex items-center gap-1 hover:text-slate-100 transition-colors ml-auto"
                    >
                      <span>Duration</span>
                      <SortIcon
                        field="duration"
                        activeField={sortField}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                  <th className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('score')}
                      className="inline-flex items-center gap-1 hover:text-slate-100 transition-colors ml-auto"
                    >
                      <span>Score</span>
                      <SortIcon field="score" activeField={sortField} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="py-2.5 px-5 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('date')}
                      className="inline-flex items-center gap-1 hover:text-slate-100 transition-colors ml-auto"
                    >
                      <span>Reviewed</span>
                      <SortIcon field="date" activeField={sortField} direction={sortDirection} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {filtered.map((review) => {
                  const critHigh = review.findings.filter(
                    (f) => f.severity === 'critical' || f.severity === 'high'
                  ).length;
                  const openCount = review.findings.filter((f) => !f.resolved).length;
                  const isExpanded = expandedReviewId === review.id;

                  return (
                    <Fragment key={review.id}>
                      <tr
                        onClick={() => onSelectReview(review)}
                        className={`cursor-pointer transition-colors ${
                          isExpanded ? 'bg-slate-800/35' : 'hover:bg-slate-800/30'
                        }`}
                      >
                        <td
                          className="py-3 pl-4 pr-2 align-middle"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedReviewId((prev) =>
                              prev === review.id ? null : review.id
                            );
                          }}
                        >
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={
                              isExpanded
                                ? `Collapse details for ${review.title}`
                                : `Expand inline details for ${review.title}`
                            }
                            className="p-1 text-slate-400 hover:text-slate-100 rounded hover:bg-slate-800 transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-blue-400" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="w-4 h-4" aria-hidden="true" />
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-3 max-w-[360px]">
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
                          <span>{openCount} open</span>
                          {critHigh > 0 && (
                            <span className="text-red-400 ml-1">({critHigh} C/H)</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
                          {formatDurationMs(review.durationMs)}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${getScoreColorClass(
                            review.score
                          )}`}
                        >
                          {review.score}
                        </td>
                        <td className="py-3 px-5 text-right text-xs text-slate-400 tabular-nums whitespace-nowrap">
                          {formatRelativeTime(review.createdAt)}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <ExpandableReviewDetails
                              review={review}
                              onOpenFullDrawer={onSelectReview}
                              onReviewUpdated={onReviewUpdated}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
