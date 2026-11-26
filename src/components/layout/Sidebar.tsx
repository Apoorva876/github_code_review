import {
  BarChart3,
  Bot,
  FolderGit2,
  GitPullRequest,
  History,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ScanSearch,
  Settings,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { NavSection } from '../../types';

interface SidebarProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  organizationName: string;
  userDisplayName?: string | null;
  userEmail?: string | null;
  userPhotoUrl?: string | null;
  onSignOut?: () => void;
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'analyze', label: 'Analyze', icon: ScanSearch },
  { id: 'repositories', label: 'Repositories', icon: FolderGit2 },
  { id: 'reviews', label: 'Code Reviews', icon: GitPullRequest },
  { id: 'agents', label: 'AI Agents', icon: Bot },
  { id: 'history', label: 'Review History', icon: History },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const SIDEBAR_STORAGE_KEY = 'coderubric.sidebarCollapsed';

export function Sidebar({
  activeSection,
  onNavigate,
  mobileOpen,
  onCloseMobile,
  organizationName,
  userDisplayName,
  userEmail,
  userPhotoUrl,
  onSignOut,
}: SidebarProps) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage restrictions
      }
      return next;
    });
  }

  const initials = (userDisplayName || userEmail || organizationName || 'CR')
    .slice(0, 2)
    .toUpperCase();

  function renderSidebarInner(isCollapsedDesktop: boolean) {
    return (
      <div
        className={`flex flex-col h-full bg-[#0E1420] border-r border-slate-800/90 transition-[width] duration-200 ${
          isCollapsedDesktop ? 'w-[72px]' : 'w-[256px]'
        }`}
      >
        {/* Brand Header */}
        <div
          className={`h-16 flex items-center border-b border-slate-800/80 shrink-0 ${
            isCollapsedDesktop ? 'justify-center px-2' : 'justify-between px-4'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              onNavigate('dashboard');
              onCloseMobile();
            }}
            title={isCollapsedDesktop ? 'CodeRubric Dashboard' : undefined}
            className="flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-blue-400 rounded p-1"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              className="shrink-0"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="coderubric-sidebar-mark"
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
                fill="url(#coderubric-sidebar-mark)"
              />
              <path
                d="M9.5 8.5L6.5 12L9.5 15.5M14.5 8.5L17.5 12L14.5 15.5M12.75 7.5L11.25 16.5"
                stroke="#F8FAFC"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {!isCollapsedDesktop && (
              <span className="font-display text-base font-bold tracking-tight text-slate-50 whitespace-nowrap">
                CodeRubric
              </span>
            )}
          </button>

          {!isCollapsedDesktop && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="hidden lg:inline-flex p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 rounded-md transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
            className="lg:hidden p-2 text-slate-400 hover:text-slate-100 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isCollapsedDesktop && (
          <div className="hidden lg:flex justify-center pt-3 pb-1 shrink-0">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 rounded-md transition-colors"
            >
              <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Navigation Links */}
        <nav
          aria-label="Primary navigation"
          className={`flex-1 py-4 space-y-1 overflow-y-auto ${
            isCollapsedDesktop ? 'px-2 overflow-visible' : 'px-3'
          }`}
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeSection === item.id ||
              (item.id === 'analyze' &&
                (activeSection === 'repository-intelligence' || activeSection === 'pr-review'));
            return (
              <div key={item.id} className="relative group">
                <button
                  type="button"
                  onClick={() => {
                    onNavigate(item.id);
                    onCloseMobile();
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={isCollapsedDesktop ? item.label : undefined}
                  className={`w-full flex items-center rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-400 ${
                    isCollapsedDesktop ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
                  } ${
                    isActive
                      ? 'bg-gradient-to-r from-blue-600/20 to-purple-600/15 text-blue-300 border border-blue-500/25'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                    aria-hidden="true"
                  />
                  {!isCollapsedDesktop && <span>{item.label}</span>}
                </button>

                {isCollapsedDesktop && (
                  <div
                    role="tooltip"
                    className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-50 px-2.5 py-1.5 rounded-md bg-[#111827] border border-slate-700 text-xs font-medium text-slate-100 shadow-lg whitespace-nowrap"
                  >
                    {item.label}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Workspace Profile & Sign Out Footer */}
        <div
          className={`p-3 border-t border-slate-800/80 shrink-0 space-y-1.5 ${
            isCollapsedDesktop ? 'px-2' : ''
          }`}
        >
          <div className="relative group">
            <button
              type="button"
              onClick={() => {
                onNavigate('settings');
                onCloseMobile();
              }}
              aria-label={
                isCollapsedDesktop
                  ? `${userDisplayName || organizationName} — Settings`
                  : undefined
              }
              className={`w-full flex items-center rounded-md hover:bg-slate-800/50 transition-colors text-left ${
                isCollapsedDesktop ? 'justify-center p-1.5' : 'gap-3 p-2'
              }`}
            >
              {avatarFailed ? (
                <div className="w-8 h-8 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-200 shrink-0">
                  {initials}
                </div>
              ) : (
                <img
                  src={userPhotoUrl || '/src/assets/images/avatar_lead_engineer_1794517766015.jpg'}
                  alt={userDisplayName || 'Signed in reviewer avatar'}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="w-8 h-8 rounded-md object-cover border border-slate-700/80 shrink-0"
                />
              )}
              {!isCollapsedDesktop && (
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-100 truncate">
                    {userDisplayName || organizationName}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {userEmail || 'Workspace Settings'}
                  </div>
                </div>
              )}
            </button>

            {isCollapsedDesktop && (
              <div
                role="tooltip"
                className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-50 px-2.5 py-1.5 rounded-md bg-[#111827] border border-slate-700 text-xs text-slate-100 shadow-lg whitespace-nowrap"
              >
                <div className="font-semibold">{userDisplayName || organizationName}</div>
                {userEmail && <div className="text-[11px] text-slate-400">{userEmail}</div>}
              </div>
            )}
          </div>

          {onSignOut && (
            <div className="relative group">
              <button
                type="button"
                onClick={() => {
                  onCloseMobile();
                  onSignOut();
                }}
                aria-label={isCollapsedDesktop ? 'Sign out' : undefined}
                className={`w-full flex items-center rounded-md text-xs font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition-colors ${
                  isCollapsedDesktop ? 'justify-center py-2' : 'gap-2.5 px-3 py-2'
                }`}
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {!isCollapsedDesktop && <span>Sign out</span>}
              </button>

              {isCollapsedDesktop && (
                <div
                  role="tooltip"
                  className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-50 px-2.5 py-1.5 rounded-md bg-[#111827] border border-slate-700 text-xs font-medium text-slate-100 shadow-lg whitespace-nowrap"
                >
                  Sign out
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop persistent collapsible sidebar */}
      <aside className="hidden lg:block shrink-0">{renderSidebarInner(collapsed)}</aside>

      {/* Mobile slide-over sidebar (always expanded) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full">{renderSidebarInner(false)}</aside>
        </div>
      )}
    </>
  );
}
