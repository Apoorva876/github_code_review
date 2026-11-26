import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { CommandPaletteModal } from './components/modals/CommandPaletteModal';
import { ConnectRepoModal } from './components/modals/ConnectRepoModal';
import { ReviewDetailDrawer } from './components/modals/ReviewDetailDrawer';
import { RunReviewModal } from './components/modals/RunReviewModal';
import { ErrorBanner } from './components/ui/DataState';
import { useFirebase } from './context/FirebaseContext';
import { useToast } from './context/ToastContext';
import { api } from './services/api';
import type {
  AIAgent,
  CodeReview,
  DashboardPayload,
  GitHubAuthStatus,
  NavSection,
  Repository,
  RepositoryAnalysisJob,
  RepositoryIntelligenceJob,
  ReviewStatus,
  Severity,
  WorkspaceSettings,
} from './types';
import { AgentsView } from './views/AgentsView';
import {
  AnalyzeView,
  type PullRequestReviewTarget,
  type RepositoryIntelligenceTarget,
} from './views/AnalyzeView';
import { AnalyticsView } from './views/AnalyticsView';
import { CodeReviewsView } from './views/CodeReviewsView';
import { DashboardView } from './views/DashboardView';
import { HistoryView } from './views/HistoryView';
import { LoginView } from './views/LoginView';
import { PullRequestReviewView } from './views/PullRequestReviewView';
import { RepositoriesView } from './views/RepositoriesView';
import { RepositoryIntelligenceView } from './views/RepositoryIntelligenceView';
import { SettingsView } from './views/SettingsView';

const VALID_SECTIONS: ReadonlySet<NavSection> = new Set([
  'dashboard',
  'analyze',
  'repository-intelligence',
  'pr-review',
  'repositories',
  'reviews',
  'agents',
  'history',
  'analytics',
  'settings',
]);

function readSectionFromHash(): NavSection {
  const raw = window.location.hash.replace(/^#\/?/, '').toLowerCase() as NavSection;
  return VALID_SECTIONS.has(raw) ? raw : 'dashboard';
}

export default function App() {
  const {
    user,
    authGateState,
    workspaceSyncVersion,
    syncError,
    clearSyncError,
    signOutFirebase,
    syncRepository,
    syncAnalysisJob,
    syncReviewAndRelated,
    syncReviewMutation,
  } = useFirebase();
  const { showToast } = useToast();
  const [activeSection, setActiveSection] = useState<NavSection>(() => readSectionFromHash());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [reviews, setReviews] = useState<CodeReview[]>([]);
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [analysisJobs, setAnalysisJobs] = useState<RepositoryAnalysisJob[]>([]);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [githubAuth, setGithubAuth] = useState<GitHubAuthStatus | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [connectRepoOpen, setConnectRepoOpen] = useState(false);
  const [runReviewOpen, setRunReviewOpen] = useState(false);
  const [prefillRepoSlug, setPrefillRepoSlug] = useState<string | undefined>(undefined);
  const [prefillPrNumber, setPrefillPrNumber] = useState<number | undefined>(undefined);
  const [prefillAgentId, setPrefillAgentId] = useState<string | undefined>(undefined);
  const [prefillMode, setPrefillMode] = useState<'github-pr' | 'manual-diff' | undefined>(
    undefined
  );
  const [prefillPrTitle, setPrefillPrTitle] = useState<string | undefined>(undefined);
  const [prefillBranch, setPrefillBranch] = useState<string | undefined>(undefined);
  const [prefillDiffText, setPrefillDiffText] = useState<string | undefined>(undefined);

  const [focusedRepoId, setFocusedRepoId] = useState<string | null>(null);
  const [autoOpenAnalyzeRepoId, setAutoOpenAnalyzeRepoId] = useState<string | null>(null);
  const [intelligenceTarget, setIntelligenceTarget] =
    useState<RepositoryIntelligenceTarget | null>(null);
  const [prReviewTarget, setPrReviewTarget] = useState<PullRequestReviewTarget | null>(null);
  const [selectedReview, setSelectedReview] = useState<CodeReview | null>(null);
  const [reviewFilterPreset, setReviewFilterPreset] = useState<{
    status: 'all' | ReviewStatus;
    severity: 'all' | Severity;
    key: number;
  }>({ status: 'all', severity: 'all', key: 0 });

  const navigateTo = useCallback((section: NavSection) => {
    setActiveSection(section);
    const targetHash = `#${section}`;
    if (window.location.hash !== targetHash) {
      window.history.pushState(null, '', targetHash);
    }
  }, []);

  useEffect(() => {
    function handleHashChange() {
      setActiveSection(readSectionFromHash());
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Global Ctrl+K / Cmd+K shortcut for Command Palette when authenticated
  useEffect(() => {
    if (authGateState !== 'authenticated') return;
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [authGateState]);

  const refreshGitHubAuth = useCallback(async () => {
    try {
      const authStatus = await api.getGitHubAuthStatus();
      setGithubAuth(authStatus);
    } catch {
      // Keep previous auth status if transient check fails
    }
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashRes, reposRes, reviewsRes, agentsRes, settingsRes, authRes] =
        await Promise.all([
          api.getDashboard(),
          api.getRepositories(),
          api.getReviews(),
          api.getAgents(),
          api.getSettings(),
          api.getGitHubAuthStatus(),
        ]);
      setDashboard(dashRes);
      setRepositories(reposRes.repositories);
      setReviews(reviewsRes.reviews);
      setAgents(agentsRes.agents);
      setSettings(settingsRes.settings);
      setGithubAuth(authRes);

      const canReadLiveJobs =
        authRes.authenticated || Boolean(settingsRes.settings.githubTokenConfigured);
      const readableRepos = reposRes.repositories.filter(
        (r) => !r.isDemo && (canReadLiveJobs || !r.isPrivate)
      );
      if (readableRepos.length > 0) {
        const jobLists = await Promise.all(
          readableRepos.map((repo) =>
            api
              .getRepositoryAnalysisJobs(repo.id)
              .then((res) => res.jobs)
              .catch(() => [] as RepositoryAnalysisJob[])
          )
        );
        const merged = new Map<string, RepositoryAnalysisJob>();
        for (const list of jobLists) {
          for (const job of list) merged.set(job.id, job);
        }
        setAnalysisJobs((prev) => {
          for (const existing of prev) {
            if (!merged.has(existing.id)) merged.set(existing.id, existing);
          }
          return Array.from(merged.values());
        });

        // Restore last viewed Repository Intelligence report if page reloaded on #repository-intelligence
        const savedRepoId = window.localStorage.getItem('coderubric.lastIntelRepoId');
        const candidateRepo =
          readableRepos.find((r) => r.id === savedRepoId) ?? readableRepos[0];
        if (candidateRepo) {
          api
            .getLatestRepositoryIntelligence(candidateRepo.id)
            .then(({ report }) => {
              const synthJob: RepositoryIntelligenceJob = {
                id: `intel-restored-${report.id}`,
                repositoryId: candidateRepo.id,
                repositoryFullName: report.repositoryFullName,
                branch: report.branch,
                status: report.analysisStatus === 'partial' ? 'partial' : 'completed',
                progress: 100,
                currentStep: report.analysisStatus === 'partial' ? 'partial' : 'completed',
                message: `Loaded persisted Repository Intelligence report for ${report.repositoryFullName}.`,
                createdAt: report.generatedAt,
                startedAt: report.generatedAt,
                updatedAt: report.generatedAt,
                completedAt: report.generatedAt,
                analyzedCommitSha: report.analyzedCommitSha,
                totalTreeEntries: report.coverage.totalTreeEntries,
                totalFiles: report.coverage.totalFiles,
                eligibleFiles: report.coverage.eligibleFiles,
                filesCollected: report.coverage.analyzedFiles,
                filesAnalyzed: report.coverage.analyzedFiles,
                filesSkipped: report.coverage.skippedFiles,
                failedFiles: report.coverage.failedFiles,
                truncatedFiles: report.coverage.truncatedFiles,
                totalChunks: report.coverage.totalChunksAnalyzed,
                completedChunks: report.coverage.totalChunksAnalyzed,
                reportId: report.id,
                fromCache: true,
                error: null,
              };
              setIntelligenceTarget((prev) =>
                prev
                  ? prev
                  : {
                      repository: candidateRepo,
                      parsed: {
                        ok: true,
                        owner: candidateRepo.owner,
                        repo: candidateRepo.name,
                        fullName: candidateRepo.fullName,
                        normalizedUrl: candidateRepo.htmlUrl,
                      },
                      job: synthJob,
                      report,
                    }
              );
            })
            .catch(() => {
              // No persisted intelligence report yet
            });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load CodeRubric workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authGateState !== 'authenticated') {
      setDashboard(null);
      setRepositories([]);
      setReviews([]);
      setAgents([]);
      setAnalysisJobs([]);
      setSettings(null);
      setGithubAuth(null);
      setSelectedReview(null);
      setFocusedRepoId(null);
      setAutoOpenAnalyzeRepoId(null);
      setIntelligenceTarget(null);
      setPrReviewTarget(null);
      setCommandPaletteOpen(false);
      setConnectRepoOpen(false);
      setRunReviewOpen(false);
      setMobileNavOpen(false);
      setError(null);
      setLoading(false);
      return;
    }
    void loadWorkspaceData();
  }, [authGateState, loadWorkspaceData, workspaceSyncVersion]);

  // Listen for cross-origin popup postMessage after GitHub OAuth callback completes
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const origin = event.origin || '';
      if (
        origin !== window.location.origin &&
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost')
      ) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setOauthError(null);
        void refreshGitHubAuth();
        void loadWorkspaceData();
        showToast({
          title: 'GitHub connected',
          description: 'OAuth session active for repository browsing and PR reviews.',
          variant: 'success',
        });
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        const msg = event.data?.message || 'GitHub OAuth authentication failed.';
        setOauthError(msg);
        showToast({
          title: 'GitHub OAuth error',
          description: msg,
          variant: 'error',
        });
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshGitHubAuth, loadWorkspaceData, showToast]);

  async function handleSignInWithGitHub() {
    setOauthError(null);
    try {
      const { url } = await api.getGitHubAuthUrl();
      const popup = window.open(url, 'github_oauth_popup', 'width=600,height=720');
      if (!popup) {
        setOauthError('Popup blocked by browser. Please allow popups for this site and retry.');
      }
    } catch (err) {
      setOauthError(
        err instanceof Error ? err.message : 'Unable to start GitHub OAuth flow.'
      );
    }
  }

  async function handleSignOutGitHub() {
    setOauthError(null);
    try {
      await api.logoutGitHub();
      await refreshGitHubAuth();
      showToast({
        title: 'Signed out of GitHub',
        description: 'GitHub OAuth session cleared.',
        variant: 'info',
      });
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : 'Failed to sign out of GitHub.');
    }
  }

  function handleOpenRunReview(options?: {
    repoSlug?: string;
    prNumber?: number;
    agentId?: string;
    mode?: 'github-pr' | 'manual-diff';
    prTitle?: string;
    branch?: string;
    diffText?: string;
  }) {
    setPrefillRepoSlug(options?.repoSlug);
    setPrefillPrNumber(options?.prNumber);
    setPrefillAgentId(options?.agentId);
    setPrefillMode(options?.mode);
    setPrefillPrTitle(options?.prTitle);
    setPrefillBranch(options?.branch);
    setPrefillDiffText(options?.diffText);
    setRunReviewOpen(true);
  }

  function handleReviewUpdated(updated: CodeReview) {
    setSelectedReview((prev) => (prev && prev.id === updated.id ? updated : prev));
    setReviews((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    void syncReviewMutation(updated);
    loadWorkspaceData();
  }

  const handleJobUpdated = useCallback((updatedJob: RepositoryAnalysisJob) => {
    setAnalysisJobs((prev) => {
      const exists = prev.some((j) => j.id === updatedJob.id);
      if (!exists) return [updatedJob, ...prev];
      return prev.map((j) => (j.id === updatedJob.id ? updatedJob : j));
    });
  }, []);

  const handleOpenReviewById = useCallback(
    async (reviewId: string) => {
      const existing = reviews.find((r) => r.id === reviewId);
      if (existing) {
        setSelectedReview(existing);
        return;
      }
      try {
        const res = await api.getReviewById(reviewId);
        setSelectedReview(res.review);
        void loadWorkspaceData();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to open repository review.'
        );
      }
    },
    [reviews, loadWorkspaceData]
  );

  if (authGateState === 'checking-auth') {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="coderubric-boot-mark" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#2563EB" />
                <stop offset="1" stopColor="#7C3AED" />
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#coderubric-boot-mark)" />
            <path
              d="M9.5 8.5L6.5 12L9.5 15.5M14.5 8.5L17.5 12L14.5 15.5M12.75 7.5L11.25 16.5"
              stroke="#F8FAFC"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" aria-hidden="true" />
            <span>Checking authentication...</span>
          </div>
          <p className="text-xs text-slate-400">
            Verifying your Google authentication session before loading CodeRubric.
          </p>
        </div>
      </div>
    );
  }

  if (authGateState === 'unauthenticated' || authGateState === 'unverified-email') {
    return <LoginView />;
  }

  if (authGateState === 'initializing-workspace') {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm rounded-xl bg-[#111827] border border-slate-800 px-8 py-7 shadow-xl">
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="coderubric-init-mark" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#2563EB" />
                <stop offset="1" stopColor="#7C3AED" />
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#coderubric-init-mark)" />
            <path
              d="M9.5 8.5L6.5 12L9.5 15.5M14.5 8.5L17.5 12L14.5 15.5M12.75 7.5L11.25 16.5"
              stroke="#F8FAFC"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-100">
            <Loader2 className="w-4 h-4 animate-spin text-purple-400" aria-hidden="true" />
            <span>Initializing your CodeRubric workspace...</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Syncing repositories, reviews, AI agents, and settings...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex">
      <Sidebar
        activeSection={activeSection}
        onNavigate={navigateTo}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        organizationName={settings?.organizationName || 'Acme Cloud Engineering'}
        userDisplayName={user?.displayName}
        userEmail={user?.email}
        userPhotoUrl={user?.photoURL}
        onSignOut={() => void signOutFirebase()}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeSection={activeSection}
          hasDemoData={Boolean(dashboard?.hasDemoData)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onOpenConnectRepo={() => setConnectRepoOpen(true)}
          onOpenRunReview={() => handleOpenRunReview()}
          onNavigateSettings={() => navigateTo('settings')}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto space-y-4">
          {oauthError && (
            <ErrorBanner message={oauthError} onRetry={() => setOauthError(null)} />
          )}
          {syncError && (
            <ErrorBanner message={syncError} onRetry={clearSyncError} />
          )}

          <div key={activeSection} className="cr-view-enter">
            {activeSection === 'dashboard' && (
              <DashboardView
                data={dashboard}
                reviews={reviews}
                agents={agents}
                analysisJobs={analysisJobs}
                loading={loading}
                error={error}
                onRetry={loadWorkspaceData}
                onSelectReview={setSelectedReview}
                onSelectRepository={(repo) => {
                  setFocusedRepoId(repo.id);
                  navigateTo('repositories');
                }}
                onNavigate={navigateTo}
                onNavigateFilteredReviews={(options) => {
                  setReviewFilterPreset((prev) => ({
                    status: options?.status ?? 'all',
                    severity: options?.severity ?? 'all',
                    key: prev.key + 1,
                  }));
                  navigateTo('reviews');
                }}
                onOpenConnectRepo={() => setConnectRepoOpen(true)}
                onRunReview={(agentId) => handleOpenRunReview(agentId ? { agentId } : undefined)}
              />
            )}

            {activeSection === 'analyze' && (
              <AnalyzeView
                initialUrl={intelligenceTarget?.parsed.normalizedUrl || prReviewTarget?.parsed.normalizedUrl || ''}
                onRepositoryVerified={(repo) => {
                  setRepositories((prev) => {
                    const exists = prev.some(
                      (r) => r.fullName.toLowerCase() === repo.fullName.toLowerCase()
                    );
                    return exists
                      ? prev.map((r) =>
                          r.fullName.toLowerCase() === repo.fullName.toLowerCase() ? repo : r
                        )
                      : [repo, ...prev];
                  });
                  void syncRepository(repo);
                }}
                onStartRepositoryIntelligence={(target) => {
                  window.localStorage.setItem('coderubric.lastIntelRepoId', target.repository.id);
                  setIntelligenceTarget(target);
                  navigateTo('repository-intelligence');
                }}
                onOpenPullRequestReview={(target) => {
                  setPrReviewTarget(target);
                  navigateTo('pr-review');
                }}
              />
            )}

            {activeSection === 'repository-intelligence' && (
              <RepositoryIntelligenceView
                target={intelligenceTarget}
                onBackToAnalyze={() => navigateTo('analyze')}
                onJobUpdated={(updatedJob) => {
                  setIntelligenceTarget((prev) =>
                    prev && prev.repository.id === updatedJob.repositoryId
                      ? { ...prev, job: updatedJob }
                      : prev
                  );
                }}
                onRunCodeReview={(repoSlug) => {
                  const matched = repositories.find(
                    (r) => r.fullName.toLowerCase() === repoSlug.toLowerCase()
                  );
                  if (matched) {
                    setAutoOpenAnalyzeRepoId(matched.id);
                    navigateTo('repositories');
                  } else {
                    handleOpenRunReview({ repoSlug, mode: 'github-pr' });
                  }
                }}
              />
            )}

            {activeSection === 'pr-review' && (
              <PullRequestReviewView
                target={prReviewTarget}
                onBackToAnalyze={() => navigateTo('analyze')}
                onTriggerPrReview={(slug, prNum) =>
                  handleOpenRunReview({ repoSlug: slug, prNumber: prNum, mode: 'github-pr' })
                }
              />
            )}

            {activeSection === 'repositories' && (
              <RepositoriesView
                repositories={repositories}
                agents={agents}
                reviews={reviews}
                externalAnalysisJobs={analysisJobs}
                loading={loading}
                error={error}
                githubAuth={githubAuth}
                focusedRepoId={focusedRepoId}
                onClearFocusedRepo={() => setFocusedRepoId(null)}
                autoOpenAnalyzeRepoId={autoOpenAnalyzeRepoId}
                onClearAutoOpenAnalyze={() => setAutoOpenAnalyzeRepoId(null)}
                onRefresh={loadWorkspaceData}
                onOpenConnectRepo={() => setConnectRepoOpen(true)}
                onSignInWithGitHub={handleSignInWithGitHub}
                onSignOutGitHub={handleSignOutGitHub}
                onOpenReviewById={handleOpenReviewById}
                onJobUpdated={handleJobUpdated}
                onTriggerPrReview={(slug, prNum) =>
                  handleOpenRunReview({ repoSlug: slug, prNumber: prNum, mode: 'github-pr' })
                }
                onAuditSourceFile={(repoFullName, filePath, content, branch) =>
                  handleOpenRunReview({
                    mode: 'manual-diff',
                    repoSlug: repoFullName,
                    prTitle: `Audit ${filePath}`,
                    branch,
                    diffText: content,
                  })
                }
              />
            )}

            {activeSection === 'reviews' && (
              <CodeReviewsView
                reviews={reviews}
                loading={loading}
                error={error}
                onRefresh={loadWorkspaceData}
                onSelectReview={setSelectedReview}
                onReviewUpdated={handleReviewUpdated}
                onRunReview={() => handleOpenRunReview()}
                initialStatusFilter={reviewFilterPreset.status}
                initialSeverityFilter={reviewFilterPreset.severity}
                filterPresetKey={reviewFilterPreset.key}
              />
            )}

            {activeSection === 'agents' && (
              <AgentsView
                agents={agents}
                reviews={reviews}
                analysisJobs={analysisJobs}
                error={error}
                onRefresh={loadWorkspaceData}
                onRunWithAgent={(agentId) => handleOpenRunReview({ agentId })}
              />
            )}

            {activeSection === 'history' && (
              <HistoryView
                reviews={reviews}
                loading={loading}
                error={error}
                onRefresh={loadWorkspaceData}
                onSelectReview={setSelectedReview}
                onReviewUpdated={handleReviewUpdated}
              />
            )}

            {activeSection === 'analytics' && (
              <AnalyticsView
                reviews={reviews}
                repositories={repositories}
                dailyActivity={dashboard?.dailyActivity ?? []}
                loading={loading}
                error={error}
                onRetry={loadWorkspaceData}
              />
            )}

            {activeSection === 'settings' && (
              <SettingsView
                settings={settings}
                agents={agents}
                githubAuth={githubAuth}
                error={error}
                onRefresh={loadWorkspaceData}
                onSignInWithGitHub={handleSignInWithGitHub}
                onSignOutGitHub={handleSignOutGitHub}
              />
            )}
          </div>
        </main>
      </div>

      <CommandPaletteModal
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        repositories={repositories}
        reviews={reviews}
        agents={agents}
        onNavigate={navigateTo}
        onOpenConnectRepo={() => setConnectRepoOpen(true)}
        onOpenRunReview={(agentId) => handleOpenRunReview(agentId ? { agentId } : undefined)}
        onSelectRepository={(repo) => {
          setFocusedRepoId(repo.id);
          navigateTo('repositories');
        }}
        onSelectReview={(rev) => setSelectedReview(rev)}
        onStartRepoAnalysis={(repo) => {
          setAutoOpenAnalyzeRepoId(repo.id);
          navigateTo('repositories');
        }}
      />

      <ConnectRepoModal
        open={connectRepoOpen}
        onClose={() => setConnectRepoOpen(false)}
        githubAuth={githubAuth}
        connectedRepoFullNames={repositories.map((r) => r.fullName)}
        onSignInWithGitHub={handleSignInWithGitHub}
        onSignOutGitHub={handleSignOutGitHub}
        onConnected={(repo) => {
          setFocusedRepoId(repo.id);
          void syncRepository(repo);
          loadWorkspaceData();
          navigateTo('repositories');
          showToast({
            title: 'Repository connected',
            description: `${repo.fullName} is ready for code inspection and analysis.`,
            variant: 'success',
          });
        }}
      />

      <RunReviewModal
        open={runReviewOpen}
        onClose={() => setRunReviewOpen(false)}
        repositories={repositories}
        agents={agents}
        initialRepoSlug={prefillRepoSlug}
        initialPrNumber={prefillPrNumber}
        initialAgentId={prefillAgentId}
        initialMode={prefillMode}
        initialPrTitle={prefillPrTitle}
        initialBranch={prefillBranch}
        initialDiffText={prefillDiffText}
        onReviewCreated={(created) => {
          setSelectedReview(created);
          void syncReviewAndRelated(created);
          loadWorkspaceData();
          showToast({
            title: 'AI code review completed',
            description: `${created.repositoryFullName} scored ${created.score}/100 with ${created.findings.length} findings.`,
            variant: 'success',
          });
        }}
      />

      <ReviewDetailDrawer
        review={selectedReview}
        onClose={() => setSelectedReview(null)}
        onReviewUpdated={handleReviewUpdated}
      />
    </div>
  );
}
