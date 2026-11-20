import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../services/api';
import type {
  RepositoryAnalysisJob,
  RepositoryAnalysisJobStatus,
} from '../types';

export const DEFAULT_POLL_INTERVAL_MS = 2500;

export const ACTIVE_JOB_STATUSES: ReadonlySet<RepositoryAnalysisJobStatus> = new Set([
  'queued',
  'collecting_files',
  'running_agents',
  'synthesizing',
]);

export const TERMINAL_JOB_STATUSES: ReadonlySet<RepositoryAnalysisJobStatus> = new Set([
  'completed',
  'partial',
  'failed',
]);

export function isJobActive(status: RepositoryAnalysisJobStatus): boolean {
  return ACTIVE_JOB_STATUSES.has(status);
}

export function isJobTerminal(status: RepositoryAnalysisJobStatus): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

export interface AnalysisStageStep {
  key: 'queued' | 'collecting_files' | 'running_agents' | 'synthesizing' | 'terminal';
  label: string;
  state: 'pending' | 'active' | 'done' | 'warning' | 'error';
}

export function getAnalysisStageSteps(
  job: Pick<RepositoryAnalysisJob, 'status' | 'currentStep'> | null
): AnalysisStageStep[] {
  const status = job?.status ?? 'queued';
  const failedAtStep = job?.currentStep;

  const terminalLabel =
    status === 'failed'
      ? 'Failed'
      : status === 'partial'
        ? 'Completed (Partial)'
        : 'Completed';

  if (status === 'completed') {
    return [
      { key: 'queued', label: 'Queued', state: 'done' },
      { key: 'collecting_files', label: 'Collecting repository files', state: 'done' },
      { key: 'running_agents', label: 'Running AI agents', state: 'done' },
      { key: 'synthesizing', label: 'Synthesizing repository review', state: 'done' },
      { key: 'terminal', label: terminalLabel, state: 'done' },
    ];
  }

  if (status === 'partial') {
    return [
      { key: 'queued', label: 'Queued', state: 'done' },
      { key: 'collecting_files', label: 'Collecting repository files', state: 'done' },
      { key: 'running_agents', label: 'Running AI agents', state: 'warning' },
      { key: 'synthesizing', label: 'Synthesizing repository review', state: 'done' },
      { key: 'terminal', label: terminalLabel, state: 'warning' },
    ];
  }

  if (status === 'failed') {
    const stepOrder = ['queued', 'collecting_files', 'running_agents', 'synthesizing'] as const;
    const failedIdx = stepOrder.indexOf(
      (failedAtStep as (typeof stepOrder)[number]) ?? 'collecting_files'
    );
    const resolvedIdx = failedIdx >= 0 ? failedIdx : 1;

    return [
      {
        key: 'queued',
        label: 'Queued',
        state: resolvedIdx > 0 ? 'done' : 'error',
      },
      {
        key: 'collecting_files',
        label: 'Collecting repository files',
        state: resolvedIdx > 1 ? 'done' : resolvedIdx === 1 ? 'error' : 'pending',
      },
      {
        key: 'running_agents',
        label: 'Running AI agents',
        state: resolvedIdx > 2 ? 'done' : resolvedIdx === 2 ? 'error' : 'pending',
      },
      {
        key: 'synthesizing',
        label: 'Synthesizing repository review',
        state: resolvedIdx > 3 ? 'done' : resolvedIdx === 3 ? 'error' : 'pending',
      },
      {
        key: 'terminal',
        label: 'Failed',
        state: 'error',
      },
    ];
  }

  const activeOrder = ['queued', 'collecting_files', 'running_agents', 'synthesizing'] as const;
  const activeIdx = Math.max(0, activeOrder.indexOf(status as (typeof activeOrder)[number]));

  return [
    {
      key: 'queued',
      label: 'Queued',
      state: activeIdx === 0 ? 'active' : 'done',
    },
    {
      key: 'collecting_files',
      label: 'Collecting repository files',
      state: activeIdx < 1 ? 'pending' : activeIdx === 1 ? 'active' : 'done',
    },
    {
      key: 'running_agents',
      label: 'Running AI agents',
      state: activeIdx < 2 ? 'pending' : activeIdx === 2 ? 'active' : 'done',
    },
    {
      key: 'synthesizing',
      label: 'Synthesizing repository review',
      state: activeIdx < 3 ? 'pending' : 'active',
    },
    {
      key: 'terminal',
      label: 'Completed',
      state: 'pending',
    },
  ];
}

interface UseRepositoryAnalysisJobOptions {
  initialJob?: RepositoryAnalysisJob | null;
  pollIntervalMs?: number;
  onTerminalJob?: (job: RepositoryAnalysisJob) => void;
}

export function useRepositoryAnalysisJob(options?: UseRepositoryAnalysisJobOptions) {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const initialJob = options?.initialJob ?? null;
  const onTerminalJobRef = useRef(options?.onTerminalJob);
  onTerminalJobRef.current = options?.onTerminalJob;

  const [job, setJob] = useState<RepositoryAnalysisJob | null>(initialJob);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [permissionError, setPermissionError] = useState(false);

  const mountedRef = useRef(true);
  const inFlightPollRef = useRef(false);
  const startGuardRef = useRef(false);
  const activeJobIdRef = useRef<string | null>(initialJob?.id ?? null);
  const terminalNotifiedRef = useRef<string | null>(
    initialJob && isJobTerminal(initialJob.status)
      ? `${initialJob.id}:${initialJob.status}`
      : null
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const notifyTerminalIfNeeded = useCallback((nextJob: RepositoryAnalysisJob) => {
    if (
      isJobTerminal(nextJob.status) &&
      terminalNotifiedRef.current !== `${nextJob.id}:${nextJob.status}`
    ) {
      terminalNotifiedRef.current = `${nextJob.id}:${nextJob.status}`;
      onTerminalJobRef.current?.(nextJob);
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string) => {
      if (!mountedRef.current) return;
      if (inFlightPollRef.current) return;
      if (activeJobIdRef.current !== jobId) return;

      inFlightPollRef.current = true;
      try {
        const res = await api.getAnalysisJob(jobId);
        if (!mountedRef.current || activeJobIdRef.current !== jobId) return;

        setJob(res.job);
        setPollError(null);
        setAuthExpired(false);
        notifyTerminalIfNeeded(res.job);
      } catch (err) {
        if (!mountedRef.current || activeJobIdRef.current !== jobId) return;

        if (err instanceof ApiError && err.status === 401) {
          setAuthExpired(true);
          setPollError(
            err.message || 'Your GitHub OAuth session expired. Reconnect GitHub to resume status polling.'
          );
          return;
        }

        if (err instanceof ApiError && err.status === 404) {
          setPollError(err.message || 'Analysis job is no longer accessible.');
          return;
        }

        // Preserve existing job progress/status on transient errors
        setPollError(
          err instanceof Error
            ? `Transient connection error while checking progress: ${err.message}`
            : 'Transient connection error while checking progress.'
        );
      } finally {
        inFlightPollRef.current = false;
      }
    },
    [notifyTerminalIfNeeded]
  );

  const startAnalysis = useCallback(
    async (repoId: string, branch?: string): Promise<RepositoryAnalysisJob | null> => {
      if (startGuardRef.current) return null;
      if (job && isJobActive(job.status) && job.repositoryId === repoId) {
        return job;
      }

      startGuardRef.current = true;
      setStarting(true);
      setError(null);
      setPollError(null);
      setAuthExpired(false);
      setPermissionError(false);

      try {
        const res = await api.startRepositoryAnalysis(repoId, branch);
        if (!mountedRef.current) return null;

        activeJobIdRef.current = res.job.id;
        terminalNotifiedRef.current = null;
        setJob(res.job);
        notifyTerminalIfNeeded(res.job);
        return res.job;
      } catch (err) {
        if (!mountedRef.current) return null;

        if (err instanceof ApiError) {
          if (err.status === 401) setAuthExpired(true);
          if (err.status === 403 || err.isPermissionError) setPermissionError(true);
          setError(err.message);
        } else {
          setError(
            err instanceof Error ? err.message : 'Unable to start repository analysis.'
          );
        }
        return null;
      } finally {
        startGuardRef.current = false;
        if (mountedRef.current) {
          setStarting(false);
        }
      }
    },
    [job, notifyTerminalIfNeeded]
  );

  const attachJob = useCallback(
    (nextJob: RepositoryAnalysisJob) => {
      activeJobIdRef.current = nextJob.id;
      terminalNotifiedRef.current = isJobTerminal(nextJob.status)
        ? `${nextJob.id}:${nextJob.status}`
        : null;
      setJob(nextJob);
      setError(null);
      setPollError(null);
      setAuthExpired(false);
      setPermissionError(false);
    },
    []
  );

  const reset = useCallback(() => {
    activeJobIdRef.current = null;
    terminalNotifiedRef.current = null;
    inFlightPollRef.current = false;
    setJob(null);
    setStarting(false);
    setError(null);
    setPollError(null);
    setAuthExpired(false);
    setPermissionError(false);
  }, []);

  const jobId = job?.id ?? null;
  const jobStatus = job?.status ?? null;
  const isTerminalPollFatal =
    Boolean(pollError) &&
    (authExpired ||
      pollError?.toLowerCase().includes('not found') ||
      pollError?.toLowerCase().includes('no longer accessible'));

  useEffect(() => {
    if (!jobId || !jobStatus || !isJobActive(jobStatus) || isTerminalPollFatal) {
      return;
    }

    const timer = window.setInterval(() => {
      void pollJob(jobId);
    }, pollIntervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [jobId, jobStatus, isTerminalPollFatal, pollIntervalMs, pollJob]);

  return {
    job,
    starting,
    error,
    pollError,
    authExpired,
    permissionError,
    isActive: Boolean(job && isJobActive(job.status)),
    isTerminal: Boolean(job && isJobTerminal(job.status)),
    startAnalysis,
    attachJob,
    refreshNow: () => (jobId ? pollJob(jobId) : Promise.resolve()),
    reset,
  };
}
