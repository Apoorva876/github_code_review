import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getAnalysisStageSteps,
  useRepositoryAnalysisJob,
} from '../../hooks/useRepositoryAnalysisJob';
import { ApiError, api } from '../../services/api';
import type {
  AIAgent,
  GitHubAuthStatus,
  GitHubBranchSummary,
  Repository,
  RepositoryAnalysisJob,
} from '../../types';
import {
  formatCommitSha,
  getJobStatusColorClass,
  getJobStatusLabel,
} from '../../utils/formatters';
import { AgentExecutionBreakdown } from '../analysis/AgentExecutionBreakdown';

interface RepositoryAnalysisModalProps {
  open: boolean;
  repository: Repository | null;
  initialBranch?: string;
  initialJob?: RepositoryAnalysisJob | null;
  agents: AIAgent[];
  githubAuth: GitHubAuthStatus | null;
  onClose: () => void;
  onSignInWithGitHub: () => void;
  onOpenReview: (reviewId: string) => void;
  onJobUpdated?: (job: RepositoryAnalysisJob) => void;
}

export function RepositoryAnalysisModal({
  open,
  repository,
  ...rest
}: RepositoryAnalysisModalProps) {
  if (!open || !repository) return null;

  return <RepositoryAnalysisModalContent repository={repository} {...rest} />;
}

function RepositoryAnalysisModalContent({
  repository,
  initialBranch,
  initialJob,
  agents,
  githubAuth,
  onClose,
  onSignInWithGitHub,
  onOpenReview,
  onJobUpdated,
}: Omit<RepositoryAnalysisModalProps, 'open' | 'repository'> & {
  repository: Repository;
}) {
  const [selectedBranch, setSelectedBranch] = useState(
    initialJob?.branch || initialBranch || repository.defaultBranch || 'main'
  );
  const [branches, setBranches] = useState<GitHubBranchSummary[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesWarning, setBranchesWarning] = useState<string | null>(null);
  const [branchesAuthRequired, setBranchesAuthRequired] = useState(false);
  const lastInitialJobIdRef = useRef<string | null>(initialJob?.id ?? null);
  const onJobUpdatedRef = useRef(onJobUpdated);
  onJobUpdatedRef.current = onJobUpdated;
  const lastEmittedJobSigRef = useRef<string | null>(
    initialJob ? `${initialJob.id}:${initialJob.status}:${initialJob.updatedAt}` : null
  );

  const {
    job,
    starting,
    error,
    pollError,
    authExpired,
    permissionError,
    isActive,
    startAnalysis,
    attachJob,
    refreshNow,
    reset,
  } = useRepositoryAnalysisJob({
    initialJob,
    onTerminalJob: (finishedJob) => {
      onJobUpdatedRef.current?.(finishedJob);
    },
  });

  useEffect(() => {
    if (initialJob && initialJob.id !== lastInitialJobIdRef.current) {
      lastInitialJobIdRef.current = initialJob.id;
      lastEmittedJobSigRef.current = `${initialJob.id}:${initialJob.status}:${initialJob.updatedAt}`;
      attachJob(initialJob);
    }
  }, [initialJob, attachJob]);

  useEffect(() => {
    if (!job) return;
    const sig = `${job.id}:${job.status}:${job.updatedAt}`;
    if (lastEmittedJobSigRef.current === sig) return;
    lastEmittedJobSigRef.current = sig;
    onJobUpdatedRef.current?.(job);
  }, [job]);

  useEffect(() => {
    if (repository.isDemo || initialJob) return;
    let cancelled = false;
    setBranchesLoading(true);
    setBranchesWarning(null);
    setBranchesAuthRequired(false);

    api
      .getRepositoryBranches(repository.id, 1, 50)
      .then((res) => {
        if (cancelled) return;
        setBranches(res.branches);
        const preferred = initialBranch || repository.defaultBranch;
        if (preferred) {
          setSelectedBranch(preferred);
        } else if (res.branches[0]?.name) {
          setSelectedBranch(res.branches[0].name);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setBranchesAuthRequired(true);
          setBranchesWarning(
            'GitHub session required to list remote branches. You can still sign in or use the default branch.'
          );
        } else {
          setBranchesWarning(
            err instanceof Error
              ? `Could not refresh remote branches (${err.message}). Using default branch.`
              : 'Could not refresh remote branches. Using default branch.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repository.id, repository.isDemo, repository.defaultBranch, initialBranch, initialJob]);

  const branchOptions = useMemo(() => {
    const names = new Set<string>();
    if (repository.defaultBranch) names.add(repository.defaultBranch);
    if (initialBranch) names.add(initialBranch);
    for (const b of branches) {
      names.add(b.name);
    }
    return Array.from(names);
  }, [branches, initialBranch, repository.defaultBranch]);

  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents]);
  const disabledAgentsCount = agents.length - enabledAgents.length;

  const needsReconnect =
    authExpired ||
    permissionError ||
    branchesAuthRequired ||
    Boolean(repository.isPrivate && (!githubAuth?.authenticated || !githubAuth?.hasPrivateScope));

  const stageSteps = useMemo(() => getAnalysisStageSteps(job), [job]);

  async function handleConfirmStart() {
    if (repository.isDemo || enabledAgents.length === 0) return;
    const started = await startAnalysis(repository.id, selectedBranch);
    if (started) {
      onJobUpdated?.(started);
    }
  }

  async function handleRetry() {
    reset();
    const branchToRun = job?.branch || selectedBranch || repository.defaultBranch;
    const started = await startAnalysis(repository.id, branchToRun);
    if (started) {
      onJobUpdated?.(started);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="repo-analysis-modal-title"
    >
      <div className="w-full max-w-3xl bg-[#111827] border border-slate-800 rounded-lg overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              {repository.isPrivate && (
                <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-label="Private repository" />
              )}
              <span className="font-mono text-slate-200 truncate">{repository.fullName}</span>
              <span aria-hidden="true">·</span>
              <span>{repository.isPrivate ? 'Private Repository' : 'Public Repository'}</span>
              {job && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{job.branch}</span>
                  {job.analyzedCommitSha && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Commit {formatCommitSha(job.analyzedCommitSha)}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
            <h2
              id="repo-analysis-modal-title"
              className="mt-1 text-base font-semibold text-slate-100"
            >
              {job ? 'Repository Analysis Progress' : 'Analyze GitHub Repository'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close repository analysis dialog"
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md hover:bg-slate-800/60 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {repository.isDemo ? (
            <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-5 space-y-2 text-center">
              <div className="text-sm font-medium text-slate-100">
                Demo repositories cannot run live repository analysis
              </div>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Connect a real public or private GitHub repository to collect source files and run the multi-agent CodeRubric audit.
              </p>
            </div>
          ) : !job ? (
            /* Confirmation View */
            <div className="space-y-5">
              <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
                  <span>Full-Repository Multi-Agent Audit</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  CodeRubric resolves the selected branch commit, collects prioritized source files via the GitHub Git Trees API, splits code into line-numbered batches, runs every enabled AI agent independently, and synthesizes one unified repository review.
                </p>
              </div>

              {/* Branch selector */}
              <div className="space-y-2">
                <label
                  htmlFor="analysis-branch-select"
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-300"
                >
                  <GitBranch className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  <span>Target Branch</span>
                  {branchesLoading && (
                    <Loader2 className="w-3 h-3 animate-spin text-slate-400 ml-1" aria-hidden="true" />
                  )}
                </label>
                <select
                  id="analysis-branch-select"
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  disabled={starting}
                  className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                >
                  {branchOptions.map((branchName) => (
                    <option key={branchName} value={branchName}>
                      {branchName}
                      {branchName === repository.defaultBranch ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
                {branchesWarning && (
                  <p className="text-xs text-amber-300/90">{branchesWarning}</p>
                )}
              </div>

              {/* Enabled agents summary */}
              <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-200">
                    Active Reviewer Agents
                  </span>
                  <span className="font-mono text-slate-300 tabular-nums">
                    {enabledAgents.length} of {agents.length} enabled
                    {disabledAgentsCount > 0 ? ` · ${disabledAgentsCount} skipped` : ''}
                  </span>
                </div>

                {enabledAgents.length === 0 ? (
                  <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
                    No AI agents are currently enabled. Enable at least one agent in the Agents tab before starting an audit.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {agents.map((agent) => (
                      <div
                        key={agent.id}
                        className={`px-3 py-2 rounded border text-xs flex items-center justify-between gap-2 ${
                          agent.enabled
                            ? 'bg-[#111827] border-slate-800 text-slate-200'
                            : 'bg-[#111827]/40 border-slate-800/50 text-slate-500'
                        }`}
                      >
                        <span className="truncate font-medium">{agent.name}</span>
                        <span className="font-mono text-[11px] shrink-0">
                          {agent.enabled ? agent.thinkingLevel : 'Disabled'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Private repo / OAuth note */}
              <div className="bg-[#0B0F17] border border-slate-800 rounded-md px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-300">
                  {repository.isPrivate ? (
                    <span>
                      <span className="font-semibold text-amber-300">Private repo access:</span>{' '}
                      Requires an active GitHub OAuth session with <span className="font-mono">repo</span> scope.
                    </span>
                  ) : (
                    <span>
                      Uses your authenticated GitHub session for higher rate limits and repository access.
                    </span>
                  )}
                </div>

                {needsReconnect && (
                  <button
                    type="button"
                    onClick={onSignInWithGitHub}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md whitespace-nowrap shrink-0"
                  >
                    {githubAuth?.authenticated ? 'Reconnect GitHub' : 'Sign in with GitHub'}
                  </button>
                )}
              </div>

              {error && (
                <div
                  role="alert"
                  className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-2 text-xs text-red-300">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                  {(authExpired || permissionError) && (
                    <button
                      type="button"
                      onClick={onSignInWithGitHub}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-md whitespace-nowrap shrink-0"
                    >
                      Reconnect GitHub
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Live Job Progress & Terminal View */
            <div className="space-y-5">
              {/* Top Progress Banner */}
              <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {isActive ? (
                      <Loader2
                        className="w-4 h-4 animate-spin text-blue-400 shrink-0"
                        aria-hidden="true"
                      />
                    ) : job.status === 'completed' ? (
                      <CheckCircle2
                        className="w-4 h-4 text-emerald-400 shrink-0"
                        aria-hidden="true"
                      />
                    ) : job.status === 'partial' ? (
                      <AlertTriangle
                        className="w-4 h-4 text-amber-400 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <XCircle
                        className="w-4 h-4 text-red-400 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`text-sm font-semibold ${getJobStatusColorClass(job.status)}`}
                    >
                      {getJobStatusLabel(job.status)}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                    <span className="text-slate-400">Job {job.id.slice(0, 12)}</span>
                    <span className="text-slate-100 font-semibold">
                      {Math.max(0, Math.min(100, job.progress))}%
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div
                  className="h-2 bg-slate-800 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={job.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`h-full transition-all duration-300 rounded-full ${
                      job.status === 'failed'
                        ? 'bg-red-500'
                        : job.status === 'partial'
                          ? 'bg-amber-500'
                          : job.status === 'completed'
                            ? 'bg-emerald-500'
                            : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                  />
                </div>

                <p className="text-xs text-slate-300">{job.message}</p>

                {/* 5-Stage Visual Stepper */}
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-800/80">
                  {stageSteps.map((step, idx) => (
                    <div
                      key={step.key}
                      className={`px-2.5 py-2 rounded border text-[11px] leading-snug ${
                        step.state === 'active'
                          ? 'bg-blue-500/10 border-blue-500/40 text-blue-200'
                          : step.state === 'done'
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                            : step.state === 'warning'
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                              : step.state === 'error'
                                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                                : 'bg-[#111827] border-slate-800/80 text-slate-500'
                      }`}
                    >
                      <div className="font-mono text-[10px] opacity-75">
                        Step {idx + 1}
                      </div>
                      <div className="font-medium truncate" title={step.label}>
                        {step.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Real Collection & Execution Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
                  <div className="text-[11px] text-slate-400">Files Collected</div>
                  <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
                    {job.filesCollected}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {job.eligibleFiles} eligible · {job.totalTreeEntries} tree
                  </div>
                </div>

                <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
                  <div className="text-[11px] text-slate-400">Files Analyzed</div>
                  <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
                    {job.filesAnalyzed}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {job.filesSkipped} skipped · {job.filesTruncated} truncated
                  </div>
                </div>

                <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
                  <div className="text-[11px] text-slate-400">Source Chunks</div>
                  <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
                    {job.completedChunks} / {job.totalChunks}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {job.analyzedCommitSha
                      ? `SHA ${formatCommitSha(job.analyzedCommitSha)}`
                      : 'Resolving SHA'}
                  </div>
                </div>

                <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
                  <div className="text-[11px] text-slate-400">AI Agents</div>
                  <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
                    {job.completedAgents} / {job.totalAgents}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {job.failedAgents > 0
                      ? `${job.failedAgents} failed`
                      : 'No agent failures'}
                  </div>
                </div>
              </div>

              {/* Partial / Truncation / Poll Warnings */}
              {(job.status === 'partial' || job.collectionCoverage?.truncationDetected) && (
                <div
                  role="status"
                  className="bg-amber-500/10 border border-amber-500/30 rounded-md px-4 py-3 flex items-start gap-2.5 text-xs text-amber-200"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-1">
                    {job.status === 'partial' && (
                      <div>
                        Partial analysis completed: one or more agents or repository stages reported issues, so findings reflect only the agents that succeeded.
                      </div>
                    )}
                    {job.collectionCoverage?.truncationDetected && (
                      <div>
                        Coverage truncation detected: GitHub tree or collection safety limits capped the collected subset ({job.filesAnalyzed} files analyzed out of {job.eligibleFiles} eligible).
                      </div>
                    )}
                  </div>
                </div>
              )}

              {pollError && (
                <div
                  role="alert"
                  className="bg-amber-500/10 border border-amber-500/30 rounded-md px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200"
                >
                  <span>{pollError}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {authExpired ? (
                      <button
                        type="button"
                        onClick={onSignInWithGitHub}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-500 rounded-md whitespace-nowrap"
                      >
                        Reconnect GitHub
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void refreshNow()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded whitespace-nowrap"
                      >
                        <RefreshCw className="w-3 h-3" aria-hidden="true" />
                        <span>Retry Poll</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {job.status === 'failed' && job.error && (
                <div
                  role="alert"
                  className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-2 text-xs text-red-300">
                    <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{job.error}</span>
                  </div>
                </div>
              )}

              {/* Agent Breakdown */}
              <AgentExecutionBreakdown
                agentBreakdown={job.agentBreakdown}
                configuredAgents={agents}
                totalAgents={job.totalAgents}
                completedAgents={job.completedAgents}
                failedAgents={job.failedAgents}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0 bg-[#0E1420]/60">
          <div className="text-xs text-slate-400">
            {job
              ? isActive
                ? 'Polling job progress every 2.5s. Closing runs the job in the background.'
                : job.resultReviewId
                  ? 'Repository CodeRubric review saved and ready to inspect.'
                  : 'Analysis finished without creating a persisted review.'
              : 'Analysis runs asynchronously in the background and persists progress.'}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {!repository.isDemo && !job && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800/70 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={starting || enabledAgents.length === 0}
                  onClick={handleConfirmStart}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  {starting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{starting ? 'Starting Analysis...' : 'Start Repository Analysis'}</span>
                </button>
              </>
            )}

            {job && isActive && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap"
              >
                Run in Background
              </button>
            )}

            {job && !isActive && (
              <>
                {job.status === 'failed' && (
                  <button
                    type="button"
                    disabled={starting}
                    onClick={handleRetry}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Retry Analysis</span>
                  </button>
                )}

                {job.resultReviewId && (
                  <button
                    type="button"
                    onClick={() => {
                      const reviewId = job.resultReviewId!;
                      onClose();
                      onOpenReview(reviewId);
                    }}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap"
                  >
                    Open Repository Review
                  </button>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800/70 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap"
                >
                  Close
                </button>
              </>
            )}

            {repository.isDemo && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-md whitespace-nowrap"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
