import {
  Check,
  Database,
  ExternalLink,
  GitBranch,
  Loader2,
  LogOut,
  RefreshCw,
  RotateCcw,
  Shield,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ErrorBanner } from '../components/ui/DataState';
import { useFirebase } from '../context/FirebaseContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import type { AIAgent, GitHubAuthStatus, WorkspaceSettings } from '../types';

interface SettingsViewProps {
  settings: WorkspaceSettings | null;
  agents: AIAgent[];
  githubAuth: GitHubAuthStatus | null;
  error: string | null;
  onRefresh: () => void;
  onSignInWithGitHub: () => void;
  onSignOutGitHub: () => void;
}

export function SettingsView({
  settings,
  agents,
  githubAuth,
  error,
  onRefresh,
  onSignInWithGitHub,
  onSignOutGitHub,
}: SettingsViewProps) {
  const {
    user,
    isVerifiedUser,
    signingIn,
    syncing,
    syncStatus,
    hasCompletedCloudSync,
    syncError,
    isQuotaError,
    firestoreCounts,
    lastSyncedAt,
    projectId,
    databaseId,
    upgradeUrl,
    signInWithGoogle,
    signOutFirebase,
    syncNow,
    syncWorkspaceSettings,
    syncWorkspaceResetFromExpress,
  } = useFirebase();
  const { showToast } = useToast();

  const [orgName, setOrgName] = useState(settings?.organizationName ?? '');
  const [defaultAgentId, setDefaultAgentId] = useState(
    settings?.defaultAgentId ?? agents[0]?.id ?? ''
  );
  const [minimumPassScore, setMinimumPassScore] = useState(
    settings?.minimumPassScore ?? 80
  );
  const [autoPostPrSummary, setAutoPostPrSummary] = useState(
    settings?.autoPostPrSummary ?? true
  );
  const [githubTokenInput, setGithubTokenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetOk, setResetOk] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [confirmClearTokenOpen, setConfirmClearTokenOpen] = useState(false);
  const [confirmResetDemoOpen, setConfirmResetDemoOpen] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setOrgName(settings.organizationName);
    setDefaultAgentId(settings.defaultAgentId);
    setMinimumPassScore(settings.minimumPassScore);
    setAutoPostPrSummary(settings.autoPostPrSummary);
  }, [settings]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedOk(false);
    setActionError(null);
    try {
      const payload: Parameters<typeof api.updateSettings>[0] = {
        organizationName: orgName,
        defaultAgentId,
        minimumPassScore: Number(minimumPassScore),
        autoPostPrSummary,
      };
      if (githubTokenInput.trim() !== '') {
        payload.githubToken = githubTokenInput.trim();
      }
      const res = await api.updateSettings(payload);
      void syncWorkspaceSettings(res.settings);
      setGithubTokenInput('');
      onRefresh();
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
      showToast({
        title: 'Workspace settings saved',
        description: 'Preferences persisted locally and queued for Cloud Firestore.',
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save settings.';
      setActionError(msg);
      showToast({
        title: 'Settings update failed',
        description: msg,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmClearGithubToken() {
    setSaving(true);
    setActionError(null);
    try {
      await api.updateSettings({ githubToken: '' });
      setConfirmClearTokenOpen(false);
      onRefresh();
      showToast({
        title: 'Server GitHub token removed',
        description: 'Cleared server fallback token.',
        variant: 'info',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to remove GitHub token.';
      setActionError(msg);
      showToast({
        title: 'Failed to remove token',
        description: msg,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmResetDemo() {
    setResetting(true);
    setResetOk(false);
    setActionError(null);
    try {
      await api.resetDemoData();
      await syncWorkspaceResetFromExpress();
      setConfirmResetDemoOpen(false);
      onRefresh();
      setResetOk(true);
      setTimeout(() => setResetOk(false), 2500);
      showToast({
        title: 'Demo dataset restored',
        description: 'Workspace restored to baseline demo repositories and reviews.',
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reset demo dataset.';
      setActionError(msg);
      showToast({
        title: 'Reset failed',
        description: msg,
        variant: 'error',
      });
    } finally {
      setResetting(false);
    }
  }

  async function handleSyncNow() {
    await syncNow();
    showToast({
      title: 'Cloud Firestore sync requested',
      description: 'Synchronized workspace snapshot with your Google account.',
      variant: 'info',
    });
  }

  return (
    <div className="max-w-5xl space-y-6">
      {(error || actionError) && (
        <ErrorBanner message={actionError || error || ''} onRetry={onRefresh} />
      )}

      {/* Top Row: Account / Cloud Database + GitHub OAuth */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Firebase Cloud Firestore Database Card */}
        <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-slate-100">
                    Google Account &amp; Cloud Firestore
                  </h2>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {isVerifiedUser && user
                    ? syncStatus === 'failed'
                      ? `Connected as ${user.email || user.displayName || user.uid}. Cloud Firestore synchronization failed, so local JSON persistence remains active.`
                      : `Connected as ${user.email || user.displayName || user.uid}. Repositories, code reviews, AI agent configs, analysis jobs, and preferences sync per account.`
                    : 'Sign in with Google to persist repositories, reviews, AI agent prompts, analysis jobs, and preferences to Cloud Firestore across sessions.'}
                </p>
              </div>
            </div>

            <div className="bg-[#0B0F17] border border-slate-800/80 rounded-md p-3.5 text-xs space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-400">Sync Mode</span>
                <span
                  className={
                    syncStatus === 'synced'
                      ? 'text-emerald-400 font-medium text-right'
                      : syncStatus === 'syncing'
                        ? 'text-blue-400 font-medium text-right'
                        : syncStatus === 'failed'
                          ? 'text-red-400 font-medium text-right'
                          : isVerifiedUser
                            ? 'text-amber-300 font-medium text-right'
                            : 'text-slate-300 font-medium text-right'
                  }
                >
                  {syncStatus === 'synced'
                    ? 'Cloud Firestore + Local JSON Mirror'
                    : syncStatus === 'syncing'
                      ? 'Syncing to Cloud Firestore (Local JSON Mirror active)'
                      : syncStatus === 'failed'
                        ? 'Cloud Sync Failed — Using Local JSON Fallback'
                        : user && !isVerifiedUser
                          ? 'Local JSON Only (Unverified Google email)'
                          : isVerifiedUser
                            ? 'Local JSON Fallback (Cloud sync pending)'
                            : 'Local JSON Only (Sign in to enable Cloud DB)'}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-400">Firebase Project / DB</span>
                <code className="font-mono text-slate-200 break-all text-right">
                  {projectId} / {databaseId}
                </code>
              </div>
              {isVerifiedUser && hasCompletedCloudSync && firestoreCounts && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-400">Synced Documents</span>
                  <span className="font-mono text-slate-200 tabular-nums">
                    {firestoreCounts.repositories} repos · {firestoreCounts.reviews} reviews ·{' '}
                    {firestoreCounts.agents} agents · {firestoreCounts.analysisJobs} jobs
                  </span>
                </div>
              )}
              {isVerifiedUser && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-400">Last Cloud Sync</span>
                  {lastSyncedAt ? (
                    <span className="font-mono text-slate-300 tabular-nums">
                      {new Date(lastSyncedAt).toLocaleTimeString()}
                    </span>
                  ) : (
                    <span
                      className={
                        syncStatus === 'failed' ? 'text-red-300 font-medium' : 'text-slate-400'
                      }
                    >
                      {syncStatus === 'syncing'
                        ? 'In progress...'
                        : 'None (initial sync has not completed)'}
                    </span>
                  )}
                </div>
              )}
            </div>

            {syncError && (
              <div
                role="alert"
                className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-xs text-red-300 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{syncError}</span>
                  {isVerifiedUser && (
                    <button
                      type="button"
                      disabled={syncing}
                      onClick={() => void handleSyncNow()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-200 bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 border border-red-500/40 rounded whitespace-nowrap"
                    >
                      <RefreshCw className="w-3 h-3" aria-hidden="true" />
                      <span>Retry Sync</span>
                    </button>
                  )}
                </div>
                {isQuotaError && (
                  <a
                    href={upgradeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-300 hover:underline font-medium"
                  >
                    <span>Open Firebase Blaze Plan Upgrade Dialog</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
            {isVerifiedUser && user ? (
              <>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void handleSyncNow()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 disabled:opacity-50 border border-slate-800 rounded-md whitespace-nowrap"
                >
                  {syncing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void signOutFirebase()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 rounded-md whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Sign out Google</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={signingIn}
                onClick={() => void signInWithGoogle()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
              >
                {signingIn && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                <span>{signingIn ? 'Connecting...' : 'Sign in with Google'}</span>
              </button>
            )}
          </div>
        </section>

        {/* GitHub OAuth Connection Card */}
        <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-purple-400 shrink-0" aria-hidden="true" />
                <h2 className="text-base font-semibold text-slate-100">
                  GitHub OAuth Authentication
                </h2>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                {githubAuth?.authenticated && githubAuth.user
                  ? `Authenticated as @${githubAuth.user.login} (${githubAuth.hasPrivateScope ? 'public + private repo access' : 'public repo access'}).`
                  : 'Authenticate individual GitHub accounts via OAuth to access personal and private repositories.'}
              </p>
            </div>

            <div className="bg-[#0B0F17] border border-slate-800/80 rounded-md p-3.5 text-xs space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-400">OAuth Server Configuration</span>
                <span
                  className={
                    githubAuth?.configured
                      ? 'text-emerald-400 font-medium'
                      : 'text-amber-400 font-medium'
                  }
                >
                  {githubAuth?.configured
                    ? 'Configured'
                    : 'Missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET'}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-400">Session Status</span>
                <span
                  className={
                    githubAuth?.authenticated
                      ? 'text-emerald-400 font-medium'
                      : 'text-slate-300 font-medium'
                  }
                >
                  {githubAuth?.authenticated && githubAuth.user
                    ? `Connected (@${githubAuth.user.login})`
                    : 'Not connected'}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-400">Callback URL</span>
                <code className="font-mono text-slate-200 break-all text-right">
                  {githubAuth?.callbackUrl || '/auth/github/callback'}
                </code>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
            {githubAuth?.authenticated ? (
              <button
                type="button"
                onClick={onSignOutGitHub}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 rounded-md whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign out GitHub</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignInWithGitHub}
                disabled={!githubAuth?.configured}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                Sign in with GitHub
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Workspace Preferences & Server Token Form */}
      <form
        onSubmit={handleSave}
        className="bg-[#111827] border border-slate-800/90 rounded-lg divide-y divide-slate-800/80"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">Workspace Preferences</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure organization defaults and minimum rubric approval thresholds.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="org-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                Organization Name
              </label>
              <input
                id="org-name"
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label
                htmlFor="default-agent"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Default Reviewer Agent
              </label>
              <select
                id="default-agent"
                value={defaultAgentId}
                onChange={(e) => setDefaultAgentId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label
                htmlFor="min-score"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Minimum Approval Score ({minimumPassScore} / 100)
              </label>
              <input
                id="min-score"
                type="range"
                min={50}
                max={95}
                value={minimumPassScore}
                onChange={(e) => setMinimumPassScore(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>

            <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer pt-4">
              <input
                type="checkbox"
                checked={autoPostPrSummary}
                onChange={(e) => setAutoPostPrSummary(e.target.checked)}
                className="w-4 h-4 accent-blue-600 rounded"
              />
              <span>Generate structured rubric summary per PR</span>
            </label>
          </div>
        </div>

        {/* GitHub REST API Token (Optional server fallback) */}
        <div className="p-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Server GitHub Personal Access Token (Optional Fallback)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Used only on the Node.js server when no OAuth user is signed in, to raise GitHub REST API rate limits. Never sent to the browser.
              </p>
            </div>
            {settings?.githubTokenConfigured && (
              <span className="text-xs font-mono text-emerald-400 whitespace-nowrap">
                Configured ({settings.githubTokenMask})
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="password"
              value={githubTokenInput}
              onChange={(e) => setGithubTokenInput(e.target.value)}
              placeholder={
                settings?.githubTokenConfigured
                  ? 'Enter new GitHub PAT to replace existing token'
                  : 'ghp_... (optional)'
              }
              className="flex-1 min-w-[240px] px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 font-mono placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
            {settings?.githubTokenConfigured && (
              <button
                type="button"
                onClick={() => setConfirmClearTokenOpen(true)}
                className="px-3 py-2 text-xs font-medium text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-md whitespace-nowrap transition-colors"
              >
                Remove Token
              </button>
            )}
          </div>
        </div>

        {/* Submit Footer */}
        <div className="px-6 py-4 flex items-center justify-between gap-4 bg-[#0E1420]/60">
          <div className="text-xs text-slate-400">
            {savedOk && (
              <span className="inline-flex items-center gap-1.5 text-emerald-400">
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Settings saved</span>
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            <span>Save Settings</span>
          </button>
        </div>
      </form>

      {/* Persistence & Demo Data Management */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <h3 className="text-sm font-semibold text-slate-100">Storage &amp; Demo Dataset</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            {settings?.persistenceNote ||
              'Persisting reviews, repositories, and agent configurations on the Node.js server.'}
          </p>
          {resetOk && (
            <p className="text-xs text-emerald-400 pt-1">
              Demo dataset restored to initial baseline.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setConfirmResetDemoOpen(true)}
          disabled={resetting}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-200 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{resetting ? 'Resetting...' : 'Reset Demo Dataset'}</span>
        </button>
      </section>

      <ConfirmDialog
        open={confirmClearTokenOpen}
        title="Remove Server GitHub Token?"
        description="This clears the fallback GitHub Personal Access Token stored on the server. Private or unauthenticated requests will rely on your browser GitHub OAuth session."
        confirmLabel="Remove Token"
        loading={saving}
        onCancel={() => setConfirmClearTokenOpen(false)}
        onConfirm={() => void handleConfirmClearGithubToken()}
      />

      <ConfirmDialog
        open={confirmResetDemoOpen}
        title="Reset Demo Dataset?"
        description="Restores CodeRubric's baseline demo repositories and pull request reviews across the server store and your synced Cloud Firestore workspace."
        confirmLabel="Reset Dataset"
        loading={resetting}
        onCancel={() => setConfirmResetDemoOpen(false)}
        onConfirm={() => void handleConfirmResetDemo()}
      />
    </div>
  );
}
