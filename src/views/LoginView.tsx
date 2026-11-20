import {
  AlertCircle,
  Bot,
  FileCheck2,
  FolderGit2,
  Loader2,
  LogOut,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useFirebase } from '../context/FirebaseContext';

const FEATURE_HIGHLIGHTS = [
  {
    icon: Sparkles,
    title: 'AI-powered code reviews',
    description:
      'Automated pull request diffs and manual code rubric scoring with structured maintainability breakdowns.',
    accent: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  },
  {
    icon: Bot,
    title: 'Six specialized AI agents',
    description:
      'Security Sentinel, Architecture Rubric, Performance Profiler, Reliability Guard, Testing Auditor, and API Reviewer.',
    accent: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  },
  {
    icon: FolderGit2,
    title: 'Repository-wide code analysis',
    description:
      'Recursive branch source collection, commit SHA tracking, and persistent background analysis jobs.',
    accent: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  },
  {
    icon: ShieldCheck,
    title: 'Security and performance insights',
    description:
      'Identify injection risks, auth gaps, N+1 queries, memory leaks, and concurrency hazards before merge.',
    accent: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  },
  {
    icon: FileCheck2,
    title: 'Evidence-backed findings',
    description:
      'Critical-to-low severity findings pinned to exact file paths, line ranges, source snippets, and fixes.',
    accent: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  },
];

function GoogleLogo() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

export function LoginView() {
  const {
    user,
    authGateState,
    signingIn,
    syncError,
    signInWithGoogle,
    signOutFirebase,
    clearSyncError,
  } = useFirebase();

  const isUnverifiedEmail = authGateState === 'unverified-email';
  const isBusy = signingIn || authGateState === 'initializing-workspace';

  return (
    <div className="relative min-h-screen bg-[#0B0F17] text-slate-100 overflow-hidden flex flex-col justify-between">
      {/* Ambient blue/purple developer backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            'radial-gradient(680px circle at 12% 14%, rgba(37, 99, 235, 0.16), transparent 60%), radial-gradient(640px circle at 88% 82%, rgba(124, 58, 237, 0.14), transparent 60%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148, 163, 184, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.08) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Top Brand Header */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="coderubric-mark" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#2563EB" />
                <stop offset="1" stopColor="#7C3AED" />
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#coderubric-mark)" />
            <path
              d="M9.5 8.5L6.5 12L9.5 15.5M14.5 8.5L17.5 12L14.5 15.5M12.75 7.5L11.25 16.5"
              stroke="#F8FAFC"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-display text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap">
            CodeRubric
          </span>
        </div>
      </header>

      {/* Main Split Content */}
      <main className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        {/* Left: Hero Copy & Feature Highlights */}
        <section className="lg:col-span-7 space-y-8">
          <div className="space-y-4">
            <h1
              className="font-display font-bold tracking-tight text-slate-50 leading-[1.12] text-balance"
              style={{ fontSize: 'clamp(2rem, 3.6vw, 3.25rem)' }}
            >
              Review Code Smarter.{' '}
              <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Build Better Software.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-2xl">
              An AI-powered GitHub repository analysis and intelligent code review platform.
            </p>
          </div>

          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3.5" aria-label="Platform capabilities">
            {FEATURE_HIGHLIGHTS.map((feature, index) => {
              const Icon = feature.icon;
              const isFullSpan = index === FEATURE_HIGHLIGHTS.length - 1;
              return (
                <li
                  key={feature.title}
                  className={`group rounded-lg bg-[#0E1420]/90 border border-slate-800/90 hover:border-slate-700/90 p-4 transition-all duration-200 hover:-translate-y-0.5 ${
                    isFullSpan ? 'sm:col-span-2' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-8 h-8 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-transform duration-200 group-hover:scale-105 ${feature.accent}`}
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <h2 className="text-sm font-semibold text-slate-100">{feature.title}</h2>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Right: Authentication Card */}
        <section className="lg:col-span-5">
          <div className="relative rounded-xl bg-[#111827]/95 border border-slate-800/95 p-6 sm:p-8 shadow-2xl shadow-black/50 space-y-6">
            <div
              aria-hidden="true"
              className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/60 to-purple-500/60"
            />

            <div className="space-y-2">
              <h2 className="font-display text-xl font-semibold text-slate-50">
                {isUnverifiedEmail ? 'Verify your email to continue' : 'Sign in to CodeRubric'}
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                {isUnverifiedEmail
                  ? 'Your Google account requires a verified email address before accessing your workspace or Cloud Firestore data.'
                  : 'Use your verified Google account to unlock your personal engineering rubric workspace and synced review history.'}
              </p>
            </div>

            {syncError && (
              <div
                role="alert"
                className="rounded-lg bg-red-500/10 border border-red-500/30 p-3.5 text-xs text-red-200 flex items-start justify-between gap-3"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="leading-relaxed break-words">{syncError}</span>
                </div>
                <button
                  type="button"
                  onClick={clearSyncError}
                  aria-label="Dismiss authentication error"
                  className="text-red-300/80 hover:text-red-100 p-0.5 rounded shrink-0"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            {isUnverifiedEmail && user ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-[#0B0F17] border border-slate-800 p-3 text-xs text-slate-300">
                  Signed in as <span className="font-medium text-slate-100">{user.email ?? user.uid}</span>{' '}
                  (email unverified).
                </div>
                <button
                  type="button"
                  onClick={() => void signOutFirebase()}
                  className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                  <span>Sign out and use a verified Google account</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void signInWithGoogle()}
                className="w-full min-h-[48px] inline-flex items-center justify-center gap-3 px-5 py-3 text-sm font-semibold text-slate-900 bg-white hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg shadow-sm transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                {isBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" aria-hidden="true" />
                    <span>
                      {authGateState === 'initializing-workspace'
                        ? 'Initializing workspace...'
                        : 'Connecting with Google...'}
                    </span>
                  </>
                ) : (
                  <>
                    <GoogleLogo />
                    <span>Continue with Google</span>
                  </>
                )}
              </button>
            )}

            <div className="pt-5 border-t border-slate-800/90 space-y-2.5 text-xs text-slate-400 leading-relaxed">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-slate-300 shrink-0">Workspace Access</span>
                <span className="text-right">
                  Google Authentication secures your personal Cloud Firestore workspace.
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-slate-300 shrink-0">GitHub Access</span>
                <span className="text-right">
                  Connect GitHub OAuth inside Settings or Repositories for live repos.
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Subtle Footer */}
      <footer className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 border-t border-slate-900/80">
        <span>CodeRubric · AI GitHub Repository Analysis &amp; Code Review</span>
        <span>Protected by verified Google Authentication</span>
      </footer>
    </div>
  );
}
