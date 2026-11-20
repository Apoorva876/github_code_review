import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileCode,
  Folder,
  GitBranch,
  GitCommit,
  GitPullRequest,
  History,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  LogOut,
  Play,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RepositoryAnalysisHistoryTab } from '../components/analysis/RepositoryAnalysisHistoryTab';
import { RepositoryAnalysisModal } from '../components/modals/RepositoryAnalysisModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState, ErrorBanner, TableSkeleton } from '../components/ui/DataState';
import { useFirebase } from '../context/FirebaseContext';
import { useToast } from '../context/ToastContext';
import { ApiError, api } from '../services/api';
import type {
  AIAgent,
  CodeReview,
  GitHubAuthStatus,
  GitHubBranchSummary,
  GitHubCommitSummary,
  GitHubContentsResult,
  GitHubPagination,
  GitHubPullRequestSummary,
  GitHubRateLimit,
  GitHubRepositoryDetails,
  Repository,
  RepositoryAnalysisJob,
} from '../types';
import { formatCommitSha, formatRelativeTime, getScoreColorClass } from '../utils/formatters';
import { getRepositoryAnalysisSnapshot } from '../utils/workspaceMetrics';

interface RepositoriesViewProps {
  repositories: Repository[];
  agents: AIAgent[];
  reviews?: CodeReview[];
  externalAnalysisJobs?: RepositoryAnalysisJob[];
  loading: boolean;
  error: string | null;
  githubAuth: GitHubAuthStatus | null;
  focusedRepoId?: string | null;
  onClearFocusedRepo?: () => void;
  autoOpenAnalyzeRepoId?: string | null;
  onClearAutoOpenAnalyze?: () => void;
  onRefresh: () => void;
  onOpenConnectRepo: () => void;
  onSignInWithGitHub: () => void;
  onSignOutGitHub: () => void;
  onOpenReviewById: (reviewId: string) => void;
  onJobUpdated?: (job: RepositoryAnalysisJob) => void;
  onTriggerPrReview: (repoFullName: string, prNumber: number) => void;
  onAuditSourceFile: (
    repoFullName: string,
    filePath: string,
    content: string,
    branch: string
  ) => void;
}

type InspectorTab = 'files' | 'pulls' | 'commits' | 'overview' | 'analysis-history';

export function RepositoriesView({
  repositories,
  agents,
  reviews = [],
  externalAnalysisJobs = [],
  loading,
  error,
  githubAuth,
  focusedRepoId,
  onClearFocusedRepo,
  autoOpenAnalyzeRepoId,
  onClearAutoOpenAnalyze,
  onRefresh,
  onOpenConnectRepo,
  onSignInWithGitHub,
  onSignOutGitHub,
  onOpenReviewById,
  onJobUpdated,
  onTriggerPrReview,
  onAuditSourceFile,
}: RepositoriesViewProps) {
  const {
    syncRepositoryAutoReview,
    removeRepository: removeRepositoryFromFirestore,
    syncAnalysisJob,
    syncReviewAndRelated,
  } = useFirebase();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'live' | 'demo' | 'analyzed' | 'auto_review'
  >('all');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [actionError, setActionError] = useState<string | null>(null);
  const [repoPendingDelete, setRepoPendingDelete] = useState<Repository | null>(null);
  const [deletingRepo, setDeletingRepo] = useState(false);

  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('files');
  const [rateLimit, setRateLimit] = useState<GitHubRateLimit | null>(null);

  // Pull Requests tab state
  const [prState, setPrState] = useState<'open' | 'closed' | 'all'>('open');
  const [prPage, setPrPage] = useState(1);
  const [pulls, setPulls] = useState<GitHubPullRequestSummary[]>([]);
  const [pullsPagination, setPullsPagination] = useState<GitHubPagination>({
    page: 1,
    perPage: 10,
    hasNext: false,
    hasPrev: false,
  });
  const [loadingPulls, setLoadingPulls] = useState(false);
  const [pullsError, setPullsError] = useState<string | null>(null);

  // Details & Branches tab state
  const [repoDetails, setRepoDetails] = useState<GitHubRepositoryDetails | null>(null);
  const [branches, setBranches] = useState<GitHubBranchSummary[]>([]);
  const [branchesPage, setBranchesPage] = useState(1);
  const [branchesPagination, setBranchesPagination] = useState<GitHubPagination>({
    page: 1,
    perPage: 15,
    hasNext: false,
    hasPrev: false,
  });
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Commits tab state
  const [activeBranch, setActiveBranch] = useState<string>('');
  const [commits, setCommits] = useState<GitHubCommitSummary[]>([]);
  const [commitsPage, setCommitsPage] = useState(1);
  const [commitsPagination, setCommitsPagination] = useState<GitHubPagination>({
    page: 1,
    perPage: 12,
    hasNext: false,
    hasPrev: false,
  });
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);

  // File Tree & Source Viewer state
  const [currentPath, setCurrentPath] = useState('');
  const [contentsResult, setContentsResult] = useState<GitHubContentsResult | null>(null);
  const [loadingContents, setLoadingContents] = useState(false);
  const [contentsError, setContentsError] = useState<string | null>(null);

  // Repository Analysis modal & history state
  const [analysisModalRepo, setAnalysisModalRepo] = useState<Repository | null>(null);
  const [analysisModalBranch, setAnalysisModalBranch] = useState<string | undefined>(undefined);
  const [analysisModalJob, setAnalysisModalJob] = useState<RepositoryAnalysisJob | null>(null);
  const [analysisJobs, setAnalysisJobs] = useState<RepositoryAnalysisJob[]>([]);
  const [loadingAnalysisJobs, setLoadingAnalysisJobs] = useState(false);
  const [analysisJobsError, setAnalysisJobsError] = useState<string | null>(null);
  const [analysisJobsAuthRequired, setAnalysisJobsAuthRequired] = useState(false);
  const refreshedTerminalJobsRef = useRef<Set<string>>(new Set());

  const combinedJobs = useMemo(() => {
    const byId = new Map<string, RepositoryAnalysisJob>();
    for (const j of externalAnalysisJobs) byId.set(j.id, j);
    for (const j of analysisJobs) byId.set(j.id, j);
    return Array.from(byId.values());
  }, [externalAnalysisJobs, analysisJobs]);

  const uniqueLanguages = useMemo(
    () =>
      Array.from(
        new Set(repositories.map((r) => r.language).filter((lang) => Boolean(lang?.trim())))
      ).sort((a, b) => a.localeCompare(b)),
    [repositories]
  );

  const repoSnapshots = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getRepositoryAnalysisSnapshot>>();
    for (const repo of repositories) {
      map.set(repo.id, getRepositoryAnalysisSnapshot(repo, reviews, combinedJobs));
    }
    return map;
  }, [repositories, reviews, combinedJobs]);

  const filtered = repositories.filter((repo) => {
    const q = search.toLowerCase();
    const matchesSearch =
      repo.fullName.toLowerCase().includes(q) ||
      repo.language.toLowerCase().includes(q) ||
      repo.defaultBranch.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (languageFilter !== 'all' && repo.language !== languageFilter) return false;
    if (statusFilter === 'live') return !repo.isDemo;
    if (statusFilter === 'demo') return repo.isDemo;
    if (statusFilter === 'auto_review') return repo.autoReviewEnabled;
    if (statusFilter === 'analyzed') {
      const snap = repoSnapshots.get(repo.id);
      return snap !== undefined && snap.analysisStatus !== 'not_analyzed';
    }
    return true;
  });

  const loadPulls = useCallback(
    async (repo: Repository, state: 'open' | 'closed' | 'all', page: number) => {
      setLoadingPulls(true);
      setPullsError(null);
      try {
        const res = await api.getRepositoryPulls(repo.id, state, page, 10);
        setPulls(res.pulls);
        if (res.pagination) setPullsPagination(res.pagination);
        if (res.rateLimit) setRateLimit(res.rateLimit);
      } catch (err) {
        setPullsError(err instanceof Error ? err.message : 'Unable to load pull requests.');
        setPulls([]);
      } finally {
        setLoadingPulls(false);
      }
    },
    []
  );

  const loadOverviewAndBranches = useCallback(async (repo: Repository, page: number) => {
    if (repo.isDemo) return;
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const [detailsRes, branchesRes] = await Promise.all([
        api.getRepositoryDetails(repo.id),
        api.getRepositoryBranches(repo.id, page, 15),
      ]);
      setRepoDetails(detailsRes.details);
      setBranches(branchesRes.branches);
      setBranchesPagination(branchesRes.pagination);
      if (branchesRes.rateLimit || detailsRes.rateLimit) {
        setRateLimit(branchesRes.rateLimit || detailsRes.rateLimit);
      }
    } catch (err) {
      setOverviewError(
        err instanceof Error ? err.message : 'Unable to load repository overview and branches.'
      );
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const loadCommits = useCallback(
    async (repo: Repository, branch: string, page: number) => {
      if (repo.isDemo) return;
      setLoadingCommits(true);
      setCommitsError(null);
      try {
        const res = await api.getRepositoryCommits(repo.id, branch, page, 12);
        setCommits(res.commits);
        setCommitsPagination(res.pagination);
        if (res.rateLimit) setRateLimit(res.rateLimit);
      } catch (err) {
        setCommitsError(err instanceof Error ? err.message : 'Unable to load commits.');
        setCommits([]);
      } finally {
        setLoadingCommits(false);
      }
    },
    []
  );

  const loadContents = useCallback(
    async (repo: Repository, targetPath: string, ref: string) => {
      if (repo.isDemo) return;
      setLoadingContents(true);
      setContentsError(null);
      try {
        const res = await api.getRepositoryContents(repo.id, targetPath, ref);
        setCurrentPath(targetPath);
        setContentsResult(res);
        if (res.rateLimit) setRateLimit(res.rateLimit);
      } catch (err) {
        setContentsError(
          err instanceof Error ? err.message : 'Unable to browse repository files.'
        );
      } finally {
        setLoadingContents(false);
      }
    },
    []
  );

  const loadAnalysisJobs = useCallback(async (repo: Repository) => {
    if (repo.isDemo) {
      setAnalysisJobs([]);
      setAnalysisJobsError(null);
      setAnalysisJobsAuthRequired(false);
      return;
    }
    setLoadingAnalysisJobs(true);
    setAnalysisJobsError(null);
    setAnalysisJobsAuthRequired(false);
    try {
      const res = await api.getRepositoryAnalysisJobs(repo.id);
      setAnalysisJobs(res.jobs);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAnalysisJobsAuthRequired(true);
        setAnalysisJobsError(err.message);
      } else {
        setAnalysisJobsError(
          err instanceof Error ? err.message : 'Unable to load repository analysis history.'
        );
      }
      setAnalysisJobs([]);
    } finally {
      setLoadingAnalysisJobs(false);
    }
  }, []);

  const handleOpenAnalyzeModal = useCallback(
    (repo: Repository, branch?: string, existingJob?: RepositoryAnalysisJob | null) => {
      setAnalysisModalRepo(repo);
      setAnalysisModalBranch(branch || repo.defaultBranch);
      setAnalysisModalJob(existingJob ?? null);
    },
    []
  );

  const handleSelectRepo = useCallback(
    (repo: Repository, defaultTab?: InspectorTab) => {
      setSelectedRepo(repo);
      setActiveBranch(repo.defaultBranch);
      setPrState('open');
      setPrPage(1);
      setBranchesPage(1);
      setCommitsPage(1);
      setCurrentPath('');
      setContentsResult(null);
      setRepoDetails(null);
      setBranches([]);
      setCommits([]);
      setPulls([]);
      setAnalysisJobs([]);
      setAnalysisJobsError(null);
      setAnalysisJobsAuthRequired(false);

      const initialTab: InspectorTab = defaultTab || (repo.isDemo ? 'pulls' : 'files');
      setInspectorTab(initialTab);

      if (repo.isDemo) {
        loadPulls(repo, 'open', 1);
      } else {
        loadContents(repo, '', repo.defaultBranch);
        loadOverviewAndBranches(repo, 1);
      }
    },
    [loadContents, loadOverviewAndBranches, loadPulls]
  );

  useEffect(() => {
    if (!focusedRepoId) return;
    const target = repositories.find((r) => r.id === focusedRepoId);
    if (target) {
      handleSelectRepo(target);
      onClearFocusedRepo?.();
    }
  }, [focusedRepoId, repositories, onClearFocusedRepo, handleSelectRepo]);

  useEffect(() => {
    if (!autoOpenAnalyzeRepoId) return;
    const target = repositories.find((r) => r.id === autoOpenAnalyzeRepoId);
    if (target) {
      handleSelectRepo(target, 'analysis-history');
      handleOpenAnalyzeModal(target, target.defaultBranch);
      onClearAutoOpenAnalyze?.();
    }
  }, [autoOpenAnalyzeRepoId, repositories, onClearAutoOpenAnalyze, handleSelectRepo, handleOpenAnalyzeModal]);

  function handleTabSwitch(tab: InspectorTab) {
    setInspectorTab(tab);
    if (!selectedRepo || selectedRepo.isDemo) return;
    if (tab === 'pulls' && pulls.length === 0 && !loadingPulls) {
      loadPulls(selectedRepo, prState, prPage);
    } else if (tab === 'commits' && commits.length === 0 && !loadingCommits) {
      loadCommits(selectedRepo, activeBranch || selectedRepo.defaultBranch, commitsPage);
    } else if (tab === 'overview' && !repoDetails && !loadingOverview) {
      loadOverviewAndBranches(selectedRepo, branchesPage);
    } else if (tab === 'files' && !contentsResult && !loadingContents) {
      loadContents(selectedRepo, currentPath, activeBranch || selectedRepo.defaultBranch);
    } else if (tab === 'analysis-history') {
      loadAnalysisJobs(selectedRepo);
    }
  }

  async function handleToggleAutoReview(repo: Repository) {
    setActionError(null);
    try {
      const res = await api.toggleRepositoryAutoReview(repo.id, !repo.autoReviewEnabled);
      void syncRepositoryAutoReview(res.repository.id, res.repository.autoReviewEnabled);
      onRefresh();
      showToast({
        title: res.repository.autoReviewEnabled
          ? 'Auto-review enabled'
          : 'Auto-review paused',
        description: repo.fullName,
        variant: 'info',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to update repository.';
      setActionError(msg);
      showToast({
        title: 'Repository update failed',
        description: msg,
        variant: 'error',
      });
    }
  }

  async function handleConfirmDeleteRepo() {
    if (!repoPendingDelete) return;
    const target = repoPendingDelete;
    setDeletingRepo(true);
    setActionError(null);
    try {
      await api.deleteRepository(target.id);
      void removeRepositoryFromFirestore(target.id);
      if (selectedRepo?.id === target.id) {
        setSelectedRepo(null);
        setPulls([]);
      }
      setRepoPendingDelete(null);
      onRefresh();
      showToast({
        title: 'Repository disconnected',
        description: `${target.fullName} was removed from your workspace.`,
        variant: 'info',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to disconnect repository.';
      setActionError(msg);
      showToast({
        title: 'Disconnect failed',
        description: msg,
        variant: 'error',
      });
    } finally {
      setDeletingRepo(false);
    }
  }

  const pathSegments = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
    <div className="space-y-6">
      {(error || actionError) && (
        <ErrorBanner message={actionError || error || ''} onRetry={onRefresh} />
      )}

      {/* GitHub Account Connection Bar */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-300">
          {githubAuth?.authenticated && githubAuth.user ? (
            <span>
              GitHub OAuth connected as{' '}
              <a
                href={githubAuth.user.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono font-semibold text-slate-100 hover:underline"
              >
                @{githubAuth.user.login}
              </a>
              {' · '}
              {githubAuth.hasPrivateScope
                ? 'Public and private repositories enabled'
                : 'Public repositories enabled'}
            </span>
          ) : (
            <span>
              <span className="font-semibold text-slate-100">GitHub Account:</span> Sign in via GitHub OAuth to browse your personal and private repositories, or connect any public repository by slug.
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {githubAuth?.authenticated ? (
            <button
              type="button"
              onClick={onSignOutGitHub}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 rounded-md whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign out GitHub</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignInWithGitHub}
              disabled={!githubAuth?.configured}
              title={
                githubAuth?.configured
                  ? 'Sign in with GitHub OAuth'
                  : 'Configure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on the server first'
              }
              className="px-3 py-1.5 text-xs font-medium text-slate-100 bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
            >
              {githubAuth?.configured ? 'Sign in with GitHub' : 'OAuth Not Configured'}
            </button>
          )}
        </div>
      </div>

      {/* Toolbar: Search, Language & Status Filters, Table/Cards Toggle */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
          <div className="relative w-full sm:w-64">
            <Search
              className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search repositories, language, branch..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            aria-label="Filter repositories by language"
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value)}
            className="px-2.5 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Languages</option>
            {uniqueLanguages.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'live', label: 'Live GitHub' },
                { id: 'analyzed', label: 'Analyzed' },
                { id: 'auto_review', label: 'Auto-Review' },
                { id: 'demo', label: 'Demo' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Repository layout view"
            className="inline-flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md"
          >
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-label="Table view"
              aria-pressed={viewMode === 'table'}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'table'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <List className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              aria-label="Cards view"
              aria-pressed={viewMode === 'cards'}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'cards'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenConnectRepo}
            className="px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            Connect GitHub Repo
          </button>
        </div>
      </div>

      {/* Repository List: Table or Cards */}
      {loading && repositories.length === 0 ? (
        <div className="bg-[#111827] border border-slate-800/90 rounded-lg">
          <TableSkeleton rows={4} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No repositories match your filter"
          description="Connect any public or private GitHub repository to browse files, branches, commits, and pull requests."
          actionLabel="Connect Repository"
          onAction={onOpenConnectRepo}
        />
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((repo) => {
            const isSelected = selectedRepo?.id === repo.id;
            const snapshot = repoSnapshots.get(repo.id);
            const analysisLabel =
              snapshot?.analysisStatus === 'completed'
                ? 'Analyzed'
                : snapshot?.analysisStatus === 'partial'
                  ? 'Partial'
                  : snapshot?.analysisStatus === 'running'
                    ? 'Running'
                    : snapshot?.analysisStatus === 'failed'
                      ? 'Failed'
                      : 'Not analyzed';
            const analysisTone =
              snapshot?.analysisStatus === 'completed'
                ? 'text-emerald-400'
                : snapshot?.analysisStatus === 'partial'
                  ? 'text-amber-400'
                  : snapshot?.analysisStatus === 'running'
                    ? 'text-blue-400'
                    : snapshot?.analysisStatus === 'failed'
                      ? 'text-red-400'
                      : 'text-slate-500';

            return (
              <article
                key={repo.id}
                className={`bg-[#111827] border rounded-lg p-5 flex flex-col justify-between gap-4 transition-colors ${
                  isSelected
                    ? 'border-blue-500/60 bg-slate-800/35'
                    : 'border-slate-800/90 hover:border-slate-700'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {repo.isPrivate && (
                          <Lock
                            className="w-3.5 h-3.5 text-amber-400 shrink-0"
                            aria-label="Private repository"
                          />
                        )}
                        <h3 className="font-mono text-sm font-semibold text-slate-100 truncate">
                          {repo.fullName}
                        </h3>
                        <a
                          href={repo.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${repo.fullName} on GitHub`}
                          className="text-slate-500 hover:text-slate-200 shrink-0"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 truncate">
                        {repo.isDemo
                          ? 'Demo data'
                          : repo.isPrivate
                            ? 'Live GitHub · Private'
                            : 'Live GitHub · Public'}{' '}
                        · {repo.language}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-slate-500">Health</div>
                      <div
                        className={`font-mono font-semibold text-base tabular-nums ${getScoreColorClass(
                          repo.healthScore
                        )}`}
                      >
                        {repo.healthScore}
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#0B0F17] border border-slate-800/80 rounded-md p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Branch / PRs</span>
                      <span className="font-mono text-slate-200 tabular-nums">
                        {repo.defaultBranch} · {repo.openPrsCount} open PRs
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Analysis Status</span>
                      <span className={`font-medium ${analysisTone}`}>{analysisLabel}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Commit / Coverage</span>
                      <span className="font-mono text-slate-300 tabular-nums truncate">
                        {snapshot?.lastCommitSha
                          ? formatCommitSha(snapshot.lastCommitSha)
                          : '—'}
                        {snapshot?.coverageLabel ? ` · ${snapshot.coverageLabel}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Last Analysis</span>
                      <span className="font-mono text-slate-400 tabular-nums">
                        {snapshot?.lastAnalyzedAt
                          ? formatRelativeTime(snapshot.lastAnalyzedAt)
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => handleToggleAutoReview(repo)}
                    className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                      repo.autoReviewEnabled
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Auto: {repo.autoReviewEnabled ? 'On' : 'Paused'}
                  </button>

                  <div className="flex items-center gap-1.5">
                    {!repo.isDemo && (
                      <button
                        type="button"
                        onClick={() => handleOpenAnalyzeModal(repo)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Analyze</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSelectRepo(repo)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 rounded-md transition-colors whitespace-nowrap"
                    >
                      <Folder className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Inspect</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRepoPendingDelete(repo)}
                      aria-label={`Remove ${repo.fullName}`}
                      className="p-1.5 text-slate-500 hover:text-red-400 rounded-md transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 text-[12px] font-medium text-slate-400 bg-[#0E1420]">
                  <th className="py-2.5 px-5">Repository</th>
                  <th className="py-2.5 px-4">Language / Branch</th>
                  <th className="py-2.5 px-4">Last Analysis</th>
                  <th className="py-2.5 px-4 text-right">Open PRs</th>
                  <th className="py-2.5 px-4 text-right">Health</th>
                  <th className="py-2.5 px-4">Auto-Review</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {filtered.map((repo) => {
                  const isSelected = selectedRepo?.id === repo.id;
                  const snapshot = repoSnapshots.get(repo.id);
                  const analysisLabel =
                    snapshot?.analysisStatus === 'completed'
                      ? 'Completed'
                      : snapshot?.analysisStatus === 'partial'
                        ? 'Partial'
                        : snapshot?.analysisStatus === 'running'
                          ? 'Running'
                          : snapshot?.analysisStatus === 'failed'
                            ? 'Failed'
                            : 'Not analyzed';
                  const analysisTone =
                    snapshot?.analysisStatus === 'completed'
                      ? 'text-emerald-400'
                      : snapshot?.analysisStatus === 'partial'
                        ? 'text-amber-400'
                        : snapshot?.analysisStatus === 'running'
                          ? 'text-blue-400'
                          : snapshot?.analysisStatus === 'failed'
                            ? 'text-red-400'
                            : 'text-slate-500';

                  return (
                    <tr
                      key={repo.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-slate-800/45' : 'hover:bg-slate-800/30'
                      }`}
                    >
                      <td className="py-3.5 px-5 max-w-[340px]">
                        <div className="flex items-center gap-2">
                          {repo.isPrivate && (
                            <Lock
                              className="w-3.5 h-3.5 text-amber-400 shrink-0"
                              aria-label="Private repository"
                            />
                          )}
                          <span className="font-mono font-medium text-slate-100 truncate">
                            {repo.fullName}
                          </span>
                          <a
                            href={repo.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${repo.fullName} on GitHub`}
                            className="text-slate-500 hover:text-slate-200 shrink-0"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 truncate">
                          {repo.isDemo
                            ? 'Demo data'
                            : repo.isPrivate
                              ? 'Live GitHub · Private'
                              : 'Live GitHub · Public'}{' '}
                          · {repo.stars.toLocaleString()} stars · Reviewed{' '}
                          {formatRelativeTime(repo.lastReviewedAt)}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                        <div className="text-slate-200">{repo.language}</div>
                        <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                          {repo.defaultBranch}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                        <div className={`font-medium ${analysisTone}`}>
                          {analysisLabel}
                          {snapshot?.lastCommitSha && (
                            <span className="font-mono text-slate-400 ml-1.5">
                              ({formatCommitSha(snapshot.lastCommitSha)})
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5 tabular-nums">
                          {snapshot?.coverageLabel ? `${snapshot.coverageLabel} · ` : ''}
                          {snapshot?.lastAnalyzedAt
                            ? formatRelativeTime(snapshot.lastAnalyzedAt)
                            : '—'}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs text-slate-200 tabular-nums whitespace-nowrap">
                        {repo.openPrsCount}
                      </td>
                      <td
                        className={`py-3.5 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${getScoreColorClass(
                          repo.healthScore
                        )}`}
                      >
                        {repo.healthScore}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleAutoReview(repo)}
                          className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                            repo.autoReviewEnabled
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {repo.autoReviewEnabled ? 'Enabled' : 'Paused'}
                        </button>
                      </td>
                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {!repo.isDemo && (
                            <button
                              type="button"
                              onClick={() => handleOpenAnalyzeModal(repo)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Analyze</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleSelectRepo(repo)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 rounded-md transition-colors"
                          >
                            <Folder className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Inspect</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setRepoPendingDelete(repo)}
                            aria-label={`Remove ${repo.fullName}`}
                            className="p-1.5 text-slate-500 hover:text-red-400 rounded-md transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Selected Repository Inspector Panel */}
      {selectedRepo && (
        <section className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                {selectedRepo.isPrivate && (
                  <Lock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                )}
                <h3 className="text-sm font-semibold text-slate-100 font-mono">
                  {selectedRepo.fullName}
                </h3>
                <span className="text-xs text-slate-400">
                  · {selectedRepo.isDemo ? 'Demo dataset' : selectedRepo.isPrivate ? 'Private GitHub Repo' : 'Public GitHub Repo'}
                </span>
              </div>
              {rateLimit && !selectedRepo.isDemo && (
                <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                  GitHub API quota: {rateLimit.remaining} / {rateLimit.limit} remaining
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              {!selectedRepo.isDemo && branches.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  <select
                    aria-label="Select branch"
                    value={activeBranch || selectedRepo.defaultBranch}
                    onChange={(e) => {
                      const nextBranch = e.target.value;
                      setActiveBranch(nextBranch);
                      setCommitsPage(1);
                      loadContents(selectedRepo, '', nextBranch);
                      if (inspectorTab === 'commits') {
                        loadCommits(selectedRepo, nextBranch, 1);
                      } else {
                        setCommits([]);
                      }
                    }}
                    className="px-2.5 py-1 text-xs bg-[#0B0F17] border border-slate-800 rounded text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                  >
                    {branches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!selectedRepo.isDemo && (
                <button
                  type="button"
                  onClick={() =>
                    handleOpenAnalyzeModal(
                      selectedRepo,
                      activeBranch || selectedRepo.defaultBranch
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Analyze Repository</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedRepo(null)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
            </div>
          </div>

          {/* Inspector Tabs */}
          <div className="px-5 pt-3 border-b border-slate-800/80 flex items-center gap-1 overflow-x-auto bg-[#0E1420]/50">
            {(
              [
                { id: 'files', label: 'Files & Code', icon: FileCode },
                { id: 'pulls', label: 'Pull Requests', icon: GitPullRequest },
                { id: 'commits', label: 'Commits', icon: GitCommit },
                { id: 'overview', label: 'Branches & Languages', icon: GitBranch },
                { id: 'analysis-history', label: 'Analysis History', icon: History },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = inspectorTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabSwitch(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-blue-500 text-slate-100'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Body */}
          {selectedRepo.isDemo && inspectorTab !== 'pulls' ? (
            <div className="p-6 text-center space-y-3">
              <p className="text-sm text-slate-300">
                <span className="font-mono">{selectedRepo.fullName}</span> is a demo placeholder repository.
              </p>
              <p className="text-xs text-slate-400 max-w-lg mx-auto">
                Live source tree browsing, UTF-8 file reading, branch inspection, and commit history are available exclusively for real connected GitHub repositories.
              </p>
              <button
                type="button"
                onClick={onOpenConnectRepo}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
              >
                Connect Real GitHub Repository
              </button>
            </div>
          ) : (
            <div className="p-5">
              {/* TAB 1: FILES & SOURCE CODE */}
              {inspectorTab === 'files' && (
                <div className="space-y-4">
                  {/* Breadcrumb navigation */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        loadContents(
                          selectedRepo,
                          '',
                          activeBranch || selectedRepo.defaultBranch
                        )
                      }
                      className="text-blue-400 hover:underline"
                    >
                      {selectedRepo.name}
                    </button>
                    {pathSegments.map((segment, idx) => {
                      const partialPath = pathSegments.slice(0, idx + 1).join('/');
                      return (
                        <span key={partialPath} className="inline-flex items-center gap-1.5">
                          <span className="text-slate-600">/</span>
                          <button
                            type="button"
                            onClick={() =>
                              loadContents(
                                selectedRepo,
                                partialPath,
                                activeBranch || selectedRepo.defaultBranch
                              )
                            }
                            className="text-slate-200 hover:text-blue-400"
                          >
                            {segment}
                          </button>
                        </span>
                      );
                    })}
                  </div>

                  {loadingContents ? (
                    <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Fetching repository tree from GitHub...</span>
                    </div>
                  ) : contentsError ? (
                    <ErrorBanner
                      message={contentsError}
                      onRetry={() =>
                        loadContents(
                          selectedRepo,
                          currentPath,
                          activeBranch || selectedRepo.defaultBranch
                        )
                      }
                    />
                  ) : contentsResult?.kind === 'dir' ? (
                    <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-md bg-[#0B0F17]">
                      {currentPath !== '' && (
                        <button
                          type="button"
                          onClick={() => {
                            const parent = pathSegments.slice(0, -1).join('/');
                            loadContents(
                              selectedRepo,
                              parent,
                              activeBranch || selectedRepo.defaultBranch
                            );
                          }}
                          className="w-full px-3.5 py-2 text-left text-xs font-mono text-slate-400 hover:bg-slate-800/40 flex items-center gap-2"
                        >
                          <Folder className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                          <span>..</span>
                        </button>
                      )}
                      {(contentsResult.entries ?? []).map((entry) => (
                        <button
                          key={entry.sha + entry.path}
                          type="button"
                          onClick={() =>
                            loadContents(
                              selectedRepo,
                              entry.path,
                              activeBranch || selectedRepo.defaultBranch
                            )
                          }
                          className="w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {entry.type === 'dir' ? (
                              <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" aria-hidden="true" />
                            ) : (
                              <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                            )}
                            <span className="font-mono text-slate-100 truncate">
                              {entry.name}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                            {entry.type === 'dir'
                              ? 'dir'
                              : `${(entry.size / 1024).toFixed(1)} KB`}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : contentsResult?.kind === 'file' && contentsResult.file ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs font-mono text-slate-400 tabular-nums">
                          {contentsResult.file.path} · {(contentsResult.file.size / 1024).toFixed(1)} KB ·{' '}
                          {contentsResult.file.encoding}
                        </div>

                        <div className="flex items-center gap-2">
                          {contentsResult.file.htmlUrl && (
                            <a
                              href={contentsResult.file.htmlUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-300 bg-[#0B0F17] border border-slate-800 rounded hover:bg-slate-800"
                            >
                              <span>View on GitHub</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {!contentsResult.file.isBinary && !contentsResult.file.truncated && (
                            <button
                              type="button"
                              onClick={() =>
                                onAuditSourceFile(
                                  selectedRepo.fullName,
                                  contentsResult.file!.path,
                                  contentsResult.file!.content,
                                  activeBranch || selectedRepo.defaultBranch
                                )
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                            >
                              <Play className="w-3 h-3" aria-hidden="true" />
                              <span>Audit File with Gemini</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {contentsResult.file.isBinary ? (
                        <div className="p-6 text-center text-xs text-slate-400 bg-[#0B0F17] border border-slate-800 rounded-md">
                          Binary file detected ({contentsResult.file.name}). Inline source preview is skipped.
                        </div>
                      ) : contentsResult.file.truncated ? (
                        <div className="p-6 text-center text-xs text-slate-400 bg-[#0B0F17] border border-slate-800 rounded-md">
                          {contentsResult.file.content}
                        </div>
                      ) : (
                        <div className="bg-[#0B0F17] border border-slate-800 rounded-md overflow-x-auto max-h-[420px]">
                          <div className="py-2 font-mono text-xs leading-6 min-w-[540px]">
                            {contentsResult.file.content.split('\n').map((line, idx) => (
                              <div key={idx} className="flex px-3 hover:bg-slate-800/30">
                                <span className="w-10 shrink-0 select-none text-right pr-3 text-slate-600 tabular-nums">
                                  {idx + 1}
                                </span>
                                <span className="whitespace-pre text-slate-200">{line || ' '}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {/* TAB 2: PULL REQUESTS */}
              {inspectorTab === 'pulls' && (
                <div className="space-y-4">
                  {!selectedRepo.isDemo && (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md">
                        {(['open', 'closed', 'all'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => {
                              setPrState(st);
                              setPrPage(1);
                              loadPulls(selectedRepo, st, 1);
                            }}
                            className={`px-2.5 py-1 text-xs font-medium rounded capitalize transition-colors ${
                              prState === st
                                ? 'bg-slate-800 text-slate-100'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="font-mono tabular-nums">Page {pullsPagination.page}</span>
                        <button
                          type="button"
                          disabled={!pullsPagination.hasPrev || loadingPulls}
                          onClick={() => {
                            const next = Math.max(1, prPage - 1);
                            setPrPage(next);
                            loadPulls(selectedRepo, prState, next);
                          }}
                          className="p-1 bg-[#0B0F17] border border-slate-800 rounded disabled:opacity-40 hover:bg-slate-800 text-slate-200"
                          aria-label="Previous pull requests page"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={!pullsPagination.hasNext || loadingPulls}
                          onClick={() => {
                            const next = prPage + 1;
                            setPrPage(next);
                            loadPulls(selectedRepo, prState, next);
                          }}
                          className="p-1 bg-[#0B0F17] border border-slate-800 rounded disabled:opacity-40 hover:bg-slate-800 text-slate-200"
                          aria-label="Next pull requests page"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {loadingPulls ? (
                    <div className="py-6 flex items-center gap-2 text-xs text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Fetching pull requests from GitHub...</span>
                    </div>
                  ) : pullsError ? (
                    <ErrorBanner
                      message={pullsError}
                      onRetry={() => loadPulls(selectedRepo, prState, prPage)}
                    />
                  ) : pulls.length === 0 ? (
                    <div className="py-6 text-sm text-slate-400 text-center">
                      No {prState} pull requests found in this repository.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-md bg-[#0B0F17]">
                      {pulls.map((pr) => (
                        <div
                          key={pr.number}
                          className="px-4 py-3 flex flex-wrap items-center justify-between gap-4"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-100 truncate">
                              <span className="font-mono text-slate-400 mr-2">#{pr.number}</span>
                              {pr.title}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5 font-mono">
                              {pr.state} · {pr.headRef} → {pr.baseRef} · by {pr.user} · Updated{' '}
                              {formatRelativeTime(pr.updatedAt)}
                            </div>
                          </div>

                          {!selectedRepo.isDemo ? (
                            <button
                              type="button"
                              onClick={() => onTriggerPrReview(selectedRepo.fullName, pr.number)}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap shrink-0"
                            >
                              Review with Gemini
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500 whitespace-nowrap">
                              Demo PR preview
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: COMMITS */}
              {inspectorTab === 'commits' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-mono">
                      Branch: {activeBranch || selectedRepo.defaultBranch}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono tabular-nums">Page {commitsPagination.page}</span>
                      <button
                        type="button"
                        disabled={!commitsPagination.hasPrev || loadingCommits}
                        onClick={() => {
                          const next = Math.max(1, commitsPage - 1);
                          setCommitsPage(next);
                          loadCommits(
                            selectedRepo,
                            activeBranch || selectedRepo.defaultBranch,
                            next
                          );
                        }}
                        className="p-1 bg-[#0B0F17] border border-slate-800 rounded disabled:opacity-40 hover:bg-slate-800 text-slate-200"
                        aria-label="Previous commits page"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!commitsPagination.hasNext || loadingCommits}
                        onClick={() => {
                          const next = commitsPage + 1;
                          setCommitsPage(next);
                          loadCommits(
                            selectedRepo,
                            activeBranch || selectedRepo.defaultBranch,
                            next
                          );
                        }}
                        className="p-1 bg-[#0B0F17] border border-slate-800 rounded disabled:opacity-40 hover:bg-slate-800 text-slate-200"
                        aria-label="Next commits page"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {loadingCommits ? (
                    <div className="py-6 flex items-center gap-2 text-xs text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Fetching commit history from GitHub...</span>
                    </div>
                  ) : commitsError ? (
                    <ErrorBanner
                      message={commitsError}
                      onRetry={() =>
                        loadCommits(
                          selectedRepo,
                          activeBranch || selectedRepo.defaultBranch,
                          commitsPage
                        )
                      }
                    />
                  ) : commits.length === 0 ? (
                    <div className="py-6 text-sm text-slate-400 text-center">
                      No commits found on this branch.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-md bg-[#0B0F17]">
                      {commits.map((c) => (
                        <div
                          key={c.sha}
                          className="px-4 py-2.5 flex items-center justify-between gap-4"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-slate-100 truncate">
                              {c.message}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                              {c.authorLogin ? `@${c.authorLogin}` : c.authorName} ·{' '}
                              {c.date ? formatRelativeTime(c.date) : ''}
                            </div>
                          </div>
                          <a
                            href={c.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-xs text-blue-400 hover:underline shrink-0"
                          >
                            <span>{c.shortSha}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: BRANCHES & LANGUAGES */}
              {inspectorTab === 'overview' && (
                <div className="space-y-5">
                  {loadingOverview && !repoDetails ? (
                    <div className="py-6 flex items-center gap-2 text-xs text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Loading repository metadata, languages, and branches...</span>
                    </div>
                  ) : overviewError ? (
                    <ErrorBanner
                      message={overviewError}
                      onRetry={() => loadOverviewAndBranches(selectedRepo, branchesPage)}
                    />
                  ) : (
                    <>
                      {repoDetails && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-4 space-y-2">
                            <div className="text-xs font-semibold text-slate-300">
                              Repository Metadata
                            </div>
                            <p className="text-xs text-slate-400 leading-relaxed">
                              {repoDetails.description || 'No description provided.'}
                            </p>
                            <div className="pt-2 text-xs font-mono text-slate-300 tabular-nums space-y-1">
                              <div>Default branch: {repoDetails.defaultBranch}</div>
                              <div>
                                Visibility: {repoDetails.visibility} · Stars{' '}
                                {repoDetails.stars.toLocaleString()} · Forks{' '}
                                {repoDetails.forks.toLocaleString()}
                              </div>
                            </div>
                          </div>

                          <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-4 space-y-3">
                            <div className="text-xs font-semibold text-slate-300">
                              Languages Breakdown
                            </div>
                            {repoDetails.languages.length === 0 ? (
                              <div className="text-xs text-slate-500">No language data reported.</div>
                            ) : (
                              <div className="space-y-2">
                                {repoDetails.languages.slice(0, 6).map((lang) => (
                                  <div key={lang.name} className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                      <span className="text-slate-200">{lang.name}</span>
                                      <span className="font-mono text-slate-400 tabular-nums">
                                        {lang.percentage}%
                                      </span>
                                    </div>
                                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-blue-500 rounded-full"
                                        style={{ width: `${lang.percentage}%` }}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span className="font-semibold text-slate-300">Branches</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono tabular-nums">
                              Page {branchesPagination.page}
                            </span>
                            <button
                              type="button"
                              disabled={!branchesPagination.hasPrev || loadingOverview}
                              onClick={() => {
                                const next = Math.max(1, branchesPage - 1);
                                setBranchesPage(next);
                                loadOverviewAndBranches(selectedRepo, next);
                              }}
                              className="p-1 bg-[#0B0F17] border border-slate-800 rounded disabled:opacity-40 hover:bg-slate-800 text-slate-200"
                              aria-label="Previous branches page"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={!branchesPagination.hasNext || loadingOverview}
                              onClick={() => {
                                const next = branchesPage + 1;
                                setBranchesPage(next);
                                loadOverviewAndBranches(selectedRepo, next);
                              }}
                              className="p-1 bg-[#0B0F17] border border-slate-800 rounded disabled:opacity-40 hover:bg-slate-800 text-slate-200"
                              aria-label="Next branches page"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-md bg-[#0B0F17]">
                          {branches.map((b) => (
                            <div
                              key={b.name}
                              className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <GitBranch className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span className="font-mono text-slate-100 truncate">{b.name}</span>
                                {b.name === selectedRepo.defaultBranch && (
                                  <span className="text-blue-400">· default</span>
                                )}
                                {b.protected && (
                                  <span className="text-amber-400">· protected</span>
                                )}
                              </div>
                              <span className="font-mono text-slate-500 tabular-nums shrink-0">
                                {b.commitSha.slice(0, 7)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* TAB 5: ANALYSIS HISTORY */}
              {inspectorTab === 'analysis-history' && (
                <RepositoryAnalysisHistoryTab
                  repository={selectedRepo}
                  jobs={analysisJobs}
                  loading={loadingAnalysisJobs}
                  error={analysisJobsError}
                  authRequired={analysisJobsAuthRequired}
                  onRefresh={() => loadAnalysisJobs(selectedRepo)}
                  onSignInWithGitHub={onSignInWithGitHub}
                  onStartNewAnalysis={() =>
                    handleOpenAnalyzeModal(
                      selectedRepo,
                      activeBranch || selectedRepo.defaultBranch
                    )
                  }
                  onInspectJob={(job) =>
                    handleOpenAnalyzeModal(selectedRepo, job.branch, job)
                  }
                  onOpenReview={onOpenReviewById}
                />
              )}
            </div>
          )}
        </section>
      )}

      <RepositoryAnalysisModal
        open={Boolean(analysisModalRepo)}
        repository={analysisModalRepo}
        initialBranch={analysisModalBranch}
        initialJob={analysisModalJob}
        agents={agents}
        githubAuth={githubAuth}
        onClose={() => {
          setAnalysisModalRepo(null);
          setAnalysisModalJob(null);
        }}
        onSignInWithGitHub={onSignInWithGitHub}
        onOpenReview={onOpenReviewById}
        onJobUpdated={(updatedJob) => {
          void syncAnalysisJob(updatedJob);
          onJobUpdated?.(updatedJob);
          setAnalysisJobs((prev) => {
            const exists = prev.some((j) => j.id === updatedJob.id);
            if (!exists) return [updatedJob, ...prev];
            return prev.map((j) => (j.id === updatedJob.id ? updatedJob : j));
          });
          if (
            (updatedJob.status === 'completed' || updatedJob.status === 'partial') &&
            !refreshedTerminalJobsRef.current.has(updatedJob.id)
          ) {
            refreshedTerminalJobsRef.current.add(updatedJob.id);
            if (updatedJob.resultReviewId) {
              api
                .getReviewById(updatedJob.resultReviewId)
                .then((res) => syncReviewAndRelated(res.review))
                .catch(() => undefined);
            }
            onRefresh();
            showToast({
              title: 'Repository analysis complete',
              description: `${updatedJob.repositoryFullName} (${updatedJob.branch}) finished with ${updatedJob.completedAgents}/${updatedJob.totalAgents} agents.`,
              variant: updatedJob.status === 'partial' ? 'warning' : 'success',
            });
          } else if (
            updatedJob.status === 'failed' &&
            !refreshedTerminalJobsRef.current.has(updatedJob.id)
          ) {
            refreshedTerminalJobsRef.current.add(updatedJob.id);
            showToast({
              title: 'Repository analysis failed',
              description: updatedJob.error || updatedJob.repositoryFullName,
              variant: 'error',
            });
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(repoPendingDelete)}
        title={`Disconnect ${repoPendingDelete?.fullName || 'Repository'}?`}
        description="Removes this repository connection from CodeRubric and Cloud Firestore sync. Existing completed code reviews remain in your history."
        confirmLabel="Remove Repository"
        loading={deletingRepo}
        onCancel={() => setRepoPendingDelete(null)}
        onConfirm={() => void handleConfirmDeleteRepo()}
      />
    </div>
  );
}
