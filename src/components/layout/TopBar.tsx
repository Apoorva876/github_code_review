import {
  AlertTriangle,
  Database,
  FolderPlus,
  Loader2,
  Menu,
  Play,
  Search,
} from 'lucide-react';
import { useFirebase } from '../../context/FirebaseContext';
import type { NavSection } from '../../types';

interface TopBarProps {
  activeSection: NavSection;
  hasDemoData: boolean;
  onOpenMobileNav: () => void;
  onOpenCommandPalette: () => void;
  onOpenConnectRepo: () => void;
  onOpenRunReview: () => void;
  onNavigateSettings: () => void;
}

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  repositories: 'Repositories',
  reviews: 'Code Reviews',
  agents: 'AI Agents',
  history: 'Review History',
  analytics: 'Analytics',
  settings: 'Settings',
};

export function TopBar({
  activeSection,
  hasDemoData,
  onOpenMobileNav,
  onOpenCommandPalette,
  onOpenConnectRepo,
  onOpenRunReview,
  onNavigateSettings,
}: TopBarProps) {
  const { user, isVerifiedUser, signingIn, syncStatus, syncError, signInWithGoogle } =
    useFirebase();

  return (
    <header className="h-16 px-4 sm:px-6 lg:px-8 border-b border-slate-800/90 bg-[#0B0F17] flex items-center justify-between gap-4 shrink-0">
      {/* Left: Hamburger + Breadcrumb Trail */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-2 text-slate-300 hover:text-white rounded-md hover:bg-slate-800/60"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-500 hidden sm:inline whitespace-nowrap">CodeRubric</span>
          <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <h1 className="font-display font-semibold text-slate-100 truncate">
            {SECTION_TITLES[activeSection]}
          </h1>
          {hasDemoData && (
            <>
              <span className="text-slate-700 hidden xl:inline" aria-hidden="true">
                ·
              </span>
              <span className="text-xs text-slate-400 hidden xl:inline whitespace-nowrap">
                Demo dataset active
              </span>
            </>
          )}
        </div>
      </div>

      {/* Center / Right: Global Search Trigger + Cloud Sync + Primary Actions */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Open global search and command palette (Ctrl+K)"
          className="inline-flex items-center justify-between gap-3 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 bg-[#111827] hover:bg-slate-800/90 border border-slate-800 hover:border-slate-700 rounded-md transition-colors sm:w-56 lg:w-64 whitespace-nowrap shrink-0"
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline truncate">Search workspace...</span>
          </span>
          <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-[#0B0F17] border border-slate-800 rounded">
            Ctrl+K
          </kbd>
        </button>

        {user ? (
          syncStatus === 'syncing' ? (
            <button
              type="button"
              onClick={onNavigateSettings}
              title={`Synchronizing Cloud Firestore (${user.email ?? user.uid})`}
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-300 bg-[#111827] hover:bg-slate-800 border border-blue-500/30 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              <span>Syncing DB...</span>
            </button>
          ) : syncStatus === 'failed' ? (
            <button
              type="button"
              onClick={onNavigateSettings}
              title={syncError || 'Cloud Firestore sync failed. Using local JSON fallback.'}
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Cloud Sync Failed</span>
            </button>
          ) : syncStatus === 'synced' ? (
            <button
              type="button"
              onClick={onNavigateSettings}
              title={`Firestore Cloud Sync active (${user.email ?? user.uid})`}
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-300 bg-[#111827] hover:bg-slate-800 border border-emerald-500/30 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Cloud DB Synced</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onNavigateSettings}
              title={
                isVerifiedUser
                  ? 'Google connected, awaiting initial Cloud Firestore sync'
                  : 'Verify your Google account email to enable Cloud Firestore sync'
              }
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-300 bg-[#111827] hover:bg-slate-800 border border-amber-500/30 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isVerifiedUser ? 'Cloud Sync Pending' : 'Verify Email for Cloud DB'}</span>
            </button>
          )
        ) : (
          <button
            type="button"
            disabled={signingIn}
            onClick={() => void signInWithGoogle()}
            title="Sign in with Google to persist workspace data in Cloud Firestore"
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-[#111827] hover:bg-slate-800 disabled:opacity-50 border border-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            {signingIn ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Database className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{signingIn ? 'Connecting...' : 'Sign in for Cloud DB'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenConnectRepo}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-[#111827] hover:bg-slate-800 border border-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Connect Repo</span>
          <span className="sm:hidden">Connect</span>
        </button>

        <button
          type="button"
          onClick={onOpenRunReview}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <Play className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Run AI Review</span>
        </button>
      </div>
    </header>
  );
}
