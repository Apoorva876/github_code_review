import crypto from 'node:crypto';
import {
  createAnalysisJob,
  getStore,
  updateAnalysisJob,
} from '../store.ts';
import type {
  Repository,
  RepositoryAnalysisJob,
  RepositoryCollectionReport,
} from '../types.ts';
import {
  redactSensitiveText,
  toSafeGeminiErrorMessage,
} from './geminiReviewService.ts';
import type { GitHubOAuthSession } from './githubAuthService.ts';
import {
  collectRepositorySources,
  GitHubApiError,
  verifyGitHubRepositoryAccess,
} from './githubService.ts';
import {
  analyzeRepositoryWithAgents,
  persistRepositoryAnalysisReview,
  type RepositoryAnalysisOptions,
} from './repositoryAnalysisService.ts';

export type SourceCollectorFn = typeof collectRepositorySources;

export interface StartRepositoryAnalysisJobParams {
  repository: Repository;
  branch: string;
  token?: string;
  requestedByUserId?: number | null;
  requestedByLogin?: string | null;
  collectorFn?: SourceCollectorFn;
  analysisOptions?: RepositoryAnalysisOptions;
}

interface RepoAccessInfo {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
}

const activeJobPromises = new Map<string, Promise<void>>();
const accessCache = new Map<string, { access: RepoAccessInfo; expiresAt: number }>();
const ACCESS_CACHE_TTL_MS = 30_000;

function toSafeJobError(err: unknown): string {
  if (err instanceof GitHubApiError) {
    return redactSensitiveText(err.message);
  }
  return toSafeGeminiErrorMessage(err);
}

export function clearRepositoryAccessCache(): void {
  accessCache.clear();
}

export async function verifyRepositoryAccessCached(
  fullName: string,
  token?: string
): Promise<RepoAccessInfo> {
  const tokenDigest = token
    ? crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
    : 'public';
  const key = `${tokenDigest}:${fullName.toLowerCase()}`;
  const now = Date.now();
  const cached = accessCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.access;
  }

  const verified = await verifyGitHubRepositoryAccess(fullName, token);
  const access: RepoAccessInfo = {
    fullName: verified.fullName,
    isPrivate: verified.isPrivate,
    defaultBranch: verified.defaultBranch,
    permissions: verified.permissions,
  };
  accessCache.set(key, { access, expiresAt: now + ACCESS_CACHE_TTL_MS });
  return access;
}

export async function canCallerAccessAnalysisJob(params: {
  job: RepositoryAnalysisJob;
  session: GitHubOAuthSession | null;
  token?: string;
  skipRemoteCheck?: boolean;
}): Promise<boolean> {
  const { job, session, token } = params;

  if (job.requestedByUserId !== undefined && job.requestedByUserId !== null) {
    if (!session || session.user.id !== job.requestedByUserId) {
      return false;
    }
  }

  if (params.skipRemoteCheck) {
    return true;
  }

  try {
    const access = await verifyRepositoryAccessCached(job.repositoryFullName, token);
    if (access.isPrivate && !token) {
      return false;
    }
    if (access.isPrivate && session && !session.scopes.includes('repo')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function toPublicAnalysisJob(
  job: RepositoryAnalysisJob
): Omit<RepositoryAnalysisJob, 'requestedByUserId' | 'requestedByLogin'> {
  const {
    requestedByUserId: _uid,
    requestedByLogin: _login,
    ...publicFields
  } = job;
  return publicFields;
}

export function waitForAnalysisJob(jobId: string): Promise<void> {
  return activeJobPromises.get(jobId) ?? Promise.resolve();
}

async function runAnalysisJobInBackground(
  jobId: string,
  params: StartRepositoryAnalysisJobParams
): Promise<void> {
  const { repository, branch, token } = params;

  try {
    updateAnalysisJob(jobId, {
      status: 'collecting_files',
      progress: 5,
      currentStep: 'collecting_files',
      startedAt: new Date().toISOString(),
      message: `Collecting source files from ${repository.fullName} (${branch})...`,
    });

    let collectionReport: RepositoryCollectionReport;
    try {
      const collector = params.collectorFn ?? collectRepositorySources;
      collectionReport = await collector({
        fullName: repository.fullName,
        branch,
        token,
      });
    } catch (err) {
      updateAnalysisJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        message: 'Failed while collecting repository source files.',
        error: toSafeJobError(err),
        completedAt: new Date().toISOString(),
      });
      return;
    }

    if (!collectionReport.collectedFiles || collectionReport.collectedFiles.length === 0) {
      updateAnalysisJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        analyzedCommitSha: collectionReport.analyzedCommitSha || null,
        totalTreeEntries: collectionReport.totalTreeEntries,
        eligibleFiles: collectionReport.eligibleFiles,
        filesCollected: 0,
        filesSkipped: collectionReport.filesSkipped,
        filesTruncated: collectionReport.filesTruncated,
        collectionCoverage: {
          totalTreeEntries: collectionReport.totalTreeEntries,
          eligibleFiles: collectionReport.eligibleFiles,
          filesCollected: 0,
          filesSkipped: collectionReport.filesSkipped,
          filesTruncated: collectionReport.filesTruncated,
          failedFiles: collectionReport.failedFiles,
          totalBytesCollected: 0,
          truncationDetected: collectionReport.truncationDetected,
          coverageComplete: false,
          totalFilesAnalyzed: 0,
          totalChunksAnalyzed: 0,
        },
        message: 'Repository has no eligible source files to analyze.',
        error: 'No eligible source files were collected from the repository.',
        completedAt: new Date().toISOString(),
      });
      return;
    }

    updateAnalysisJob(jobId, {
      status: 'collecting_files',
      progress: 25,
      currentStep: 'collecting_files',
      analyzedCommitSha: collectionReport.analyzedCommitSha,
      totalTreeEntries: collectionReport.totalTreeEntries,
      eligibleFiles: collectionReport.eligibleFiles,
      filesCollected: collectionReport.filesCollected,
      filesSkipped: collectionReport.filesSkipped,
      filesTruncated: collectionReport.filesTruncated,
      collectionCoverage: {
        totalTreeEntries: collectionReport.totalTreeEntries,
        eligibleFiles: collectionReport.eligibleFiles,
        filesCollected: collectionReport.filesCollected,
        filesSkipped: collectionReport.filesSkipped,
        filesTruncated: collectionReport.filesTruncated,
        failedFiles: collectionReport.failedFiles,
        totalBytesCollected: collectionReport.totalBytesCollected,
        truncationDetected: collectionReport.truncationDetected,
        coverageComplete: collectionReport.coverageComplete,
        totalFilesAnalyzed: 0,
        totalChunksAnalyzed: 0,
      },
      message: `Collected ${collectionReport.filesCollected}/${collectionReport.eligibleFiles} eligible files at commit ${collectionReport.analyzedCommitSha.slice(0, 7)}.`,
    });

    const store = getStore();
    const agents = store.agents;
    const enabledCount = agents.filter((a) => a.enabled).length;
    if (enabledCount === 0) {
      updateAnalysisJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        message: 'No AI reviewer agents are enabled.',
        error: 'At least one AI agent must be enabled before analyzing a repository.',
        completedAt: new Date().toISOString(),
      });
      return;
    }

    const analysis = await analyzeRepositoryWithAgents({
      collectionReport,
      agents,
      options: {
        ...params.analysisOptions,
        onProgress: (evt) => {
          if (evt.stage === 'running_agents') {
            const pct =
              evt.totalChunks > 0
                ? Math.min(75, Math.max(25, Math.round(25 + (evt.completedChunks / evt.totalChunks) * 50)))
                : 35;
            updateAnalysisJob(jobId, {
              status: 'running_agents',
              progress: pct,
              currentStep: evt.currentStep,
              message: evt.message,
              totalChunks: evt.totalChunks,
              completedChunks: evt.completedChunks,
              totalAgents: evt.totalAgents,
              completedAgents: evt.completedAgents,
              failedAgents: evt.failedAgents,
            });
          } else if (evt.stage === 'synthesizing') {
            updateAnalysisJob(jobId, {
              status: 'synthesizing',
              progress: 80,
              currentStep: evt.currentStep,
              message: evt.message,
              totalChunks: evt.totalChunks,
              completedChunks: evt.totalChunks,
              totalAgents: evt.totalAgents,
              completedAgents: evt.completedAgents,
              failedAgents: evt.failedAgents,
              ...(evt.agentBreakdown ? { agentBreakdown: evt.agentBreakdown } : {}),
            });
          }
          params.analysisOptions?.onProgress?.(evt);
        },
      },
    });

    const completedAt = new Date().toISOString();

    if (analysis.analysisStatus === 'failed' || analysis.succeededAgentsCount === 0) {
      updateAnalysisJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        message: 'Repository analysis failed because no enabled AI agents succeeded.',
        error: analysis.error || 'All enabled AI agents failed to analyze the repository.',
        filesAnalyzed: 0,
        totalChunks: analysis.totalChunksAnalyzed,
        completedChunks: 0,
        totalAgents: analysis.enabledAgentsCount,
        completedAgents: 0,
        failedAgents: analysis.failedAgentsCount,
        agentBreakdown: analysis.agentBreakdown,
        collectionCoverage: analysis.collectionCoverage,
        resultReviewId: null,
        completedAt,
      });
      return;
    }

    if (analysis.synthesisStatus === 'failed') {
      updateAnalysisJob(jobId, {
        status: 'partial',
        progress: 100,
        currentStep: 'partial',
        message:
          'Agent analysis completed with findings, but repository synthesis failed. Partial breakdown retained without creating a completed review.',
        error: analysis.error || 'Repository synthesis failed.',
        filesAnalyzed: analysis.totalFilesAnalyzed,
        totalChunks: analysis.totalChunksAnalyzed,
        completedChunks: analysis.totalChunksAnalyzed,
        totalAgents: analysis.enabledAgentsCount,
        completedAgents: analysis.succeededAgentsCount,
        failedAgents: analysis.failedAgentsCount,
        agentBreakdown: analysis.agentBreakdown,
        collectionCoverage: analysis.collectionCoverage,
        resultReviewId: null,
        completedAt,
      });
      return;
    }

    const isPartial =
      analysis.analysisStatus === 'partial' ||
      !analysis.allAgentsSucceeded ||
      !analysis.collectionCoverage.coverageComplete;

    let savedReviewId: string | null = null;
    try {
      const savedReview = persistRepositoryAnalysisReview({
        analysis,
        repositoryId: repository.id,
        analysisJobId: jobId,
        author: params.requestedByLogin || 'multi-agent-engine',
        htmlUrl: repository.htmlUrl,
        allowPartial: isPartial,
      });
      savedReviewId = savedReview.id;
    } catch (persistErr) {
      updateAnalysisJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        message: 'Analysis finished but review persistence failed.',
        error: toSafeJobError(persistErr),
        filesAnalyzed: analysis.totalFilesAnalyzed,
        totalChunks: analysis.totalChunksAnalyzed,
        completedChunks: analysis.totalChunksAnalyzed,
        totalAgents: analysis.enabledAgentsCount,
        completedAgents: analysis.succeededAgentsCount,
        failedAgents: analysis.failedAgentsCount,
        agentBreakdown: analysis.agentBreakdown,
        collectionCoverage: analysis.collectionCoverage,
        resultReviewId: null,
        completedAt,
      });
      return;
    }

    if (isPartial) {
      const reasons: string[] = [];
      if (analysis.failedAgentsCount > 0) {
        reasons.push(`${analysis.failedAgentsCount}/${analysis.enabledAgentsCount} agents failed`);
      }
      if (!analysis.collectionCoverage.coverageComplete) {
        reasons.push(
          `incomplete source coverage (${analysis.collectionCoverage.filesCollected}/${analysis.collectionCoverage.eligibleFiles} eligible files)`
        );
      }
      updateAnalysisJob(jobId, {
        status: 'partial',
        progress: 100,
        currentStep: 'partial',
        message: `Repository analysis finished with partial status (${reasons.join('; ')}).`,
        error: analysis.error || reasons.join('; '),
        filesAnalyzed: analysis.totalFilesAnalyzed,
        totalChunks: analysis.totalChunksAnalyzed,
        completedChunks: analysis.totalChunksAnalyzed,
        totalAgents: analysis.enabledAgentsCount,
        completedAgents: analysis.succeededAgentsCount,
        failedAgents: analysis.failedAgentsCount,
        agentBreakdown: analysis.agentBreakdown,
        collectionCoverage: analysis.collectionCoverage,
        resultReviewId: savedReviewId,
        completedAt,
      });
      return;
    }

    updateAnalysisJob(jobId, {
      status: 'completed',
      progress: 100,
      currentStep: 'completed',
      message: `Repository analysis completed (${analysis.succeededAgentsCount} agents, rubric score ${analysis.score}/100).`,
      error: null,
      filesAnalyzed: analysis.totalFilesAnalyzed,
      totalChunks: analysis.totalChunksAnalyzed,
      completedChunks: analysis.totalChunksAnalyzed,
      totalAgents: analysis.enabledAgentsCount,
      completedAgents: analysis.succeededAgentsCount,
      failedAgents: analysis.failedAgentsCount,
      agentBreakdown: analysis.agentBreakdown,
      collectionCoverage: analysis.collectionCoverage,
      resultReviewId: savedReviewId,
      completedAt,
    });
  } catch (unexpectedErr) {
    try {
      updateAnalysisJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        message: 'Unexpected background error during repository analysis.',
        error: toSafeJobError(unexpectedErr),
        completedAt: new Date().toISOString(),
      });
    } catch {
      // Last-resort guard so background runner never throws unhandled rejections
    }
  }
}

export function startRepositoryAnalysisJob(
  params: StartRepositoryAnalysisJobParams
): RepositoryAnalysisJob {
  const now = new Date().toISOString();
  const store = getStore();
  const enabledAgentsCount = store.agents.filter((a) => a.enabled).length;

  const jobId = `job-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const initialJob: RepositoryAnalysisJob = {
    id: jobId,
    repositoryId: params.repository.id,
    repositoryFullName: params.repository.fullName,
    branch: params.branch,
    status: 'queued',
    progress: 0,
    currentStep: 'queued',
    message: `Analysis job queued for ${params.repository.fullName} (${params.branch}).`,
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    completedAt: null,
    analyzedCommitSha: null,
    totalTreeEntries: 0,
    eligibleFiles: 0,
    filesCollected: 0,
    filesAnalyzed: 0,
    filesSkipped: 0,
    filesTruncated: 0,
    totalChunks: 0,
    completedChunks: 0,
    totalAgents: enabledAgentsCount,
    completedAgents: 0,
    failedAgents: 0,
    agentBreakdown: [],
    collectionCoverage: null,
    resultReviewId: null,
    error: null,
    requestedByUserId: params.requestedByUserId ?? null,
    requestedByLogin: params.requestedByLogin ?? null,
  };

  const savedJob = createAnalysisJob(initialJob);

  const runnerPromise = new Promise<void>((resolve) => {
    setImmediate(() => {
      runAnalysisJobInBackground(savedJob.id, params)
        .catch(() => {
          // Handled inside runAnalysisJobInBackground
        })
        .finally(() => {
          activeJobPromises.delete(savedJob.id);
          resolve();
        });
    });
  });

  activeJobPromises.set(savedJob.id, runnerPromise);
  return savedJob;
}
