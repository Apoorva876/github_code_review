import {
  AlertTriangle,
  Bot,
  FolderGit2,
  FolderPlus,
  GitPullRequest,
  History,
  Play,
  Search,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AIAgent, CodeReview, NavSection, Repository } from '../../types';
import { formatFindingLocation, getScoreColorClass } from '../../utils/formatters';
import { buildGlobalSearchResults } from '../../utils/workspaceMetrics';

interface CommandPaletteModalProps {
  open: boolean;
  onClose: () => void;
  repositories: Repository[];
  reviews: CodeReview[];
  agents: AIAgent[];
  onNavigate: (section: NavSection) => void;
  onOpenConnectRepo: () => void;
  onOpenRunReview: (agentId?: string) => void;
  onSelectRepository: (repo: Repository) => void;
  onSelectReview: (review: CodeReview) => void;
  onStartRepoAnalysis: (repo: Repository) => void;
}

interface PaletteEntry {
  id: string;
  section: string;
  title: string;
  subtitle: string;
  badge?: string;
  badgeClass?: string;
  icon: typeof Search;
  onExecute: () => void;
}

export function CommandPaletteModal({
  open,
  onClose,
  repositories,
  reviews,
  agents,
  onNavigate,
  onOpenConnectRepo,
  onOpenRunReview,
  onSelectRepository,
  onSelectReview,
  onStartRepoAnalysis,
}: CommandPaletteModalProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(id);
  }, [open]);

  const liveRepo = useMemo(
    () => repositories.find((r) => !r.isDemo) ?? null,
    [repositories]
  );

  const entries = useMemo<PaletteEntry[]>(() => {
    const q = query.trim().toLowerCase();
    const results = buildGlobalSearchResults(query, repositories, reviews, agents);
    const items: PaletteEntry[] = [];

    const quickActions: PaletteEntry[] = [
      {
        id: 'action-connect-repo',
        section: 'Quick Actions',
        title: 'Connect GitHub repository',
        subtitle: 'Add a public or private GitHub repository to CodeRubric',
        badge: 'Action',
        badgeClass: 'text-blue-400',
        icon: FolderPlus,
        onExecute: () => {
          onClose();
          onOpenConnectRepo();
        },
      },
      {
        id: 'action-start-repo-analysis',
        section: 'Quick Actions',
        title: liveRepo
          ? `Start repository analysis (${liveRepo.fullName})`
          : 'Start repository analysis',
        subtitle: liveRepo
          ? `Launch full-tree multi-agent analysis on ${liveRepo.defaultBranch}`
          : 'Open Repositories to connect or analyze a GitHub repository',
        badge: 'Analyze',
        badgeClass: 'text-purple-400',
        icon: ShieldCheck,
        onExecute: () => {
          onClose();
          if (liveRepo) {
            onStartRepoAnalysis(liveRepo);
          } else {
            onNavigate('repositories');
          }
        },
      },
      {
        id: 'action-run-review',
        section: 'Quick Actions',
        title: 'Run Gemini AI code review',
        subtitle: 'Analyze a GitHub pull request or paste a code diff',
        badge: 'Review',
        badgeClass: 'text-blue-400',
        icon: Play,
        onExecute: () => {
          onClose();
          onOpenRunReview();
        },
      },
      {
        id: 'action-history',
        section: 'Quick Actions',
        title: 'Open review history',
        subtitle: 'Browse audit logs and export CSV reports',
        icon: History,
        onExecute: () => {
          onClose();
          onNavigate('history');
        },
      },
      {
        id: 'action-agents',
        section: 'Quick Actions',
        title: 'Open AI agents',
        subtitle: 'Configure the six specialized Gemini reviewer agents',
        icon: Bot,
        onExecute: () => {
          onClose();
          onNavigate('agents');
        },
      },
      {
        id: 'action-settings',
        section: 'Quick Actions',
        title: 'Open settings & cloud sync',
        subtitle: 'Manage Google Firestore sync, GitHub OAuth, and thresholds',
        icon: Settings,
        onExecute: () => {
          onClose();
          onNavigate('settings');
        },
      },
    ];

    const matchingActions = q
      ? quickActions.filter(
          (a) =>
            a.title.toLowerCase().includes(q) || a.subtitle.toLowerCase().includes(q)
        )
      : quickActions;
    items.push(...matchingActions);

    for (const repo of results.repositories) {
      items.push({
        id: `repo-${repo.id}`,
        section: 'Repositories',
        title: repo.fullName,
        subtitle: `${repo.language} · ${repo.defaultBranch} · ${repo.openPrsCount} open PRs`,
        badge: `${repo.healthScore}`,
        badgeClass: getScoreColorClass(repo.healthScore),
        icon: FolderGit2,
        onExecute: () => {
          onClose();
          onSelectRepository(repo);
        },
      });
    }

    for (const rev of results.reviews) {
      items.push({
        id: `rev-${rev.id}`,
        section: 'Reviews',
        title: `${rev.reviewScope === 'repository' ? 'Repo' : `#${rev.prNumber}`} ${rev.title}`,
        subtitle: `${rev.repositoryFullName} · ${rev.agentName}`,
        badge: `${rev.score}/100`,
        badgeClass: getScoreColorClass(rev.score),
        icon: GitPullRequest,
        onExecute: () => {
          onClose();
          onSelectReview(rev);
        },
      });
    }

    for (const match of results.findings) {
      items.push({
        id: `finding-${match.review.id}-${match.finding.id}`,
        section: 'Findings',
        title: match.finding.title,
        subtitle: `${match.review.repositoryFullName} · ${formatFindingLocation(
          match.finding.filePath,
          match.finding.lineStart,
          match.finding.lineEnd
        )}`,
        badge: match.finding.severity,
        badgeClass:
          match.finding.severity === 'critical'
            ? 'text-red-400 uppercase'
            : match.finding.severity === 'high'
              ? 'text-orange-400 uppercase'
              : match.finding.severity === 'medium'
                ? 'text-amber-400 uppercase'
                : 'text-slate-400 uppercase',
        icon: AlertTriangle,
        onExecute: () => {
          onClose();
          onSelectReview(match.review);
        },
      });
    }

    for (const agent of results.agents) {
      items.push({
        id: `agent-${agent.id}`,
        section: 'AI Agents',
        title: agent.name,
        subtitle: `${agent.focus} · ${agent.strictness} · ${agent.thinkingLevel}`,
        badge: agent.enabled ? 'Active' : 'Disabled',
        badgeClass: agent.enabled ? 'text-emerald-400' : 'text-slate-500',
        icon: Bot,
        onExecute: () => {
          onClose();
          onNavigate('agents');
        },
      });
    }

    return items;
  }, [
    query,
    repositories,
    reviews,
    agents,
    liveRepo,
    onClose,
    onNavigate,
    onOpenConnectRepo,
    onOpenRunReview,
    onSelectRepository,
    onSelectReview,
    onStartRepoAnalysis,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (entries.length === 0 ? 0 : (prev + 1) % entries.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) =>
          entries.length === 0 ? 0 : (prev - 1 + entries.length) % entries.length
        );
      } else if (e.key === 'Enter') {
        const selected = entries[activeIndex];
        if (selected) {
          e.preventDefault();
          selected.onExecute();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, entries, activeIndex, onClose]);

  if (!open) return null;

  // Group items preserving order for section headers
  const groupedSections: Array<{ name: string; rows: Array<{ entry: PaletteEntry; idx: number }> }> =
    [];
  entries.forEach((entry, idx) => {
    const last = groupedSections[groupedSections.length - 1];
    if (!last || last.name !== entry.section) {
      groupedSections.push({ name: entry.section, rows: [{ entry, idx }] });
    } else {
      last.rows.push({ entry, idx });
    }
  });

  return (
    <div
      className="fixed inset-0 z-[65] flex items-start justify-center pt-[10vh] px-4 bg-black/75 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Global workspace search and command palette"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-2xl bg-[#111827] border border-slate-700/90 rounded-xl shadow-2xl shadow-black/70 overflow-hidden cr-view-enter">
        {/* Search Input Header */}
        <div className="px-4 py-3.5 border-b border-slate-800 flex items-center gap-3">
          <Search className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search repositories, reviews, findings, AI agents, or actions..."
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="p-1 text-slate-400 hover:text-slate-100 rounded"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {entries.length === 0 ? (
            <div className="px-6 py-10 text-center space-y-1.5">
              <div className="text-sm font-medium text-slate-200">
                No matching workspace records
              </div>
              <p className="text-xs text-slate-400">
                Try searching by repository name, file path, finding severity, or agent name.
              </p>
            </div>
          ) : (
            groupedSections.map((group) => (
              <div key={group.name} className="py-1">
                <div className="px-4 py-1.5 text-[11px] font-medium text-slate-500">
                  {group.name}
                </div>
                {group.rows.map(({ entry, idx }) => {
                  const Icon = entry.icon;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={entry.onExecute}
                      className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors ${
                        isActive ? 'bg-blue-600/15 text-slate-50' : 'text-slate-300 hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            isActive ? 'text-blue-400' : 'text-slate-400'
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-100 truncate">
                            {entry.title}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {entry.subtitle}
                          </div>
                        </div>
                      </div>
                      {entry.badge && (
                        <span
                          className={`text-[11px] font-mono tabular-nums shrink-0 ${
                            entry.badgeClass || 'text-slate-400'
                          }`}
                        >
                          {entry.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer keyboard hints */}
        <div className="px-4 py-2.5 border-t border-slate-800/90 bg-[#0E1420]/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-mono">
          <span>↑↓ Navigate · Enter Open · Esc Close</span>
          <span>Ctrl+K / ⌘K</span>
        </div>
      </div>
    </div>
  );
}
