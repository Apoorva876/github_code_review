import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Boxes,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  Layers,
  Loader2,
  Lock,
  MessageSquareText,
  Network,
  Plug,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Workflow,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { InteractiveArchitectureGraph } from '../components/diagrams/InteractiveArchitectureGraph';
import { InteractiveMermaidDiagram } from '../components/diagrams/InteractiveMermaidDiagram';
import { AiExplanationsSection } from '../components/intelligence/AiExplanationsSection';
import { AskRepositorySection } from '../components/intelligence/AskRepositorySection';
import { RepositoryExplorer } from '../components/intelligence/RepositoryExplorer';
import { EmptyState } from '../components/ui/DataState';
import { useToast } from '../context/ToastContext';
import {
  getIntelligenceStageSteps,
  useRepositoryIntelligenceJob,
} from '../hooks/useRepositoryIntelligenceJob';
import type {
  RepositoryChatMessage,
  RepositoryIntelligenceJob,
  RepositoryIntelligenceJobStatus,
  RepositoryIntelligenceReport,
} from '../types';
import { formatCommitSha, formatDurationMs } from '../utils/formatters';
import { downloadMarkdownReport, downloadPdfReport } from '../utils/reportExport';
import type { RepositoryIntelligenceTarget } from './AnalyzeView';

type IntelligenceSectionId =
  | 'overview'
  | 'structure'
  | 'system'
  | 'frontend'
  | 'backend'
  | 'communication'
  | 'integrations'
  | 'database'
  | 'auth'
  | 'workflows'
  | 'explanations'
  | 'qa';

const SECTION_TABS: Array<{
  id: IntelligenceSectionId;
  num: string;
  label: string;
  icon: typeof Activity;
}> = [
  { id: 'overview', num: '01', label: 'Overview', icon: Sparkles },
  { id: 'structure', num: '02', label: 'Repository Structure', icon: FolderTree },
  { id: 'system', num: '03', label: 'System Architecture', icon: Boxes },
  { id: 'frontend', num: '04', label: 'Frontend Architecture', icon: Globe },
  { id: 'backend', num: '05', label: 'Backend Architecture', icon: Server },
  { id: 'communication', num: '06', label: 'Frontend-Backend Comm', icon: Network },
  { id: 'integrations', num: '07', label: 'API Integrations', icon: Plug },
  { id: 'database', num: '08', label: 'Database Architecture', icon: Database },
  { id: 'auth', num: '09', label: 'Authentication Flow', icon: Lock },
  { id: 'workflows', num: '10', label: 'Application Workflow', icon: Workflow },
  { id: 'explanations', num: '11', label: 'AI Explanations', icon: BookOpen },
  { id: 'qa', num: '12', label: 'Ask Your Repository', icon: MessageSquareText },
];

interface RepositoryIntelligenceViewProps {
  target: RepositoryIntelligenceTarget | null;
  onBackToAnalyze: () => void;
  onJobUpdated: (job: RepositoryIntelligenceJob) => void;
  onRunCodeReview?: (repoSlug: string, branch: string) => void;
}

function getIntelStatusDisplay(status: RepositoryIntelligenceJobStatus): {
  label: string;
  colorClass: string;
} {
  switch (status) {
    case 'queued':
      return { label: 'Queued', colorClass: 'text-blue-400' };
    case 'retrieving_tree':
      return { label: 'Retrieving Repository Tree', colorClass: 'text-blue-400' };
    case 'collecting_files':
      return { label: 'Collecting Source Files', colorClass: 'text-blue-400' };
    case 'analyzing_chunks':
      return { label: 'Analyzing Source Chunks', colorClass: 'text-blue-400' };
    case 'synthesizing_architecture':
      return { label: 'Synthesizing Architecture Diagrams', colorClass: 'text-purple-400' };
    case 'completed':
      return { label: 'Intelligence Ready', colorClass: 'text-emerald-400' };
    case 'partial':
      return { label: 'Intelligence Ready (Partial Coverage)', colorClass: 'text-amber-400' };
    case 'failed':
      return { label: 'Analysis Failed', colorClass: 'text-red-400' };
  }
}

export function RepositoryIntelligenceView({
  target,
  onBackToAnalyze,
  onJobUpdated,
  onRunCodeReview,
}: RepositoryIntelligenceViewProps) {
  const onJobUpdatedRef = useRef(onJobUpdated);
  onJobUpdatedRef.current = onJobUpdated;

  const {
    job,
    report,
    starting,
    loadingReport,
    error,
    pollError,
    isActive,
    startIntelligence,
    attachJob,
    refreshNow,
  } = useRepositoryIntelligenceJob({
    initialJob: target?.job ?? null,
    initialReport: target?.report ?? null,
  });

  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<IntelligenceSectionId>('overview');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFlowIndex, setSelectedFlowIndex] = useState(0);
  const [selectedWorkflowIndex, setSelectedWorkflowIndex] = useState(0);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [qaMessagesSnapshot, setQaMessagesSnapshot] = useState<RepositoryChatMessage[]>([]);

  const lastTargetIdRef = useRef<string | null>(target?.job.id ?? null);
  useEffect(() => {
    if (target?.job && target.job.id !== lastTargetIdRef.current) {
      lastTargetIdRef.current = target.job.id;
      attachJob(target.job);
      setActiveTab('overview');
      setSelectedFilePath(null);
      setSelectedFlowIndex(0);
      setSelectedWorkflowIndex(0);
    }
  }, [target?.job, attachJob]);

  useEffect(() => {
    if (job) {
      onJobUpdatedRef.current(job);
    }
  }, [job]);

  const stageSteps = useMemo(() => getIntelligenceStageSteps(job), [job]);

  if (!target) {
    return (
      <EmptyState
        title="No repository selected for intelligence analysis"
        description="Enter a public GitHub repository URL on the Analyze page and select Analyze Repository to generate complete repository intelligence."
        actionLabel="Go to Analyze"
        onAction={onBackToAnalyze}
      />
    );
  }

  const { repository, parsed } = target;
  const activeJob = job ?? target.job;
  const statusDisplay = getIntelStatusDisplay(activeJob.status);

  function handleJumpToFile(filePath: string) {
    setSelectedFilePath(filePath);
    setActiveTab('structure');
  }

  function renderFileChipList(paths: string[], emptyLabel: string) {
    if (paths.length === 0) {
      return <span className="text-xs text-slate-500">{emptyLabel}</span>;
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {paths.map((fp) => (
          <button
            key={fp}
            type="button"
            onClick={() => handleJumpToFile(fp)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-blue-300 hover:text-blue-200 transition-colors"
          >
            <FileCode2 className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span>{fp}</span>
          </button>
        ))}
      </div>
    );
  }

  async function handleReanalyze() {
    const started = await startIntelligence(repository.id, activeJob.branch || repository.defaultBranch, true);
    if (started) {
      onJobUpdatedRef.current(started);
    }
  }

  const activeReport: RepositoryIntelligenceReport | null = report ?? target.report ?? null;

  function handleDownloadMarkdown() {
    if (!activeReport) return;
    try {
      const filename = downloadMarkdownReport(activeReport, {
        chatMessages: qaMessagesSnapshot,
      });
      showToast({
        title: 'Markdown Report Exported',
        description: `Saved ${filename}`,
        variant: 'success',
      });
    } catch (err) {
      showToast({
        title: 'Markdown Export Failed',
        description: err instanceof Error ? err.message : 'Failed to generate Markdown report.',
        variant: 'error',
      });
    }
  }

  async function handleDownloadPdf() {
    if (!activeReport || exportingPdf) return;
    setExportingPdf(true);
    try {
      const filename = await downloadPdfReport(activeReport, {
        chatMessages: qaMessagesSnapshot,
        includeDiagramImages: true,
      });
      showToast({
        title: 'PDF Report Exported',
        description: `Saved ${filename}`,
        variant: 'success',
      });
    } catch (err) {
      showToast({
        title: 'PDF Export Failed',
        description: err instanceof Error ? err.message : 'Failed to generate PDF report.',
        variant: 'error',
      });
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Sticky Top Identity Header */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <button
              type="button"
              onClick={onBackToAnalyze}
              className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Back to Analyze</span>
            </button>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span>Owner: <span className="font-mono text-slate-200">{parsed.owner}</span></span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span>Repo: <span className="font-mono text-slate-200">{parsed.repo}</span></span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-lg sm:text-xl font-bold text-slate-100 font-mono truncate">
              {repository.fullName}
            </h2>
            <a
              href={repository.htmlUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${repository.fullName} on GitHub`}
              className="text-slate-400 hover:text-slate-100 transition-colors"
            >
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
            </a>
            {activeJob.fromCache && (
              <span className="text-[11px] font-mono text-blue-300 bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 rounded">
                Cached Commit Snapshot
              </span>
            )}
          </div>

          <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
            <span>{repository.isPrivate ? 'Private' : 'Public'} Repository</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 font-mono text-slate-200">
              <GitBranch className="w-3 h-3 text-slate-400" aria-hidden="true" />
              {activeJob.branch}
            </span>
            <span aria-hidden="true">·</span>
            <span>{repository.language}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{repository.stars.toLocaleString()} stars</span>
            {activeJob.analyzedCommitSha && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-300">
                  SHA {formatCommitSha(activeJob.analyzedCommitSha)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {activeReport && (
            <>
              <button
                type="button"
                onClick={handleDownloadMarkdown}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 rounded-md transition-colors whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                <span>Download Markdown Report</span>
              </button>
              <button
                type="button"
                disabled={exportingPdf}
                onClick={() => void handleDownloadPdf()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 rounded-md transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {exportingPdf ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" aria-hidden="true" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-purple-400" aria-hidden="true" />
                )}
                <span>{exportingPdf ? 'Generating PDF...' : 'Download PDF Report'}</span>
              </button>
            </>
          )}
          {onRunCodeReview && (
            <button
              type="button"
              onClick={() => onRunCodeReview(repository.fullName, activeJob.branch)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 rounded-md transition-colors whitespace-nowrap"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-purple-400" aria-hidden="true" />
              <span>Run Security / Rubric Audit</span>
            </button>
          )}
          <button
            type="button"
            disabled={isActive || starting}
            onClick={() => void handleReanalyze()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isActive || starting ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isActive ? 'Analyzing...' : 'Re-analyze Repository'}</span>
          </button>
        </div>
      </div>

      {/* Live Progress Card (shown while active, failed, or loading report) */}
      {(isActive || activeJob.status === 'failed' || !activeReport) && (
        <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {isActive || loadingReport ? (
                <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" aria-hidden="true" />
              ) : activeJob.status === 'completed' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
              ) : activeJob.status === 'partial' ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
              )}
              <span className={`text-sm font-semibold ${statusDisplay.colorClass}`}>
                {statusDisplay.label}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
              <span className="text-slate-400">{activeJob.id.slice(0, 18)}</span>
              <span className="text-slate-100 font-semibold">
                {Math.max(0, Math.min(100, activeJob.progress))}%
              </span>
            </div>
          </div>

          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                activeJob.status === 'failed'
                  ? 'bg-red-500'
                  : activeJob.status === 'partial'
                    ? 'bg-amber-500'
                    : activeJob.status === 'completed'
                      ? 'bg-emerald-500'
                      : 'bg-blue-500'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, activeJob.progress))}%` }}
            />
          </div>

          <p className="text-xs text-slate-300">{activeJob.message}</p>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-800/80">
            {stageSteps.map((step, idx) => (
              <div
                key={step.key}
                className={`px-3 py-2 rounded border text-[11px] leading-snug ${
                  step.state === 'active'
                    ? 'bg-blue-500/10 border-blue-500/40 text-blue-200'
                    : step.state === 'done'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : step.state === 'warning'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                        : step.state === 'error'
                          ? 'bg-red-500/10 border-red-500/30 text-red-300'
                          : 'bg-[#0B0F17] border-slate-800/80 text-slate-500'
                }`}
              >
                <div className="font-mono text-[10px] opacity-75">Step {idx + 1}</div>
                <div className="font-medium truncate">{step.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
              <div className="text-[11px] text-slate-400">Repository Tree</div>
              <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
                {activeJob.totalFiles.toLocaleString()} files
              </div>
              <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                {activeJob.totalTreeEntries.toLocaleString()} tree entries
              </div>
            </div>
            <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
              <div className="text-[11px] text-slate-400">Collected Source Files</div>
              <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
                {activeJob.filesCollected} / {activeJob.eligibleFiles}
              </div>
              <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                {activeJob.filesSkipped} skipped · {activeJob.failedFiles} failed
              </div>
            </div>
            <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
              <div className="text-[11px] text-slate-400">AI Chunk Analysis</div>
              <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
                {activeJob.completedChunks} / {activeJob.totalChunks}
              </div>
              <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                {activeJob.truncatedFiles} truncated
              </div>
            </div>
            <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
              <div className="text-[11px] text-slate-400">Commit Target</div>
              <div className="mt-1 text-base font-mono font-semibold text-slate-100">
                {formatCommitSha(activeJob.analyzedCommitSha)}
              </div>
              <div className="text-[11px] font-mono text-slate-500">{activeJob.branch}</div>
            </div>
          </div>

          {(error || activeJob.error) && (
            <div
              role="alert"
              className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3 flex items-start gap-2 text-xs text-red-300"
            >
              <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error || activeJob.error}</span>
            </div>
          )}

          {pollError && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-md px-4 py-3 flex items-center justify-between gap-3 text-xs text-amber-200">
              <span>{pollError}</span>
              <button
                type="button"
                onClick={() => void refreshNow()}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                Retry Poll
              </button>
            </div>
          )}
        </section>
      )}

      {/* 10-Section Intelligence Interface once Report is Ready */}
      {activeReport && (
        <>
          {/* 10-Section Navigation Bar */}
          <nav
            aria-label="Repository Intelligence Sections"
            className="bg-[#111827] border border-slate-800/90 rounded-lg p-1.5 flex flex-wrap gap-1"
          >
            {SECTION_TABS.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    isSelected
                      ? 'bg-gradient-to-r from-blue-600/25 to-purple-600/25 text-white border border-blue-500/40'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <span className="font-mono text-[10px] opacity-70">{tab.num}</span>
                  <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* SECTION 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Partial Coverage Banner if incomplete */}
              {!activeReport.coverage.coverageComplete && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-xs text-amber-200 space-y-1">
                  <div className="font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                    <span>Partial Repository Coverage — Verified Counts Shown Below</span>
                  </div>
                  <p className="text-amber-200/90">
                    {activeReport.coverage.limitations.join(' ')}
                  </p>
                </div>
              )}

              {/* Hero Summary */}
              <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-blue-400">
                      {activeReport.overview.architectureStyle} · Generated in{' '}
                      {formatDurationMs(activeReport.durationMs)}
                    </div>
                    <h3 className="font-display text-xl font-bold text-slate-50">
                      {activeReport.overview.headline}
                    </h3>
                    {activeReport.description && (
                      <p className="text-xs text-slate-400 max-w-3xl">
                        {activeReport.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Accurate File Accounting Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2">
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
                    <div className="text-[11px] text-slate-400">Total Files</div>
                    <div className="mt-1 text-lg font-mono font-bold text-slate-100 tabular-nums">
                      {activeReport.coverage.totalFiles.toLocaleString()}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      {activeReport.coverage.totalDirectories} folders
                    </div>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
                    <div className="text-[11px] text-slate-400">Eligible Source</div>
                    <div className="mt-1 text-lg font-mono font-bold text-slate-100 tabular-nums">
                      {activeReport.coverage.eligibleFiles.toLocaleString()}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      {activeReport.coverage.totalTreeEntries} tree entries
                    </div>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
                    <div className="text-[11px] text-slate-400">Analyzed Files</div>
                    <div className="mt-1 text-lg font-mono font-bold text-emerald-400 tabular-nums">
                      {activeReport.coverage.analyzedFiles.toLocaleString()}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      {activeReport.coverage.totalChunksAnalyzed} chunks
                    </div>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
                    <div className="text-[11px] text-slate-400">Skipped Files</div>
                    <div className="mt-1 text-lg font-mono font-bold text-slate-200 tabular-nums">
                      {activeReport.coverage.skippedFiles.toLocaleString()}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      Binary / lock / budget
                    </div>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
                    <div className="text-[11px] text-slate-400">Failed Retrieval</div>
                    <div
                      className={`mt-1 text-lg font-mono font-bold tabular-nums ${
                        activeReport.coverage.failedFiles > 0 ? 'text-red-400' : 'text-slate-200'
                      }`}
                    >
                      {activeReport.coverage.failedFiles}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      {activeReport.coverage.truncatedFiles} truncated
                    </div>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3">
                    <div className="text-[11px] text-slate-400">Mapped Modules</div>
                    <div className="mt-1 text-lg font-mono font-bold text-blue-400 tabular-nums">
                      {activeReport.components.length}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      {activeReport.backendArchitecture.endpoints.length} routes ·{' '}
                      {activeReport.apiIntegrations.length} APIs
                    </div>
                  </div>
                </div>

                {/* Beginner & Technical Summaries Side-by-Side */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-4 space-y-2">
                    <div className="text-xs font-semibold text-blue-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Simple Explanation (For Any Reader)</span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                      {activeReport.overview.simpleSummary}
                    </p>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-4 space-y-2">
                    <div className="text-xs font-semibold text-purple-400 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Technical Architecture Summary</span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                      {activeReport.overview.technicalSummary}
                    </p>
                  </div>
                </div>

                {/* Tech Stack & Entry Points */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-4 space-y-2.5">
                    <div className="text-xs font-semibold text-slate-200">Detected Tech Stack</div>
                    <div className="flex flex-wrap gap-1.5">
                      {activeReport.overview.techStack.map((tech) => (
                        <span
                          key={tech}
                          className="px-2 py-0.5 rounded bg-[#111827] border border-slate-700/80 text-xs font-mono text-slate-200"
                        >
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-4 space-y-2.5">
                    <div className="text-xs font-semibold text-slate-200">Key Entry Points</div>
                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-slate-400 mr-2">Frontend:</span>
                        {renderFileChipList(activeReport.overview.entryPoints.frontend, 'None detected')}
                      </div>
                      <div>
                        <span className="text-slate-400 mr-2">Backend:</span>
                        {renderFileChipList(activeReport.overview.entryPoints.backend, 'None detected')}
                      </div>
                      <div>
                        <span className="text-slate-400 mr-2">Config:</span>
                        {renderFileChipList(activeReport.overview.entryPoints.config, 'None detected')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Confirmed vs Inferred Grounding */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-4 space-y-2">
                    <div className="text-xs font-semibold text-emerald-400">
                      Directly Confirmed From Source Code
                    </div>
                    <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                      {activeReport.overview.confirmedFacts.length > 0 ? (
                        activeReport.overview.confirmedFacts.map((fact, idx) => (
                          <li key={idx}>{fact}</li>
                        ))
                      ) : (
                        <li>File tree, entry points, and component boundaries verified in collected files.</li>
                      )}
                    </ul>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-4 space-y-2">
                    <div className="text-xs font-semibold text-amber-400">
                      Inferred Details & Coverage Notes
                    </div>
                    <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                      {activeReport.overview.inferredDetails.length > 0 ? (
                        activeReport.overview.inferredDetails.map((detail, idx) => (
                          <li key={idx}>{detail}</li>
                        ))
                      ) : (
                        <li>No speculative inferences recorded beyond analyzed source evidence.</li>
                      )}
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* SECTION 2: COMPLETE REPOSITORY STRUCTURE */}
          {activeTab === 'structure' && (
            <RepositoryExplorer
              report={activeReport}
              selectedFilePath={selectedFilePath}
              onSelectFilePath={setSelectedFilePath}
              onSelectComponent={() => setActiveTab('system')}
            />
          )}

          {/* SECTION 3: SYSTEM ARCHITECTURE */}
          {activeTab === 'system' && (
            <div className="space-y-6">
              <InteractiveArchitectureGraph
                components={activeReport.components}
                onOpenFile={handleJumpToFile}
              />
              <InteractiveMermaidDiagram
                spec={activeReport.systemArchitecture}
                components={activeReport.components}
                onOpenFile={handleJumpToFile}
              />
            </div>
          )}

          {/* SECTION 4: FRONTEND ARCHITECTURE */}
          {activeTab === 'frontend' && (
            <div className="space-y-5">
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">Frontend Architecture</h3>
                    <p className="text-xs text-slate-300 mt-1">
                      {activeReport.frontendArchitecture.frameworkSummary}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      activeReport.frontendArchitecture.hasFrontend
                        ? 'text-emerald-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {activeReport.frontendArchitecture.hasFrontend
                      ? 'Frontend Detected'
                      : 'No Dedicated Frontend Detected'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1.5">
                    <div className="font-semibold text-slate-200">Entry & Root App</div>
                    {renderFileChipList(
                      [
                        ...activeReport.frontendArchitecture.entryPoints,
                        ...activeReport.frontendArchitecture.rootComponents,
                      ],
                      'None detected'
                    )}
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1.5">
                    <div className="font-semibold text-slate-200">Pages & Views</div>
                    {renderFileChipList(activeReport.frontendArchitecture.pagesAndViews, 'None detected')}
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1.5">
                    <div className="font-semibold text-slate-200">Routing, State & Contexts</div>
                    {renderFileChipList(
                      [
                        ...activeReport.frontendArchitecture.routingFiles,
                        ...activeReport.frontendArchitecture.stateAndContexts,
                      ],
                      'None detected'
                    )}
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1.5">
                    <div className="font-semibold text-slate-200">Hooks & API Services</div>
                    {renderFileChipList(
                      [
                        ...activeReport.frontendArchitecture.customHooks,
                        ...activeReport.frontendArchitecture.apiServiceFiles,
                      ],
                      'None detected'
                    )}
                  </div>
                </div>

                {activeReport.frontendArchitecture.reusableComponents.length > 0 && (
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1.5">
                    <div className="text-xs font-semibold text-slate-200">
                      Reusable UI Components
                    </div>
                    {renderFileChipList(
                      activeReport.frontendArchitecture.reusableComponents,
                      'None detected'
                    )}
                  </div>
                )}
              </div>

              <InteractiveMermaidDiagram
                spec={activeReport.frontendArchitecture.diagram}
                components={activeReport.components}
                onOpenFile={handleJumpToFile}
              />
            </div>
          )}

          {/* SECTION 5: BACKEND ARCHITECTURE */}
          {activeTab === 'backend' && (
            <div className="space-y-5">
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">Backend Architecture</h3>
                    <p className="text-xs text-slate-300 mt-1">
                      {activeReport.backendArchitecture.runtimeSummary}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      activeReport.backendArchitecture.hasBackend
                        ? 'text-emerald-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {activeReport.backendArchitecture.hasBackend
                      ? 'Backend Server Detected'
                      : 'No Dedicated Backend Server Detected'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1.5">
                    <div className="font-semibold text-slate-200">Server Entry & Middleware</div>
                    {renderFileChipList(
                      [
                        ...activeReport.backendArchitecture.serverEntryPoints,
                        ...activeReport.backendArchitecture.middlewareFiles,
                      ],
                      'None detected'
                    )}
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1.5">
                    <div className="font-semibold text-slate-200">API Routes & Controllers</div>
                    {renderFileChipList(
                      activeReport.backendArchitecture.routeAndControllerFiles,
                      'None detected'
                    )}
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1.5">
                    <div className="font-semibold text-slate-200">
                      Services, DB Layer & Integrations
                    </div>
                    {renderFileChipList(
                      [
                        ...activeReport.backendArchitecture.serviceFiles,
                        ...activeReport.backendArchitecture.databaseLayerFiles,
                        ...activeReport.backendArchitecture.externalIntegrationFiles,
                      ],
                      'None detected'
                    )}
                  </div>
                </div>

                {activeReport.backendArchitecture.endpoints.length > 0 && (
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-lg overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-slate-800 text-xs font-semibold text-slate-200">
                      Detected Backend API Endpoints ({activeReport.backendArchitecture.endpoints.length})
                    </div>
                    <div className="overflow-x-auto max-h-72 overflow-y-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-[#111827] text-slate-400 border-b border-slate-800">
                          <tr>
                            <th className="py-2 px-3 font-medium">Method</th>
                            <th className="py-2 px-3 font-medium">Path</th>
                            <th className="py-2 px-3 font-medium">Handler / Purpose</th>
                            <th className="py-2 px-3 font-medium">Source File</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {activeReport.backendArchitecture.endpoints.map((ep, idx) => (
                            <tr key={`${ep.method}-${ep.path}-${idx}`} className="hover:bg-slate-900/50">
                              <td className="py-2 px-3 font-mono font-semibold text-blue-400">
                                {ep.method}
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-100">{ep.path}</td>
                              <td className="py-2 px-3 text-slate-300">
                                <span className="font-mono text-[11px] text-purple-300 mr-1.5">
                                  {ep.handler}
                                </span>
                                <span>{ep.purpose}</span>
                              </td>
                              <td className="py-2 px-3">
                                <button
                                  type="button"
                                  onClick={() => handleJumpToFile(ep.filePath)}
                                  className="font-mono text-[11px] text-blue-300 hover:underline"
                                >
                                  {ep.filePath}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <InteractiveMermaidDiagram
                spec={activeReport.backendArchitecture.diagram}
                components={activeReport.components}
                onOpenFile={handleJumpToFile}
              />
            </div>
          )}

          {/* SECTION 6: FRONTEND-BACKEND COMMUNICATION */}
          {activeTab === 'communication' && (
            <div className="space-y-5">
              <InteractiveMermaidDiagram
                spec={activeReport.communicationOverviewDiagram}
                components={activeReport.components}
                onOpenFile={handleJumpToFile}
              />

              {activeReport.communicationFlows.length > 0 && (
                <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-100">
                        Traced Request Lifecycle Flows
                      </h3>
                      <p className="text-xs text-slate-400">
                        Follow real end-to-end communication paths from user interaction to backend processing and UI updates.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {activeReport.communicationFlows.map((flow, idx) => (
                        <button
                          key={flow.id}
                          type="button"
                          onClick={() => setSelectedFlowIndex(idx)}
                          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                            selectedFlowIndex === idx
                              ? 'bg-blue-600 text-white'
                              : 'bg-[#0B0F17] text-slate-300 border border-slate-800 hover:border-slate-600'
                          }`}
                        >
                          {flow.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {activeReport.communicationFlows[selectedFlowIndex] && (() => {
                    const flow = activeReport.communicationFlows[selectedFlowIndex];
                    const steps = [
                      { label: '1. User Action', value: flow.userAction },
                      { label: '2. Frontend Component', value: flow.frontendComponent },
                      { label: '3. Frontend API Service', value: flow.frontendService },
                      { label: '4. HTTP Request', value: flow.httpRequest },
                      { label: '5. Backend Route', value: flow.backendRoute },
                      { label: '6. Middleware', value: flow.middleware },
                      { label: '7. Service Layer', value: flow.serviceLayer },
                      { label: '8. Database / External API', value: flow.databaseOrExternal },
                      { label: '9. Response & State Update', value: `${flow.responseFormat} → ${flow.stateUpdate}` },
                      { label: '10. UI Rendering', value: flow.uiRendering },
                    ].filter((s) => s.value && s.value.trim());

                    return (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2.5">
                          {steps.map((step) => (
                            <div
                              key={step.label}
                              className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1"
                            >
                              <div className="text-[10px] font-mono uppercase tracking-wider text-blue-400">
                                {step.label}
                              </div>
                              <div className="text-xs text-slate-200 leading-snug break-words">
                                {step.value}
                              </div>
                            </div>
                          ))}
                        </div>

                        {flow.sourceFiles.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-slate-400">Verified Source Files:</span>
                            {renderFileChipList(flow.sourceFiles, '')}
                          </div>
                        )}

                        <InteractiveMermaidDiagram
                          spec={{
                            id: flow.id,
                            title: flow.name,
                            diagramType: 'sequence',
                            mermaidCode: flow.mermaidCode,
                            simpleExplanation:
                              flow.simpleExplanation ||
                              `Walkthrough of ${flow.name} from user action to screen update.`,
                            technicalExplanation:
                              flow.technicalExplanation ||
                              `${flow.httpRequest} handled by ${flow.backendRoute}.`,
                            confidence: flow.confidence,
                            relatedComponentIds: [],
                            sourceFiles: flow.sourceFiles,
                          }}
                          components={activeReport.components}
                          onOpenFile={handleJumpToFile}
                        />
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* SECTION 7: API INTEGRATIONS */}
          {activeTab === 'integrations' && (
            <div className="space-y-5">
              <InteractiveMermaidDiagram
                spec={activeReport.apiIntegrationsDiagram}
                components={activeReport.components}
                onOpenFile={handleJumpToFile}
              />

              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-slate-100">
                    External Services, AI Providers & Internal APIs
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Only referenced environment variable names are listed; actual API keys, tokens, and credentials are never displayed.
                  </p>
                </div>

                {activeReport.apiIntegrations.length === 0 ? (
                  <div className="p-4 rounded-md bg-[#0B0F17] border border-slate-800 text-xs text-slate-400">
                    No outbound third-party REST or AI SDK integrations were detected in the collected source files.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activeReport.apiIntegrations.map((integ) => (
                      <div
                        key={integ.id}
                        className="bg-[#0B0F17] border border-slate-800 rounded-lg p-4 space-y-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-slate-100">{integ.provider}</span>
                          <span className="font-mono text-[11px] text-blue-300">
                            {integ.kind}
                          </span>
                        </div>
                        <p className="text-slate-300 leading-relaxed">{integ.purpose}</p>
                        <div className="space-y-1 text-[11px] text-slate-400">
                          {integ.clientInitialization && (
                            <div>
                              <span className="text-slate-300 font-medium">Client Setup:</span>{' '}
                              {integ.clientInitialization}
                            </div>
                          )}
                          <div>
                            <span className="text-slate-300 font-medium">Called From:</span>{' '}
                            <button
                              type="button"
                              onClick={() => handleJumpToFile(integ.callingFile)}
                              className="font-mono text-blue-300 hover:underline"
                            >
                              {integ.callingFile}
                            </button>
                            {integ.callingFunction ? ` (${integ.callingFunction})` : ''}
                          </div>
                          {integ.endpointOrMethod && (
                            <div>
                              <span className="text-slate-300 font-medium">Endpoint / Method:</span>{' '}
                              <code className="font-mono text-purple-300">
                                {integ.endpointOrMethod}
                              </code>
                            </div>
                          )}
                          {integ.requestFlow && (
                            <div>
                              <span className="text-slate-300 font-medium">Flow:</span>{' '}
                              {integ.requestFlow}
                            </div>
                          )}
                          {integ.responseHandling && (
                            <div>
                              <span className="text-slate-300 font-medium">Response:</span>{' '}
                              {integ.responseHandling}
                            </div>
                          )}
                        </div>
                        {integ.envVarNames.length > 0 && (
                          <div className="pt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-slate-400">Env Vars:</span>
                            {integ.envVarNames.map((env) => (
                              <code
                                key={env}
                                className="px-1.5 py-0.5 rounded bg-[#111827] border border-slate-700 font-mono text-[11px] text-amber-300"
                              >
                                {env}
                              </code>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 8: DATABASE ARCHITECTURE */}
          {activeTab === 'database' && (
            <div className="space-y-5">
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">Database & Schema Architecture</h3>
                    <p className="text-xs text-slate-300 mt-1">
                      {activeReport.databaseArchitecture.databaseTechSummary}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      activeReport.databaseArchitecture.hasDatabase
                        ? 'text-emerald-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {activeReport.databaseArchitecture.hasDatabase
                      ? `${activeReport.databaseArchitecture.entities.length} Entities Discovered`
                      : 'No Dedicated Database Schema'}
                  </span>
                </div>

                {activeReport.databaseArchitecture.schemaFiles.length > 0 && (
                  <div className="text-xs flex flex-wrap items-center gap-2">
                    <span className="text-slate-400">Schema / Persistence Files:</span>
                    {renderFileChipList(activeReport.databaseArchitecture.schemaFiles, '')}
                  </div>
                )}

                {activeReport.databaseArchitecture.entities.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activeReport.databaseArchitecture.entities.map((entity) => (
                      <div
                        key={entity.name}
                        className="bg-[#0B0F17] border border-slate-800 rounded-lg overflow-hidden text-xs"
                      >
                        <div className="px-4 py-2.5 bg-[#111827] border-b border-slate-800 flex items-center justify-between gap-2">
                          <div>
                            <span className="font-mono font-bold text-slate-100">
                              {entity.name}
                            </span>
                            <span className="ml-2 text-[11px] font-mono text-amber-300">
                              {entity.kind}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleJumpToFile(entity.sourceFile)}
                            className="font-mono text-[11px] text-blue-300 hover:underline truncate max-w-[180px]"
                          >
                            {entity.sourceFile}
                          </button>
                        </div>
                        <div className="p-3 space-y-2">
                          {entity.fields.length > 0 && (
                            <div className="space-y-1">
                              {entity.fields.slice(0, 12).map((field) => (
                                <div
                                  key={field.name}
                                  className="flex items-center justify-between gap-2 font-mono text-[11px] py-0.5 border-b border-slate-800/50 last:border-0"
                                >
                                  <span className="text-slate-200">
                                    {field.key && (
                                      <span className="text-amber-400 mr-1.5">[{field.key}]</span>
                                    )}
                                    {field.name}
                                  </span>
                                  <span className="text-slate-400">{field.type}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {entity.relationships.length > 0 && (
                            <div className="text-[11px] text-slate-400 pt-1">
                              <span className="text-slate-300 font-semibold">Relationships:</span>{' '}
                              {entity.relationships.join(' · ')}
                            </div>
                          )}
                          {entity.accessorFunctions.length > 0 && (
                            <div className="text-[11px] text-slate-400">
                              <span className="text-slate-300 font-semibold">Accessors:</span>{' '}
                              <span className="font-mono text-blue-300">
                                {entity.accessorFunctions.join(', ')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <InteractiveMermaidDiagram
                spec={activeReport.databaseArchitecture.diagram}
                components={activeReport.components}
                onOpenFile={handleJumpToFile}
              />
            </div>
          )}

          {/* SECTION 9: AUTHENTICATION FLOW */}
          {activeTab === 'auth' && (
            <div className="space-y-5">
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">
                      Authentication & Authorization Architecture
                    </h3>
                    <p className="text-xs text-slate-300 mt-1">
                      {activeReport.authenticationFlow.authSummary}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      activeReport.authenticationFlow.hasAuthentication
                        ? 'text-emerald-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {activeReport.authenticationFlow.hasAuthentication
                      ? 'Authentication Implemented'
                      : 'No Auth Flow Detected'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1.5">
                    <div className="font-semibold text-slate-200">Auth Providers & Login Files</div>
                    {activeReport.authenticationFlow.providers.length > 0 && (
                      <div className="text-blue-300 font-mono text-[11px]">
                        {activeReport.authenticationFlow.providers.join(', ')}
                      </div>
                    )}
                    {renderFileChipList(
                      activeReport.authenticationFlow.loginInitiationFiles,
                      'None detected'
                    )}
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1.5">
                    <div className="font-semibold text-slate-200">
                      Token / Session & Logout Handling
                    </div>
                    <p className="text-slate-300">
                      {activeReport.authenticationFlow.tokenOrSessionHandling}
                    </p>
                    <p className="text-slate-400 text-[11px]">
                      Logout: {activeReport.authenticationFlow.logoutHandling}
                    </p>
                  </div>
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 space-y-1.5">
                    <div className="font-semibold text-slate-200">
                      Backend Verification & Route Guards
                    </div>
                    <p className="text-slate-300">
                      {activeReport.authenticationFlow.protectedRoutesSummary}
                    </p>
                    {renderFileChipList(
                      activeReport.authenticationFlow.backendVerificationFiles,
                      'None detected'
                    )}
                  </div>
                </div>

                {activeReport.authenticationFlow.steps.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {activeReport.authenticationFlow.steps.map((step) => (
                      <div
                        key={step.step}
                        className="bg-[#0B0F17] border border-slate-800 rounded-md p-3 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-purple-400">
                          <span>STEP {step.step}</span>
                          <span>{step.actor}</span>
                        </div>
                        <div className="font-semibold text-slate-100">{step.action}</div>
                        <p className="text-slate-400 text-[11px]">{step.detail}</p>
                        {step.filePath && (
                          <button
                            type="button"
                            onClick={() => handleJumpToFile(step.filePath)}
                            className="font-mono text-[10px] text-blue-300 hover:underline block truncate"
                          >
                            {step.filePath}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <InteractiveMermaidDiagram
                spec={activeReport.authenticationFlow.diagram}
                components={activeReport.components}
                onOpenFile={handleJumpToFile}
              />
            </div>
          )}

          {/* SECTION 10: APPLICATION WORKFLOW */}
          {activeTab === 'workflows' && (
            <div className="space-y-5">
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-100">
                    Execution & Feature Workflows
                  </h3>
                  <p className="text-xs text-slate-400">
                    Select a runtime workflow to view its step-by-step interactive flowchart and source files.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeReport.applicationWorkflows.map((wf, idx) => (
                    <button
                      key={wf.id}
                      type="button"
                      onClick={() => setSelectedWorkflowIndex(idx)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        selectedWorkflowIndex === idx
                          ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                          : 'bg-[#0B0F17] text-slate-300 border border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      {wf.title}
                    </button>
                  ))}
                </div>
              </div>

              {activeReport.applicationWorkflows[selectedWorkflowIndex] && (
                <>
                  <InteractiveMermaidDiagram
                    spec={activeReport.applicationWorkflows[selectedWorkflowIndex]}
                    components={activeReport.components}
                    onOpenFile={handleJumpToFile}
                  />
                  {activeReport.applicationWorkflows[selectedWorkflowIndex].sourceFiles.length > 0 && (
                    <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-slate-400 font-medium flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                        <span>Referenced Workflow Files:</span>
                      </span>
                      {renderFileChipList(
                        activeReport.applicationWorkflows[selectedWorkflowIndex].sourceFiles,
                        ''
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* SECTION 11: AI EXPLANATIONS */}
          {activeTab === 'explanations' && (
            <AiExplanationsSection
              report={activeReport}
              onOpenFile={handleJumpToFile}
            />
          )}

          {/* SECTION 12: ASK YOUR REPOSITORY */}
          {activeTab === 'qa' && (
            <AskRepositorySection
              repositoryId={repository.id}
              report={activeReport}
              onOpenFile={handleJumpToFile}
              onMessagesChange={setQaMessagesSnapshot}
            />
          )}
        </>
      )}
    </div>
  );
}
