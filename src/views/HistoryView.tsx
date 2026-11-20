import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Download,
  Search,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { ExpandableReviewDetails } from '../components/reviews/ExpandableReviewDetails';
import { EmptyState, ErrorBanner, TableSkeleton } from '../components/ui/DataState';
import { StatusText } from '../components/ui/SeverityText';
import type { CodeReview, ReviewStatus, Severity } from '../types';
import {
  downloadReviewsCsv,
  formatDurationMs,
  getScoreColorClass,
  getSourceLabel,
} from '../utils/formatters';
import {
  sortAndFilterReviews,
  type DateRangeFilter,
  type ReviewSortField,
  type SortDirection,
} from '../utils/workspaceMetrics';

interface HistoryViewProps {
  reviews: CodeReview[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectReview: (review: CodeReview) => void;
  onReviewUpdated?: (updated: CodeReview) => void;
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

export function HistoryView({
  reviews,
  loading,
  error,
  onRefresh,
  onSelectReview,
  onReviewUpdated,
}: HistoryViewProps) {
  const [search, setSearch] = useState('');
  const [repoFilter, setRepoFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ReviewStatus>('all');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [sortField, setSortField] = useState<ReviewSortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);

  const uniqueRepos = useMemo(
    () =>
      Array.from(new Set(reviews.map((r) => r.repositoryFullName))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [reviews]
  );

  const uniqueAgents = useMemo(() => {
    const names = new Set<string>();
    for (const r of reviews) {
      if (r.agentName) names.add(r.agentName);
      r.agentBreakdown?.forEach((b) => names.add(b.agentName));
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [reviews]);

  const filtered = useMemo(
    () =>
      sortAndFilterReviews(reviews, {
        search,
        status: statusFilter,
        source: 'all',
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
    setRepoFilter('all');
    setAgentFilter('all');
    setSeverityFilter('all');
    setStatusFilter('all');
    setDateRange('all');
  }

  const hasActiveFilters =
    search !== '' ||
    repoFilter !== 'all' ||
    agentFilter !== 'all' ||
    severityFilter !== 'all' ||
    statusFilter !== 'all' ||
    dateRange !== 'all';

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} onRetry={onRefresh} />}

      {/* Filter & Export Controls */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
            <div className="relative w-full sm:w-64">
              <Search
                className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search audit log, file, or finding..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <select
              aria-label="Filter history by repository"
              value={repoFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
              className="px-2.5 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 font-mono focus:outline-none focus:border-blue-500"
            >
              <option value="all">All repositories ({reviews.length})</option>
              {uniqueRepos.map((repoName) => (
                <option key={repoName} value={repoName}>
                  {repoName}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter history by AI agent"
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="px-2.5 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All AI agents</option>
              {uniqueAgents.map((agentName) => (
                <option key={agentName} value={agentName}>
                  {agentName}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter history by severity"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as 'all' | Severity)}
              className="px-2.5 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All severities</option>
              <option value="critical">Has Critical</option>
              <option value="high">Has High</option>
              <option value="medium">Has Medium</option>
              <option value="low">Has Low</option>
            </select>

            <select
              aria-label="Filter history by decision"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | ReviewStatus)}
              className="px-2.5 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All decisions</option>
              <option value="approved">Approved</option>
              <option value="changes_requested">Changes Requested</option>
              <option value="in_review">In Review</option>
            </select>

            <select
              aria-label="Filter history by date range"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRangeFilter)}
              className="px-2.5 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All Time</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={() => downloadReviewsCsv(filtered)}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export CSV ({filtered.length})</span>
            </button>
          </div>
        </div>
      </div>

      {loading && reviews.length === 0 ? (
        <div className="bg-[#111827] border border-slate-800/90 rounded-lg">
          <TableSkeleton rows={6} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No historical reviews match your filters"
          description="Executed Gemini PR reviews, repository audits, and diff evaluations appear here in chronological order."
          actionLabel={hasActiveFilters ? 'Reset Filters' : undefined}
          onAction={hasActiveFilters ? handleResetFilters : undefined}
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
                      onClick={() => handleSort('date')}
                      className="inline-flex items-center gap-1 hover:text-slate-100 transition-colors"
                    >
                      <span>Timestamp</span>
                      <SortIcon field="date" activeField={sortField} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="py-2.5 px-4">
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
                  <th className="py-2.5 px-5 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('score')}
                      className="inline-flex items-center gap-1 hover:text-slate-100 transition-colors ml-auto"
                    >
                      <span>Score</span>
                      <SortIcon field="score" activeField={sortField} direction={sortDirection} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {filtered.map((rev) => {
                  const isExpanded = expandedReviewId === rev.id;
                  const openCount = rev.findings.filter((f) => !f.resolved).length;
                  return (
                    <Fragment key={rev.id}>
                      <tr
                        onClick={() => onSelectReview(rev)}
                        className={`cursor-pointer transition-colors ${
                          isExpanded ? 'bg-slate-800/35' : 'hover:bg-slate-800/30'
                        }`}
                      >
                        <td
                          className="py-3 pl-4 pr-2 align-middle"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedReviewId((prev) => (prev === rev.id ? null : rev.id));
                          }}
                        >
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={
                              isExpanded
                                ? `Collapse details for ${rev.title}`
                                : `Expand inline details for ${rev.title}`
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
                        <td className="py-3 px-3 font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
                          {new Date(rev.createdAt).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-3 px-4 max-w-[340px]">
                          <div className="font-medium text-slate-100 truncate">
                            <span className="font-mono text-slate-400 mr-2">
                              {rev.reviewScope === 'repository' ? 'Repo' : `#${rev.prNumber}`}
                            </span>
                            {rev.title}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5 truncate">
                            <span className="font-mono">{rev.repositoryFullName}</span> ·{' '}
                            {getSourceLabel(rev)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-300 whitespace-nowrap">
                          {rev.agentName}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <StatusText status={rev.status} />
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-slate-300 tabular-nums whitespace-nowrap">
                          {openCount} / {rev.findings.length}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
                          {formatDurationMs(rev.durationMs)}
                        </td>
                        <td
                          className={`py-3 px-5 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${getScoreColorClass(
                            rev.score
                          )}`}
                        >
                          {rev.score}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <ExpandableReviewDetails
                              review={rev}
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
