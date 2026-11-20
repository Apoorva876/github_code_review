import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  FieldValue,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  AIAgent,
  CodeReview,
  DailyActivityPoint,
  Repository,
  RepositoryAnalysisJob,
  WorkspaceSettings,
} from '../types';

export interface FirestoreWorkspaceSnapshot {
  repositories: Repository[];
  reviews: CodeReview[];
  agents: AIAgent[];
  analysisJobs: RepositoryAnalysisJob[];
  dailyActivity: DailyActivityPoint[];
  settings: Pick<
    WorkspaceSettings,
    | 'organizationName'
    | 'defaultAgentId'
    | 'defaultModel'
    | 'autoPostPrSummary'
    | 'minimumPassScore'
  >;
}

const VALID_REVIEW_STATUSES = new Set(['approved', 'changes_requested', 'in_review']);
const VALID_SOURCES = new Set(['demo', 'github-live', 'manual-diff']);
const VALID_THINKING = new Set(['LOW', 'MEDIUM', 'HIGH']);
const VALID_STRICTNESS = new Set(['strict', 'balanced', 'advisory']);
const VALID_JOB_STATUSES = new Set([
  'queued',
  'collecting_files',
  'running_agents',
  'synthesizing',
  'completed',
  'partial',
  'failed',
]);
const TERMINAL_JOB_STATUSES = new Set(['completed', 'partial', 'failed']);

export function sanitizeDocId(raw: string, fallback = 'doc'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 128);
  return cleaned || fallback;
}

function clampStr(value: unknown, maxLen: number, fallback = ''): string {
  const str = typeof value === 'string' ? value : value == null ? fallback : String(value);
  return str.slice(0, maxLen);
}

function clampNonEmptyStr(value: unknown, maxLen: number, fallback: string): string {
  const trimmed = clampStr(value, maxLen, fallback).trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLen) : fallback.slice(0, maxLen);
}

function clampNum(value: unknown, min: number, max?: number, fallback = min): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const boundedLow = Math.max(min, num);
  return typeof max === 'number' ? Math.min(max, boundedLow) : boundedLow;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function stripUndefinedDeep<T>(value: T): T {
  // Never strip or reconstruct Firestore FieldValue sentinels (e.g. serverTimestamp()) or class instances
  if (value instanceof FieldValue) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function stripFirestoreTimestamps<T extends Record<string, unknown>>(
  raw: T
): Omit<T, 'ownerUid' | 'firestoreCreatedAt' | 'firestoreUpdatedAt'> {
  const clone = { ...raw } as Record<string, unknown>;
  delete clone.ownerUid;
  delete clone.firestoreCreatedAt;
  delete clone.firestoreUpdatedAt;
  return clone as Omit<T, 'ownerUid' | 'firestoreCreatedAt' | 'firestoreUpdatedAt'>;
}

export function toFirestoreUserProfile(
  user: Pick<User, 'uid' | 'displayName' | 'photoURL' | 'email'>,
  timestamps: { createdAt: FieldValue | unknown; updatedAt: FieldValue }
): Record<string, unknown> {
  const uid = user.uid;
  return {
    uid,
    displayName: clampStr(user.displayName || user.email?.split('@')[0] || 'CodeRubric User', 120),
    photoURL: clampStr(user.photoURL || '', 500),
    firestoreCreatedAt: timestamps.createdAt,
    firestoreUpdatedAt: timestamps.updatedAt,
  };
}

export function toFirestorePrivateAccount(
  user: Pick<User, 'uid' | 'email'>,
  timestamps: { createdAt: FieldValue | unknown; updatedAt: FieldValue }
): Record<string, unknown> {
  const uid = user.uid;
  const rawEmail = clampStr(user.email, 200).trim();
  const safeEmail = rawEmail.length >= 3 ? rawEmail : `${uid}@users.local`.slice(0, 200);
  return {
    uid,
    email: safeEmail,
    firestoreCreatedAt: timestamps.createdAt,
    firestoreUpdatedAt: timestamps.updatedAt,
  };
}

export function toFirestoreRepository(
  uid: string,
  repo: Repository,
  timestamps: { createdAt: FieldValue | unknown; updatedAt: FieldValue }
): Record<string, unknown> {
  const safeId = sanitizeDocId(repo.id, `repo_${Date.now()}`);
  const activity = Array.isArray(repo.activitySeries)
    ? repo.activitySeries
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        .slice(0, 30)
    : [];

  return stripUndefinedDeep({
    id: safeId,
    ownerUid: uid,
    fullName: clampNonEmptyStr(repo.fullName, 200, 'org/repo'),
    owner: clampNonEmptyStr(repo.owner, 100, 'org'),
    name: clampNonEmptyStr(repo.name, 100, 'repo'),
    description: clampStr(repo.description ?? '', 1000),
    language: clampStr(repo.language ?? 'Unknown', 64),
    defaultBranch: clampNonEmptyStr(repo.defaultBranch, 255, 'main'),
    stars: clampNum(repo.stars, 0),
    ...(typeof repo.forks === 'number' && Number.isFinite(repo.forks)
      ? { forks: clampNum(repo.forks, 0) }
      : {}),
    openPrsCount: clampNum(repo.openPrsCount, 0),
    lastReviewedAt: clampStr(repo.lastReviewedAt || new Date().toISOString(), 64),
    healthScore: clampNum(repo.healthScore, 0, 100, 80),
    isDemo: Boolean(repo.isDemo),
    ...(typeof repo.isPrivate === 'boolean' ? { isPrivate: repo.isPrivate } : {}),
    autoReviewEnabled: Boolean(repo.autoReviewEnabled),
    htmlUrl: clampStr(repo.htmlUrl ?? '', 500),
    activitySeries: activity,
    firestoreCreatedAt: timestamps.createdAt,
    firestoreUpdatedAt: timestamps.updatedAt,
  });
}

export function toFirestoreReview(
  uid: string,
  review: CodeReview,
  timestamps: { createdAt: FieldValue | unknown; updatedAt: FieldValue }
): Record<string, unknown> {
  const safeId = sanitizeDocId(review.id, `rev_${Date.now()}`);
  const safeRepoId = sanitizeDocId(review.repositoryId, 'repo_custom');
  const safeAgentId = sanitizeDocId(review.agentId, 'agent_default');

  const safeStatus = VALID_REVIEW_STATUSES.has(review.status) ? review.status : 'in_review';
  const safeSource = VALID_SOURCES.has(review.source) ? review.source : 'manual-diff';

  return stripUndefinedDeep({
    id: safeId,
    ownerUid: uid,
    prNumber: clampNum(review.prNumber, 0),
    title: clampNonEmptyStr(review.title, 300, 'Code Review'),
    repositoryId: safeRepoId,
    repositoryFullName: clampNonEmptyStr(review.repositoryFullName, 200, 'custom/snippet'),
    branch: clampStr(review.branch ?? 'main', 255),
    baseBranch: clampStr(review.baseBranch ?? 'main', 255),
    author: clampStr(review.author ?? 'developer', 120),
    status: safeStatus,
    score: clampNum(review.score, 0, 100, 80),
    summary: clampStr(review.summary ?? '', 4000),
    rubricBreakdown: {
      security: clampNum(review.rubricBreakdown?.security, 0, 100, 80),
      reliability: clampNum(review.rubricBreakdown?.reliability, 0, 100, 80),
      maintainability: clampNum(review.rubricBreakdown?.maintainability, 0, 100, 80),
      performance: clampNum(review.rubricBreakdown?.performance, 0, 100, 80),
    },
    findings: Array.isArray(review.findings) ? review.findings.slice(0, 100) : [],
    agentId: safeAgentId,
    agentName: clampStr(review.agentName ?? 'AI Reviewer', 120),
    source: safeSource,
    isDemo: Boolean(review.isDemo),
    diffPreview: clampStr(review.diffPreview ?? '', 8000),
    filesChanged: clampNum(review.filesChanged, 0),
    additions: clampNum(review.additions, 0),
    deletions: clampNum(review.deletions, 0),
    ...(typeof review.prUrl === 'string' && review.prUrl
      ? { prUrl: clampStr(review.prUrl, 500) }
      : {}),
    createdAt: clampStr(review.createdAt || new Date().toISOString(), 64),
    durationMs: clampNum(review.durationMs, 0),
    ...(review.reviewScope === 'pr-diff' ||
    review.reviewScope === 'manual-diff' ||
    review.reviewScope === 'repository'
      ? { reviewScope: review.reviewScope }
      : {}),
    ...(review.analysisStatus === 'completed' || review.analysisStatus === 'partial'
      ? { analysisStatus: review.analysisStatus }
      : {}),
    ...(typeof review.analysisJobId === 'string' && review.analysisJobId
      ? { analysisJobId: clampStr(review.analysisJobId, 128) }
      : {}),
    ...(typeof review.analyzedCommitSha === 'string' && review.analyzedCommitSha
      ? { analyzedCommitSha: clampStr(review.analyzedCommitSha, 64) }
      : {}),
    ...(Array.isArray(review.strengths)
      ? {
          strengths: review.strengths
            .filter((s): s is string => typeof s === 'string')
            .slice(0, 30),
        }
      : {}),
    ...(Array.isArray(review.agentBreakdown)
      ? { agentBreakdown: review.agentBreakdown.slice(0, 10) }
      : {}),
    ...(review.collectionCoverage ? { collectionCoverage: review.collectionCoverage } : {}),
    firestoreCreatedAt: timestamps.createdAt,
    firestoreUpdatedAt: timestamps.updatedAt,
  });
}

export function toFirestoreAgent(
  uid: string,
  agent: AIAgent,
  timestamps: { createdAt: FieldValue | unknown; updatedAt: FieldValue }
): Record<string, unknown> {
  const safeId = sanitizeDocId(agent.id, `agent_${Date.now()}`);
  return stripUndefinedDeep({
    id: safeId,
    ownerUid: uid,
    name: clampNonEmptyStr(agent.name, 120, 'AI Reviewer'),
    focus: clampStr(agent.focus ?? '', 300),
    description: clampStr(agent.description ?? '', 1000),
    model: clampStr(agent.model || 'gemini-4-hydrogen', 80),
    thinkingLevel: VALID_THINKING.has(agent.thinkingLevel) ? agent.thinkingLevel : 'MEDIUM',
    systemPrompt: clampNonEmptyStr(
      agent.systemPrompt,
      4000,
      'Review code changes accurately.'
    ),
    enabled: Boolean(agent.enabled),
    strictness: VALID_STRICTNESS.has(agent.strictness) ? agent.strictness : 'balanced',
    reviewsRun: clampNum(agent.reviewsRun, 0),
    avgFindingsPerPr: clampNum(agent.avgFindingsPerPr, 0),
    isDemo: Boolean(agent.isDemo),
    firestoreCreatedAt: timestamps.createdAt,
    firestoreUpdatedAt: timestamps.updatedAt,
  });
}

export function toFirestoreAnalysisJob(
  uid: string,
  job: RepositoryAnalysisJob,
  timestamps: { createdAt: FieldValue | unknown; updatedAt: FieldValue }
): Record<string, unknown> {
  const safeId = sanitizeDocId(job.id, `job_${Date.now()}`);
  const safeRepoId = sanitizeDocId(job.repositoryId, 'repo_custom');
  const safeStatus = VALID_JOB_STATUSES.has(job.status) ? job.status : 'queued';

  return stripUndefinedDeep({
    id: safeId,
    ownerUid: uid,
    repositoryId: safeRepoId,
    repositoryFullName: clampStr(job.repositoryFullName ?? '', 200),
    branch: clampStr(job.branch ?? 'main', 255),
    status: safeStatus,
    progress: clampNum(job.progress, 0, 100, 0),
    currentStep: clampStr(job.currentStep ?? '', 64),
    message: clampStr(job.message ?? '', 1000),
    createdAt: clampStr(job.createdAt || new Date().toISOString(), 64),
    startedAt: job.startedAt ? clampStr(job.startedAt, 64) : null,
    updatedAt: clampStr(job.updatedAt || new Date().toISOString(), 64),
    completedAt: job.completedAt ? clampStr(job.completedAt, 64) : null,
    analyzedCommitSha: job.analyzedCommitSha ? clampStr(job.analyzedCommitSha, 64) : null,
    totalTreeEntries: clampNum(job.totalTreeEntries, 0),
    eligibleFiles: clampNum(job.eligibleFiles, 0),
    filesCollected: clampNum(job.filesCollected, 0),
    filesAnalyzed: clampNum(job.filesAnalyzed, 0),
    filesSkipped: clampNum(job.filesSkipped, 0),
    filesTruncated: clampNum(job.filesTruncated, 0),
    totalChunks: clampNum(job.totalChunks, 0),
    completedChunks: clampNum(job.completedChunks, 0),
    totalAgents: clampNum(job.totalAgents, 0),
    completedAgents: clampNum(job.completedAgents, 0),
    failedAgents: clampNum(job.failedAgents, 0),
    agentBreakdown: Array.isArray(job.agentBreakdown) ? job.agentBreakdown.slice(0, 10) : [],
    collectionCoverage: job.collectionCoverage ?? null,
    resultReviewId: job.resultReviewId ? clampStr(job.resultReviewId, 128) : null,
    error: job.error ? clampStr(job.error, 1000) : null,
    firestoreCreatedAt: timestamps.createdAt,
    firestoreUpdatedAt: timestamps.updatedAt,
  });
}

export function toFirestoreWorkspaceSettings(
  uid: string,
  settings: Pick<
    WorkspaceSettings,
    | 'organizationName'
    | 'defaultAgentId'
    | 'defaultModel'
    | 'autoPostPrSummary'
    | 'minimumPassScore'
  >,
  dailyActivity: DailyActivityPoint[],
  timestamps: { createdAt: FieldValue | unknown; updatedAt: FieldValue }
): Record<string, unknown> {
  return stripUndefinedDeep({
    ownerUid: uid,
    organizationName: clampNonEmptyStr(settings.organizationName, 120, 'CodeRubric Workspace'),
    defaultAgentId: clampStr(settings.defaultAgentId ?? 'agent-security-sentinel', 128),
    defaultModel: clampStr(settings.defaultModel || 'gemini-4-hydrogen', 80),
    autoPostPrSummary: Boolean(settings.autoPostPrSummary),
    minimumPassScore: clampNum(settings.minimumPassScore, 0, 100, 80),
    dailyActivity: Array.isArray(dailyActivity) ? dailyActivity.slice(-14) : [],
    firestoreCreatedAt: timestamps.createdAt,
    firestoreUpdatedAt: timestamps.updatedAt,
  });
}

async function commitWriteBatches(
  operations: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown>; merge?: boolean }>
): Promise<void> {
  // Keep <= 10 writes per batch so Master Gate exists() lookups stay strictly under Firestore's 20-lookup batch limit.
  const CHUNK_SIZE = 10;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of chunk) {
      if (op.merge) {
        batch.set(op.ref, op.data, { merge: true });
      } else {
        batch.set(op.ref, op.data);
      }
    }
    await batch.commit();
  }
}

export async function bootstrapAndLoadFirestoreWorkspace(
  user: User,
  seedWorkspace: FirestoreWorkspaceSnapshot
): Promise<{
  isFirstSignIn: boolean;
  workspace: FirestoreWorkspaceSnapshot;
}> {
  const uid = user.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  let userExists = false;
  try {
    const userSnap = await getDoc(userRef);
    userExists = userSnap.exists();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  if (!userExists) {
    // 1. Create parent /users/{uid}
    const profileTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    try {
      await setDoc(userRef, toFirestoreUserProfile(user, profileTs));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, userPath);
    }

    // 2. Create /users/{uid}/private/account
    const privatePath = `${userPath}/private/account`;
    try {
      await setDoc(
        doc(db, 'users', uid, 'private', 'account'),
        toFirestorePrivateAccount(user, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, privatePath);
    }

    // 3. Create /users/{uid}/settings/workspace (canonical workspace settings path)
    const settingsPath = `${userPath}/settings/workspace`;
    try {
      await setDoc(
        doc(db, 'users', uid, 'settings', 'workspace'),
        toFirestoreWorkspaceSettings(
          uid,
          seedWorkspace.settings,
          seedWorkspace.dailyActivity,
          {
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
        )
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, settingsPath);
    }

    // 4. Write repositories (<= 10 per batch)
    if (seedWorkspace.repositories.length > 0) {
      const repoTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      try {
        await commitWriteBatches(
          seedWorkspace.repositories.map((repo) => ({
            ref: doc(db, 'users', uid, 'repositories', sanitizeDocId(repo.id)),
            data: toFirestoreRepository(uid, repo, repoTs),
          }))
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `${userPath}/repositories`);
      }
    }

    // 5. Write AI agents (<= 10 per batch)
    if (seedWorkspace.agents.length > 0) {
      const agentTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      try {
        await commitWriteBatches(
          seedWorkspace.agents.map((agent) => ({
            ref: doc(db, 'users', uid, 'agents', sanitizeDocId(agent.id)),
            data: toFirestoreAgent(uid, agent, agentTs),
          }))
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `${userPath}/agents`);
      }
    }

    // 6. Write reviews and analysis jobs (<= 10 per batch)
    if (seedWorkspace.reviews.length > 0) {
      const reviewTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      try {
        await commitWriteBatches(
          seedWorkspace.reviews.map((review) => ({
            ref: doc(db, 'users', uid, 'reviews', sanitizeDocId(review.id)),
            data: toFirestoreReview(uid, review, reviewTs),
          }))
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `${userPath}/reviews`);
      }
    }

    const initialJobs = seedWorkspace.analysisJobs.slice(0, 50);
    if (initialJobs.length > 0) {
      const jobTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      try {
        await commitWriteBatches(
          initialJobs.map((job) => ({
            ref: doc(db, 'users', uid, 'analysisJobs', sanitizeDocId(job.id)),
            data: toFirestoreAnalysisJob(uid, job, jobTs),
          }))
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `${userPath}/analysisJobs`);
      }
    }

    return { isFirstSignIn: true, workspace: seedWorkspace };
  }

  // Returning verified user: keep profile metadata fresh & load persisted collections
  try {
    await updateDoc(userRef, {
      displayName: clampStr(user.displayName || user.email?.split('@')[0] || 'CodeRubric User', 120),
      photoURL: clampStr(user.photoURL || '', 500),
      firestoreUpdatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal if profile fields unchanged or transiently unavailable
  }

  let privateExists = false;
  let settingsExists = false;
  let repositories: Repository[] = [];
  let reviews: CodeReview[] = [];
  let agents: AIAgent[] = [];
  let analysisJobs: RepositoryAnalysisJob[] = [];
  let settings = seedWorkspace.settings;
  let dailyActivity = seedWorkspace.dailyActivity;

  try {
    const [reposSnap, reviewsSnap, agentsSnap, jobsSnap, settingsSnap, privateSnap] =
      await Promise.all([
        getDocs(query(collection(db, 'users', uid, 'repositories'), where('ownerUid', '==', uid))),
        getDocs(query(collection(db, 'users', uid, 'reviews'), where('ownerUid', '==', uid))),
        getDocs(query(collection(db, 'users', uid, 'agents'), where('ownerUid', '==', uid))),
        getDocs(query(collection(db, 'users', uid, 'analysisJobs'), where('ownerUid', '==', uid))),
        getDoc(doc(db, 'users', uid, 'settings', 'workspace')),
        getDoc(doc(db, 'users', uid, 'private', 'account')),
      ]);

    privateExists = privateSnap.exists();
    settingsExists = settingsSnap.exists();

    repositories = reposSnap.docs.map(
      (d) => stripFirestoreTimestamps(d.data()) as unknown as Repository
    );
    reviews = reviewsSnap.docs
      .map((d) => stripFirestoreTimestamps(d.data()) as unknown as CodeReview)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    agents = agentsSnap.docs.map(
      (d) => stripFirestoreTimestamps(d.data()) as unknown as AIAgent
    );
    analysisJobs = jobsSnap.docs
      .map((d) => stripFirestoreTimestamps(d.data()) as unknown as RepositoryAnalysisJob)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const settingsData = settingsExists ? settingsSnap.data() : undefined;
    if (settingsData) {
      const rawSettings = stripFirestoreTimestamps(settingsData);
      settings = {
        organizationName: String(
          rawSettings.organizationName || seedWorkspace.settings.organizationName
        ),
        defaultAgentId: String(
          rawSettings.defaultAgentId || seedWorkspace.settings.defaultAgentId
        ),
        defaultModel: String(rawSettings.defaultModel || seedWorkspace.settings.defaultModel),
        autoPostPrSummary: Boolean(rawSettings.autoPostPrSummary),
        minimumPassScore: clampNum(rawSettings.minimumPassScore, 0, 100, 80),
      };
      if (Array.isArray(rawSettings.dailyActivity)) {
        dailyActivity = rawSettings.dailyActivity as DailyActivityPoint[];
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, userPath);
  }

  // Self-heal partial initial seed in canonical sequence with exact path attribution
  if (!privateExists) {
    try {
      await setDoc(
        doc(db, 'users', uid, 'private', 'account'),
        toFirestorePrivateAccount(user, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `${userPath}/private/account`);
    }
  }

  if (!settingsExists) {
    try {
      await setDoc(
        doc(db, 'users', uid, 'settings', 'workspace'),
        toFirestoreWorkspaceSettings(uid, settings, dailyActivity, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `${userPath}/settings/workspace`);
    }

    if (repositories.length === 0 && seedWorkspace.repositories.length > 0) {
      repositories = seedWorkspace.repositories;
      const repoTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      try {
        await commitWriteBatches(
          repositories.map((repo) => ({
            ref: doc(db, 'users', uid, 'repositories', sanitizeDocId(repo.id)),
            data: toFirestoreRepository(uid, repo, repoTs),
          }))
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `${userPath}/repositories`);
      }
    }

    if (reviews.length === 0 && seedWorkspace.reviews.length > 0) {
      reviews = seedWorkspace.reviews;
      const reviewTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      try {
        await commitWriteBatches(
          reviews.map((review) => ({
            ref: doc(db, 'users', uid, 'reviews', sanitizeDocId(review.id)),
            data: toFirestoreReview(uid, review, reviewTs),
          }))
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `${userPath}/reviews`);
      }
    }
  }

  if (agents.length === 0 && seedWorkspace.agents.length > 0) {
    agents = seedWorkspace.agents;
    const agentTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    try {
      await commitWriteBatches(
        agents.map((agent) => ({
          ref: doc(db, 'users', uid, 'agents', sanitizeDocId(agent.id)),
          data: toFirestoreAgent(uid, agent, agentTs),
        }))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${userPath}/agents`);
    }
  }

  return {
    isFirstSignIn: false,
    workspace: {
      repositories,
      reviews,
      agents,
      analysisJobs,
      dailyActivity,
      settings,
    },
  };
}

export async function upsertRepositoryInFirestore(uid: string, repo: Repository): Promise<void> {
  const safeId = sanitizeDocId(repo.id);
  const path = `users/${uid}/repositories/${safeId}`;
  const ref = doc(db, 'users', uid, 'repositories', safeId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        toFirestoreRepository(uid, repo, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      await updateDoc(
        ref,
        stripUndefinedDeep({
          lastReviewedAt: clampStr(repo.lastReviewedAt || new Date().toISOString(), 64),
          healthScore: clampNum(repo.healthScore, 0, 100, 80),
          activitySeries: Array.isArray(repo.activitySeries)
            ? repo.activitySeries.slice(0, 30)
            : [],
          openPrsCount: clampNum(repo.openPrsCount, 0),
          stars: clampNum(repo.stars, 0),
          ...(typeof repo.forks === 'number' ? { forks: clampNum(repo.forks, 0) } : {}),
          description: clampStr(repo.description ?? '', 1000),
          defaultBranch: clampNonEmptyStr(repo.defaultBranch, 255, 'main'),
          firestoreUpdatedAt: serverTimestamp(),
        })
      );
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateRepositoryAutoReviewInFirestore(
  uid: string,
  repoId: string,
  autoReviewEnabled: boolean
): Promise<void> {
  const safeId = sanitizeDocId(repoId);
  const path = `users/${uid}/repositories/${safeId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'repositories', safeId), {
      autoReviewEnabled: Boolean(autoReviewEnabled),
      firestoreUpdatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteRepositoryInFirestore(uid: string, repoId: string): Promise<void> {
  const safeId = sanitizeDocId(repoId);
  const path = `users/${uid}/repositories/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'repositories', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function upsertReviewInFirestore(uid: string, review: CodeReview): Promise<void> {
  const safeId = sanitizeDocId(review.id);
  const path = `users/${uid}/reviews/${safeId}`;
  const ref = doc(db, 'users', uid, 'reviews', safeId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        toFirestoreReview(uid, review, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      await updateDoc(ref, {
        status: VALID_REVIEW_STATUSES.has(review.status) ? review.status : 'in_review',
        findings: stripUndefinedDeep(
          Array.isArray(review.findings) ? review.findings.slice(0, 100) : []
        ),
        firestoreUpdatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateReviewStatusOrFindingsInFirestore(
  uid: string,
  review: CodeReview
): Promise<void> {
  const safeId = sanitizeDocId(review.id);
  const path = `users/${uid}/reviews/${safeId}`;
  const ref = doc(db, 'users', uid, 'reviews', safeId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        toFirestoreReview(uid, review, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      return;
    }
    await updateDoc(ref, {
      status: VALID_REVIEW_STATUSES.has(review.status) ? review.status : 'in_review',
      findings: stripUndefinedDeep(
        Array.isArray(review.findings) ? review.findings.slice(0, 100) : []
      ),
      firestoreUpdatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function upsertAgentInFirestore(uid: string, agent: AIAgent): Promise<void> {
  const safeId = sanitizeDocId(agent.id);
  const path = `users/${uid}/agents/${safeId}`;
  const ref = doc(db, 'users', uid, 'agents', safeId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        toFirestoreAgent(uid, agent, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      await updateDoc(ref, {
        enabled: Boolean(agent.enabled),
        strictness: VALID_STRICTNESS.has(agent.strictness) ? agent.strictness : 'balanced',
        thinkingLevel: VALID_THINKING.has(agent.thinkingLevel) ? agent.thinkingLevel : 'MEDIUM',
        systemPrompt: clampNonEmptyStr(
          agent.systemPrompt,
          4000,
          'Review code changes accurately.'
        ),
        focus: clampStr(agent.focus ?? '', 300),
        firestoreUpdatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncAgentStatsInFirestore(uid: string, agent: AIAgent): Promise<void> {
  const safeId = sanitizeDocId(agent.id);
  const path = `users/${uid}/agents/${safeId}`;
  const ref = doc(db, 'users', uid, 'agents', safeId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        toFirestoreAgent(uid, agent, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      await updateDoc(ref, {
        reviewsRun: clampNum(agent.reviewsRun, 0),
        avgFindingsPerPr: clampNum(agent.avgFindingsPerPr, 0),
        firestoreUpdatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function syncAnalysisJobInFirestore(
  uid: string,
  job: RepositoryAnalysisJob
): Promise<void> {
  const safeId = sanitizeDocId(job.id);
  const path = `users/${uid}/analysisJobs/${safeId}`;
  const ref = doc(db, 'users', uid, 'analysisJobs', safeId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        toFirestoreAnalysisJob(uid, job, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      return;
    }

    const existingStatus = String(snap.data()?.status || '');
    if (TERMINAL_JOB_STATUSES.has(existingStatus)) {
      // Terminal state lock enforced by firestore.rules
      return;
    }

    const payload = toFirestoreAnalysisJob(uid, job, {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    delete payload.id;
    delete payload.ownerUid;
    delete payload.repositoryId;
    delete payload.repositoryFullName;
    delete payload.branch;
    delete payload.createdAt;
    delete payload.firestoreCreatedAt;

    await updateDoc(ref, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateWorkspaceSettingsInFirestore(
  uid: string,
  settings: Pick<
    WorkspaceSettings,
    | 'organizationName'
    | 'defaultAgentId'
    | 'defaultModel'
    | 'autoPostPrSummary'
    | 'minimumPassScore'
  >,
  dailyActivity: DailyActivityPoint[]
): Promise<void> {
  const path = `users/${uid}/settings/workspace`;
  const ref = doc(db, 'users', uid, 'settings', 'workspace');

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        toFirestoreWorkspaceSettings(uid, settings, dailyActivity, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      await updateDoc(
        ref,
        stripUndefinedDeep({
          organizationName: clampNonEmptyStr(
            settings.organizationName,
            120,
            'CodeRubric Workspace'
          ),
          defaultAgentId: clampStr(settings.defaultAgentId ?? 'agent-security-sentinel', 128),
          defaultModel: clampStr(settings.defaultModel || 'gemini-4-hydrogen', 80),
          autoPostPrSummary: Boolean(settings.autoPostPrSummary),
          minimumPassScore: clampNum(settings.minimumPassScore, 0, 100, 80),
          dailyActivity: Array.isArray(dailyActivity) ? dailyActivity.slice(-14) : [],
          firestoreUpdatedAt: serverTimestamp(),
        })
      );
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function replaceWorkspaceInFirestore(
  user: User,
  snapshot: FirestoreWorkspaceSnapshot
): Promise<void> {
  const uid = user.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  // 1. Ensure parent /users/{uid} exists before deleting/creating any subcollections
  try {
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(
        userRef,
        toFirestoreUserProfile(user, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }

  // 2. Ensure /users/{uid}/private/account exists
  try {
    const privateRef = doc(db, 'users', uid, 'private', 'account');
    const privateSnap = await getDoc(privateRef);
    if (!privateSnap.exists()) {
      await setDoc(
        privateRef,
        toFirestorePrivateAccount(user, {
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${userPath}/private/account`);
  }

  // 3. Ensure/update /users/{uid}/settings/workspace at canonical path
  await updateWorkspaceSettingsInFirestore(
    uid,
    snapshot.settings,
    snapshot.dailyActivity
  );

  // Clear existing collections before writing updated snapshot
  let reposSnap;
  let reviewsSnap;
  let agentsSnap;
  let jobsSnap;
  try {
    [reposSnap, reviewsSnap, agentsSnap, jobsSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', uid, 'repositories'), where('ownerUid', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'reviews'), where('ownerUid', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'agents'), where('ownerUid', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'analysisJobs'), where('ownerUid', '==', uid))),
    ]);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, userPath);
  }

  const deleteDocsChunked = async (
    docsToDelete: Array<{ ref: ReturnType<typeof doc> }>,
    collectionPath: string
  ): Promise<void> => {
    try {
      for (let i = 0; i < docsToDelete.length; i += 200) {
        const batch = writeBatch(db);
        for (const item of docsToDelete.slice(i, i + 200)) {
          batch.delete(item.ref);
        }
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, collectionPath);
    }
  };

  await deleteDocsChunked(reposSnap.docs, `${userPath}/repositories`);
  await deleteDocsChunked(agentsSnap.docs, `${userPath}/agents`);
  await deleteDocsChunked(reviewsSnap.docs, `${userPath}/reviews`);
  await deleteDocsChunked(jobsSnap.docs, `${userPath}/analysisJobs`);

  // 4. Write repositories (<= 10 per batch)
  if (snapshot.repositories.length > 0) {
    const repoTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    try {
      await commitWriteBatches(
        snapshot.repositories.map((repo) => ({
          ref: doc(db, 'users', uid, 'repositories', sanitizeDocId(repo.id)),
          data: toFirestoreRepository(uid, repo, repoTs),
        }))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${userPath}/repositories`);
    }
  }

  // 5. Write AI agents (<= 10 per batch)
  if (snapshot.agents.length > 0) {
    const agentTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    try {
      await commitWriteBatches(
        snapshot.agents.map((agent) => ({
          ref: doc(db, 'users', uid, 'agents', sanitizeDocId(agent.id)),
          data: toFirestoreAgent(uid, agent, agentTs),
        }))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${userPath}/agents`);
    }
  }

  // 6. Write reviews and analysis jobs (<= 10 per batch)
  if (snapshot.reviews.length > 0) {
    const reviewTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    try {
      await commitWriteBatches(
        snapshot.reviews.map((review) => ({
          ref: doc(db, 'users', uid, 'reviews', sanitizeDocId(review.id)),
          data: toFirestoreReview(uid, review, reviewTs),
        }))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${userPath}/reviews`);
    }
  }

  const jobsToWrite = snapshot.analysisJobs.slice(0, 50);
  if (jobsToWrite.length > 0) {
    const jobTs = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    try {
      await commitWriteBatches(
        jobsToWrite.map((job) => ({
          ref: doc(db, 'users', uid, 'analysisJobs', sanitizeDocId(job.id)),
          data: toFirestoreAnalysisJob(uid, job, jobTs),
        }))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${userPath}/analysisJobs`);
    }
  }
}
