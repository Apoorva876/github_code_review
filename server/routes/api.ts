import { Router, type Request, type Response } from 'express';
import {
  redactSensitiveText,
  runGeminiCodeReview,
  toSafeGeminiErrorMessage,
} from '../services/geminiReviewService.ts';
import { getSessionFromRequest } from '../services/githubAuthService.ts';
import {
  collectRepositorySources,
  fetchAuthenticatedUserRepositories,
  fetchGitHubBranches,
  fetchGitHubCommits,
  fetchGitHubContents,
  fetchGitHubPullRequestDiff,
  fetchGitHubPullRequests,
  fetchGitHubRepository,
  fetchGitHubRepositoryDetails,
  GitHubApiError,
  isValidBranchName,
  parseRepoFullName,
} from '../services/githubService.ts';
import {
  startRepositoryAnalysisJob,
  toPublicAnalysisJob,
  verifyRepositoryAccessCached,
  type SourceCollectorFn,
} from '../services/repositoryAnalysisJobService.ts';
import type { RepositoryAnalysisOptions } from '../services/repositoryAnalysisService.ts';
import {
  addRepository,
  addReview,
  getAnalysisJobById,
  getStore,
  hydrateWorkspaceStore,
  listAnalysisJobsForRepository,
  removeRepository,
  resetDemoStore,
  toggleFindingResolved,
  toggleRepositoryAutoReview,
  updateAgent,
  updateReviewStatus,
  updateWorkspaceSettings,
} from '../store.ts';
import type { CodeReview, ReviewStatus } from '../types.ts';

export interface ApiRouterDeps {
  collectorFn?: SourceCollectorFn;
  analysisOptions?: RepositoryAnalysisOptions;
  verifyAccessFn?: typeof verifyRepositoryAccessCached;
}

export function createApiRouter(deps?: ApiRouterDeps): Router {
  const apiRouter = Router();
  const verifyAccess = deps?.verifyAccessFn ?? verifyRepositoryAccessCached;

function resolveGitHubToken(req: Request): string | undefined {
  const session = getSessionFromRequest(req);
  if (session?.accessToken) {
    return session.accessToken;
  }
  const state = getStore();
  return state.githubToken || process.env.GITHUB_TOKEN?.trim() || undefined;
}

function sendGitHubError(res: Response, err: unknown, fallbackMessage: string) {
  if (err instanceof GitHubApiError) {
    return res.status(err.status).json({
      error: redactSensitiveText(err.message),
      isRateLimited: err.isRateLimited,
      isPermissionError: err.isPermissionError,
      rateLimit: err.rateLimit,
    });
  }
  const raw = err instanceof Error ? err.message : fallbackMessage;
  return res.status(502).json({ error: redactSensitiveText(raw) });
}

apiRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'CodeRubric API',
    timestamp: new Date().toISOString(),
  });
});

apiRouter.get('/dashboard', (_req, res) => {
  const state = getStore();
  const reviews = state.reviews;
  const repositories = state.repositories;

  const allFindings = reviews.flatMap((r) => r.findings);
  const openFindings = allFindings.filter((f) => !f.resolved);

  const severityTotals = {
    critical: allFindings.filter((f) => f.severity === 'critical').length,
    high: allFindings.filter((f) => f.severity === 'high').length,
    medium: allFindings.filter((f) => f.severity === 'medium').length,
    low: allFindings.filter((f) => f.severity === 'low').length,
  };

  const meanScore =
    reviews.length > 0
      ? Number((reviews.reduce((sum, r) => sum + r.score, 0) / reviews.length).toFixed(1))
      : 0;

  const totalWeeklyReviews = state.dailyActivity
    .slice(-7)
    .reduce((sum, d) => sum + d.reviews, 0);

  const approvalRate =
    reviews.length > 0
      ? Math.round(
          (reviews.filter((r) => r.status === 'approved').length / reviews.length) * 100
        )
      : 0;

  res.json({
    overview: {
      totalReviews: reviews.length,
      weeklyReviews: totalWeeklyReviews,
      openFindingsCount: openFindings.length,
      criticalOpenCount: openFindings.filter((f) => f.severity === 'critical').length,
      highOpenCount: openFindings.filter((f) => f.severity === 'high').length,
      meanScore,
      connectedReposCount: repositories.length,
      openPrsCount: repositories.reduce((sum, r) => sum + r.openPrsCount, 0),
      approvalRate,
    },
    severityTotals,
    dailyActivity: state.dailyActivity,
    recentReviews: reviews.slice(0, 6),
    repositories: repositories.slice(0, 6),
    activeAgentsCount: state.agents.filter((a) => a.enabled).length,
    hasDemoData: reviews.some((r) => r.isDemo) || repositories.some((r) => r.isDemo),
  });
});

apiRouter.get('/github/user/repos', async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.accessToken) {
    return res.status(401).json({
      error: 'GitHub OAuth authentication required to list your personal and private repositories.',
    });
  }

  try {
    const page = Number(req.query.page ?? 1);
    const perPage = Number(req.query.perPage ?? 12);
    const rawVisibility = String(req.query.visibility ?? 'all');
    const visibility =
      rawVisibility === 'public' || rawVisibility === 'private' ? rawVisibility : 'all';
    const query = String(req.query.q ?? '');

    const result = await fetchAuthenticatedUserRepositories({
      token: session.accessToken,
      page: Number.isFinite(page) ? page : 1,
      perPage: Number.isFinite(perPage) ? perPage : 12,
      visibility,
      query,
    });

    return res.json({
      ...result,
      hasPrivateScope: session.scopes.includes('repo'),
    });
  } catch (err) {
    return sendGitHubError(res, err, 'Failed to fetch authenticated user repositories.');
  }
});

apiRouter.get('/repositories', (_req, res) => {
  const state = getStore();
  res.json({ repositories: state.repositories });
});

apiRouter.post('/repositories', async (req, res) => {
  try {
    const repoInput = String(req.body?.repo ?? '').trim();
    if (!repoInput) {
      return res.status(400).json({ error: 'Repository slug or GitHub URL is required.' });
    }
    const token = resolveGitHubToken(req);
    const repo = await fetchGitHubRepository(repoInput, token);
    const saved = addRepository(repo);
    return res.status(201).json({ repository: saved });
  } catch (err) {
    return sendGitHubError(res, err, 'Failed to connect GitHub repository.');
  }
});

apiRouter.patch('/repositories/:id', (req, res) => {
  const { id } = req.params;
  const autoReviewEnabled = Boolean(req.body?.autoReviewEnabled);
  const updated = toggleRepositoryAutoReview(id, autoReviewEnabled);
  if (!updated) {
    return res.status(404).json({ error: 'Repository not found.' });
  }
  return res.json({ repository: updated });
});

apiRouter.delete('/repositories/:id', (req, res) => {
  const removed = removeRepository(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Repository not found.' });
  }
  return res.json({ ok: true });
});

apiRouter.get('/repositories/:id/details', async (req, res) => {
  const state = getStore();
  const repo = state.repositories.find((r) => r.id === req.params.id);
  if (!repo) {
    return res.status(404).json({ error: 'Repository not found.' });
  }

  if (repo.isDemo) {
    return res.json({
      isDemo: true,
      details: {
        fullName: repo.fullName,
        description: repo.description,
        defaultBranch: repo.defaultBranch,
        isPrivate: false,
        visibility: 'demo',
        stars: repo.stars,
        forks: 0,
        openIssuesCount: repo.openPrsCount,
        htmlUrl: repo.htmlUrl,
        updatedAt: repo.lastReviewedAt,
        languages: [{ name: repo.language, bytes: 100, percentage: 100 }],
      },
      rateLimit: null,
    });
  }

  try {
    const token = resolveGitHubToken(req);
    const result = await fetchGitHubRepositoryDetails(repo.fullName, token);
    return res.json({ isDemo: false, ...result });
  } catch (err) {
    return sendGitHubError(res, err, 'Failed to fetch repository details.');
  }
});

apiRouter.get('/repositories/:id/branches', async (req, res) => {
  const state = getStore();
  const repo = state.repositories.find((r) => r.id === req.params.id);
  if (!repo) {
    return res.status(404).json({ error: 'Repository not found.' });
  }

  if (repo.isDemo) {
    return res.json({
      isDemo: true,
      branches: [],
      pagination: { page: 1, perPage: 15, hasNext: false, hasPrev: false },
      rateLimit: null,
    });
  }

  try {
    const page = Number(req.query.page ?? 1);
    const perPage = Number(req.query.perPage ?? 15);
    const token = resolveGitHubToken(req);
    const result = await fetchGitHubBranches(
      repo.fullName,
      {
        page: Number.isFinite(page) ? page : 1,
        perPage: Number.isFinite(perPage) ? perPage : 15,
      },
      token
    );
    return res.json({ isDemo: false, ...result });
  } catch (err) {
    return sendGitHubError(res, err, 'Failed to fetch branches.');
  }
});

apiRouter.get('/repositories/:id/commits', async (req, res) => {
  const state = getStore();
  const repo = state.repositories.find((r) => r.id === req.params.id);
  if (!repo) {
    return res.status(404).json({ error: 'Repository not found.' });
  }

  if (repo.isDemo) {
    return res.json({
      isDemo: true,
      commits: [],
      pagination: { page: 1, perPage: 15, hasNext: false, hasPrev: false },
      rateLimit: null,
    });
  }

  try {
    const branch = typeof req.query.branch === 'string' ? req.query.branch : undefined;
    const page = Number(req.query.page ?? 1);
    const perPage = Number(req.query.perPage ?? 15);
    const token = resolveGitHubToken(req);
    const result = await fetchGitHubCommits(
      repo.fullName,
      {
        branch,
        page: Number.isFinite(page) ? page : 1,
        perPage: Number.isFinite(perPage) ? perPage : 15,
      },
      token
    );
    return res.json({ isDemo: false, ...result });
  } catch (err) {
    return sendGitHubError(res, err, 'Failed to fetch commits.');
  }
});

apiRouter.get('/repositories/:id/contents', async (req, res) => {
  const state = getStore();
  const repo = state.repositories.find((r) => r.id === req.params.id);
  if (!repo) {
    return res.status(404).json({ error: 'Repository not found.' });
  }

  if (repo.isDemo) {
    return res.status(400).json({
      error:
        'Demo repositories do not have live source trees. Connect a real GitHub repository to browse files and source code.',
      isDemo: true,
    });
  }

  try {
    const filePath = typeof req.query.path === 'string' ? req.query.path : '';
    const ref = typeof req.query.ref === 'string' ? req.query.ref : repo.defaultBranch;
    const token = resolveGitHubToken(req);
    const result = await fetchGitHubContents(
      repo.fullName,
      { path: filePath, ref },
      token
    );
    return res.json({ isDemo: false, ...result });
  } catch (err) {
    return sendGitHubError(res, err, 'Failed to browse repository contents.');
  }
});

apiRouter.post('/repositories/:id/collect', async (req, res) => {
  const session = getSessionFromRequest(req);
  const token = resolveGitHubToken(req);
  if (!token) {
    return res.status(401).json({
      error:
        'GitHub authentication required to collect repository source files. Sign in with GitHub OAuth or configure a server GitHub token.',
    });
  }

  const state = getStore();
  const repo = state.repositories.find((r) => r.id === req.params.id);
  if (!repo) {
    return res.status(404).json({ error: 'Repository not found.' });
  }

  if (repo.isDemo) {
    return res.status(400).json({
      error:
        'Demo repositories do not have live source trees. Connect a real GitHub repository to collect source files.',
      isDemo: true,
    });
  }

  if (
    repo.isPrivate &&
    session &&
    !session.scopes.includes('repo') &&
    !state.githubToken &&
    !process.env.GITHUB_TOKEN
  ) {
    return res.status(403).json({
      error:
        'Insufficient GitHub OAuth scope for private repository collection. Re-authenticate with repo scope.',
      isPermissionError: true,
    });
  }

  if (req.body !== undefined && (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body))) {
    return res.status(400).json({ error: 'Invalid request body. Expected a JSON object.' });
  }

  const rawBodySize = Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf-8');
  if (rawBodySize > 8192) {
    return res.status(413).json({ error: 'Collection request payload exceeds 8 KB limit.' });
  }

  let branch = repo.defaultBranch || 'main';
  if (req.body?.branch !== undefined) {
    if (typeof req.body.branch !== 'string') {
      return res.status(400).json({ error: 'Branch must be a non-empty string.' });
    }
    const trimmedBranch = req.body.branch.trim();
    if (
      !trimmedBranch ||
      trimmedBranch.length > 255 ||
      trimmedBranch.includes('..') ||
      trimmedBranch.startsWith('/') ||
      trimmedBranch.endsWith('/') ||
      !/^[a-zA-Z0-9._/-]+$/.test(trimmedBranch)
    ) {
      return res.status(400).json({ error: 'Invalid branch name.' });
    }
    branch = trimmedBranch;
  }

  const limitsInput = req.body?.limits;
  if (limitsInput !== undefined) {
    if (typeof limitsInput !== 'object' || limitsInput === null || Array.isArray(limitsInput)) {
      return res.status(400).json({ error: 'Limits must be a JSON object.' });
    }
    for (const key of ['maxFiles', 'maxFileSizeBytes', 'maxTotalBytes', 'maxConcurrency'] as const) {
      const val = (limitsInput as Record<string, unknown>)[key];
      if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val) || val <= 0)) {
        return res.status(400).json({ error: `Invalid collection limit: ${key}` });
      }
    }
  }

  try {
    const report = await collectRepositorySources({
      fullName: repo.fullName,
      branch,
      token,
      limits: limitsInput,
    });
    return res.json(report);
  } catch (err) {
    return sendGitHubError(res, err, 'Failed to collect repository source files.');
  }
});

apiRouter.post('/repositories/:id/analyze', async (req, res) => {
  const session = getSessionFromRequest(req);
  const token = resolveGitHubToken(req);
  if (!token) {
    return res.status(401).json({
      error:
        'GitHub authentication required to analyze repository source files. Sign in with GitHub OAuth or configure a server GitHub token.',
    });
  }

  const state = getStore();
  const repo = state.repositories.find((r) => r.id === req.params.id);
  if (!repo) {
    return res.status(404).json({ error: 'Repository not found.' });
  }

  if (repo.isDemo) {
    return res.status(400).json({
      error:
        'Demo repositories do not have live source trees. Connect a real GitHub repository to run a multi-agent analysis.',
      isDemo: true,
    });
  }

  if (
    repo.isPrivate &&
    session &&
    !session.scopes.includes('repo') &&
    !state.githubToken &&
    !process.env.GITHUB_TOKEN
  ) {
    return res.status(403).json({
      error:
        'Insufficient GitHub OAuth scope for private repository analysis. Re-authenticate with repo scope.',
      isPermissionError: true,
    });
  }

  if (
    req.body !== undefined &&
    (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body))
  ) {
    return res.status(400).json({ error: 'Invalid request body. Expected a JSON object.' });
  }

  const rawBodySize = Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf-8');
  if (rawBodySize > 8192) {
    return res.status(413).json({ error: 'Analysis request payload exceeds 8 KB limit.' });
  }

  const bodyObj = (req.body ?? {}) as Record<string, unknown>;
  for (const forbiddenKey of ['repo', 'url', 'repositoryUrl', 'fullName', 'path', 'filePath', 'localPath']) {
    if (bodyObj[forbiddenKey] !== undefined) {
      return res.status(400).json({
        error: `Field "${forbiddenKey}" is not accepted. Specify a connected repository ID in the URL and an optional branch name.`,
      });
    }
  }

  let branch = repo.defaultBranch || 'main';
  if (bodyObj.branch !== undefined) {
    if (typeof bodyObj.branch !== 'string' || !isValidBranchName(bodyObj.branch)) {
      return res.status(400).json({ error: 'Invalid branch name.' });
    }
    branch = bodyObj.branch.trim();
  }

  const enabledAgentsCount = state.agents.filter((a) => a.enabled).length;
  if (enabledAgentsCount === 0) {
    return res.status(400).json({
      error: 'At least one AI reviewer agent must be enabled before starting repository analysis.',
    });
  }

  try {
    const access = await verifyAccess(repo.fullName, token);
    if (
      access.isPrivate &&
      session &&
      !session.scopes.includes('repo') &&
      !state.githubToken &&
      !process.env.GITHUB_TOKEN
    ) {
      return res.status(403).json({
        error:
          'Insufficient GitHub OAuth scope for private repository analysis. Re-authenticate with repo scope.',
        isPermissionError: true,
      });
    }
  } catch (err) {
    return sendGitHubError(res, err, 'Failed to verify GitHub repository access.');
  }

  const job = startRepositoryAnalysisJob({
    repository: repo,
    branch,
    token,
    requestedByUserId: session?.user.id ?? null,
    requestedByLogin: session?.user.login ?? null,
    collectorFn: deps?.collectorFn,
    analysisOptions: deps?.analysisOptions,
  });

  return res.status(202).json({
    job: toPublicAnalysisJob(job),
  });
});

apiRouter.get('/analysis-jobs/:jobId', async (req, res) => {
  const session = getSessionFromRequest(req);
  const token = resolveGitHubToken(req);
  if (!token) {
    return res.status(401).json({
      error: 'GitHub authentication required to view analysis job status.',
    });
  }

  const job = getAnalysisJobById(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Analysis job not found.' });
  }

  // Verify user ownership / repository access; return 404 to avoid leaking existence
  let allowed = true;
  if (job.requestedByUserId !== undefined && job.requestedByUserId !== null) {
    if (!session || session.user.id !== job.requestedByUserId) {
      allowed = false;
    }
  }
  if (allowed) {
    try {
      const access = await verifyAccess(job.repositoryFullName, token);
      if (
        access.isPrivate &&
        session &&
        !session.scopes.includes('repo') &&
        !getStore().githubToken &&
        !process.env.GITHUB_TOKEN
      ) {
        allowed = false;
      }
    } catch {
      allowed = false;
    }
  }

  if (!allowed) {
    return res.status(404).json({ error: 'Analysis job not found.' });
  }

  return res.json({
    job: toPublicAnalysisJob(job),
  });
});

apiRouter.get('/repositories/:id/analysis-jobs', async (req, res) => {
  const session = getSessionFromRequest(req);
  const token = resolveGitHubToken(req);
  if (!token) {
    return res.status(401).json({
      error: 'GitHub authentication required to view repository analysis jobs.',
    });
  }

  const state = getStore();
  const repo = state.repositories.find((r) => r.id === req.params.id);
  if (!repo) {
    return res.status(404).json({ error: 'Repository not found.' });
  }

  if (repo.isDemo) {
    return res.json({ isDemo: true, jobs: [] });
  }

  try {
    const access = await verifyAccess(repo.fullName, token);
    if (
      access.isPrivate &&
      session &&
      !session.scopes.includes('repo') &&
      !state.githubToken &&
      !process.env.GITHUB_TOKEN
    ) {
      return res.status(404).json({ error: 'Repository not found.' });
    }
  } catch {
    return res.status(404).json({ error: 'Repository not found.' });
  }

  const rawJobs = listAnalysisJobsForRepository(repo.id);
  const visibleJobs = rawJobs.filter((job) => {
    if (job.requestedByUserId !== undefined && job.requestedByUserId !== null) {
      return Boolean(session && session.user.id === job.requestedByUserId);
    }
    return true;
  });

  return res.json({
    isDemo: false,
    jobs: visibleJobs.map(toPublicAnalysisJob),
  });
});

apiRouter.get('/repositories/:id/pulls', async (req, res) => {
  const state = getStore();
  const repo = state.repositories.find((r) => r.id === req.params.id);
  if (!repo) {
    return res.status(404).json({ error: 'Repository not found.' });
  }

  if (repo.isDemo) {
    return res.json({
      isDemo: true,
      pulls: [
        {
          number: 421,
          title: 'feat(retry): add exponential jitter to settlement worker',
          state: 'open',
          user: 'mira.chen',
          headRef: 'feat/settlement-jitter',
          baseRef: repo.defaultBranch,
          htmlUrl: repo.htmlUrl,
          createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
        },
        {
          number: 419,
          title: 'fix(auth): validate audience claim before caching session',
          state: 'open',
          user: 'devon.patel',
          headRef: 'fix/aud-claim',
          baseRef: repo.defaultBranch,
          htmlUrl: repo.htmlUrl,
          createdAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        },
      ],
      pagination: { page: 1, perPage: 15, hasNext: false, hasPrev: false },
      rateLimit: null,
    });
  }

  try {
    const rawState = String(req.query.state ?? 'open');
    const prState = rawState === 'closed' || rawState === 'all' ? rawState : 'open';
    const page = Number(req.query.page ?? 1);
    const perPage = Number(req.query.perPage ?? 15);
    const token = resolveGitHubToken(req);

    const result = await fetchGitHubPullRequests(repo.fullName, prState, token, {
      page: Number.isFinite(page) ? page : 1,
      perPage: Number.isFinite(perPage) ? perPage : 15,
    });
    return res.json({ isDemo: false, ...result });
  } catch (err) {
    return sendGitHubError(res, err, 'Failed to fetch pull requests.');
  }
});

apiRouter.get('/reviews', (_req, res) => {
  const state = getStore();
  res.json({ reviews: state.reviews });
});

apiRouter.get('/reviews/:id', (req, res) => {
  const state = getStore();
  const review = state.reviews.find((r) => r.id === req.params.id);
  if (!review) {
    return res.status(404).json({ error: 'Review not found.' });
  }
  return res.json({ review });
});

apiRouter.post('/reviews/run', async (req, res) => {
  const startedAt = Date.now();
  try {
    const state = getStore();
    const token = resolveGitHubToken(req);
    const mode = req.body?.mode === 'github-pr' ? 'github-pr' : 'manual-diff';
    const agentId = String(req.body?.agentId || state.settings.defaultAgentId);
    const agent = state.agents.find((a) => a.id === agentId) ?? state.agents[0];
    if (!agent) {
      return res.status(400).json({ error: 'No AI reviewer agent configured.' });
    }

    let repositoryFullName = String(req.body?.repositoryFullName || 'custom/snippet').trim();
    let prNumber = Number(req.body?.prNumber || 1);
    let prTitle = String(req.body?.prTitle || 'Manual Code Diff Audit').trim();
    let author = String(req.body?.author || 'developer').trim();
    let branch = String(req.body?.branch || 'feature/local-diff').trim();
    let baseBranch = String(req.body?.baseBranch || 'main').trim();
    let diffText = String(req.body?.diffText || '').trim();
    let filesChanged = 1;
    let additions = 0;
    let deletions = 0;
    let prUrl: string | undefined;

    if (mode === 'github-pr') {
      const slug = parseRepoFullName(repositoryFullName);
      if (!Number.isInteger(prNumber) || prNumber <= 0) {
        return res.status(400).json({ error: 'Valid Pull Request number is required.' });
      }
      const prPayload = await fetchGitHubPullRequestDiff(slug, prNumber, token);
      repositoryFullName = slug;
      prTitle = prPayload.title;
      author = prPayload.author;
      branch = prPayload.branch;
      baseBranch = prPayload.baseBranch;
      diffText = prPayload.diffText;
      filesChanged = prPayload.filesChanged;
      additions = prPayload.additions;
      deletions = prPayload.deletions;
      prUrl = prPayload.prUrl;

      // Auto-connect repository if not yet in list
      const existingRepo = state.repositories.find(
        (r) => r.fullName.toLowerCase() === slug.toLowerCase()
      );
      if (!existingRepo) {
        try {
          const ghRepo = await fetchGitHubRepository(slug, token);
          addRepository(ghRepo);
        } catch {
          // Non-fatal if repo metadata call hits rate limit after PR diff succeeded
        }
      }
    } else {
      if (!diffText) {
        return res.status(400).json({ error: 'Code or diff text is required for review.' });
      }
      const lines = diffText.split('\n');
      additions = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length || lines.length;
      deletions = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
    }

    const aiResult = await runGeminiCodeReview({
      repositoryFullName,
      prTitle,
      prNumber,
      diffText,
      agent,
    });

    const matchedRepo = state.repositories.find(
      (r) => r.fullName.toLowerCase() === repositoryFullName.toLowerCase()
    );

    const newReview: CodeReview = {
      id: `rev-live-${Date.now()}`,
      prNumber,
      title: prTitle,
      repositoryId: matchedRepo?.id ?? `repo-custom-${Date.now()}`,
      repositoryFullName,
      branch,
      baseBranch,
      author,
      status: aiResult.recommendedStatus,
      score: aiResult.score,
      summary: aiResult.summary,
      rubricBreakdown: aiResult.rubricBreakdown,
      findings: aiResult.findings,
      agentId: agent.id,
      agentName: agent.name,
      source: mode === 'github-pr' ? 'github-live' : 'manual-diff',
      isDemo: false,
      diffPreview: diffText.slice(0, 6000),
      filesChanged,
      additions,
      deletions,
      prUrl,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };

    const saved = addReview(newReview);
    return res.status(201).json({ review: saved });
  } catch (err) {
    if (err instanceof GitHubApiError) {
      return sendGitHubError(res, err, 'Failed to fetch GitHub pull request diff.');
    }
    const status =
      typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : 500;
    return res.status(status).json({ error: toSafeGeminiErrorMessage(err) });
  }
});

apiRouter.patch('/reviews/:id/status', (req, res) => {
  const status = req.body?.status as ReviewStatus;
  if (status !== 'approved' && status !== 'changes_requested' && status !== 'in_review') {
    return res.status(400).json({ error: 'Invalid review status.' });
  }
  const updated = updateReviewStatus(req.params.id, status);
  if (!updated) {
    return res.status(404).json({ error: 'Review not found.' });
  }
  return res.json({ review: updated });
});

apiRouter.patch('/reviews/:id/findings/:findingId', (req, res) => {
  const resolved = Boolean(req.body?.resolved);
  const updated = toggleFindingResolved(req.params.id, req.params.findingId, resolved);
  if (!updated) {
    return res.status(404).json({ error: 'Review or finding not found.' });
  }
  return res.json({ review: updated });
});

apiRouter.get('/agents', (_req, res) => {
  const state = getStore();
  res.json({ agents: state.agents });
});

apiRouter.patch('/agents/:id', (req, res) => {
  const patch: Record<string, unknown> = {};
  if (typeof req.body?.enabled === 'boolean') patch.enabled = req.body.enabled;
  if (
    req.body?.strictness === 'strict' ||
    req.body?.strictness === 'balanced' ||
    req.body?.strictness === 'advisory'
  ) {
    patch.strictness = req.body.strictness;
  }
  if (
    req.body?.thinkingLevel === 'LOW' ||
    req.body?.thinkingLevel === 'MEDIUM' ||
    req.body?.thinkingLevel === 'HIGH'
  ) {
    patch.thinkingLevel = req.body.thinkingLevel;
  }
  if (typeof req.body?.systemPrompt === 'string' && req.body.systemPrompt.trim()) {
    patch.systemPrompt = req.body.systemPrompt.trim();
  }
  if (typeof req.body?.focus === 'string' && req.body.focus.trim()) {
    patch.focus = req.body.focus.trim();
  }

  const updated = updateAgent(req.params.id, patch);
  if (!updated) {
    return res.status(404).json({ error: 'Agent not found.' });
  }
  return res.json({ agent: updated });
});

apiRouter.get('/settings', (_req, res) => {
  const state = getStore();
  res.json({ settings: state.settings });
});

apiRouter.patch('/settings', (req, res) => {
  const patch: Record<string, unknown> = {};
  if (typeof req.body?.organizationName === 'string' && req.body.organizationName.trim()) {
    patch.organizationName = req.body.organizationName.trim();
  }
  if (typeof req.body?.defaultAgentId === 'string') {
    patch.defaultAgentId = req.body.defaultAgentId;
  }
  if (typeof req.body?.autoPostPrSummary === 'boolean') {
    patch.autoPostPrSummary = req.body.autoPostPrSummary;
  }
  if (typeof req.body?.minimumPassScore === 'number') {
    patch.minimumPassScore = Math.max(0, Math.min(100, Math.round(req.body.minimumPassScore)));
  }
  if (typeof req.body?.githubToken === 'string') {
    patch.githubToken = req.body.githubToken;
  }
  const settings = updateWorkspaceSettings(patch);
  return res.json({ settings });
});

apiRouter.post('/demo/reset', (_req, res) => {
  const state = resetDemoStore();
  return res.json({
    ok: true,
    repositoriesCount: state.repositories.length,
    reviewsCount: state.reviews.length,
  });
});

apiRouter.post('/workspace/hydrate', (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Invalid workspace hydration payload.' });
  }
  const body = req.body as Record<string, unknown>;
  const storageMode =
    body.storageMode === 'firebase-firestore' || body.storageMode === 'local-json'
      ? body.storageMode
      : undefined;

  const state = hydrateWorkspaceStore({
    repositories: Array.isArray(body.repositories) ? body.repositories : undefined,
    reviews: Array.isArray(body.reviews) ? body.reviews : undefined,
    agents: Array.isArray(body.agents) ? body.agents : undefined,
    dailyActivity: Array.isArray(body.dailyActivity) ? body.dailyActivity : undefined,
    analysisJobs: Array.isArray(body.analysisJobs) ? body.analysisJobs : undefined,
    settings:
      body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
        ? (body.settings as Record<string, unknown>)
        : undefined,
    storageMode,
  });

  return res.json({
    ok: true,
    repositoriesCount: state.repositories.length,
    reviewsCount: state.reviews.length,
  });
});

  return apiRouter;
}

export const apiRouter = createApiRouter();
