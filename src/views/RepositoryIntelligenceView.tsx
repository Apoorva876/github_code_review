import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { AgentExecutionBreakdown } from '../components/analysis/AgentExecutionBreakdown';
import { EmptyState } from '../components/ui/DataState';
import {
  getAnalysisStageSteps,
  useRepositoryAnalysisJob,
} from '../hooks/useRepositoryAnalysisJob';
import type { AIAgent, RepositoryAnalysisJob } from '../types';
import {
  formatCommitSha,
  getJobStatusColorClass,
  getJobStatusLabel,
} from '../utils/formatters';
import type { RepositoryIntelligenceTarget } from './AnalyzeView';

interface RepositoryIntelligenceViewProps {
  target: RepositoryIntelligenceTarget | null;
  agents: AIAgent[];
  onBackToAnalyze: () => void;
  onJobUpdated: (job: RepositoryAnalysisJob) => void;
  onOpenReview: (reviewId: string) => void;
}

export function RepositoryIntelligenceView({
  target,
  agents,
  onBackToAnalyze,
  onJobUpdated,
  onOpenReview,
}: RepositoryIntelligenceViewProps) {
  const onJobUpdatedRef = useRef(onJobUpdated);
  onJobUpdatedRef.current = onJobUpdated;

  const {
    job,
    starting,
    error,
    pollError,
    isActive,
    startAnalysis,
    attachJob,
    refreshNow,
    reset,
  } = useRepositoryAnalysisJob({
    initialJob: target?.job ?? null,
    onTerminalJob: (finished) => {
      onJobUpdatedRef.current(finished);
    },
  });

  const lastTargetJobIdRef = useRef<string | null>(target?.job.id ?? null);
  useEffect(() => {
    if (target?.job && target.job.id !== lastTargetJobIdRef.current) {
      lastTargetJobIdRef.current = target.job.id;
      attachJob(target.job);
    }
  }, [target?.job, attachJob]);

  useEffect(() => {
    if (job) {
      onJobUpdatedRef.current(job);
    }
  }, [job]);

  const stageSteps = useMemo(() => getAnalysisStageSteps(job), [job]);

  if (!target) {
    return (
      <EmptyState
        title="No repository selected for intelligence analysis"
        description="Enter a public GitHub repository URL on the Analyze page and select Analyze Repository to begin."
        actionLabel="Go to Analyze"
        onAction={onBackToAnalyze}
      />
    );
  }

  const { repository, parsed } = target;
  const activeJob = job ?? target.job;

  async function handleRetry() {
    reset();
    const started = await startAnalysis(repository.id, repository.defaultBranch);
    if (started) {
      onJobUpdatedRef.current(started);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Bar / Repository Identity */}
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
            <span>{repository.isPrivate ? 'Private' : 'Public'} GitHub Repository</span>
            <span aria-hidden="true">·</span>
            <span>Branch <span className="font-mono text-slate-200">{activeJob.branch}</span></span>
            <span aria-hidden="true">·</span>
            <span>{repository.language}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{repository.stars.toLocaleString()} stars</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {activeJob.resultReviewId && (
            <button
              type="button"
              onClick={() => onOpenReview(activeJob.resultReviewId!)}
              className="px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-md transition-colors whitespace-nowrap"
            >
              Open Repository Review
            </button>
          )}
          {activeJob.status === 'failed' && (
            <button
              type="button"
              disabled={starting}
              onClick={() => void handleRetry()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Retry Analysis</span>
            </button>
          )}
        </div>
      </div>

      {/* Stage Notice */}
      <div className="bg-[#111827] border border-blue-500/25 rounded-lg px-4 py-3 text-xs text-slate-300">
        Repository verified on GitHub and analysis workflow started. Full Repository Intelligence diagrams and multi-view insights will be rendered on this page in the next development stage.
      </div>

      {/* Live Analysis Workflow Status */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {isActive ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" aria-hidden="true" />
            ) : activeJob.status === 'completed' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
            ) : activeJob.status === 'partial' ? (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
            )}
            <span className={`text-sm font-semibold ${getJobStatusColorClass(activeJob.status)}`}>
              {getJobStatusLabel(activeJob.status)}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
            <span className="text-slate-400">Job {activeJob.id.slice(0, 14)}</span>
            <span className="text-slate-100 font-semibold">
              {Math.max(0, Math.min(100, activeJob.progress))}%
            </span>
          </div>
        </div>

        <div
          className="h-2 bg-slate-800 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={activeJob.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              activeJob.status === 'failed'
                ? 'bg-red-500'
                : activeJob.status === 'partial'
                  ? 'bg-amber-500'
                  : activeJob.status === 'completed'
                    ? 'bg-emerald-500'
                    : 'bg-blue-500'
            }`}
            style={{ width: `${Math.max(0, Math.min(100, activeJob.progress))}%` }}
          />
        </div>

        <p className="text-xs text-slate-300">{activeJob.message}</p>

        {/* 5-Stage Pipeline */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-800/80">
          {stageSteps.map((step, idx) => (
            <div
              key={step.key}
              className={`px-3 py-2 rounded border text-[11px] leading-snug ${
                step.state === 'active'
                  ? 'bg-blue-500/10 border-blue-500/40 text-blue-200'
                  : step.state === 'done'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : step.state === 'warning'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      : step.state === 'error'
                        ? 'bg-red-500/10 border-red-500/30 text-red-300'
                        : 'bg-[#0B0F17] border-slate-800/80 text-slate-500'
              }`}
            >
              <div className="font-mono text-[10px] opacity-75">Step {idx + 1}</div>
              <div className="font-medium truncate" title={step.label}>
                {step.label}
              </div>
            </div>
          ))}
        </div>

        {/* Real Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
            <div className="text-[11px] text-slate-400">Files Collected</div>
            <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
              {activeJob.filesCollected}
            </div>
            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
              {activeJob.eligibleFiles} eligible · {activeJob.totalTreeEntries} tree
            </div>
          </div>

          <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
            <div className="text-[11px] text-slate-400">Files Analyzed</div>
            <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
              {activeJob.filesAnalyzed}
            </div>
            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
              {activeJob.filesSkipped} skipped · {activeJob.filesTruncated} truncated
            </div>
          </div>

          <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
            <div className="text-[11px] text-slate-400">Source Chunks</div>
            <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
              {activeJob.completedChunks} / {activeJob.totalChunks}
            </div>
            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
              {activeJob.analyzedCommitSha
                ? `SHA ${formatCommitSha(activeJob.analyzedCommitSha)}`
                : 'Resolving SHA'}
            </div>
          </div>

          <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
            <div className="text-[11px] text-slate-400">AI Agents</div>
            <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
              {activeJob.completedAgents} / {activeJob.totalAgents}
            </div>
            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
              {activeJob.failedAgents > 0 ? `${activeJob.failedAgents} failed` : 'No failures'}
            </div>
          </div>
        </div>

        {(error || activeJob.error) && (
          <div
            role="alert"
            className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 flex items-start gap-2 text-xs text-red-300"
          >
            <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error || activeJob.error}</span>
          </div>
        )}

        {pollError && (
          <div
            role="alert"
            className="bg-amber-500/10 border border-amber-500/30 rounded-md px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200"
          >
            <span>{pollError}</span>
            <button
              type="button"
              onClick={() => void refreshNow()}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded whitespace-nowrap"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              <span>Retry Poll</span>
            </button>
          </div>
        )}

        <AgentExecutionBreakdown
          agentBreakdown={activeJob.agentBreakdown}
          configuredAgents={agents}
          totalAgents={activeJob.totalAgents}
          completedAgents={activeJob.completedAgents}
          failedAgents={activeJob.failedAgents}
        />
      </section>
    </div>
  );
}
