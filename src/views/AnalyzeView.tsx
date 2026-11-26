import { AlertCircle, GitPullRequest, Loader2, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../services/api';
import type {
  GitHubPagination,
  GitHubPullRequestSummary,
  GitHubRateLimit,
  Repository,
  RepositoryIntelligenceJob,
  RepositoryIntelligenceReport,
} from '../types';
import { parsePublicGitHubRepoUrl, type ParsedGitHubRepoUrl } from '../utils/githubUrl';

export interface RepositoryIntelligenceTarget {
  repository: Repository;
  parsed: ParsedGitHubRepoUrl;
  job: RepositoryIntelligenceJob;
  report?: RepositoryIntelligenceReport | null;
}

export interface PullRequestReviewTarget {
  repository: Repository;
  parsed: ParsedGitHubRepoUrl;
  pulls: GitHubPullRequestSummary[];
  pagination?: GitHubPagination;
  rateLimit?: GitHubRateLimit | null;
}

interface AnalyzeViewProps {
  initialUrl?: string;
  onRepositoryVerified: (repo: Repository) => void;
  onStartRepositoryIntelligence: (target: RepositoryIntelligenceTarget) => void;
  onOpenPullRequestReview: (target: PullRequestReviewTarget) => void;
}

export function AnalyzeView({
  initialUrl = '',
  onRepositoryVerified,
  onStartRepositoryIntelligence,
  onOpenPullRequestReview,
}: AnalyzeViewProps) {
  const [repoUrl, setRepoUrl] = useState(initialUrl);
  const [activeAction, setActiveAction] = useState<'analyze' | 'pulls' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBusy = activeAction !== null;

  async function handleAnalyzeRepository() {
    if (isBusy) return;
    setError(null);

    const validation = parsePublicGitHubRepoUrl(repoUrl);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setActiveAction('analyze');
    try {
      const { repository } = await api.connectRepository(validation.normalizedUrl);
      onRepositoryVerified(repository);

      const { job } = await api.startRepositoryIntelligence(
        repository.id,
        repository.defaultBranch
      );

      onStartRepositoryIntelligence({
        repository,
        parsed: validation,
        job,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to verify repository or start repository intelligence analysis.'
      );
    } finally {
      setActiveAction(null);
    }
  }

  async function handleReviewPullRequest() {
    if (isBusy) return;
    setError(null);

    const validation = parsePublicGitHubRepoUrl(repoUrl);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setActiveAction('pulls');
    try {
      const { repository } = await api.connectRepository(validation.normalizedUrl);
      onRepositoryVerified(repository);

      const pullsRes = await api.getRepositoryPulls(repository.id, 'open', 1, 15);
      onOpenPullRequestReview({
        repository,
        parsed: validation,
        pulls: pullsRes.pulls,
        pagination: pullsRes.pagination,
        rateLimit: pullsRes.rateLimit ?? null,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to verify repository or retrieve public pull requests.'
      );
    } finally {
      setActiveAction(null);
    }
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    void handleAnalyzeRepository();
  }

  return (
    <div className="min-h-[calc(100vh-8.5rem)] flex items-center justify-center py-8 px-2">
      <section className="w-full max-w-2xl bg-[#111827] border border-slate-800/90 rounded-xl p-6 sm:p-10 shadow-xl shadow-black/30">
        {/* CodeRubric Branding */}
        <div className="flex items-center justify-center gap-3">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0"
            aria-hidden="true"
          >
            <defs>
              <linearGradient
                id="coderubric-analyze-mark"
                x1="2"
                y1="2"
                x2="22"
                y2="22"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#2563EB" />
                <stop offset="1" stopColor="#7C3AED" />
              </linearGradient>
            </defs>
            <rect
              x="2"
              y="2"
              width="20"
              height="20"
              rx="5"
              fill="url(#coderubric-analyze-mark)"
            />
            <path
              d="M9.5 8.5L6.5 12L9.5 15.5M14.5 8.5L17.5 12L14.5 15.5M12.75 7.5L11.25 16.5"
              stroke="#F8FAFC"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-display text-xs font-bold tracking-[0.22em] text-slate-300 uppercase whitespace-nowrap">
            CODE RUBRIC
          </span>
        </div>

        {/* Heading & Description */}
        <div className="mt-6 text-center space-y-2.5">
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-50 text-balance">
            Understand Any GitHub Repository
          </h2>
          <p className="text-sm text-slate-400 max-w-xl mx-auto leading-relaxed">
            Enter a public GitHub repository URL to run a full-repository intelligence analysis or browse open pull requests for review.
          </p>
        </div>

        {/* URL Input + Two Action Buttons */}
        <form onSubmit={handleFormSubmit} noValidate className="mt-8 space-y-5">
          <div>
            <label htmlFor="analyze-github-url" className="sr-only">
              Public GitHub Repository URL
            </label>
            <input
              id="analyze-github-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              value={repoUrl}
              onChange={(e) => {
                setRepoUrl(e.target.value);
                if (error) setError(null);
              }}
              disabled={isBusy}
              placeholder="https://github.com/owner/repository"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'analyze-url-error' : undefined}
              className="w-full px-4 py-3 text-sm bg-[#0B0F17] border border-slate-700/90 rounded-lg text-slate-100 placeholder:text-slate-500 font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60 transition-colors"
            />
          </div>

          {error && (
            <div
              id="analyze-url-error"
              role="alert"
              className="flex items-start gap-2.5 px-3.5 py-2.5 text-xs text-red-300 bg-red-500/10 border border-red-500/35 rounded-lg"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => void handleAnalyzeRepository()}
              disabled={isBusy}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              {activeAction === 'analyze' ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
              ) : (
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                {activeAction === 'analyze' ? 'Verifying & Starting...' : 'Analyze Repository'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void handleReviewPullRequest()}
              disabled={isBusy}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-slate-100 bg-[#0B0F17] hover:bg-slate-800/90 disabled:opacity-60 border border-slate-700 hover:border-blue-500/60 rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              {activeAction === 'pulls' ? (
                <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" aria-hidden="true" />
              ) : (
                <GitPullRequest className="w-4 h-4 text-purple-400 shrink-0" aria-hidden="true" />
              )}
              <span>
                {activeAction === 'pulls' ? 'Loading Pull Requests...' : 'Review Pull Request'}
              </span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
