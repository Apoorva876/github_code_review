import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type {
  RepositoryIntelligenceJob,
  RepositoryIntelligenceJobStatus,
  RepositoryIntelligenceReport,
} from '../types';

export interface IntelligenceStageStep {
  key: string;
  label: string;
  state: 'pending' | 'active' | 'done' | 'warning' | 'error';
}

const ACTIVE_STATUSES = new Set<RepositoryIntelligenceJobStatus>([
  'queued',
  'retrieving_tree',
  'collecting_files',
  'analyzing_chunks',
  'synthesizing_architecture',
]);

export function isIntelligenceJobActive(
  status: RepositoryIntelligenceJobStatus | null | undefined
): boolean {
  return Boolean(status && ACTIVE_STATUSES.has(status));
}

export function getIntelligenceStageSteps(
  job: RepositoryIntelligenceJob | null
): IntelligenceStageStep[] {
  const status = job?.status ?? 'queued';
  const stageOrder: Record<RepositoryIntelligenceJobStatus, number> = {
    queued: 0,
    retrieving_tree: 1,
    collecting_files: 2,
    analyzing_chunks: 3,
    synthesizing_architecture: 4,
    completed: 5,
    partial: 5,
    failed: -1,
  };

  const currentIdx = stageOrder[status];
  const defs = [
    { key: 'retrieving_tree', label: 'Git Tree Retrieval' },
    { key: 'collecting_files', label: 'Source Collection' },
    { key: 'analyzing_chunks', label: 'Chunked Code Audit' },
    { key: 'synthesizing_architecture', label: 'Diagram Synthesis' },
    { key: 'completed', label: status === 'partial' ? 'Partial Ready' : 'Intelligence Ready' },
  ];

  return defs.map((d, idx) => {
    const stepPos = idx + 1;
    if (status === 'failed') {
      const progress = job?.progress ?? 0;
      if (stepPos === 1 && progress < 15) return { ...d, state: 'error' };
      if (stepPos === 2 && progress >= 15 && progress < 35) return { ...d, state: 'error' };
      if (stepPos === 3 && progress >= 35 && progress < 80) return { ...d, state: 'error' };
      if (stepPos === 4 && progress >= 80) return { ...d, state: 'error' };
      return { ...d, state: progress >= stepPos * 20 ? 'done' : 'pending' };
    }
    if (status === 'completed') return { ...d, state: 'done' };
    if (status === 'partial') {
      return { ...d, state: stepPos === 5 ? 'warning' : 'done' };
    }
    if (currentIdx > stepPos) return { ...d, state: 'done' };
    if (currentIdx === stepPos) return { ...d, state: 'active' };
    return { ...d, state: 'pending' };
  });
}

export function useRepositoryIntelligenceJob(options?: {
  initialJob?: RepositoryIntelligenceJob | null;
  initialReport?: RepositoryIntelligenceReport | null;
}) {
  const [job, setJob] = useState<RepositoryIntelligenceJob | null>(options?.initialJob ?? null);
  const [report, setReport] = useState<RepositoryIntelligenceReport | null>(
    options?.initialReport ?? null
  );
  const [starting, setStarting] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const fetchedReportIdRef = useRef<string | null>(options?.initialReport?.id ?? null);

  const fetchReport = useCallback(async (reportId: string) => {
    if (!reportId || fetchedReportIdRef.current === reportId) return;
    setLoadingReport(true);
    try {
      const res = await api.getIntelligenceReport(reportId);
      fetchedReportIdRef.current = res.report.id;
      setReport(res.report);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repository intelligence report.');
    } finally {
      setLoadingReport(false);
    }
  }, []);

  const attachJob = useCallback(
    (nextJob: RepositoryIntelligenceJob) => {
      setJob(nextJob);
      setError(null);
      setPollError(null);
      if (nextJob.reportId && fetchedReportIdRef.current !== nextJob.reportId) {
        void fetchReport(nextJob.reportId);
      }
    },
    [fetchReport]
  );

  const startIntelligence = useCallback(
    async (repoId: string, branch?: string, forceRefresh = false) => {
      setStarting(true);
      setError(null);
      setPollError(null);
      if (forceRefresh) {
        setReport(null);
        fetchedReportIdRef.current = null;
      }
      try {
        const res = await api.startRepositoryIntelligence(repoId, branch, forceRefresh);
        setJob(res.job);
        if (res.job.reportId) {
          void fetchReport(res.job.reportId);
        }
        return res.job;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start repository intelligence.');
        return null;
      } finally {
        setStarting(false);
      }
    },
    [fetchReport]
  );

  const refreshNow = useCallback(async () => {
    if (!job?.id) return;
    try {
      const res = await api.getIntelligenceJob(job.id);
      setJob(res.job);
      setPollError(null);
      if (res.job.reportId) {
        void fetchReport(res.job.reportId);
      }
    } catch (err) {
      setPollError(err instanceof Error ? err.message : 'Polling job status failed.');
    }
  }, [job?.id, fetchReport]);

  useEffect(() => {
    if (!job?.id || !isIntelligenceJobActive(job.status)) return;

    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const res = await api.getIntelligenceJob(job.id);
        if (cancelled) return;
        setJob(res.job);
        setPollError(null);
        if (res.job.reportId && fetchedReportIdRef.current !== res.job.reportId) {
          void fetchReport(res.job.reportId);
        }
      } catch (err) {
        if (cancelled) return;
        setPollError(
          err instanceof Error ? err.message : 'Temporary network error polling intelligence job.'
        );
      }
    }, 1400);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status, fetchReport]);

  // Also fetch report immediately if initialJob already had reportId
  useEffect(() => {
    if (job?.reportId && fetchedReportIdRef.current !== job.reportId) {
      void fetchReport(job.reportId);
    }
  }, [job?.reportId, fetchReport]);

  return {
    job,
    report,
    setReport,
    starting,
    loadingReport,
    error,
    pollError,
    isActive: isIntelligenceJobActive(job?.status),
    startIntelligence,
    attachJob,
    refreshNow,
  };
}
