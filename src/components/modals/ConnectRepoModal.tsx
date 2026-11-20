import { ChevronLeft, ChevronRight, ExternalLink, Lock, Loader2, LogOut, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../services/api';
import type {
  GitHubAuthStatus,
  GitHubPagination,
  GitHubRateLimit,
  GitHubUserRepoSummary,
  Repository,
} from '../../types';

interface ConnectRepoModalProps {
  open: boolean;
  onClose: () => void;
  onConnected: (repo: Repository) => void;
  githubAuth: GitHubAuthStatus | null;
  connectedRepoFullNames: string[];
  onSignInWithGitHub: () => void;
  onSignOutGitHub: () => void;
}

const SUGGESTED_REPOS = ['expressjs/express', 'vitejs/vite', 'lucide-icons/lucide'];

export function ConnectRepoModal({
  open,
  onClose,
  onConnected,
  githubAuth,
  connectedRepoFullNames,
  onSignInWithGitHub,
  onSignOutGitHub,
}: ConnectRepoModalProps) {
  const [repoInput, setRepoInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Authenticated user's GitHub repositories state
  const [userRepos, setUserRepos] = useState<GitHubUserRepoSummary[]>([]);
  const [userReposLoading, setUserReposLoading] = useState(false);
  const [userReposError, setUserReposError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<GitHubPagination>({
    page: 1,
    perPage: 8,
    hasNext: false,
    hasPrev: false,
  });
  const [rateLimit, setRateLimit] = useState<GitHubRateLimit | null>(null);

  const loadUserRepos = useCallback(async () => {
    if (!open || !githubAuth?.authenticated) return;
    setUserReposLoading(true);
    setUserReposError(null);
    try {
      const res = await api.getAuthenticatedUserRepos({
        page,
        perPage: 8,
        visibility,
        q: searchQuery.trim() || undefined,
      });
      setUserRepos(res.repositories);
      setPagination(res.pagination);
      setRateLimit(res.rateLimit);
    } catch (err) {
      setUserReposError(
        err instanceof Error ? err.message : 'Unable to load your GitHub repositories.'
      );
      setUserRepos([]);
    } finally {
      setUserReposLoading(false);
    }
  }, [open, githubAuth?.authenticated, page, visibility, searchQuery]);

  useEffect(() => {
    loadUserRepos();
  }, [loadUserRepos]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!repoInput.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.connectRepository(repoInput.trim());
      onConnected(res.repository);
      setRepoInput('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect repository.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConnectUserRepo(fullName: string) {
    setConnectingSlug(fullName);
    setError(null);
    try {
      const res = await api.connectRepository(fullName);
      onConnected(res.repository);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect repository.');
    } finally {
      setConnectingSlug(null);
    }
  }

  const connectedSet = new Set(connectedRepoFullNames.map((n) => n.toLowerCase()));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-repo-title"
    >
      <div className="w-full max-w-2xl bg-[#111827] border border-slate-800 rounded-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <h2 id="connect-repo-title" className="text-base font-semibold text-slate-100">
            Connect GitHub Repository
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Section 1: Authenticated GitHub Account Repositories */}
          <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  GitHub Account (OAuth)
                </h3>
                {githubAuth?.authenticated && githubAuth.user ? (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Signed in as <span className="font-mono text-slate-200">@{githubAuth.user.login}</span> ·{' '}
                    {githubAuth.hasPrivateScope ? 'Public & private repos' : 'Public repos only'}
                    {rateLimit && ` · ${rateLimit.remaining}/${rateLimit.limit} API calls left`}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Sign in with GitHub to browse and connect your public and private repositories.
                  </p>
                )}
              </div>

              {githubAuth?.authenticated ? (
                <button
                  type="button"
                  onClick={onSignOutGitHub}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#111827] hover:bg-slate-800 border border-slate-800 rounded-md whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSignInWithGitHub}
                  disabled={!githubAuth?.configured}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  Sign in with GitHub
                </button>
              )}
            </div>

            {!githubAuth?.configured && !githubAuth?.authenticated && (
              <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-md p-3 space-y-1">
                <div className="font-medium">GitHub OAuth credentials not configured on server</div>
                <p className="text-slate-300">
                  Set <span className="font-mono">GITHUB_CLIENT_ID</span> and{' '}
                  <span className="font-mono">GITHUB_CLIENT_SECRET</span> in your server environment with callback URL{' '}
                  <span className="font-mono text-slate-100 break-all">
                    {githubAuth?.callbackUrl || '/auth/github/callback'}
                  </span>
                  . You can still connect public repositories below without OAuth.
                </p>
              </div>
            )}

            {githubAuth?.authenticated && (
              <div className="space-y-3 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search
                      className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Filter your GitHub repositories..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#111827] border border-slate-800 rounded text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex items-center gap-1 p-0.5 bg-[#111827] border border-slate-800 rounded">
                    {(['all', 'public', 'private'] as const).map((vis) => (
                      <button
                        key={vis}
                        type="button"
                        onClick={() => {
                          setVisibility(vis);
                          setPage(1);
                        }}
                        className={`px-2.5 py-1 text-xs rounded capitalize transition-colors whitespace-nowrap ${
                          visibility === vis
                            ? 'bg-slate-800 text-slate-100'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {vis}
                      </button>
                    ))}
                  </div>
                </div>

                {userReposLoading ? (
                  <div className="py-5 flex items-center justify-center gap-2 text-xs text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading your GitHub repositories...</span>
                  </div>
                ) : userReposError ? (
                  <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2.5">
                    {userReposError}
                  </div>
                ) : userRepos.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-400">
                    No repositories found matching this filter.
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-slate-800 border border-slate-800 rounded-md bg-[#111827] max-h-64 overflow-y-auto">
                      {userRepos.map((repo) => {
                        const alreadyConnected = connectedSet.has(repo.fullName.toLowerCase());
                        const isConnecting = connectingSlug === repo.fullName;

                        return (
                          <div
                            key={repo.id}
                            className="px-3 py-2.5 flex items-start justify-between gap-3"
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center gap-1.5 text-xs font-mono text-slate-100">
                                {repo.isPrivate && (
                                  <Lock
                                    className="w-3 h-3 text-amber-400 shrink-0"
                                    aria-label="Private repository"
                                  />
                                )}
                                <span className="truncate">{repo.fullName}</span>
                                {repo.htmlUrl && (
                                  <a
                                    href={repo.htmlUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Open ${repo.fullName} on GitHub`}
                                    title={`Open ${repo.fullName} on GitHub`}
                                    className="text-slate-500 hover:text-slate-200 shrink-0 transition-colors"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                                  </a>
                                )}
                              </div>
                              <p className="text-xs text-slate-300/90 line-clamp-2">
                                {repo.description?.trim() ? (
                                  repo.description
                                ) : (
                                  <span className="text-slate-500">No description provided.</span>
                                )}
                              </p>
                              <div className="text-[11px] text-slate-400 truncate">
                                {repo.isPrivate ? 'Private' : 'Public'} · {repo.language} ·{' '}
                                {repo.defaultBranch}
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={alreadyConnected || Boolean(connectingSlug)}
                              onClick={() => handleConnectUserRepo(repo.fullName)}
                              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                                alreadyConnected
                                  ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/30'
                                  : 'text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50'
                              }`}
                            >
                              {alreadyConnected
                                ? 'Connected'
                                : isConnecting
                                  ? 'Connecting...'
                                  : 'Connect'}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-mono tabular-nums">Page {pagination.page}</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!pagination.hasPrev || userReposLoading}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#111827] border border-slate-800 rounded disabled:opacity-40 hover:bg-slate-800 text-slate-200"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          <span>Prev</span>
                        </button>
                        <button
                          type="button"
                          disabled={!pagination.hasNext || userReposLoading}
                          onClick={() => setPage((p) => p + 1)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#111827] border border-slate-800 rounded disabled:opacity-40 hover:bg-slate-800 text-slate-200"
                        >
                          <span>Next</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Section 2: Direct Slug / URL Connection */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="github-repo-input" className="block text-xs font-medium text-slate-300 mb-1.5">
                Or Connect by GitHub Repository Slug / URL
              </label>
              <input
                id="github-repo-input"
                type="text"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="owner/repository or https://github.com/owner/repo"
                className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 font-mono"
              />
              <p className="mt-1.5 text-xs text-slate-400">
                Fetches live repository metadata, branches, source tree, commits, and pull requests via the GitHub REST API.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Quick fill:</span>
              {SUGGESTED_REPOS.map((slug) => (
                <button
                  key={slug}
                  type="button"
                  onClick={() => setRepoInput(slug)}
                  className="px-2 py-1 text-xs font-mono text-slate-300 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 rounded transition-colors"
                >
                  {slug}
                </button>
              ))}
            </div>

            {error && (
              <div role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800/70 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !repoInput.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                <span>{submitting ? 'Connecting...' : 'Connect Repository'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
