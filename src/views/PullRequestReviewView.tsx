import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  Loader2,
  Play,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, ErrorBanner } from '../components/ui/DataState';
import { api } from '../services/api';
import type {
  GitHubPagination,
  GitHubPullRequestSummary,
  GitHubRateLimit,
} from '../types';
import { formatRelativeTime } from '../utils/formatters';
import type { PullRequestReviewTarget } from './AnalyzeView';

interface PullRequestReviewViewProps {
  target: PullRequestReviewTarget | null;
  onBackToAnalyze: () => void;
  onTriggerPrReview: (repoFullName: string, prNumber: number) => void;
}

export function PullRequestReviewView({
  target,
  onBackToAnalyze,
  onTriggerPrReview,
}: PullRequestReviewViewProps) {
  const [prState, setPrState] = useState<'open' | 'closed' | 'all'>('open');
  const [page, setPage] = useState(1);
  const [pulls, setPulls] = useState<GitHubPullRequestSummary[]>(target?.pulls ?? []);
  const [pagination, setPagination] = useState<GitHubPagination>(
    target?.pagination ?? { page: 1, perPage: 15, hasNext: false, hasPrev: false }
  );
  const [rateLimit, setRateLimit] = useState<GitHubRateLimit | null>(
    target?.rateLimit ?? null
  );
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(
    target?.pulls[0]?.number ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setPrState('open');
    setPage(1);
    setPulls(target.pulls);
    setPagination(
      target.pagination ?? { page: 1, perPage: 15, hasNext: false, hasPrev: false }
    );
    setRateLimit(target.rateLimit ?? null);
    setSelectedPrNumber(target.pulls[0]?.number ?? null);
    setError(null);
  }, [target]);

  const loadPulls = useCallback(
    async (
      repoId: string,
      nextState: 'open' | 'closed' | 'all',
      nextPage: number
    ) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.getRepositoryPulls(repoId, nextState, nextPage, 15);
        setPulls(res.pulls);
        if (res.pagination) setPagination(res.pagination);
        if (res.rateLimit !== undefined) setRateLimit(res.rateLimit ?? null);
        setSelectedPrNumber((prev) =>
          res.pulls.some((pr) => pr.number === prev) ? prev : (res.pulls[0]?.number ?? null)
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to retrieve pull requests from GitHub.'
        );
        setPulls([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  if (!target) {
    return (
      <EmptyState
        title="No repository selected for pull request review"
        description="Enter a public GitHub repository URL on the Analyze page and click Review Pull Request to load its pull requests."
        actionLabel="Go to Analyze"
        onAction={onBackToAnalyze}
      />
    );
  }

  const { repository, parsed } = target;
  const selectedPr = pulls.find((pr) => pr.number === selectedPrNumber) ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <button
              type="button"
              onClick={onBackToAnalyze}
              className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Back to Analyze</span>
            </button>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span>Owner: <span className="font-mono text-slate-200">{parsed.owner}</span></span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span>Repository: <span className="font-mono text-slate-200">{parsed.repo}</span></span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-lg font-bold text-slate-100 font-mono truncate">
              {repository.fullName}
            </h2>
            <a
              href={repository.htmlUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${repository.fullName} on GitHub`}
              className="text-slate-400 hover:text-slate-100 transition-colors"
            >
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
            </a>
          </div>

          <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
            <span>Public Pull Requests</span>
            <span aria-hidden="true">·</span>
            <span>Default branch <span className="font-mono text-slate-200">{repository.defaultBranch}</span></span>
            {rateLimit && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  GitHub API quota: {rateLimit.remaining}/{rateLimit.limit}
                </span>
              </>
            )}
          </div>
        </div>

        {/* PR State Filter */}
        <div
          role="group"
          aria-label="Pull request state filter"
          className="inline-flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md shrink-0"
        >
          {(['open', 'closed', 'all'] as const).map((stateOpt) => (
            <button
              key={stateOpt}
              type="button"
              disabled={loading}
              onClick={() => {
                setPrState(stateOpt);
                setPage(1);
                void loadPulls(repository.id, stateOpt, 1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded capitalize transition-colors whitespace-nowrap ${
                prState === stateOpt
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {stateOpt}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <ErrorBanner
          message={error}
          onRetry={() => void loadPulls(repository.id, prState, page)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Pull Requests List */}
        <section className="lg:col-span-7 bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <GitPullRequest className="w-4 h-4 text-purple-400 shrink-0" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-100">
                Available Pull Requests
              </h3>
            </div>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {pulls.length} shown
            </span>
          </div>

          {loading ? (
            <div className="p-8 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" aria-hidden="true" />
              <span>Fetching pull requests from GitHub...</span>
            </div>
          ) : pulls.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <div className="text-sm font-medium text-slate-200">
                No {prState === 'all' ? '' : `${prState} `}pull requests found
              </div>
              <p className="text-xs text-slate-400">
                {prState === 'open'
                  ? 'This repository has no open pull requests right now. Switch to Closed or All above to view past pull requests.'
                  : 'Try switching the filter or returning to Analyze to inspect another repository.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {pulls.map((pr) => {
                const isSelected = selectedPrNumber === pr.number;
                return (
                  <button
                    key={pr.number}
                    type="button"
                    onClick={() => setSelectedPrNumber(pr.number)}
                    aria-pressed={isSelected}
                    className={`w-full px-5 py-4 text-left transition-colors flex items-start justify-between gap-4 ${
                      isSelected
                        ? 'bg-blue-600/15 ring-1 ring-inset ring-blue-500/40'
                        : 'hover:bg-slate-800/35'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-medium text-slate-100 leading-snug">
                        <span className="font-mono text-blue-400 mr-2">#{pr.number}</span>
                        <span>{pr.title}</span>
                      </div>
                      <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
                        <span>@{pr.user}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-slate-300 truncate max-w-[260px]">
                          {pr.headRef} → {pr.baseRef}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{pr.state}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{formatRelativeTime(pr.updatedAt)}</span>
                      </div>
                    </div>

                    <span
                      className={`text-xs font-medium whitespace-nowrap shrink-0 ${
                        isSelected ? 'text-blue-300' : 'text-slate-400'
                      }`}
                    >
                      {isSelected ? 'Selected' : 'Select'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {(pagination.hasPrev || pagination.hasNext) && (
            <div className="px-5 py-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 bg-[#0E1420]/60">
              <span className="font-mono tabular-nums">Page {pagination.page}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!pagination.hasPrev || loading}
                  onClick={() => {
                    const nextPage = Math.max(1, page - 1);
                    setPage(nextPage);
                    void loadPulls(repository.id, prState, nextPage);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#0B0F17] border border-slate-800 rounded disabled:opacity-40 hover:bg-slate-800 text-slate-200"
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  disabled={!pagination.hasNext || loading}
                  onClick={() => {
                    const nextPage = page + 1;
                    setPage(nextPage);
                    void loadPulls(repository.id, prState, nextPage);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#0B0F17] border border-slate-800 rounded disabled:opacity-40 hover:bg-slate-800 text-slate-200"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Selected Pull Request Detail Panel */}
        <aside className="lg:col-span-5 bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-100">Selected Pull Request</h3>

          {selectedPr ? (
            <div className="space-y-4">
              <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-blue-400">
                    PR #{selectedPr.number}
                  </span>
                  <span
                    className={`capitalize font-medium ${
                      selectedPr.state === 'open' ? 'text-emerald-400' : 'text-slate-400'
                    }`}
                  >
                    {selectedPr.state}
                  </span>
                </div>

                <div className="text-sm font-semibold text-slate-100 leading-snug">
                  {selectedPr.title}
                </div>

                <div className="pt-2 border-t border-slate-800/80 space-y-1.5 text-xs text-slate-400">
                  <div className="flex items-center justify-between gap-2">
                    <span>Author</span>
                    <span className="font-mono text-slate-200">@{selectedPr.user}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Branch</span>
                    <span className="font-mono text-slate-200 truncate max-w-[220px]">
                      {selectedPr.headRef} → {selectedPr.baseRef}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Updated</span>
                    <span className="tabular-nums text-slate-300">
                      {formatRelativeTime(selectedPr.updatedAt)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-[#0B0F17] border border-slate-800 rounded-md px-3.5 py-3 text-xs text-slate-300 leading-relaxed">
                The complete multi-agent pull request review workflow will be enabled in a later stage. You can inspect this pull request on GitHub or run a single-agent Gemini diff review below.
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onTriggerPrReview(repository.fullName, selectedPr.number)}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-md transition-colors whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Review Selected PR</span>
                </button>

                <a
                  href={selectedPr.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 rounded-md transition-colors whitespace-nowrap"
                >
                  <span>GitHub</span>
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
          ) : (
            <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-4 text-xs text-slate-400">
              Select a pull request from the list to view its details.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
