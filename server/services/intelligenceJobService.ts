import crypto from 'node:crypto';
import {
  createIntelligenceJob,
  findCachedIntelligenceReport,
  getIntelligenceReportById,
  saveIntelligenceReport,
  updateIntelligenceJob,
} from '../store.ts';
import type {
  Repository,
  RepositoryIntelligenceCollectionBundle,
  RepositoryIntelligenceJob,
} from '../types.ts';
import {
  redactSensitiveText,
  toSafeGeminiErrorMessage,
} from './geminiReviewService.ts';
import {
  collectRepositoryIntelligenceBundle,
  fetchGitHubCommits,
  GitHubApiError,
} from './githubService.ts';
import {
  generateRepositoryIntelligenceReport,
  type RepositoryIntelligenceOptions,
} from './repositoryIntelligenceService.ts';

export type IntelligenceBundleCollectorFn = typeof collectRepositoryIntelligenceBundle;

export interface StartIntelligenceJobParams {
  repository: Repository;
  branch: string;
  token?: string;
  forceRefresh?: boolean;
  requestedByUserId?: number | null;
  collectorFn?: IntelligenceBundleCollectorFn;
  intelligenceOptions?: RepositoryIntelligenceOptions;
}

const activeIntelligencePromises = new Map<string, Promise<void>>();

function toSafeError(err: unknown): string {
  if (err instanceof GitHubApiError) {
    return redactSensitiveText(err.message);
  }
  return toSafeGeminiErrorMessage(err);
}

export function waitForIntelligenceJob(jobId: string): Promise<void> {
  return activeIntelligencePromises.get(jobId) ?? Promise.resolve();
}

async function runIntelligenceJobInBackground(
  jobId: string,
  params: StartIntelligenceJobParams
): Promise<void> {
  const { repository, branch, token, forceRefresh } = params;

  try {
    updateIntelligenceJob(jobId, {
      status: 'retrieving_tree',
      progress: 8,
      currentStep: 'retrieving_tree',
      startedAt: new Date().toISOString(),
      message: `Retrieving repository tree & commit metadata for ${repository.fullName} (${branch})...`,
    });

    // Check commit cache hit when not forcing a fresh run
    if (!forceRefresh && !params.collectorFn) {
      try {
        const latestCommits = await fetchGitHubCommits(
          repository.fullName,
          { branch, page: 1, perPage: 1 },
          token
        );
        const headSha = latestCommits.commits[0]?.sha;
        if (headSha) {
          const cached = findCachedIntelligenceReport(repository.fullName, branch, headSha);
          if (cached) {
            const verifySaved = getIntelligenceReportById(cached.id);
            if (verifySaved) {
              updateIntelligenceJob(jobId, {
                status: verifySaved.analysisStatus === 'partial' ? 'partial' : 'completed',
                progress: 100,
                currentStep: verifySaved.analysisStatus === 'partial' ? 'partial' : 'completed',
                analyzedCommitSha: verifySaved.analyzedCommitSha,
                totalTreeEntries: verifySaved.coverage.totalTreeEntries,
                totalFiles: verifySaved.coverage.totalFiles,
                eligibleFiles: verifySaved.coverage.eligibleFiles,
                filesCollected: verifySaved.coverage.analyzedFiles,
                filesAnalyzed: verifySaved.coverage.analyzedFiles,
                filesSkipped: verifySaved.coverage.skippedFiles,
                failedFiles: verifySaved.coverage.failedFiles,
                truncatedFiles: verifySaved.coverage.truncatedFiles,
                totalChunks: verifySaved.coverage.totalChunksAnalyzed,
                completedChunks: verifySaved.coverage.totalChunksAnalyzed,
                reportId: verifySaved.id,
                fromCache: true,
                message: `Loaded verified cached Repository Intelligence report for ${repository.fullName} @ ${headSha.slice(0, 7)}.`,
                completedAt: new Date().toISOString(),
              });
              return;
            }
          }
        }
      } catch {
        // Proceed cleanly to live retrieval if cache probe fails
      }
    }

    updateIntelligenceJob(jobId, {
      status: 'collecting_files',
      progress: 16,
      currentStep: 'collecting_files',
      message: `Fetching recursive tree and prioritized source files from ${repository.fullName}...`,
    });

    let bundle: RepositoryIntelligenceCollectionBundle;
    try {
      const collector = params.collectorFn ?? collectRepositoryIntelligenceBundle;
      bundle = await collector({
        fullName: repository.fullName,
        branch,
        token,
      });
    } catch (err) {
      updateIntelligenceJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        message: 'Failed while retrieving repository tree and source files from GitHub.',
        error: toSafeError(err),
        completedAt: new Date().toISOString(),
      });
      return;
    }

    if (!bundle.collectedFiles || bundle.collectedFiles.length === 0) {
      updateIntelligenceJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        analyzedCommitSha: bundle.analyzedCommitSha || null,
        totalTreeEntries: bundle.totalTreeEntries,
        totalFiles: bundle.totalFiles,
        eligibleFiles: bundle.eligibleFiles,
        filesCollected: 0,
        filesAnalyzed: 0,
        filesSkipped: bundle.filesSkipped,
        failedFiles: bundle.failedFiles,
        truncatedFiles: bundle.filesTruncated,
        message: 'No readable source files could be collected from this repository.',
        error:
          bundle.failedFiles > 0
            ? 'GitHub file retrieval failed or hit API rate limits before files could be collected.'
            : 'Repository contains no eligible textual source files.',
        completedAt: new Date().toISOString(),
      });
      return;
    }

    updateIntelligenceJob(jobId, {
      status: 'analyzing_chunks',
      progress: 34,
      currentStep: 'analyzing_chunks',
      analyzedCommitSha: bundle.analyzedCommitSha,
      totalTreeEntries: bundle.totalTreeEntries,
      totalFiles: bundle.totalFiles,
      eligibleFiles: bundle.eligibleFiles,
      filesCollected: bundle.filesCollected,
      filesSkipped: bundle.filesSkipped,
      failedFiles: bundle.failedFiles,
      truncatedFiles: bundle.filesTruncated,
      message: `Retrieved ${bundle.filesCollected}/${bundle.eligibleFiles} eligible files (${bundle.totalFiles} total files in tree). Analyzing code in chunks...`,
    });

    const report = await generateRepositoryIntelligenceReport({
      repository,
      bundle,
      options: {
        ...params.intelligenceOptions,
        onProgress: (evt) => {
          if (evt.stage === 'analyzing_chunks') {
            const pct =
              evt.totalChunks > 0
                ? Math.min(78, Math.max(36, Math.round(36 + (evt.completedChunks / evt.totalChunks) * 42)))
                : 50;
            updateIntelligenceJob(jobId, {
              status: 'analyzing_chunks',
              progress: pct,
              currentStep: 'analyzing_chunks',
              totalChunks: evt.totalChunks,
              completedChunks: evt.completedChunks,
              message: evt.message,
            });
          } else if (evt.stage === 'synthesizing_architecture') {
            updateIntelligenceJob(jobId, {
              status: 'synthesizing_architecture',
              progress: 84,
              currentStep: 'synthesizing_architecture',
              totalChunks: evt.totalChunks,
              completedChunks: evt.totalChunks,
              message: evt.message,
            });
          }
          params.intelligenceOptions?.onProgress?.(evt);
        },
      },
    });

    const savedReport = saveIntelligenceReport(report);
    const terminalStatus = savedReport.analysisStatus === 'partial' ? 'partial' : 'completed';

    updateIntelligenceJob(jobId, {
      status: terminalStatus,
      progress: 100,
      currentStep: terminalStatus,
      analyzedCommitSha: savedReport.analyzedCommitSha,
      totalTreeEntries: savedReport.coverage.totalTreeEntries,
      totalFiles: savedReport.coverage.totalFiles,
      eligibleFiles: savedReport.coverage.eligibleFiles,
      filesCollected: savedReport.coverage.analyzedFiles,
      filesAnalyzed: savedReport.coverage.analyzedFiles,
      filesSkipped: savedReport.coverage.skippedFiles,
      failedFiles: savedReport.coverage.failedFiles,
      truncatedFiles: savedReport.coverage.truncatedFiles,
      totalChunks: savedReport.coverage.totalChunksAnalyzed,
      completedChunks: savedReport.coverage.totalChunksAnalyzed,
      reportId: savedReport.id,
      fromCache: false,
      error:
        terminalStatus === 'partial' && savedReport.coverage.limitations.length > 0
          ? savedReport.coverage.limitations[0]
          : null,
      message:
        terminalStatus === 'completed'
          ? `Repository intelligence completed (${savedReport.coverage.analyzedFiles} files analyzed, ${savedReport.components.length} components mapped).`
          : `Repository intelligence completed with partial coverage (${savedReport.coverage.analyzedFiles}/${savedReport.coverage.eligibleFiles} eligible files analyzed).`,
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    try {
      updateIntelligenceJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        message: 'Repository intelligence analysis failed.',
        error: toSafeError(err),
        completedAt: new Date().toISOString(),
      });
    } catch {
      // Last-resort guard
    }
  }
}

export function startRepositoryIntelligenceJob(
  params: StartIntelligenceJobParams
): RepositoryIntelligenceJob {
  const now = new Date().toISOString();
  const jobId = `intel-job-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const initialJob: RepositoryIntelligenceJob = {
    id: jobId,
    repositoryId: params.repository.id,
    repositoryFullName: params.repository.fullName,
    branch: params.branch,
    status: 'queued',
    progress: 0,
    currentStep: 'queued',
    message: `Queued repository intelligence for ${params.repository.fullName} (${params.branch}).`,
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    completedAt: null,
    analyzedCommitSha: null,
    totalTreeEntries: 0,
    totalFiles: 0,
    eligibleFiles: 0,
    filesCollected: 0,
    filesAnalyzed: 0,
    filesSkipped: 0,
    failedFiles: 0,
    truncatedFiles: 0,
    totalChunks: 0,
    completedChunks: 0,
    reportId: null,
    fromCache: false,
    error: null,
    requestedByUserId: params.requestedByUserId ?? null,
  };

  const savedJob = createIntelligenceJob(initialJob);

  const runnerPromise = new Promise<void>((resolve) => {
    setImmediate(() => {
      runIntelligenceJobInBackground(savedJob.id, params)
        .catch(() => {
          // Handled inside runIntelligenceJobInBackground
        })
        .finally(() => {
          activeIntelligencePromises.delete(savedJob.id);
          resolve();
        });
    });
  });

  activeIntelligencePromises.set(savedJob.id, runnerPromise);
  return savedJob;
}
