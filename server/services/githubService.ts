import type {
  CollectedSourceFile,
  IntelligenceFileStatus,
  IntelligenceTreeNode,
  Repository,
  RepositoryCollectionLimits,
  RepositoryCollectionReport,
  RepositoryIntelligenceCollectionBundle,
} from '../types.ts';

const GITHUB_API_BASE = 'https://api.github.com';

export interface GitHubRateLimit {
  limit: number;
  remaining: number;
  resetAt: string | null;
}

export interface GitHubPagination {
  page: number;
  perPage: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export class GitHubApiError extends Error {
  status: number;
  isRateLimited: boolean;
  isPermissionError: boolean;
  rateLimit: GitHubRateLimit | null;

  constructor(
    message: string,
    status: number,
    options?: {
      isRateLimited?: boolean;
      isPermissionError?: boolean;
      rateLimit?: GitHubRateLimit | null;
    }
  ) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.isRateLimited = Boolean(options?.isRateLimited);
    this.isPermissionError = Boolean(options?.isPermissionError);
    this.rateLimit = options?.rateLimit ?? null;
  }
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  state: string;
  user: string;
  headRef: string;
  baseRef: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
}

export interface GitHubPullRequestDiffPayload {
  prNumber: number;
  title: string;
  author: string;
  branch: string;
  baseBranch: string;
  prUrl: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  diffText: string;
}

export interface GitHubBranchSummary {
  name: string;
  commitSha: string;
  protected: boolean;
}

export interface GitHubCommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authorLogin: string | null;
  date: string;
  htmlUrl: string;
}

export interface GitHubLanguageEntry {
  name: string;
  bytes: number;
  percentage: number;
}

export interface GitHubRepositoryDetails {
  fullName: string;
  description: string;
  defaultBranch: string;
  isPrivate: boolean;
  visibility: string;
  stars: number;
  forks: number;
  openIssuesCount: number;
  htmlUrl: string;
  updatedAt: string;
  languages: GitHubLanguageEntry[];
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export interface GitHubDirectoryEntry {
  name: string;
  path: string;
  type: 'dir' | 'file' | 'submodule' | 'symlink';
  size: number;
  sha: string;
}

export interface GitHubContentsResult {
  kind: 'dir' | 'file';
  path: string;
  ref: string;
  entries?: GitHubDirectoryEntry[];
  file?: {
    name: string;
    path: string;
    size: number;
    sha: string;
    encoding: string;
    content: string;
    isBinary: boolean;
    truncated: boolean;
    htmlUrl: string;
  };
  rateLimit: GitHubRateLimit | null;
}

export interface GitHubUserRepoSummary {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  description: string;
  language: string;
  defaultBranch: string;
  isPrivate: boolean;
  stars: number;
  forks: number;
  openIssuesCount: number;
  updatedAt: string;
  htmlUrl: string;
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CodeRubric-AI-Reviewer',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const resolvedToken = token || process.env.GITHUB_TOKEN;
  if (resolvedToken) {
    headers.Authorization = `Bearer ${resolvedToken}`;
  }
  return headers;
}

function extractRateLimit(headers: Headers): GitHubRateLimit | null {
  const limitRaw = headers.get('x-ratelimit-limit');
  const remainingRaw = headers.get('x-ratelimit-remaining');
  const resetRaw = headers.get('x-ratelimit-reset');
  if (!limitRaw || !remainingRaw) return null;
  const limit = Number(limitRaw);
  const remaining = Number(remainingRaw);
  const resetSec = Number(resetRaw);
  return {
    limit: Number.isFinite(limit) ? limit : 0,
    remaining: Number.isFinite(remaining) ? remaining : 0,
    resetAt:
      Number.isFinite(resetSec) && resetSec > 0
        ? new Date(resetSec * 1000).toISOString()
        : null,
  };
}

function parseLinkHeader(
  linkHeader: string | null,
  page: number,
  perPage: number
): GitHubPagination {
  const hasNext = Boolean(linkHeader && /rel="next"/.test(linkHeader));
  const hasPrev = page > 1 || Boolean(linkHeader && /rel="prev"/.test(linkHeader));
  return {
    page,
    perPage,
    hasNext,
    hasPrev,
  };
}

async function githubFetchWithMeta<T>(
  url: string,
  token?: string,
  pageInfo?: { page: number; perPage: number }
): Promise<{
  data: T;
  rateLimit: GitHubRateLimit | null;
  pagination: GitHubPagination;
}> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: buildHeaders(token),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network failure';
    throw new GitHubApiError(
      `Network error reaching GitHub API: ${detail}`,
      503
    );
  }

  const rateLimit = extractRateLimit(response.headers);
  const page = pageInfo?.page ?? 1;
  const perPage = pageInfo?.perPage ?? 30;
  const pagination = parseLinkHeader(response.headers.get('link'), page, perPage);

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    let apiMessage = '';
    try {
      const parsed = JSON.parse(bodyText) as { message?: string };
      apiMessage = parsed.message || '';
    } catch {
      apiMessage = bodyText.slice(0, 160);
    }

    const isRateLimited =
      response.status === 429 ||
      (response.status === 403 &&
        (rateLimit?.remaining === 0 || /rate limit/i.test(apiMessage)));

    const isPermissionError =
      response.status === 401 ||
      (response.status === 403 && !isRateLimited);

    let friendly = `GitHub API (${response.status})${apiMessage ? `: ${apiMessage}` : ''}`;
    if (isRateLimited) {
      const resetHint = rateLimit?.resetAt
        ? ` Resets at ${new Date(rateLimit.resetAt).toLocaleTimeString()}.`
        : '';
      friendly = `GitHub API rate limit exceeded.${resetHint} Sign in with GitHub OAuth or configure a personal access token to increase your quota.`;
    } else if (response.status === 401) {
      friendly = 'GitHub authentication expired or invalid. Please sign in with GitHub again.';
    } else if (response.status === 403) {
      friendly = `Insufficient GitHub permissions for this resource${apiMessage ? ` (${apiMessage})` : ''}. Ensure your OAuth grant includes the repo scope for private repositories.`;
    } else if (response.status === 404) {
      friendly =
        'Repository, branch, or path not found on GitHub (or it is private and requires GitHub authentication).';
    }

    throw new GitHubApiError(friendly, response.status, {
      isRateLimited,
      isPermissionError,
      rateLimit,
    });
  }

  const data = (await response.json()) as T;
  return { data, rateLimit, pagination };
}

export function parseRepoFullName(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed) || /^(?:www\.)?github\.com\//i.test(trimmed)) {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new GitHubApiError(
        'Enter a valid GitHub repository URL (e.g. https://github.com/owner/repository).',
        400
      );
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') {
      throw new GitHubApiError(
        'Only github.com repository URLs are supported (e.g. https://github.com/owner/repository).',
        400
      );
    }
    const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (segments.length >= 2) {
      const owner = segments[0];
      const repo = segments[1].replace(/\.git$/i, '');
      if (
        /^[a-zA-Z0-9_.-]+$/.test(owner) &&
        /^[a-zA-Z0-9_.-]+$/.test(repo) &&
        repo !== '.' &&
        repo !== '..'
      ) {
        return `${owner}/${repo}`;
      }
    }
    throw new GitHubApiError(
      'Enter a valid GitHub repository URL (e.g. https://github.com/owner/repository).',
      400
    );
  }
  const slugMatch = trimmed.match(/^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)$/);
  if (slugMatch) {
    return slugMatch[1].replace(/\.git$/i, '');
  }
  throw new GitHubApiError(
    'Enter a valid GitHub repository slug (e.g. expressjs/express) or GitHub URL.',
    400
  );
}

export async function fetchAuthenticatedUserRepositories(params: {
  token: string;
  page?: number;
  perPage?: number;
  visibility?: 'all' | 'public' | 'private';
  query?: string;
}): Promise<{
  repositories: GitHubUserRepoSummary[];
  pagination: GitHubPagination;
  rateLimit: GitHubRateLimit | null;
}> {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(50, Math.max(5, params.perPage ?? 12));
  const visibility = params.visibility ?? 'all';
  const queryText = params.query?.trim() ?? '';

  interface RawUserRepo {
    id: number;
    full_name: string;
    owner: { login: string };
    name: string;
    description: string | null;
    language: string | null;
    default_branch: string;
    private: boolean;
    stargazers_count: number;
    forks_count: number;
    open_issues_count: number;
    updated_at: string;
    html_url: string;
    permissions?: {
      admin: boolean;
      push: boolean;
      pull: boolean;
    };
  }

  // If user typed a search filter, fetch a larger page or filter cleanly
  const effectivePerPage = queryText ? 50 : perPage;
  const effectivePage = queryText ? 1 : page;

  const url = `${GITHUB_API_BASE}/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&visibility=${visibility}&per_page=${effectivePerPage}&page=${effectivePage}`;

  const { data, pagination, rateLimit } = await githubFetchWithMeta<RawUserRepo[]>(
    url,
    params.token,
    { page: effectivePage, perPage: effectivePerPage }
  );

  let mapped: GitHubUserRepoSummary[] = data.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    owner: r.owner.login,
    name: r.name,
    description: r.description || '',
    language: r.language || 'Unknown',
    defaultBranch: r.default_branch || 'main',
    isPrivate: Boolean(r.private),
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    openIssuesCount: r.open_issues_count ?? 0,
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
    permissions: r.permissions,
  }));

  if (queryText) {
    const qLower = queryText.toLowerCase();
    mapped = mapped.filter(
      (r) =>
        r.fullName.toLowerCase().includes(qLower) ||
        r.description.toLowerCase().includes(qLower) ||
        r.language.toLowerCase().includes(qLower)
    );
  }

  return {
    repositories: mapped,
    pagination: queryText
      ? { page: 1, perPage: mapped.length || perPage, hasNext: false, hasPrev: false }
      : pagination,
    rateLimit,
  };
}

export async function fetchGitHubRepository(
  rawInput: string,
  token?: string
): Promise<Repository> {
  const fullName = parseRepoFullName(rawInput);

  interface RawRepoResponse {
    id: number;
    full_name: string;
    owner: { login: string };
    name: string;
    description: string | null;
    language: string | null;
    default_branch: string;
    private: boolean;
    stargazers_count: number;
    forks_count: number;
    open_issues_count: number;
    html_url: string;
    pushed_at: string;
  }

  const { data: repoData } = await githubFetchWithMeta<RawRepoResponse>(
    `${GITHUB_API_BASE}/repos/${fullName}`,
    token
  );

  // Fetch open PRs count and last 7 days commit activity in parallel
  const [openPrsRes, commitsRes] = await Promise.all([
    githubFetchWithMeta<Array<{ number: number }>>(
      `${GITHUB_API_BASE}/repos/${fullName}/pulls?state=open&per_page=30`,
      token
    ).catch(() => ({ data: [] as Array<{ number: number }> })),
    githubFetchWithMeta<Array<{ commit: { author?: { date?: string } } }>>(
      `${GITHUB_API_BASE}/repos/${fullName}/commits?per_page=40`,
      token
    ).catch(() => ({ data: [] as Array<{ commit: { author?: { date?: string } } }> })),
  ]);

  const activitySeries = [0, 0, 0, 0, 0, 0, 0];
  const nowMs = Date.now();
  for (const item of commitsRes.data) {
    const dateStr = item.commit?.author?.date;
    if (!dateStr) continue;
    const diffDays = Math.floor((nowMs - new Date(dateStr).getTime()) / (24 * 3600 * 1000));
    if (diffDays >= 0 && diffDays < 7) {
      activitySeries[6 - diffDays] += 1;
    }
  }

  return {
    id: `repo-gh-${repoData.id}`,
    fullName: repoData.full_name,
    owner: repoData.owner.login,
    name: repoData.name,
    description: repoData.description || 'Connected GitHub repository.',
    language: repoData.language || 'Unknown',
    defaultBranch: repoData.default_branch || 'main',
    stars: repoData.stargazers_count ?? 0,
    forks: repoData.forks_count ?? 0,
    openPrsCount: openPrsRes.data.length,
    lastReviewedAt: repoData.pushed_at || new Date().toISOString(),
    healthScore: 85,
    isDemo: false,
    isPrivate: Boolean(repoData.private),
    autoReviewEnabled: true,
    htmlUrl: repoData.html_url,
    activitySeries,
  };
}

export async function fetchGitHubRepositoryDetails(
  fullName: string,
  token?: string
): Promise<{
  details: GitHubRepositoryDetails;
  rateLimit: GitHubRateLimit | null;
}> {
  interface RawRepoFull {
    full_name: string;
    description: string | null;
    default_branch: string;
    private: boolean;
    visibility?: string;
    stargazers_count: number;
    forks_count: number;
    open_issues_count: number;
    html_url: string;
    updated_at: string;
    permissions?: {
      admin: boolean;
      push: boolean;
      pull: boolean;
    };
  }

  const [repoRes, langRes] = await Promise.all([
    githubFetchWithMeta<RawRepoFull>(`${GITHUB_API_BASE}/repos/${fullName}`, token),
    githubFetchWithMeta<Record<string, number>>(
      `${GITHUB_API_BASE}/repos/${fullName}/languages`,
      token
    ).catch(() => ({ data: {} as Record<string, number>, rateLimit: null })),
  ]);

  const totalBytes = Object.values(langRes.data).reduce((sum, n) => sum + n, 0) || 1;
  const languages: GitHubLanguageEntry[] = Object.entries(langRes.data)
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes]) => ({
      name,
      bytes,
      percentage: Number(((bytes / totalBytes) * 100).toFixed(1)),
    }));

  return {
    details: {
      fullName: repoRes.data.full_name,
      description: repoRes.data.description || '',
      defaultBranch: repoRes.data.default_branch || 'main',
      isPrivate: Boolean(repoRes.data.private),
      visibility:
        repoRes.data.visibility || (repoRes.data.private ? 'private' : 'public'),
      stars: repoRes.data.stargazers_count ?? 0,
      forks: repoRes.data.forks_count ?? 0,
      openIssuesCount: repoRes.data.open_issues_count ?? 0,
      htmlUrl: repoRes.data.html_url,
      updatedAt: repoRes.data.updated_at,
      languages,
      permissions: repoRes.data.permissions,
    },
    rateLimit: repoRes.rateLimit,
  };
}

export async function fetchGitHubBranches(
  fullName: string,
  options?: { page?: number; perPage?: number },
  token?: string
): Promise<{
  branches: GitHubBranchSummary[];
  pagination: GitHubPagination;
  rateLimit: GitHubRateLimit | null;
}> {
  const page = Math.max(1, options?.page ?? 1);
  const perPage = Math.min(50, Math.max(5, options?.perPage ?? 15));

  interface RawBranch {
    name: string;
    commit: { sha: string };
    protected: boolean;
  }

  const { data, pagination, rateLimit } = await githubFetchWithMeta<RawBranch[]>(
    `${GITHUB_API_BASE}/repos/${fullName}/branches?per_page=${perPage}&page=${page}`,
    token,
    { page, perPage }
  );

  return {
    branches: data.map((b) => ({
      name: b.name,
      commitSha: b.commit.sha,
      protected: Boolean(b.protected),
    })),
    pagination,
    rateLimit,
  };
}

export async function fetchGitHubCommits(
  fullName: string,
  options?: { branch?: string; page?: number; perPage?: number },
  token?: string
): Promise<{
  commits: GitHubCommitSummary[];
  pagination: GitHubPagination;
  rateLimit: GitHubRateLimit | null;
}> {
  const page = Math.max(1, options?.page ?? 1);
  const perPage = Math.min(50, Math.max(5, options?.perPage ?? 15));
  const shaParam = options?.branch ? `&sha=${encodeURIComponent(options.branch)}` : '';

  interface RawCommit {
    sha: string;
    html_url: string;
    commit: {
      message: string;
      author?: { name?: string; date?: string };
    };
    author?: { login?: string } | null;
  }

  const { data, pagination, rateLimit } = await githubFetchWithMeta<RawCommit[]>(
    `${GITHUB_API_BASE}/repos/${fullName}/commits?per_page=${perPage}&page=${page}${shaParam}`,
    token,
    { page, perPage }
  );

  return {
    commits: data.map((c) => ({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0] || '(no message)',
      authorName: c.commit.author?.name || c.author?.login || 'Unknown',
      authorLogin: c.author?.login ?? null,
      date: c.commit.author?.date || '',
      htmlUrl: c.html_url,
    })),
    pagination,
    rateLimit,
  };
}

export async function fetchGitHubPullRequests(
  fullName: string,
  state: 'open' | 'closed' | 'all' = 'open',
  token?: string,
  options?: { page?: number; perPage?: number }
): Promise<{
  pulls: GitHubPullRequestSummary[];
  pagination: GitHubPagination;
  rateLimit: GitHubRateLimit | null;
}> {
  const page = Math.max(1, options?.page ?? 1);
  const perPage = Math.min(50, Math.max(5, options?.perPage ?? 15));

  interface RawPrItem {
    number: number;
    title: string;
    state: string;
    user: { login: string } | null;
    head: { ref: string };
    base: { ref: string };
    html_url: string;
    created_at: string;
    updated_at: string;
  }

  const { data, pagination, rateLimit } = await githubFetchWithMeta<RawPrItem[]>(
    `${GITHUB_API_BASE}/repos/${fullName}/pulls?state=${state}&per_page=${perPage}&page=${page}`,
    token,
    { page, perPage }
  );

  return {
    pulls: data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      user: pr.user?.login ?? 'unknown',
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      htmlUrl: pr.html_url,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
    })),
    pagination,
    rateLimit,
  };
}

export async function fetchGitHubContents(
  fullName: string,
  options?: { path?: string; ref?: string },
  token?: string
): Promise<GitHubContentsResult> {
  const cleanPath = (options?.path ?? '').replace(/^\/+|\/+$/g, '');
  const encodedPath = cleanPath
    ? cleanPath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
    : '';
  const ref = options?.ref?.trim() || '';
  const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const url = `${GITHUB_API_BASE}/repos/${fullName}/contents${encodedPath ? `/${encodedPath}` : ''}${refQuery}`;

  interface RawContentEntry {
    name: string;
    path: string;
    type: 'dir' | 'file' | 'submodule' | 'symlink';
    size: number;
    sha: string;
    encoding?: string;
    content?: string;
    html_url?: string;
    download_url?: string | null;
  }

  const { data, rateLimit } = await githubFetchWithMeta<RawContentEntry | RawContentEntry[]>(
    url,
    token
  );

  if (Array.isArray(data)) {
    const entries: GitHubDirectoryEntry[] = data
      .map((item) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size ?? 0,
        sha: item.sha,
      }))
      .sort((a, b) => {
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });

    return {
      kind: 'dir',
      path: cleanPath,
      ref,
      entries,
      rateLimit,
    };
  }

  // Single file handling with proper Base64 -> UTF-8 decoding & binary safety
  const maxRenderBytes = 350 * 1024;
  let decodedText = '';
  let isBinary = false;
  let truncated = false;

  if (data.size > maxRenderBytes) {
    truncated = true;
    decodedText = `File is ${(data.size / 1024).toFixed(1)} KB, which exceeds the 350 KB inline preview limit.`;
  } else if (data.encoding === 'base64' && typeof data.content === 'string') {
    const buffer = Buffer.from(data.content.replace(/\n/g, ''), 'base64');
    // Check first 4096 bytes for null byte indicating binary content
    const sampleEnd = Math.min(buffer.length, 4096);
    for (let i = 0; i < sampleEnd; i += 1) {
      if (buffer[i] === 0) {
        isBinary = true;
        break;
      }
    }
    if (!isBinary) {
      decodedText = buffer.toString('utf-8');
    }
  } else if (data.download_url && data.size <= maxRenderBytes) {
    // Fallback for files where GitHub omits inline content
    const rawRes = await fetch(data.download_url, {
      headers: buildHeaders(token),
    });
    if (rawRes.ok) {
      const arrayBuf = await rawRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const sampleEnd = Math.min(buffer.length, 4096);
      for (let i = 0; i < sampleEnd; i += 1) {
        if (buffer[i] === 0) {
          isBinary = true;
          break;
        }
      }
      if (!isBinary) {
        decodedText = buffer.toString('utf-8');
      }
    }
  }

  return {
    kind: 'file',
    path: data.path,
    ref,
    file: {
      name: data.name,
      path: data.path,
      size: data.size ?? 0,
      sha: data.sha,
      encoding: data.encoding || 'utf-8',
      content: decodedText,
      isBinary,
      truncated,
      htmlUrl: data.html_url || '',
    },
    rateLimit,
  };
}

export async function fetchGitHubPullRequestDiff(
  fullName: string,
  prNumber: number,
  token?: string
): Promise<GitHubPullRequestDiffPayload> {
  interface RawPrDetail {
    number: number;
    title: string;
    user: { login: string } | null;
    head: { ref: string };
    base: { ref: string };
    html_url: string;
    changed_files: number;
    additions: number;
    deletions: number;
  }

  interface RawPrFile {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }

  const [prDetailRes, prFilesRes] = await Promise.all([
    githubFetchWithMeta<RawPrDetail>(
      `${GITHUB_API_BASE}/repos/${fullName}/pulls/${prNumber}`,
      token
    ),
    githubFetchWithMeta<RawPrFile[]>(
      `${GITHUB_API_BASE}/repos/${fullName}/pulls/${prNumber}/files?per_page=25`,
      token
    ),
  ]);

  const prDetail = prDetailRes.data;
  const prFiles = prFilesRes.data;

  const assembledDiff = prFiles
    .map((file) => {
      const patch = file.patch ?? '(binary or large patch omitted by GitHub API)';
      return `diff --git a/${file.filename} b/${file.filename}\n--- a/${file.filename}\n+++ b/${file.filename}\n${patch}`;
    })
    .join('\n\n');

  const truncatedDiff =
    assembledDiff.length > 18000
      ? `${assembledDiff.slice(0, 18000)}\n\n... [truncated remaining diff for token budget]`
      : assembledDiff;

  return {
    prNumber: prDetail.number,
    title: prDetail.title,
    author: prDetail.user?.login ?? 'unknown',
    branch: prDetail.head.ref,
    baseBranch: prDetail.base.ref,
    prUrl: prDetail.html_url,
    filesChanged: prDetail.changed_files ?? prFiles.length,
    additions: prDetail.additions ?? 0,
    deletions: prDetail.deletions ?? 0,
    diffText: truncatedDiff || '(no textual diff returned for this pull request)',
  };
}

export const DEFAULT_COLLECTION_LIMITS: RepositoryCollectionLimits = {
  maxFiles: 150,
  maxFileSizeBytes: 100 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxConcurrency: 5,
};

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.venv',
  'venv',
  'target',
  'bin',
  'obj',
  '.gradle',
  '.idea',
  '.vscode',
  'tmp',
  'temp',
  '.parcel-cache',
  '.output',
]);

const IGNORED_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'gemfile.lock',
  'poetry.lock',
  'composer.lock',
  'podfile.lock',
  'go.sum',
  'flake.lock',
  '.ds_store',
  'thumbs.db',
]);

const IGNORED_BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.tiff',
  '.avif',
  '.mp4',
  '.mov',
  '.avi',
  '.webm',
  '.mkv',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.rar',
  '.7z',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.wasm',
  '.class',
  '.jar',
  '.pyc',
  '.pyo',
  '.o',
  '.a',
  '.lib',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.lock',
]);

const ELIGIBLE_EXTENSION_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TSX',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JSX',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.pyi': 'Python',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.scala': 'Scala',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++',
  '.hh': 'C++',
  '.cs': 'C#',
  '.go': 'Go',
  '.rs': 'Rust',
  '.php': 'PHP',
  '.rb': 'Ruby',
  '.rake': 'Ruby',
  '.gemspec': 'Ruby',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.astro': 'Astro',
  '.sql': 'SQL',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.ini': 'INI',
  '.conf': 'Config',
  '.xml': 'XML',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.prisma': 'Prisma',
  '.proto': 'Protobuf',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.ps1': 'PowerShell',
  '.tf': 'Terraform',
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.rst': 'reStructuredText',
  '.txt': 'Text',
};

const ELIGIBLE_EXACT_FILENAMES: Record<string, string> = {
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  procfile: 'Procfile',
  gemfile: 'Ruby',
  rakefile: 'Ruby',
  justfile: 'Just',
  '.env.example': 'Env',
  '.gitignore': 'Git',
  '.eslintrc': 'JSON',
  '.prettierrc': 'JSON',
  '.nvmrc': 'Config',
  '.node-version': 'Config',
  '.python-version': 'Config',
  readme: 'Markdown',
};

const MANIFEST_AND_CONFIG_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'gemfile',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env.example',
  'makefile',
  'schema.prisma',
]);

function getExtension(filePath: string): string {
  const base = filePath.split('/').pop() || '';
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx <= 0) return '';
  return base.slice(dotIdx).toLowerCase();
}

export function isIgnoredRepoPath(filePath: string): boolean {
  const normalized = filePath.replace(/^\/+/, '');
  const segments = normalized.split('/');
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (IGNORED_DIRECTORIES.has(segments[i].toLowerCase())) {
      return true;
    }
  }
  const fileName = (segments[segments.length - 1] || '').toLowerCase();
  if (!fileName) return true;
  if (IGNORED_FILENAMES.has(fileName)) return true;

  if (
    fileName.endsWith('.min.js') ||
    fileName.endsWith('.min.mjs') ||
    fileName.endsWith('.min.cjs') ||
    fileName.endsWith('.min.css') ||
    fileName.endsWith('.bundle.js') ||
    fileName.endsWith('.chunk.js') ||
    fileName.endsWith('.map') ||
    fileName.endsWith('.generated.ts') ||
    fileName.endsWith('.generated.js') ||
    fileName.endsWith('.pb.go')
  ) {
    return true;
  }

  const ext = getExtension(fileName);
  if (ext && IGNORED_BINARY_EXTENSIONS.has(ext)) {
    return true;
  }

  return false;
}

export function detectSourceLanguage(filePath: string): string | null {
  if (isIgnoredRepoPath(filePath)) return null;
  const fileName = (filePath.split('/').pop() || '').toLowerCase();
  if (ELIGIBLE_EXACT_FILENAMES[fileName]) {
    return ELIGIBLE_EXACT_FILENAMES[fileName];
  }
  if (fileName.startsWith('readme.')) {
    return 'Markdown';
  }
  if (fileName.startsWith('dockerfile.')) {
    return 'Dockerfile';
  }
  const ext = getExtension(fileName);
  return ELIGIBLE_EXTENSION_LANGUAGE[ext] ?? null;
}

export function computeSourceFilePriority(filePath: string): number {
  const lower = filePath.toLowerCase();
  const segments = lower.split('/');
  const fileName = segments[segments.length - 1] || '';

  // 1. Project manifests & configuration
  if (
    MANIFEST_AND_CONFIG_NAMES.has(fileName) ||
    fileName.startsWith('tsconfig.') ||
    fileName.startsWith('vite.config.') ||
    fileName.startsWith('next.config.') ||
    fileName.startsWith('drizzle.config.') ||
    fileName.startsWith('eslint.config.') ||
    fileName.startsWith('tailwind.config.') ||
    (segments.length === 1 &&
      (fileName.endsWith('.json') ||
        fileName.endsWith('.yml') ||
        fileName.endsWith('.yaml') ||
        fileName.endsWith('.toml')))
  ) {
    return 1;
  }

  // 6. Tests & documentation (checked before generic src/ folder so tests inside src/ sort after prod code)
  if (
    segments.some(
      (seg) =>
        seg === 'test' ||
        seg === 'tests' ||
        seg === '__tests__' ||
        seg === 'spec' ||
        seg === 'docs'
    ) ||
    /(\.test\.|\.spec\.|_test\.)/i.test(fileName) ||
    fileName.startsWith('readme') ||
    fileName.endsWith('.md') ||
    fileName.endsWith('.mdx') ||
    fileName.endsWith('.rst') ||
    fileName.endsWith('.txt')
  ) {
    return 6;
  }

  // 2. Application entry points
  if (
    /^(main|index|app|server|manage)\.[^.]+$/.test(fileName) &&
    segments.length <= 3
  ) {
    return 2;
  }

  // 3. API routes, services, models, controllers, middleware
  if (
    segments.some((seg) =>
      [
        'routes',
        'route',
        'controllers',
        'controller',
        'services',
        'service',
        'models',
        'model',
        'handlers',
        'handler',
        'middleware',
        'middlewares',
        'api',
        'schemas',
        'schema',
        'repositories',
        'resolvers',
      ].includes(seg)
    )
  ) {
    return 3;
  }

  // 4. Core source directories
  if (
    segments.some((seg) =>
      [
        'src',
        'app',
        'server',
        'backend',
        'frontend',
        'lib',
        'pkg',
        'internal',
        'cmd',
        'components',
        'hooks',
        'utils',
        'modules',
        'domain',
      ].includes(seg)
    )
  ) {
    return 4;
  }

  // 5. Remaining source/config files
  return 5;
}

export function formatLineNumberedSource(
  filePath: string,
  rawContent: string
): { formatted: string; lineCount: number } {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const effectiveLines =
    lines.length > 1 && normalized.endsWith('\n') ? lines.slice(0, -1) : lines;
  const numbered = effectiveLines
    .map((line, index) => `[${index + 1}] ${line}`)
    .join('\n');
  return {
    formatted: `FILE: ${filePath}\n${numbered}`,
    lineCount: effectiveLines.length,
  };
}

function truncateLineNumberedToByteLimit(
  filePath: string,
  rawContent: string,
  maxBytes: number
): { formatted: string; lineCount: number } {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const effectiveLines =
    lines.length > 1 && normalized.endsWith('\n') ? lines.slice(0, -1) : lines;

  const header = `FILE: ${filePath}\n`;
  let totalBytes = Buffer.byteLength(header, 'utf-8');
  const keptLines: string[] = [];

  for (let i = 0; i < effectiveLines.length; i += 1) {
    const lineText = `${keptLines.length > 0 ? '\n' : ''}[${i + 1}] ${effectiveLines[i]}`;
    const lineBytes = Buffer.byteLength(lineText, 'utf-8');
    if (totalBytes + lineBytes > maxBytes) {
      break;
    }
    keptLines.push(`[${i + 1}] ${effectiveLines[i]}`);
    totalBytes += lineBytes;
  }

  const formatted = `${header}${keptLines.join('\n')}`.slice(0, Math.max(0, maxBytes));
  return {
    formatted,
    lineCount: keptLines.length,
  };
}

function resolveCollectionLimits(
  overrides?: Partial<RepositoryCollectionLimits>
): RepositoryCollectionLimits {
  const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.round(value)));
  };

  return {
    maxFiles: clampInt(overrides?.maxFiles, DEFAULT_COLLECTION_LIMITS.maxFiles, 1, DEFAULT_COLLECTION_LIMITS.maxFiles),
    maxFileSizeBytes: clampInt(
      overrides?.maxFileSizeBytes,
      DEFAULT_COLLECTION_LIMITS.maxFileSizeBytes,
      256,
      DEFAULT_COLLECTION_LIMITS.maxFileSizeBytes
    ),
    maxTotalBytes: clampInt(
      overrides?.maxTotalBytes,
      DEFAULT_COLLECTION_LIMITS.maxTotalBytes,
      256,
      DEFAULT_COLLECTION_LIMITS.maxTotalBytes
    ),
    maxConcurrency: clampInt(
      overrides?.maxConcurrency,
      DEFAULT_COLLECTION_LIMITS.maxConcurrency,
      1,
      DEFAULT_COLLECTION_LIMITS.maxConcurrency
    ),
  };
}

export function isValidBranchName(rawBranch: string): boolean {
  const branch = rawBranch.trim();
  return Boolean(
    branch &&
      branch.length <= 255 &&
      !branch.includes('..') &&
      !branch.startsWith('/') &&
      !branch.endsWith('/') &&
      /^[a-zA-Z0-9._/-]+$/.test(branch)
  );
}

export async function verifyGitHubRepositoryAccess(
  rawFullName: string,
  token?: string
): Promise<{
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
  rateLimit: GitHubRateLimit | null;
}> {
  const fullName = parseRepoFullName(rawFullName);

  interface RawRepoAccess {
    full_name: string;
    private: boolean;
    default_branch?: string;
    permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
  }

  const repoMetaRes = await githubFetchWithMeta<RawRepoAccess>(
    `${GITHUB_API_BASE}/repos/${fullName}`,
    token
  );
  if (repoMetaRes.data.permissions && repoMetaRes.data.permissions.pull === false) {
    throw new GitHubApiError(
      'Insufficient GitHub permissions to access this repository.',
      403,
      { isPermissionError: true, rateLimit: repoMetaRes.rateLimit }
    );
  }
  return {
    fullName: repoMetaRes.data.full_name,
    isPrivate: Boolean(repoMetaRes.data.private),
    defaultBranch: repoMetaRes.data.default_branch || 'main',
    permissions: repoMetaRes.data.permissions,
    rateLimit: repoMetaRes.rateLimit,
  };
}

export async function collectRepositorySources(params: {
  fullName: string;
  branch: string;
  token?: string;
  limits?: Partial<RepositoryCollectionLimits>;
}): Promise<RepositoryCollectionReport> {
  const startedAt = Date.now();
  const fullName = parseRepoFullName(params.fullName);
  const branch = params.branch.trim();
  const limits = resolveCollectionLimits(params.limits);

  if (!isValidBranchName(branch)) {
    throw new GitHubApiError('Invalid branch name.', 400);
  }

  await verifyGitHubRepositoryAccess(fullName, params.token);

  interface RawCommitRef {
    sha: string;
    commit: {
      tree?: { sha?: string };
    };
  }

  const commitRes = await githubFetchWithMeta<RawCommitRef>(
    `${GITHUB_API_BASE}/repos/${fullName}/commits/${encodeURIComponent(branch)}`,
    params.token
  );

  const analyzedCommitSha = commitRes.data.sha;
  const treeSha = commitRes.data.commit?.tree?.sha || analyzedCommitSha;

  interface RawGitTreeEntry {
    path: string;
    mode: string;
    type: 'blob' | 'tree' | 'commit';
    sha: string;
    size?: number;
  }

  interface RawGitTreeResponse {
    sha: string;
    truncated: boolean;
    tree: RawGitTreeEntry[];
  }

  const treeRes = await githubFetchWithMeta<RawGitTreeResponse>(
    `${GITHUB_API_BASE}/repos/${fullName}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
    params.token
  );

  const treeEntries = Array.isArray(treeRes.data.tree) ? treeRes.data.tree : [];
  const totalTreeEntries = treeEntries.length;
  const truncationDetected = Boolean(treeRes.data.truncated);

  interface CandidateEntry {
    path: string;
    sha: string;
    size: number;
    language: string;
    priority: number;
    depth: number;
  }

  const eligibleCandidates: CandidateEntry[] = [];
  for (const entry of treeEntries) {
    if (entry.type !== 'blob' || !entry.path || !entry.sha) continue;
    const language = detectSourceLanguage(entry.path);
    if (!language) continue;
    eligibleCandidates.push({
      path: entry.path,
      sha: entry.sha,
      size: typeof entry.size === 'number' ? entry.size : 0,
      language,
      priority: computeSourceFilePriority(entry.path),
      depth: entry.path.split('/').length,
    });
  }

  eligibleCandidates.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.depth - b.depth ||
      a.path.localeCompare(b.path)
  );

  const eligibleFiles = eligibleCandidates.length;
  let filesSkipped = 0;
  let filesTruncated = 0;
  let failedFiles = 0;
  let totalBytesCollected = 0;
  const collectedFiles: CollectedSourceFile[] = [];

  const withinFileSizeCandidates: CandidateEntry[] = [];
  for (const candidate of eligibleCandidates) {
    if (candidate.size > limits.maxFileSizeBytes) {
      filesSkipped += 1;
    } else {
      withinFileSizeCandidates.push(candidate);
    }
  }

  const candidatesToFetch = withinFileSizeCandidates.slice(0, limits.maxFiles);
  filesSkipped += Math.max(0, withinFileSizeCandidates.length - candidatesToFetch.length);

  interface RawBlobResponse {
    sha: string;
    size?: number;
    encoding?: string;
    content?: string;
  }

  type BlobFetchOutcome =
    | { kind: 'ok'; candidate: CandidateEntry; rawText: string; originalSize: number }
    | { kind: 'skip' }
    | { kind: 'fail'; fatalError?: GitHubApiError };

  async function fetchAndDecodeBlob(candidate: CandidateEntry): Promise<BlobFetchOutcome> {
    try {
      const { data: blob } = await githubFetchWithMeta<RawBlobResponse>(
        `${GITHUB_API_BASE}/repos/${fullName}/git/blobs/${encodeURIComponent(candidate.sha)}`,
        params.token
      );

      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') {
        return { kind: 'skip' };
      }

      const buffer = Buffer.from(blob.content.replace(/\n/g, ''), 'base64');
      const originalSize = typeof blob.size === 'number' ? blob.size : candidate.size || buffer.length;
      if (buffer.length > limits.maxFileSizeBytes || originalSize > limits.maxFileSizeBytes) {
        return { kind: 'skip' };
      }

      const sampleEnd = Math.min(buffer.length, 4096);
      for (let i = 0; i < sampleEnd; i += 1) {
        if (buffer[i] === 0) {
          return { kind: 'skip' };
        }
      }

      const rawText = buffer.toString('utf-8');
      return { kind: 'ok', candidate, rawText, originalSize };
    } catch (err) {
      if (err instanceof GitHubApiError && (err.isRateLimited || err.status === 401 || err.status === 403)) {
        return { kind: 'fail', fatalError: err };
      }
      return { kind: 'fail' };
    }
  }

  let budgetExhausted = false;
  let fatalStopError: GitHubApiError | null = null;

  for (let i = 0; i < candidatesToFetch.length; i += limits.maxConcurrency) {
    if (budgetExhausted || fatalStopError) {
      filesSkipped += candidatesToFetch.length - i;
      break;
    }

    const wave = candidatesToFetch.slice(i, i + limits.maxConcurrency);
    const outcomes = await Promise.all(wave.map((candidate) => fetchAndDecodeBlob(candidate)));

    for (let j = 0; j < outcomes.length; j += 1) {
      const outcome = outcomes[j];
      if (outcome.kind === 'skip') {
        filesSkipped += 1;
        continue;
      }
      if (outcome.kind === 'fail') {
        failedFiles += 1;
        if (outcome.fatalError) {
          fatalStopError = outcome.fatalError;
        }
        continue;
      }

      if (budgetExhausted) {
        filesSkipped += 1;
        continue;
      }

      const { formatted, lineCount } = formatLineNumberedSource(
        outcome.candidate.path,
        outcome.rawText
      );
      const formattedBytes = Buffer.byteLength(formatted, 'utf-8');

      if (totalBytesCollected + formattedBytes <= limits.maxTotalBytes) {
        collectedFiles.push({
          path: outcome.candidate.path,
          blobSha: outcome.candidate.sha,
          language: outcome.candidate.language,
          originalSize: outcome.originalSize,
          collectedSize: formattedBytes,
          lineCount,
          content: formatted,
          truncated: false,
        });
        totalBytesCollected += formattedBytes;
      } else if (collectedFiles.length === 0) {
        const sliced = truncateLineNumberedToByteLimit(
          outcome.candidate.path,
          outcome.rawText,
          limits.maxTotalBytes
        );
        const slicedBytes = Buffer.byteLength(sliced.formatted, 'utf-8');
        collectedFiles.push({
          path: outcome.candidate.path,
          blobSha: outcome.candidate.sha,
          language: outcome.candidate.language,
          originalSize: outcome.originalSize,
          collectedSize: slicedBytes,
          lineCount: sliced.lineCount,
          content: sliced.formatted,
          truncated: true,
        });
        totalBytesCollected += slicedBytes;
        filesTruncated += 1;
        budgetExhausted = true;
      } else {
        filesSkipped += 1;
        budgetExhausted = true;
      }
    }

    if (fatalStopError && collectedFiles.length === 0) {
      throw fatalStopError;
    }
  }

  const filesCollected = collectedFiles.length;
  const coverageComplete =
    !truncationDetected &&
    filesSkipped === 0 &&
    filesTruncated === 0 &&
    failedFiles === 0 &&
    filesCollected === eligibleFiles;

  return {
    repositoryFullName: fullName,
    branch,
    analyzedCommitSha,
    totalTreeEntries,
    eligibleFiles,
    filesCollected,
    filesSkipped,
    filesTruncated,
    failedFiles,
    totalBytesCollected,
    collectionDuration: Date.now() - startedAt,
    truncationDetected,
    coverageComplete,
    collectedFiles,
  };
}

export function isSensitiveRepoPath(filePath: string): boolean {
  const clean = filePath.replace(/^\/+/, '').toLowerCase();
  const fileName = clean.split('/').pop() || '';
  if (!fileName) return false;

  // Allow template/example env files
  if (
    fileName === '.env.example' ||
    fileName === '.env.sample' ||
    fileName === '.env.template' ||
    fileName.endsWith('.env.example') ||
    fileName.endsWith('.env.sample') ||
    fileName.endsWith('.env.template')
  ) {
    return false;
  }

  if (fileName === '.env' || fileName.startsWith('.env.')) {
    return true;
  }

  if (
    fileName.endsWith('.pem') ||
    fileName.endsWith('.key') ||
    fileName.endsWith('.p12') ||
    fileName.endsWith('.pfx') ||
    fileName.endsWith('.jks') ||
    fileName.endsWith('.keystore')
  ) {
    return true;
  }

  if (
    fileName === 'id_rsa' ||
    fileName === 'id_dsa' ||
    fileName === 'id_ecdsa' ||
    fileName === 'id_ed25519' ||
    fileName === '.npmrc' ||
    fileName === '.pypirc' ||
    fileName === '.netrc'
  ) {
    return true;
  }

  if (
    (fileName.includes('service-account') ||
      fileName.includes('service_account') ||
      fileName.includes('serviceaccount') ||
      fileName.includes('credentials')) &&
    fileName.endsWith('.json')
  ) {
    return true;
  }

  return false;
}

function computeIntelligenceFilePriority(filePath: string): number {
  const lower = filePath.toLowerCase();
  const segments = lower.split('/');
  const fileName = segments[segments.length - 1] || '';

  // 1. Entry points, README, manifests, configs, schemas
  if (
    fileName.startsWith('readme') ||
    fileName === 'package.json' ||
    fileName === 'pyproject.toml' ||
    fileName === 'requirements.txt' ||
    fileName === 'go.mod' ||
    fileName === 'cargo.toml' ||
    fileName === 'pom.xml' ||
    fileName === 'composer.json' ||
    fileName === '.env.example' ||
    fileName === 'docker-compose.yml' ||
    fileName === 'docker-compose.yaml' ||
    fileName === 'dockerfile' ||
    fileName === 'firestore.rules' ||
    fileName === 'firebase-blueprint.json' ||
    fileName.startsWith('drizzle.config.') ||
    fileName.startsWith('vite.config.') ||
    fileName.startsWith('next.config.')
  ) {
    return 1;
  }

  // 2. Database schemas, models, auth, server/app entries
  if (
    fileName.includes('schema') ||
    fileName.includes('model') ||
    fileName.includes('auth') ||
    fileName.includes('firebase') ||
    fileName.includes('store') ||
    fileName.includes('database') ||
    fileName.includes('db.') ||
    fileName.endsWith('.sql') ||
    fileName.endsWith('.prisma') ||
    (/^(server|app|main|index)\.[^.]+$/.test(fileName) && segments.length <= 3)
  ) {
    return 2;
  }

  // 3. API routes, controllers, services, middleware, frontend router/context/api clients
  if (
    segments.some((seg) =>
      [
        'routes',
        'route',
        'controllers',
        'controller',
        'services',
        'service',
        'api',
        'middleware',
        'middlewares',
        'context',
        'contexts',
        'store',
        'stores',
        'hooks',
        'pages',
        'views',
        'app',
      ].includes(seg)
    )
  ) {
    return 3;
  }

  // 4. General source code
  if (!segments.some((s) => ['test', 'tests', '__tests__', 'spec', 'docs'].includes(s))) {
    return 4;
  }

  // 5. Tests & extra docs
  return 5;
}

export async function collectRepositoryIntelligenceBundle(params: {
  fullName: string;
  branch: string;
  token?: string;
  limits?: Partial<RepositoryCollectionLimits>;
}): Promise<RepositoryIntelligenceCollectionBundle> {
  const fullName = parseRepoFullName(params.fullName);
  const branch = params.branch.trim();
  const resolvedToken = params.token || process.env.GITHUB_TOKEN?.trim() || undefined;
  const limits: RepositoryCollectionLimits = {
    maxFiles: Math.min(120, Math.max(20, params.limits?.maxFiles ?? (resolvedToken ? 110 : 75))),
    maxFileSizeBytes: params.limits?.maxFileSizeBytes ?? 90 * 1024,
    maxTotalBytes: params.limits?.maxTotalBytes ?? 720 * 1024,
    maxConcurrency: params.limits?.maxConcurrency ?? 6,
  };

  if (!isValidBranchName(branch)) {
    throw new GitHubApiError('Invalid branch name.', 400);
  }

  const access = await verifyGitHubRepositoryAccess(fullName, resolvedToken);

  interface RawCommitRef {
    sha: string;
    commit: {
      tree?: { sha?: string };
    };
  }

  const commitRes = await githubFetchWithMeta<RawCommitRef>(
    `${GITHUB_API_BASE}/repos/${fullName}/commits/${encodeURIComponent(branch)}`,
    resolvedToken
  );

  const analyzedCommitSha = commitRes.data.sha;
  const treeSha = commitRes.data.commit?.tree?.sha || analyzedCommitSha;

  interface RawGitTreeEntry {
    path: string;
    mode: string;
    type: 'blob' | 'tree' | 'commit';
    sha: string;
    size?: number;
  }

  interface RawGitTreeResponse {
    sha: string;
    truncated: boolean;
    tree: RawGitTreeEntry[];
  }

  const treeRes = await githubFetchWithMeta<RawGitTreeResponse>(
    `${GITHUB_API_BASE}/repos/${fullName}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
    resolvedToken
  );

  const rawEntries = Array.isArray(treeRes.data.tree) ? treeRes.data.tree : [];
  const totalTreeEntries = rawEntries.length;
  const treeTruncated = Boolean(treeRes.data.truncated);

  const treeNodeMap = new Map<string, IntelligenceTreeNode>();
  let totalDirectories = 0;
  let totalFiles = 0;
  let filesSkipped = 0;
  let filesTruncated = 0;
  let failedFiles = 0;

  interface CandidateEntry {
    path: string;
    sha: string;
    size: number;
    language: string;
    priority: number;
    depth: number;
  }

  const eligibleCandidates: CandidateEntry[] = [];

  for (const entry of rawEntries) {
    if (!entry.path || entry.path.startsWith('.git/') || entry.path === '.git') continue;
    const cleanPath = entry.path.replace(/^\/+/, '');
    const name = cleanPath.split('/').pop() || cleanPath;

    if (entry.type === 'tree') {
      if (isIgnoredRepoPath(`${cleanPath}/placeholder`)) {
        // Still allow top-level folder visibility except .git/node_modules internals
        const segments = cleanPath.toLowerCase().split('/');
        if (segments.some((s) => s === '.git' || s === 'node_modules')) continue;
      }
      totalDirectories += 1;
      treeNodeMap.set(cleanPath, {
        path: cleanPath,
        name,
        type: 'dir',
        size: 0,
        sha: entry.sha,
        language: null,
      });
      continue;
    }

    if (entry.type !== 'blob') continue;
    const segments = cleanPath.toLowerCase().split('/');
    if (segments.some((s) => s === 'node_modules' || s === '.git')) {
      totalFiles += 1;
      filesSkipped += 1;
      continue;
    }

    totalFiles += 1;
    const sensitive = isSensitiveRepoPath(cleanPath);
    const language = sensitive ? null : detectSourceLanguage(cleanPath);
    const ext = getExtension(name);
    const isKnownBinary = Boolean(ext && IGNORED_BINARY_EXTENSIONS.has(ext));

    let initialStatus: IntelligenceFileStatus = 'uncollected';
    if (sensitive) {
      initialStatus = 'sensitive';
      filesSkipped += 1;
    } else if (isKnownBinary) {
      initialStatus = 'binary';
      filesSkipped += 1;
    } else if (!language) {
      initialStatus = 'skipped';
      filesSkipped += 1;
    }

    treeNodeMap.set(cleanPath, {
      path: cleanPath,
      name,
      type: 'file',
      size: typeof entry.size === 'number' ? entry.size : 0,
      sha: entry.sha,
      language,
      status: initialStatus,
    });

    if (language && !sensitive) {
      eligibleCandidates.push({
        path: cleanPath,
        sha: entry.sha,
        size: typeof entry.size === 'number' ? entry.size : 0,
        language,
        priority: computeIntelligenceFilePriority(cleanPath),
        depth: cleanPath.split('/').length,
      });
    }
  }

  eligibleCandidates.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.depth - b.depth ||
      a.path.localeCompare(b.path)
  );

  const eligibleFiles = eligibleCandidates.length;
  const withinFileSizeCandidates: CandidateEntry[] = [];

  for (const candidate of eligibleCandidates) {
    if (candidate.size > limits.maxFileSizeBytes) {
      filesSkipped += 1;
      const node = treeNodeMap.get(candidate.path);
      if (node) node.status = 'skipped';
    } else {
      withinFileSizeCandidates.push(candidate);
    }
  }

  const candidatesToFetch = withinFileSizeCandidates.slice(0, limits.maxFiles);
  for (const dropped of withinFileSizeCandidates.slice(limits.maxFiles)) {
    filesSkipped += 1;
    const node = treeNodeMap.get(dropped.path);
    if (node) node.status = 'uncollected';
  }

  interface RawBlobResponse {
    sha: string;
    size?: number;
    encoding?: string;
    content?: string;
  }

  type FetchOutcome =
    | { kind: 'ok'; candidate: CandidateEntry; rawText: string; originalSize: number }
    | { kind: 'skip'; reason: 'binary' | 'size' }
    | { kind: 'fail'; fatalError?: GitHubApiError };

  async function fetchCandidateSource(candidate: CandidateEntry): Promise<FetchOutcome> {
    // For public repositories without an OAuth/PAT token, prefer raw.githubusercontent.com
    // so we preserve GitHub REST API rate limit (60 req/hr unauthenticated).
    if (!access.isPrivate && !resolvedToken) {
      try {
        const encodedPath = candidate.path
          .split('/')
          .map((seg) => encodeURIComponent(seg))
          .join('/');
        const rawUrl = `https://raw.githubusercontent.com/${fullName}/${encodeURIComponent(
          analyzedCommitSha
        )}/${encodedPath}`;
        const rawRes = await fetch(rawUrl, {
          headers: { 'User-Agent': 'CodeRubric-AI-Reviewer' },
        });
        if (rawRes.ok) {
          const buf = Buffer.from(await rawRes.arrayBuffer());
          if (buf.length > limits.maxFileSizeBytes) {
            return { kind: 'skip', reason: 'size' };
          }
          const sampleEnd = Math.min(buf.length, 4096);
          for (let i = 0; i < sampleEnd; i += 1) {
            if (buf[i] === 0) return { kind: 'skip', reason: 'binary' };
          }
          return {
            kind: 'ok',
            candidate,
            rawText: buf.toString('utf-8'),
            originalSize: candidate.size || buf.length,
          };
        }
      } catch {
        // Fall through to GitHub Blobs API fallback
      }
    }

    try {
      const { data: blob } = await githubFetchWithMeta<RawBlobResponse>(
        `${GITHUB_API_BASE}/repos/${fullName}/git/blobs/${encodeURIComponent(candidate.sha)}`,
        resolvedToken
      );

      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') {
        return { kind: 'skip', reason: 'binary' };
      }

      const buffer = Buffer.from(blob.content.replace(/\n/g, ''), 'base64');
      const originalSize =
        typeof blob.size === 'number' ? blob.size : candidate.size || buffer.length;
      if (buffer.length > limits.maxFileSizeBytes || originalSize > limits.maxFileSizeBytes) {
        return { kind: 'skip', reason: 'size' };
      }

      const sampleEnd = Math.min(buffer.length, 4096);
      for (let i = 0; i < sampleEnd; i += 1) {
        if (buffer[i] === 0) {
          return { kind: 'skip', reason: 'binary' };
        }
      }

      return {
        kind: 'ok',
        candidate,
        rawText: buffer.toString('utf-8'),
        originalSize,
      };
    } catch (err) {
      if (err instanceof GitHubApiError && (err.isRateLimited || err.status === 401 || err.status === 403)) {
        return { kind: 'fail', fatalError: err };
      }
      return { kind: 'fail' };
    }
  }

  let totalBytesCollected = 0;
  let budgetExhausted = false;
  let fatalStopError: GitHubApiError | null = null;
  const collectedFiles: CollectedSourceFile[] = [];
  const rawContentByPath: Record<string, string> = {};

  for (let i = 0; i < candidatesToFetch.length; i += limits.maxConcurrency) {
    if (budgetExhausted || fatalStopError) {
      for (const rem of candidatesToFetch.slice(i)) {
        filesSkipped += 1;
        const node = treeNodeMap.get(rem.path);
        if (node) node.status = 'uncollected';
      }
      break;
    }

    const wave = candidatesToFetch.slice(i, i + limits.maxConcurrency);
    const outcomes = await Promise.all(wave.map((c) => fetchCandidateSource(c)));

    for (let j = 0; j < outcomes.length; j += 1) {
      const outcome = outcomes[j];
      const waveCandidate = wave[j];
      if (outcome.kind === 'skip') {
        filesSkipped += 1;
        const node = treeNodeMap.get(waveCandidate.path);
        if (node) node.status = outcome.reason === 'binary' ? 'binary' : 'skipped';
        continue;
      }
      if (outcome.kind === 'fail') {
        failedFiles += 1;
        const node = treeNodeMap.get(waveCandidate.path);
        if (node) node.status = 'failed';
        if (outcome.fatalError) {
          fatalStopError = outcome.fatalError;
        }
        continue;
      }

      if (budgetExhausted) {
        filesSkipped += 1;
        const node = treeNodeMap.get(outcome.candidate.path);
        if (node) node.status = 'uncollected';
        continue;
      }

      const { formatted, lineCount } = formatLineNumberedSource(
        outcome.candidate.path,
        outcome.rawText
      );
      const formattedBytes = Buffer.byteLength(formatted, 'utf-8');

      if (totalBytesCollected + formattedBytes <= limits.maxTotalBytes) {
        collectedFiles.push({
          path: outcome.candidate.path,
          blobSha: outcome.candidate.sha,
          language: outcome.candidate.language,
          originalSize: outcome.originalSize,
          collectedSize: formattedBytes,
          lineCount,
          content: formatted,
          truncated: false,
        });
        rawContentByPath[outcome.candidate.path] = outcome.rawText;
        totalBytesCollected += formattedBytes;
        const node = treeNodeMap.get(outcome.candidate.path);
        if (node) node.status = 'analyzed';
      } else if (collectedFiles.length === 0) {
        const sliced = truncateLineNumberedToByteLimit(
          outcome.candidate.path,
          outcome.rawText,
          limits.maxTotalBytes
        );
        const slicedBytes = Buffer.byteLength(sliced.formatted, 'utf-8');
        collectedFiles.push({
          path: outcome.candidate.path,
          blobSha: outcome.candidate.sha,
          language: outcome.candidate.language,
          originalSize: outcome.originalSize,
          collectedSize: slicedBytes,
          lineCount: sliced.lineCount,
          content: sliced.formatted,
          truncated: true,
        });
        rawContentByPath[outcome.candidate.path] = outcome.rawText.slice(0, 60000);
        totalBytesCollected += slicedBytes;
        filesTruncated += 1;
        budgetExhausted = true;
        const node = treeNodeMap.get(outcome.candidate.path);
        if (node) node.status = 'truncated';
      } else {
        filesSkipped += 1;
        budgetExhausted = true;
        const node = treeNodeMap.get(outcome.candidate.path);
        if (node) node.status = 'uncollected';
      }
    }

    if (fatalStopError && collectedFiles.length === 0) {
      throw fatalStopError;
    }
  }

  const treeNodes = Array.from(treeNodeMap.values()).sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;
    return a.path.localeCompare(b.path);
  });

  const filesCollected = collectedFiles.length;
  const coverageComplete =
    !treeTruncated &&
    filesSkipped === 0 &&
    filesTruncated === 0 &&
    failedFiles === 0 &&
    filesCollected === eligibleFiles;

  return {
    repositoryFullName: fullName,
    branch,
    analyzedCommitSha,
    totalTreeEntries,
    totalDirectories,
    totalFiles,
    eligibleFiles,
    filesCollected,
    filesSkipped,
    filesTruncated,
    failedFiles,
    totalBytesCollected,
    treeTruncated,
    coverageComplete,
    treeNodes,
    collectedFiles,
    rawContentByPath,
  };
}

