import fs from 'node:fs';
import path from 'node:path';
import { createDefaultAgents, createDemoSeed } from './demoSeed.ts';
import type {
  AIAgent,
  CodeReview,
  Repository,
  RepositoryAnalysisJob,
  ReviewStatus,
  StoreState,
  WorkspaceSettings,
} from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'coderubric-store.json');
const MAX_ANALYSIS_JOBS = 100;

let memoryState: StoreState | null = null;

export function migrateStoreState(state: StoreState): { state: StoreState; migrated: boolean } {
  let migrated = false;

  if (!Array.isArray(state.agents)) {
    state.agents = [];
    migrated = true;
  }

  const seenIds = new Set<string>();
  const dedupedAgents: AIAgent[] = [];
  for (const agent of state.agents) {
    if (!agent || !agent.id || seenIds.has(agent.id)) {
      migrated = true;
      continue;
    }
    seenIds.add(agent.id);
    dedupedAgents.push(agent);
  }
  state.agents = dedupedAgents;

  for (const defaultAgent of createDefaultAgents()) {
    if (!seenIds.has(defaultAgent.id)) {
      state.agents.push({ ...defaultAgent });
      seenIds.add(defaultAgent.id);
      migrated = true;
    }
  }

  if (!Array.isArray(state.analysisJobs)) {
    state.analysisJobs = [];
    migrated = true;
  } else {
    const seenJobIds = new Set<string>();
    const dedupedJobs: RepositoryAnalysisJob[] = [];
    for (const job of state.analysisJobs) {
      if (!job || !job.id || seenJobIds.has(job.id)) {
        migrated = true;
        continue;
      }
      seenJobIds.add(job.id);
      dedupedJobs.push(sanitizeJobRecord(job));
    }
    if (dedupedJobs.length > MAX_ANALYSIS_JOBS) {
      dedupedJobs.length = MAX_ANALYSIS_JOBS;
      migrated = true;
    }
    state.analysisJobs = dedupedJobs;
  }

  if (
    state.settings &&
    typeof state.settings.persistenceNote === 'string' &&
    state.settings.persistenceNote.includes('Firebase Firestore integration was skipped')
  ) {
    state.settings.persistenceNote =
      'Cloud Firestore (database: ai-studio-coderubric-a62b149b-c49c-4d79-a80e-bdb404ef4d9d) with local JSON server persistence (data/coderubric-store.json). Sign in with Google in Settings or the top bar to sync workspace data across sessions.';
    migrated = true;
  }

  return { state, migrated };
}

function sanitizeJobRecord(job: RepositoryAnalysisJob): RepositoryAnalysisJob {
  const clone = { ...job } as RepositoryAnalysisJob & Record<string, unknown>;
  delete clone.accessToken;
  delete clone.token;
  delete clone.githubToken;
  delete clone.apiKey;
  delete clone.secret;
  delete clone.cookie;
  return clone;
}

function loadStateFromDisk(): StoreState {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as StoreState;
      if (parsed && Array.isArray(parsed.repositories) && Array.isArray(parsed.reviews)) {
        const { state, migrated } = migrateStoreState(parsed);
        if (migrated) {
          persistStateToDisk(state);
        }
        return state;
      }
    }
  } catch (err) {
    console.warn('Could not read store file, initializing demo seed:', err);
  }
  const seed = createDemoSeed();
  persistStateToDisk(seed);
  return seed;
}

function persistStateToDisk(state: StoreState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not persist store to disk, keeping in-memory state:', err);
  }
}

export function getStore(): StoreState {
  if (!memoryState) {
    memoryState = loadStateFromDisk();
  }
  return memoryState;
}

export function saveStore(next: StoreState): StoreState {
  memoryState = next;
  persistStateToDisk(next);
  return memoryState;
}

export function resetDemoStore(): StoreState {
  const existingToken = memoryState?.githubToken;
  const fresh = createDemoSeed();
  if (existingToken) {
    fresh.githubToken = existingToken;
    fresh.settings.githubTokenConfigured = true;
    fresh.settings.githubTokenMask = `••••${existingToken.slice(-4)}`;
  }
  return saveStore(fresh);
}

export function hydrateWorkspaceStore(input: {
  repositories?: Repository[];
  reviews?: CodeReview[];
  agents?: AIAgent[];
  dailyActivity?: StoreState['dailyActivity'];
  analysisJobs?: RepositoryAnalysisJob[];
  settings?: Partial<
    Pick<
      WorkspaceSettings,
      | 'organizationName'
      | 'defaultAgentId'
      | 'defaultModel'
      | 'autoPostPrSummary'
      | 'minimumPassScore'
    >
  >;
  storageMode?: 'local-json' | 'firebase-firestore';
}): StoreState {
  const current = getStore();
  const next: StoreState = {
    repositories: Array.isArray(input.repositories) ? input.repositories : current.repositories,
    reviews: Array.isArray(input.reviews) ? input.reviews : current.reviews,
    agents: Array.isArray(input.agents) && input.agents.length > 0 ? input.agents : current.agents,
    dailyActivity: Array.isArray(input.dailyActivity)
      ? input.dailyActivity.slice(-14)
      : current.dailyActivity,
    analysisJobs: Array.isArray(input.analysisJobs)
      ? input.analysisJobs
      : current.analysisJobs,
    settings: {
      ...current.settings,
      ...(input.settings?.organizationName
        ? { organizationName: input.settings.organizationName }
        : {}),
      ...(input.settings?.defaultAgentId
        ? { defaultAgentId: input.settings.defaultAgentId }
        : {}),
      ...(input.settings?.defaultModel ? { defaultModel: input.settings.defaultModel } : {}),
      ...(typeof input.settings?.autoPostPrSummary === 'boolean'
        ? { autoPostPrSummary: input.settings.autoPostPrSummary }
        : {}),
      ...(typeof input.settings?.minimumPassScore === 'number'
        ? {
            minimumPassScore: Math.max(
              0,
              Math.min(100, Math.round(input.settings.minimumPassScore))
            ),
          }
        : {}),
      storageMode: input.storageMode ?? current.settings.storageMode,
      githubTokenConfigured: current.settings.githubTokenConfigured,
      githubTokenMask: current.settings.githubTokenMask,
    },
    ...(current.githubToken ? { githubToken: current.githubToken } : {}),
  };

  const { state } = migrateStoreState(next);
  return saveStore(state);
}

export function addRepository(repo: Repository): Repository {
  const state = getStore();
  const existingIdx = state.repositories.findIndex(
    (r) => r.fullName.toLowerCase() === repo.fullName.toLowerCase()
  );
  if (existingIdx >= 0) {
    state.repositories[existingIdx] = { ...state.repositories[existingIdx], ...repo };
  } else {
    state.repositories.unshift(repo);
  }
  saveStore(state);
  return repo;
}

export function toggleRepositoryAutoReview(id: string, enabled: boolean): Repository | null {
  const state = getStore();
  const target = state.repositories.find((r) => r.id === id);
  if (!target) return null;
  target.autoReviewEnabled = enabled;
  saveStore(state);
  return target;
}

export function removeRepository(id: string): boolean {
  const state = getStore();
  const prevLen = state.repositories.length;
  state.repositories = state.repositories.filter((r) => r.id !== id);
  if (state.repositories.length === prevLen) return false;
  saveStore(state);
  return true;
}

export function addReview(review: CodeReview): CodeReview {
  const state = getStore();
  const existing = state.reviews.find(
    (r) => r.id === review.id || (review.analysisJobId && r.analysisJobId === review.analysisJobId)
  );
  if (existing) {
    return existing;
  }

  state.reviews.unshift(review);

  // Update repository stats if matched
  const repo = state.repositories.find(
    (r) =>
      r.id === review.repositoryId ||
      r.fullName.toLowerCase() === review.repositoryFullName.toLowerCase()
  );
  if (repo) {
    repo.lastReviewedAt = review.createdAt;
    const repoReviews = state.reviews.filter(
      (rev) => rev.repositoryFullName.toLowerCase() === repo.fullName.toLowerCase()
    );
    if (repoReviews.length > 0) {
      const sum = repoReviews.reduce((acc, item) => acc + item.score, 0);
      repo.healthScore = Math.round(sum / repoReviews.length);
    }
    if (repo.activitySeries.length > 0) {
      repo.activitySeries[repo.activitySeries.length - 1] += 1;
    }
  }

  // Update agent stats
  const agent = state.agents.find((a) => a.id === review.agentId);
  if (agent) {
    const totalFindings =
      agent.avgFindingsPerPr * agent.reviewsRun + review.findings.length;
    agent.reviewsRun += 1;
    agent.avgFindingsPerPr = Number((totalFindings / agent.reviewsRun).toFixed(1));
  }

  // Update today's activity point
  const today = new Date().toISOString().slice(0, 10);
  const lastDay = state.dailyActivity[state.dailyActivity.length - 1];
  const criticalCount = review.findings.filter((f) => f.severity === 'critical').length;
  const highCount = review.findings.filter((f) => f.severity === 'high').length;
  const mediumCount = review.findings.filter((f) => f.severity === 'medium').length;
  const lowCount = review.findings.filter((f) => f.severity === 'low').length;

  if (lastDay && lastDay.date === today) {
    lastDay.reviews += 1;
    lastDay.critical += criticalCount;
    lastDay.high += highCount;
    lastDay.medium += mediumCount;
    lastDay.low += lowCount;
    lastDay.avgScore = Math.round((lastDay.avgScore + review.score) / 2);
  } else {
    const now = new Date();
    state.dailyActivity.push({
      date: today,
      label: `${now.toLocaleString('en-US', { month: 'short' })} ${now.getDate()}`,
      reviews: 1,
      critical: criticalCount,
      high: highCount,
      medium: mediumCount,
      low: lowCount,
      avgScore: review.score,
    });
    if (state.dailyActivity.length > 14) {
      state.dailyActivity.shift();
    }
  }

  saveStore(state);
  return review;
}

export function updateReviewStatus(id: string, status: ReviewStatus): CodeReview | null {
  const state = getStore();
  const rev = state.reviews.find((r) => r.id === id);
  if (!rev) return null;
  rev.status = status;
  saveStore(state);
  return rev;
}

export function toggleFindingResolved(
  reviewId: string,
  findingId: string,
  resolved: boolean
): CodeReview | null {
  const state = getStore();
  const rev = state.reviews.find((r) => r.id === reviewId);
  if (!rev) return null;
  const finding = rev.findings.find((f) => f.id === findingId);
  if (!finding) return null;
  finding.resolved = resolved;
  saveStore(state);
  return rev;
}

export function updateAgent(
  id: string,
  patch: Partial<Pick<AIAgent, 'enabled' | 'strictness' | 'thinkingLevel' | 'systemPrompt' | 'focus'>>
): AIAgent | null {
  const state = getStore();
  const agent = state.agents.find((a) => a.id === id);
  if (!agent) return null;
  Object.assign(agent, patch);
  saveStore(state);
  return agent;
}

export function updateWorkspaceSettings(
  patch: Partial<
    Pick<
      WorkspaceSettings,
      'organizationName' | 'defaultAgentId' | 'defaultModel' | 'autoPostPrSummary' | 'minimumPassScore'
    >
  > & { githubToken?: string }
): WorkspaceSettings {
  const state = getStore();
  const { githubToken, ...rest } = patch;
  Object.assign(state.settings, rest);

  if (typeof githubToken === 'string') {
    const trimmed = githubToken.trim();
    if (trimmed === '') {
      delete state.githubToken;
      state.settings.githubTokenConfigured = false;
      state.settings.githubTokenMask = '';
    } else {
      state.githubToken = trimmed;
      state.settings.githubTokenConfigured = true;
      state.settings.githubTokenMask =
        trimmed.length > 4 ? `••••${trimmed.slice(-4)}` : '••••';
    }
  }

  saveStore(state);
  return state.settings;
}

const ACTIVE_JOB_STATUSES = new Set([
  'queued',
  'collecting_files',
  'running_agents',
  'synthesizing',
]);

function pruneAnalysisJobs(jobs: RepositoryAnalysisJob[]): RepositoryAnalysisJob[] {
  if (jobs.length <= MAX_ANALYSIS_JOBS) return jobs;
  const sorted = [...jobs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  // Keep newest jobs up to MAX_ANALYSIS_JOBS (never deletes reviews)
  return sorted.slice(0, MAX_ANALYSIS_JOBS);
}

export function createAnalysisJob(job: RepositoryAnalysisJob): RepositoryAnalysisJob {
  const state = getStore();
  if (!Array.isArray(state.analysisJobs)) {
    state.analysisJobs = [];
  }
  const existing = state.analysisJobs.find((j) => j.id === job.id);
  if (existing) {
    return existing;
  }
  const cleanJob = sanitizeJobRecord(job);
  state.analysisJobs.unshift(cleanJob);
  state.analysisJobs = pruneAnalysisJobs(state.analysisJobs);
  saveStore(state);
  return cleanJob;
}

export function updateAnalysisJob(
  jobId: string,
  patch: Partial<RepositoryAnalysisJob>
): RepositoryAnalysisJob | null {
  const state = getStore();
  if (!Array.isArray(state.analysisJobs)) {
    state.analysisJobs = [];
  }
  const idx = state.analysisJobs.findIndex((j) => j.id === jobId);
  if (idx === -1) return null;

  const current = state.analysisJobs[idx];
  const nextProgress =
    typeof patch.progress === 'number' && Number.isFinite(patch.progress)
      ? Math.max(current.progress, Math.min(100, Math.round(patch.progress)))
      : current.progress;

  const updated = sanitizeJobRecord({
    ...current,
    ...patch,
    id: current.id,
    progress: nextProgress,
    updatedAt: patch.updatedAt || new Date().toISOString(),
  });

  state.analysisJobs[idx] = updated;
  saveStore(state);
  return updated;
}

export function getAnalysisJobById(jobId: string): RepositoryAnalysisJob | null {
  const state = getStore();
  const list = Array.isArray(state.analysisJobs) ? state.analysisJobs : [];
  return list.find((j) => j.id === jobId) ?? null;
}

export function listAnalysisJobsForRepository(repositoryId: string): RepositoryAnalysisJob[] {
  const state = getStore();
  const list = Array.isArray(state.analysisJobs) ? state.analysisJobs : [];
  return list
    .filter((j) => j.repositoryId === repositoryId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function recoverInterruptedAnalysisJobs(nowIso?: string): number {
  const state = getStore();
  if (!Array.isArray(state.analysisJobs)) {
    state.analysisJobs = [];
    return 0;
  }
  const timestamp = nowIso || new Date().toISOString();
  let recovered = 0;

  state.analysisJobs = state.analysisJobs.map((job) => {
    if (!ACTIVE_JOB_STATUSES.has(job.status)) {
      return job;
    }
    recovered += 1;
    return {
      ...job,
      status: 'failed',
      currentStep: 'interrupted',
      message: 'Analysis job was interrupted by a server restart before completion.',
      error:
        'Server process restarted while this analysis job was running. Please start a new analysis job.',
      updatedAt: timestamp,
      completedAt: timestamp,
    };
  });

  if (recovered > 0) {
    saveStore(state);
  }
  return recovered;
}
