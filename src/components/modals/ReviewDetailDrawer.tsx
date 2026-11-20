import { AlertTriangle, Check, CheckCircle2, ExternalLink, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import type { CodeReview, ReviewStatus, Severity } from '../../types';
import {
  formatCommitSha,
  formatDurationMs,
  formatFindingLocation,
  formatRelativeTime,
  getScoreColorClass,
  getSourceLabel,
} from '../../utils/formatters';
import { AgentExecutionBreakdown } from '../analysis/AgentExecutionBreakdown';
import { CodeDiffViewer } from '../ui/CodeDiffViewer';
import { SeverityText, StatusText } from '../ui/SeverityText';

interface ReviewDetailDrawerProps {
  review: CodeReview | null;
  onClose: () => void;
  onReviewUpdated: (updated: CodeReview) => void;
}

export function ReviewDetailDrawer({
  review,
  onClose,
  onReviewUpdated,
}: ReviewDetailDrawerProps) {
  const isRepositoryReview = review?.reviewScope === 'repository';
  const [activeTab, setActiveTab] = useState<'findings' | 'agents' | 'diff'>('findings');
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab('findings');
    setSeverityFilter('all');
    setCategoryFilter('all');
    setAgentFilter('all');
    setActionError(null);
  }, [review?.id]);

  const categories = useMemo(() => {
    if (!review) return [];
    return Array.from(new Set(review.findings.map((f) => f.category)));
  }, [review]);

  const contributingAgentNames = useMemo(() => {
    if (!review) return [];
    const names = new Set<string>();
    for (const f of review.findings) {
      if (f.contributingAgents && f.contributingAgents.length > 0) {
        for (const a of f.contributingAgents) names.add(a.agentName);
      } else if (f.agentName) {
        names.add(f.agentName);
      }
    }
    return Array.from(names);
  }, [review]);

  if (!review) return null;

  const filteredFindings = review.findings.filter((f) => {
    if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
    if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
    if (agentFilter !== 'all') {
      const matchesAgent =
        f.agentName === agentFilter ||
        Boolean(f.contributingAgents?.some((a) => a.agentName === agentFilter));
      if (!matchesAgent) return false;
    }
    return true;
  });

  const severityCounts = review.findings.reduce(
    (acc, f) => {
      acc[f.severity] += 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 }
  );

  const hasAgentMetadata = Boolean(
    (review.agentBreakdown && review.agentBreakdown.length > 0) ||
      review.collectionCoverage ||
      (review.strengths && review.strengths.length > 0)
  );

  async function handleStatusChange(nextStatus: ReviewStatus) {
    if (!review) return;
    setUpdating(true);
    setActionError(null);
    try {
      const res = await api.updateReviewStatus(review.id, nextStatus);
      onReviewUpdated(res.review);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update review status.');
    } finally {
      setUpdating(false);
    }
  }

  async function handleToggleResolved(findingId: string, current: boolean) {
    if (!review) return;
    setActionError(null);
    try {
      const res = await api.toggleFindingResolved(review.id, findingId, !current);
      onReviewUpdated(res.review);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update finding state.');
    }
  }

  const pillars = [
    { label: 'Security', value: review.rubricBreakdown.security },
    { label: 'Reliability', value: review.rubricBreakdown.reliability },
    { label: 'Maintainability', value: review.rubricBreakdown.maintainability },
    { label: 'Performance', value: review.rubricBreakdown.performance },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-review-title"
    >
      <div className="flex-1" onClick={onClose} aria-hidden="true" />
      <div className="w-full max-w-3xl bg-[#0E1420] border-l border-slate-800 h-full flex flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-mono text-slate-300">{review.repositoryFullName}</span>
              <span aria-hidden="true">·</span>
              {isRepositoryReview ? (
                <>
                  <span className="font-mono">{review.branch}</span>
                  {review.analyzedCommitSha && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatCommitSha(review.analyzedCommitSha)}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span className="font-mono tabular-nums">PR #{review.prNumber}</span>
              )}
              <span aria-hidden="true">·</span>
              <span>{getSourceLabel(review)}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{formatRelativeTime(review.createdAt)}</span>
            </div>
            <h2
              id="drawer-review-title"
              className="mt-1 text-lg font-semibold text-slate-100 leading-snug"
            >
              {review.title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close review details"
            className="p-2 text-slate-400 hover:text-slate-100 rounded-md hover:bg-slate-800/60 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {actionError && (
            <div
              role="alert"
              className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2"
            >
              {actionError}
            </div>
          )}

          {review.analysisStatus === 'partial' && (
            <div
              role="status"
              className="bg-amber-500/10 border border-amber-500/30 rounded-md px-4 py-3 flex items-start gap-2.5 text-xs text-amber-200"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Partial repository review: one or more agents or repository file collection stages did not complete fully. Inspect the Agents &amp; Coverage tab for details.
              </span>
            </div>
          )}

          {/* Score & Status Bar */}
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-5">
              <div>
                <div className="text-xs text-slate-400">Rubric Score</div>
                <div
                  className={`text-2xl font-mono font-semibold tabular-nums ${getScoreColorClass(
                    review.score
                  )}`}
                >
                  {review.score}
                  <span className="text-sm text-slate-500 font-normal"> / 100</span>
                </div>
              </div>
              <div className="h-9 w-px bg-slate-800" aria-hidden="true" />
              <div>
                <div className="text-xs text-slate-400 mb-1">Decision</div>
                <StatusText status={review.status} />
              </div>
              <div className="h-9 w-px bg-slate-800 hidden sm:block" aria-hidden="true" />
              <div className="hidden sm:block">
                <div className="text-xs text-slate-400">Agent &amp; Latency</div>
                <div className="text-xs text-slate-200 mt-0.5 tabular-nums">
                  {review.agentName} · {formatDurationMs(review.durationMs)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {review.prUrl && (
                <a
                  href={review.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 rounded-md whitespace-nowrap"
                >
                  <span>GitHub</span>
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
              <button
                type="button"
                disabled={updating}
                onClick={() => handleStatusChange('changes_requested')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                  review.status === 'changes_requested'
                    ? 'bg-red-500/15 border-red-500/50 text-red-300'
                    : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:bg-slate-800'
                }`}
              >
                Request Changes
              </button>
              <button
                type="button"
                disabled={updating}
                onClick={() => handleStatusChange('approved')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  review.status === 'approved'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                Approve
              </button>
            </div>
          </div>

          {/* Executive Summary + Rubric Pillars */}
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-400 mb-1.5">AI Assessment</h3>
              <p className="text-sm text-slate-200 leading-relaxed">{review.summary}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 font-mono tabular-nums">
                {isRepositoryReview ? (
                  <>
                    <span>Branch: {review.branch}</span>
                    {review.analyzedCommitSha && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Commit: {formatCommitSha(review.analyzedCommitSha)}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>
                      {review.collectionCoverage?.totalFilesAnalyzed ?? review.filesChanged}{' '}
                      files analyzed
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {severityCounts.critical} critical · {severityCounts.high} high ·{' '}
                      {severityCounts.medium} medium · {severityCounts.low} low
                    </span>
                  </>
                ) : (
                  <span>
                    {review.branch} → {review.baseBranch} · {review.filesChanged} files · +
                    {review.additions} / -{review.deletions}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              {pillars.map((pillar) => (
                <div
                  key={pillar.label}
                  className="bg-[#111827] border border-slate-800/80 rounded-md p-3"
                >
                  <div className="text-xs text-slate-400">{pillar.label}</div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span
                      className={`text-base font-mono font-semibold tabular-nums ${getScoreColorClass(
                        pillar.value
                      )}`}
                    >
                      {pillar.value}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">/100</span>
                  </div>
                  <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${pillar.value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Findings / Agents & Coverage / Diff Tabs */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-md">
                <button
                  type="button"
                  onClick={() => setActiveTab('findings')}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    activeTab === 'findings'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Findings ({review.findings.length})
                </button>
                {hasAgentMetadata && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('agents')}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      activeTab === 'agents'
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Agents &amp; Coverage
                  </button>
                )}
                {(!isRepositoryReview || review.diffPreview) && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('diff')}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      activeTab === 'diff'
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Code Diff
                  </button>
                )}
              </div>

              {activeTab === 'findings' && review.findings.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1">
                    {(['all', 'critical', 'high', 'medium', 'low'] as const).map((sev) => (
                      <button
                        key={sev}
                        type="button"
                        onClick={() => setSeverityFilter(sev)}
                        className={`px-2 py-1 text-xs rounded transition-colors capitalize whitespace-nowrap ${
                          severityFilter === sev
                            ? 'bg-slate-800 text-slate-100'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>

                  {categories.length > 1 && (
                    <select
                      aria-label="Filter findings by category"
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="px-2 py-1 text-xs bg-[#111827] border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-blue-500"
                    >
                      <option value="all">All categories</option>
                      {categories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  )}

                  {contributingAgentNames.length > 1 && (
                    <select
                      aria-label="Filter findings by agent"
                      value={agentFilter}
                      onChange={(e) => setAgentFilter(e.target.value)}
                      className="px-2 py-1 text-xs bg-[#111827] border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-blue-500"
                    >
                      <option value="all">All agents</option>
                      {contributingAgentNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            {activeTab === 'findings' ? (
              filteredFindings.length === 0 ? (
                <div className="bg-[#111827] border border-slate-800/80 rounded-lg p-6 text-center text-sm text-slate-400">
                  No rubric issues found for this filter.
                </div>
              ) : (
                <div className="divide-y divide-slate-800/80 border border-slate-800/90 rounded-lg bg-[#111827]">
                  {filteredFindings.map((finding) => {
                    const agentsList =
                      finding.contributingAgents && finding.contributingAgents.length > 0
                        ? finding.contributingAgents.map((a) => a.agentName).join(', ')
                        : finding.agentName;

                    return (
                      <div key={finding.id} className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <SeverityText severity={finding.severity} />
                              <span className="text-slate-600" aria-hidden="true">·</span>
                              <span className="text-slate-400">{finding.category}</span>
                              <span className="text-slate-600" aria-hidden="true">·</span>
                              <span className="font-mono text-slate-300">
                                {formatFindingLocation(
                                  finding.filePath,
                                  finding.lineStart,
                                  finding.lineEnd
                                )}
                              </span>
                              {finding.confidence && (
                                <>
                                  <span className="text-slate-600" aria-hidden="true">·</span>
                                  <span
                                    className={
                                      finding.confidence === 'confirmed'
                                        ? 'text-emerald-400 capitalize'
                                        : 'text-amber-300 capitalize'
                                    }
                                  >
                                    {finding.confidence}
                                  </span>
                                </>
                              )}
                            </div>
                            <h4
                              className={`text-sm font-medium ${
                                finding.resolved ? 'line-through text-slate-500' : 'text-slate-100'
                              }`}
                            >
                              {finding.title}
                            </h4>
                            {agentsList && (
                              <div className="text-[11px] text-slate-400">
                                Identified by <span className="text-slate-300">{agentsList}</span>
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleToggleResolved(finding.id, finding.resolved)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                              finding.resolved
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            <Check className="w-3 h-3" aria-hidden="true" />
                            <span>{finding.resolved ? 'Resolved' : 'Mark Resolved'}</span>
                          </button>
                        </div>

                        <p className="text-xs text-slate-300 leading-relaxed">
                          {finding.explanation}
                        </p>

                        {finding.evidence && (
                          <div className="bg-[#0B0F17] border border-slate-800/80 rounded px-3 py-2 text-xs text-slate-300">
                            <span className="font-semibold text-slate-400 mr-1.5">Evidence:</span>
                            <span className="font-mono text-slate-200">{finding.evidence}</span>
                          </div>
                        )}

                        {finding.codeSnippet && (
                          <pre className="p-3 bg-[#0B0F17] border border-slate-800 rounded text-xs font-mono text-slate-300 overflow-x-auto">
                            <code>{finding.codeSnippet}</code>
                          </pre>
                        )}

                        <div className="text-xs text-slate-300 bg-[#0B0F17] border border-slate-800/80 rounded px-3 py-2">
                          <span className="font-semibold text-blue-400 mr-1.5">
                            Recommendation:
                          </span>
                          {finding.suggestedFix}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : activeTab === 'agents' ? (
              <div className="space-y-4">
                {review.collectionCoverage && (
                  <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-200">
                        Collection Coverage
                      </span>
                      <span className="font-mono text-slate-400 tabular-nums">
                        {review.collectionCoverage.coverageComplete &&
                        !review.collectionCoverage.truncationDetected
                          ? 'Complete collected set'
                          : 'Truncated / Partial subset'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="bg-[#0B0F17] border border-slate-800 rounded p-2.5">
                        <div className="text-slate-400 text-[11px]">Files Collected</div>
                        <div className="mt-0.5 font-mono font-semibold text-slate-100 tabular-nums">
                          {review.collectionCoverage.filesCollected} /{' '}
                          {review.collectionCoverage.eligibleFiles}
                        </div>
                      </div>
                      <div className="bg-[#0B0F17] border border-slate-800 rounded p-2.5">
                        <div className="text-slate-400 text-[11px]">Files Analyzed</div>
                        <div className="mt-0.5 font-mono font-semibold text-slate-100 tabular-nums">
                          {review.collectionCoverage.totalFilesAnalyzed}
                        </div>
                      </div>
                      <div className="bg-[#0B0F17] border border-slate-800 rounded p-2.5">
                        <div className="text-slate-400 text-[11px]">Skipped / Truncated</div>
                        <div className="mt-0.5 font-mono font-semibold text-slate-100 tabular-nums">
                          {review.collectionCoverage.filesSkipped} /{' '}
                          {review.collectionCoverage.filesTruncated}
                        </div>
                      </div>
                      <div className="bg-[#0B0F17] border border-slate-800 rounded p-2.5">
                        <div className="text-slate-400 text-[11px]">Chunks Analyzed</div>
                        <div className="mt-0.5 font-mono font-semibold text-slate-100 tabular-nums">
                          {review.collectionCoverage.totalChunksAnalyzed}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {review.strengths && review.strengths.length > 0 && (
                  <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-2.5">
                    <div className="text-xs font-semibold text-slate-200">
                      Observed Repository Strengths
                    </div>
                    <ul className="space-y-1.5">
                      {review.strengths.map((item, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2 text-xs text-slate-300 leading-relaxed"
                        >
                          <CheckCircle2
                            className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5"
                            aria-hidden="true"
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {review.agentBreakdown && (
                  <AgentExecutionBreakdown agentBreakdown={review.agentBreakdown} />
                )}
              </div>
            ) : (
              <CodeDiffViewer diff={review.diffPreview} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
