import { Loader2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../services/api';
import type { AIAgent, CodeReview, GitHubPullRequestSummary, Repository } from '../../types';

interface RunReviewModalProps {
  open: boolean;
  onClose: () => void;
  repositories: Repository[];
  agents: AIAgent[];
  initialRepoSlug?: string;
  initialPrNumber?: number;
  initialAgentId?: string;
  initialMode?: 'github-pr' | 'manual-diff';
  initialPrTitle?: string;
  initialBranch?: string;
  initialDiffText?: string;
  onReviewCreated: (review: CodeReview) => void;
}

const SAMPLE_DIFF = `diff --git a/src/api/users.ts b/src/api/users.ts
index 1a2b3c..4d5e6f 100644
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -12,6 +12,15 @@ export async function getUserByEmail(req, res) {
+  const email = req.query.email as string;
+  const rows = await db.query(\`SELECT * FROM users WHERE email = '\${email}'\`);
+  if (!rows.length) {
+    return res.status(404).json({ error: 'Not found' });
+  }
+  return res.json(rows[0]);
 }`;

export function RunReviewModal({
  open,
  onClose,
  repositories,
  agents,
  initialRepoSlug,
  initialPrNumber,
  initialAgentId,
  initialMode,
  initialPrTitle,
  initialBranch,
  initialDiffText,
  onReviewCreated,
}: RunReviewModalProps) {
  const [mode, setMode] = useState<'github-pr' | 'manual-diff'>(initialMode || 'github-pr');
  const [repoSlug, setRepoSlug] = useState(initialRepoSlug || 'expressjs/express');
  const [prNumber, setPrNumber] = useState(initialPrNumber ? String(initialPrNumber) : '');
  const [prTitle, setPrTitle] = useState(
    initialPrTitle || 'feat(users): lookup profile by email query param'
  );
  const [branch, setBranch] = useState(initialBranch || 'feat/user-email-lookup');
  const [diffText, setDiffText] = useState(initialDiffText || SAMPLE_DIFF);
  const [agentId, setAgentId] = useState(
    initialAgentId || agents[0]?.id || 'agent-security-sentinel'
  );

  const [pullOptions, setPullOptions] = useState<GitHubPullRequestSummary[]>([]);
  const [loadingPulls, setLoadingPulls] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialMode) {
      setMode(initialMode);
    } else if (initialRepoSlug) {
      setMode('github-pr');
    }
    if (initialRepoSlug) {
      setRepoSlug(initialRepoSlug);
    }
    if (initialPrNumber) {
      setPrNumber(String(initialPrNumber));
    }
    if (initialPrTitle) {
      setPrTitle(initialPrTitle);
    }
    if (initialBranch) {
      setBranch(initialBranch);
    }
    if (initialDiffText) {
      setDiffText(initialDiffText);
    }
    if (initialAgentId) {
      setAgentId(initialAgentId);
    } else if (agents.length > 0 && !agents.some((a) => a.id === agentId)) {
      setAgentId(agents[0].id);
    }
  }, [
    open,
    initialMode,
    initialRepoSlug,
    initialPrNumber,
    initialPrTitle,
    initialBranch,
    initialDiffText,
    initialAgentId,
    agents,
    agentId,
  ]);

  if (!open) return null;

  const liveRepositories = repositories.filter((r) => !r.isDemo);

  async function handleLoadPullsForRepo(repoId: string, fullName: string) {
    setRepoSlug(fullName);
    setLoadingPulls(true);
    setError(null);
    try {
      const res = await api.getRepositoryPulls(repoId, 'open');
      setPullOptions(res.pulls);
      if (res.pulls.length > 0) {
        setPrNumber(String(res.pulls[0].number));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch PRs.');
      setPullOptions([]);
    } finally {
      setLoadingPulls(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload =
        mode === 'github-pr'
          ? {
              mode: 'github-pr' as const,
              repositoryFullName: repoSlug.trim(),
              prNumber: Number(prNumber),
              agentId,
            }
          : {
              mode: 'manual-diff' as const,
              repositoryFullName: repoSlug.trim() || 'workspace/local-snippet',
              prTitle: prTitle.trim() || 'Manual Code Diff Audit',
              branch: branch.trim() || 'feature/local',
              diffText,
              agentId,
            };

      const res = await api.runReview(payload);
      onReviewCreated(res.review);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI review execution failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-review-title"
    >
      <div className="w-full max-w-2xl bg-[#111827] border border-slate-800 rounded-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <h2 id="run-review-title" className="text-base font-semibold text-slate-100">
            Run Gemini AI Code Review
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

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          {/* Mode Switcher */}
          <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-md w-fit">
            <button
              type="button"
              onClick={() => setMode('github-pr')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                mode === 'github-pr'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              GitHub Pull Request
            </button>
            <button
              type="button"
              onClick={() => setMode('manual-diff')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                mode === 'manual-diff'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Paste Code / Diff
            </button>
          </div>

          {mode === 'github-pr' ? (
            <div className="space-y-4">
              {liveRepositories.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Connected Live Repositories
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {liveRepositories.map((repo) => (
                      <button
                        key={repo.id}
                        type="button"
                        onClick={() => handleLoadPullsForRepo(repo.id, repo.fullName)}
                        className={`px-2.5 py-1.5 text-xs font-mono rounded border transition-colors ${
                          repoSlug === repo.fullName
                            ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                            : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        {repo.fullName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor="pr-repo-slug" className="block text-xs font-medium text-slate-300 mb-1.5">
                    GitHub Repository (owner/repo)
                  </label>
                  <input
                    id="pr-repo-slug"
                    type="text"
                    value={repoSlug}
                    onChange={(e) => setRepoSlug(e.target.value)}
                    placeholder="expressjs/express"
                    className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="pr-number" className="block text-xs font-medium text-slate-300 mb-1.5">
                    PR Number
                  </label>
                  <input
                    id="pr-number"
                    type="number"
                    min={1}
                    value={prNumber}
                    onChange={(e) => setPrNumber(e.target.value)}
                    placeholder="e.g. 5940"
                    className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 font-mono tabular-nums focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
              </div>

              {loadingPulls && (
                <div className="text-xs text-slate-400 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading open pull requests from GitHub...</span>
                </div>
              )}

              {pullOptions.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-300 mb-1.5">
                    Open Pull Requests in {repoSlug}
                  </div>
                  <div className="max-h-36 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-md bg-[#0B0F17]">
                    {pullOptions.map((pr) => (
                      <button
                        key={pr.number}
                        type="button"
                        onClick={() => setPrNumber(String(pr.number))}
                        className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-3 hover:bg-slate-800/60 ${
                          Number(prNumber) === pr.number ? 'bg-blue-600/15 text-blue-300' : 'text-slate-300'
                        }`}
                      >
                        <span className="truncate">
                          <span className="font-mono text-slate-400 mr-2">#{pr.number}</span>
                          {pr.title}
                        </span>
                        <span className="text-slate-500 shrink-0">{pr.user}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="manual-title" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Pull Request / Change Title
                  </label>
                  <input
                    id="manual-title"
                    type="text"
                    value={prTitle}
                    onChange={(e) => setPrTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="manual-branch" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Branch Name
                  </label>
                  <input
                    id="manual-branch"
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="manual-diff" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Unified Diff or Source Code
                </label>
                <textarea
                  id="manual-diff"
                  rows={8}
                  value={diffText}
                  onChange={(e) => setDiffText(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 font-mono leading-relaxed focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
            </div>
          )}

          {/* AI Agent Selector */}
          <div>
            <label htmlFor="agent-select" className="block text-xs font-medium text-slate-300 mb-1.5">
              Reviewer AI Agent
            </label>
            <select
              id="agent-select"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} — {agent.focus} ({agent.strictness})
                </option>
              ))}
            </select>
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
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              <span>{submitting ? 'Analyzing with Gemini...' : 'Run Rubric Review'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
