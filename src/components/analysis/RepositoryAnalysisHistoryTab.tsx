import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { isJobActive } from '../../hooks/useRepositoryAnalysisJob';
import type { Repository, RepositoryAnalysisJob } from '../../types';
import {
  formatCommitSha,
  formatRelativeTime,
  getJobStatusColorClass,
  getJobStatusLabel,
} from '../../utils/formatters';
import { ErrorBanner } from '../ui/DataState';

interface RepositoryAnalysisHistoryTabProps {
  repository: Repository;
  jobs: RepositoryAnalysisJob[];
  loading: boolean;
  error: string | null;
  authRequired: boolean;
  onRefresh: () => void;
  onSignInWithGitHub: () => void;
  onStartNewAnalysis: () => void;
  onInspectJob: (job: RepositoryAnalysisJob) => void;
  onOpenReview: (reviewId: string) => void;
}

export function RepositoryAnalysisHistoryTab({
  repository,
  jobs,
  loading,
  error,
  authRequired,
  onRefresh,
  onSignInWithGitHub,
  onStartNewAnalysis,
  onInspectJob,
  onOpenReview,
}: RepositoryAnalysisHistoryTabProps) {
  const sortedJobs = [...jobs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-400">
          Repository-wide multi-agent audit jobs for{' '}
          <span className="font-mono text-slate-200">{repository.fullName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 disabled:opacity-50 rounded-md whitespace-nowrap"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onStartNewAnalysis}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Analyze Repository</span>
          </button>
        </div>
      </div>

      {authRequired ? (
        <div className="bg-[#0B0F17] border border-amber-500/30 rounded-md p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-medium text-amber-200">
              GitHub authentication required
            </div>
            <p className="text-xs text-slate-400">
              Your GitHub session expired or is not signed in. Reconnect GitHub to inspect repository analysis jobs and history.
            </p>
          </div>
          <button
            type="button"
            onClick={onSignInWithGitHub}
            className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md whitespace-nowrap shrink-0"
          >
            Reconnect GitHub
          </button>
        </div>
      ) : loading && sortedJobs.length === 0 ? (
        <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>Loading repository analysis history...</span>
        </div>
      ) : error ? (
        <ErrorBanner message={error} onRetry={onRefresh} />
      ) : sortedJobs.length === 0 ? (
        <div className="bg-[#0B0F17] border border-slate-800 rounded-md py-10 px-6 text-center space-y-3">
          <div className="text-sm font-medium text-slate-200">
            No repository analyses recorded yet
          </div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Run a full-repository analysis to collect source files, execute all enabled AI agents, and persist a holistic CodeRubric audit.
          </p>
          <button
            type="button"
            onClick={onStartNewAnalysis}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Analyze Repository</span>
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-md bg-[#0B0F17]">
          {sortedJobs.map((job) => {
            const active = isJobActive(job.status);

            return (
              <div
                key={job.id}
                className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {active ? (
                      <Loader2
                        className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0"
                        aria-hidden="true"
                      />
                    ) : job.status === 'completed' ? (
                      <CheckCircle2
                        className="w-3.5 h-3.5 text-emerald-400 shrink-0"
                        aria-hidden="true"
                      />
                    ) : job.status === 'partial' ? (
                      <AlertTriangle
                        className="w-3.5 h-3.5 text-amber-400 shrink-0"
                        aria-hidden="true"
                      />
                    ) : job.status === 'failed' ? (
                      <XCircle
                        className="w-3.5 h-3.5 text-red-400 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                    )}

                    <span className={`font-medium ${getJobStatusColorClass(job.status)}`}>
                      {getJobStatusLabel(job.status)}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="font-mono text-slate-200">{job.branch}</span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="font-mono text-slate-400 tabular-nums">
                      Commit {formatCommitSha(job.analyzedCommitSha)}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="font-mono text-slate-300 tabular-nums">
                      {job.progress}%
                    </span>
                  </div>

                  <div className="text-xs text-slate-400 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>{formatRelativeTime(job.createdAt)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {job.filesAnalyzed} files analyzed ({job.filesCollected} collected)
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {job.completedAgents}/{job.totalAgents} agents
                      {job.failedAgents > 0 ? ` (${job.failedAgents} failed)` : ''}
                    </span>
                  </div>

                  {job.status === 'failed' && job.error && (
                    <p className="text-xs text-red-300/90 truncate">{job.error}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {active ? (
                    <button
                      type="button"
                      onClick={() => onInspectJob(job)}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md whitespace-nowrap"
                    >
                      Live Progress
                    </button>
                  ) : (
                    <>
                      {job.resultReviewId && (
                        <button
                          type="button"
                          onClick={() => onOpenReview(job.resultReviewId!)}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md whitespace-nowrap"
                        >
                          Open Review
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onInspectJob(job)}
                        className="px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-[#111827] hover:bg-slate-800 border border-slate-800 rounded-md whitespace-nowrap"
                      >
                        {job.status === 'failed' ? 'Inspect / Retry' : 'Job Details'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
