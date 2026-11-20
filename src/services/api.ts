import type {
  AIAgent,
  CodeReview,
  DashboardPayload,
  GitHubAuthStatus,
  GitHubBranchSummary,
  GitHubCommitSummary,
  GitHubContentsResult,
  GitHubPagination,
  GitHubPullRequestSummary,
  GitHubRateLimit,
  GitHubRepositoryDetails,
  GitHubUserRepoSummary,
  Repository,
  RepositoryAnalysisJob,
  ReviewStatus,
  WorkspaceSettings,
} from '../types';

export class ApiError extends Error {
  status: number;
  isPermissionError: boolean;
  isDemo: boolean;

  constructor(
    message: string,
    status: number,
    options?: { isPermissionError?: boolean; isDemo?: boolean }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.isPermissionError = Boolean(options?.isPermissionError);
    this.isDemo = Boolean(options?.isDemo);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    isPermissionError?: boolean;
    isDemo?: boolean;
  } & T;
  if (!response.ok) {
    throw new ApiError(
      data.error || `Request failed with status ${response.status}`,
      response.status,
      {
        isPermissionError: Boolean(data.isPermissionError),
        isDemo: Boolean(data.isDemo),
      }
    );
  }
  return data;
}

export const api = {
  getDashboard: () => requestJson<DashboardPayload>('/api/dashboard'),

  getGitHubAuthStatus: () =>
    requestJson<GitHubAuthStatus>('/api/auth/github/status'),

  getGitHubAuthUrl: () =>
    requestJson<{ url: string }>('/api/auth/github/url'),

  logoutGitHub: () =>
    requestJson<{ ok: boolean }>('/api/auth/github/logout', {
      method: 'POST',
    }),

  getAuthenticatedUserRepos: (params: {
    page?: number;
    perPage?: number;
    visibility?: 'all' | 'public' | 'private';
    q?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.perPage) qs.set('perPage', String(params.perPage));
    if (params.visibility) qs.set('visibility', params.visibility);
    if (params.q) qs.set('q', params.q);
    return requestJson<{
      repositories: GitHubUserRepoSummary[];
      pagination: GitHubPagination;
      rateLimit: GitHubRateLimit | null;
      hasPrivateScope: boolean;
    }>(`/api/github/user/repos?${qs.toString()}`);
  },

  getRepositories: () => requestJson<{ repositories: Repository[] }>('/api/repositories'),

  connectRepository: (repo: string) =>
    requestJson<{ repository: Repository }>('/api/repositories', {
      method: 'POST',
      body: JSON.stringify({ repo }),
    }),

  toggleRepositoryAutoReview: (id: string, autoReviewEnabled: boolean) =>
    requestJson<{ repository: Repository }>(`/api/repositories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ autoReviewEnabled }),
    }),

  deleteRepository: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/repositories/${id}`, {
      method: 'DELETE',
    }),

  getRepositoryDetails: (id: string) =>
    requestJson<{
      isDemo: boolean;
      details: GitHubRepositoryDetails;
      rateLimit: GitHubRateLimit | null;
    }>(`/api/repositories/${id}/details`),

  getRepositoryBranches: (id: string, page = 1, perPage = 15) =>
    requestJson<{
      isDemo: boolean;
      branches: GitHubBranchSummary[];
      pagination: GitHubPagination;
      rateLimit: GitHubRateLimit | null;
    }>(`/api/repositories/${id}/branches?page=${page}&perPage=${perPage}`),

  getRepositoryCommits: (id: string, branch?: string, page = 1, perPage = 15) => {
    const qs = new URLSearchParams({ page: String(page), perPage: String(perPage) });
    if (branch) qs.set('branch', branch);
    return requestJson<{
      isDemo: boolean;
      commits: GitHubCommitSummary[];
      pagination: GitHubPagination;
      rateLimit: GitHubRateLimit | null;
    }>(`/api/repositories/${id}/commits?${qs.toString()}`);
  },

  getRepositoryContents: (id: string, path = '', ref?: string) => {
    const qs = new URLSearchParams();
    if (path) qs.set('path', path);
    if (ref) qs.set('ref', ref);
    return requestJson<GitHubContentsResult>(
      `/api/repositories/${id}/contents?${qs.toString()}`
    );
  },

  getRepositoryPulls: (
    id: string,
    state: 'open' | 'closed' | 'all' = 'open',
    page = 1,
    perPage = 15
  ) =>
    requestJson<{
      isDemo: boolean;
      pulls: GitHubPullRequestSummary[];
      pagination?: GitHubPagination;
      rateLimit?: GitHubRateLimit | null;
    }>(`/api/repositories/${id}/pulls?state=${state}&page=${page}&perPage=${perPage}`),

  getReviews: () => requestJson<{ reviews: CodeReview[] }>('/api/reviews'),

  getReviewById: (id: string) =>
    requestJson<{ review: CodeReview }>(`/api/reviews/${id}`),

  startRepositoryAnalysis: (repoId: string, branch?: string) =>
    requestJson<{ job: RepositoryAnalysisJob }>(
      `/api/repositories/${repoId}/analyze`,
      {
        method: 'POST',
        body: JSON.stringify(branch ? { branch } : {}),
      }
    ),

  getAnalysisJob: (jobId: string) =>
    requestJson<{ job: RepositoryAnalysisJob }>(`/api/analysis-jobs/${jobId}`),

  getRepositoryAnalysisJobs: (repoId: string) =>
    requestJson<{ isDemo: boolean; jobs: RepositoryAnalysisJob[] }>(
      `/api/repositories/${repoId}/analysis-jobs`
    ),

  runReview: (payload: {
    mode: 'github-pr' | 'manual-diff';
    repositoryFullName: string;
    prNumber?: number;
    prTitle?: string;
    branch?: string;
    diffText?: string;
    agentId: string;
  }) =>
    requestJson<{ review: CodeReview }>('/api/reviews/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateReviewStatus: (id: string, status: ReviewStatus) =>
    requestJson<{ review: CodeReview }>(`/api/reviews/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  toggleFindingResolved: (reviewId: string, findingId: string, resolved: boolean) =>
    requestJson<{ review: CodeReview }>(
      `/api/reviews/${reviewId}/findings/${findingId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ resolved }),
      }
    ),

  getAgents: () => requestJson<{ agents: AIAgent[] }>('/api/agents'),

  updateAgent: (
    id: string,
    patch: Partial<
      Pick<AIAgent, 'enabled' | 'strictness' | 'thinkingLevel' | 'systemPrompt' | 'focus'>
    >
  ) =>
    requestJson<{ agent: AIAgent }>(`/api/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  getSettings: () => requestJson<{ settings: WorkspaceSettings }>('/api/settings'),

  updateSettings: (
    patch: Partial<
      Pick<
        WorkspaceSettings,
        'organizationName' | 'defaultAgentId' | 'autoPostPrSummary' | 'minimumPassScore'
      >
    > & { githubToken?: string }
  ) =>
    requestJson<{ settings: WorkspaceSettings }>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  resetDemoData: () =>
    requestJson<{ ok: boolean }>('/api/demo/reset', {
      method: 'POST',
    }),

  hydrateWorkspace: (payload: {
    repositories?: Repository[];
    reviews?: CodeReview[];
    agents?: AIAgent[];
    analysisJobs?: RepositoryAnalysisJob[];
    dailyActivity?: DashboardPayload['dailyActivity'];
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
  }) =>
    requestJson<{
      ok: boolean;
      repositoriesCount: number;
      reviewsCount: number;
    }>('/api/workspace/hydrate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
