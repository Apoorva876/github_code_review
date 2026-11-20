import {
  CheckCircle2,
  ExternalLink,
  FileCode,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { api } from '../../services/api';
import type { CodeReview, Finding } from '../../types';
import {
  formatCommitSha,
  formatDurationMs,
  formatFindingLocation,
  getScoreColorClass,
} from '../../utils/formatters';
import { SeverityText } from '../ui/SeverityText';

interface ExpandableReviewDetailsProps {
  review: CodeReview;
  onOpenFullDrawer: (review: CodeReview) => void;
  onReviewUpdated?: (updated: CodeReview) => void;
}

function getBarColorClass(score: number): string {
  if (score >= 85) return 'bg-gradient-to-r from-emerald-500 to-teal-400';
  if (score >= 70) return 'bg-gradient-to-r from-amber-500 to-yellow-400';
  return 'bg-gradient-to-r from-red-500 to-orange-400';
}

export function ExpandableReviewDetails({
  review,
  onOpenFullDrawer,
  onReviewUpdated,
}: ExpandableReviewDetailsProps) {
  const { showToast } = useToast();
  const [updatingFindingId, setUpdatingFindingId] = useState<string | null>(null);

  const openFindingsCount = review.findings.filter((f) => !f.resolved).length;
  const pillars = [
    { label: 'Security', value: review.rubricBreakdown.security },
    { label: 'Reliability', value: review.rubricBreakdown.reliability },
    { label: 'Maintainability', value: review.rubricBreakdown.maintainability },
    { label: 'Performance', value: review.rubricBreakdown.performance },
  ];

  async function handleToggleResolved(finding: Finding) {
    setUpdatingFindingId(finding.id);
    try {
      const nextResolved = !finding.resolved;
      const res = await api.toggleFindingResolved(review.id, finding.id, nextResolved);
      onReviewUpdated?.(res.review);
      showToast({
        title: nextResolved ? 'Finding marked resolved' : 'Finding reopened',
        description: finding.title,
        variant: nextResolved ? 'success' : 'info',
      });
    } catch (err) {
      showToast({
        title: 'Unable to update finding status',
        description: err instanceof Error ? err.message : 'Request failed.',
        variant: 'error',
      });
    } finally {
      setUpdatingFindingId(null);
    }
  }

  return (
    <div className="bg-[#0B0F17]/95 border-t border-slate-800/90 px-5 py-5 space-y-5 cr-view-enter">
      {/* Summary & Score Visualization Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
            <span>Branch: {review.branch}</span>
            <span aria-hidden="true">·</span>
            <span>Duration: {formatDurationMs(review.durationMs)}</span>
            <span aria-hidden="true">·</span>
            <span>{review.filesChanged} files</span>
            {review.analyzedCommitSha && (
              <>
                <span aria-hidden="true">·</span>
                <span>Commit {formatCommitSha(review.analyzedCommitSha)}</span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">{review.summary}</p>
        </div>

        {/* Review Score Breakdown Visualization */}
        <div className="lg:col-span-5 bg-[#111827] border border-slate-800/90 rounded-md p-3.5 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-300">Rubric Score Breakdown</span>
            <span className={`font-mono font-semibold tabular-nums ${getScoreColorClass(review.score)}`}>
              {review.score} / 100
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {pillars.map((pillar) => (
              <div key={pillar.label} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">{pillar.label}</span>
                  <span className="font-mono text-slate-200 tabular-nums">{pillar.value}</span>
                </div>
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${getBarColorClass(
                      pillar.value
                    )}`}
                    style={{ width: `${Math.max(0, Math.min(100, pillar.value))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Evidence-Backed Findings List */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <ShieldAlert className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
            <span className="font-semibold text-slate-200">
              Evidence-Backed Findings ({openFindingsCount} open of {review.findings.length})
            </span>
          </div>

          <button
            type="button"
            onClick={() => onOpenFullDrawer(review)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-md transition-colors whitespace-nowrap"
          >
            <span>Open Full Inspector Drawer</span>
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {review.findings.length === 0 ? (
          <div className="bg-[#111827] border border-slate-800/80 rounded-md px-4 py-3 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>No defects or rubric violations flagged in this review.</span>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            {review.findings.map((finding) => {
              const isUpdating = updatingFindingId === finding.id;
              return (
                <div
                  key={finding.id}
                  className={`bg-[#111827] border rounded-md p-3.5 space-y-2.5 transition-colors ${
                    finding.resolved
                      ? 'border-slate-800/60 opacity-75'
                      : 'border-slate-800/90 hover:border-slate-700'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <SeverityText severity={finding.severity} />
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="text-slate-400">{finding.category}</span>
                        {finding.agentName && (
                          <>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className="text-purple-300 font-mono text-[11px]">
                              {finding.agentName}
                            </span>
                          </>
                        )}
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-300">
                          <FileCode className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span>
                            {formatFindingLocation(
                              finding.filePath,
                              finding.lineStart,
                              finding.lineEnd
                            )}
                          </span>
                        </span>
                      </div>
                      <h4 className="text-xs font-semibold text-slate-100">{finding.title}</h4>
                    </div>

                    <button
                      type="button"
                      disabled={isUpdating}
                      onClick={() => void handleToggleResolved(finding)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                        finding.resolved
                          ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/25'
                          : 'bg-[#0B0F17] border-slate-700 text-slate-300 hover:text-white hover:border-slate-600'
                      }`}
                    >
                      {isUpdating ? (
                        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                      )}
                      <span>{finding.resolved ? 'Resolved' : 'Mark Resolved'}</span>
                    </button>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">{finding.explanation}</p>

                  {finding.codeSnippet && (
                    <pre className="text-[11px] font-mono text-slate-300 bg-[#0B0F17] border border-slate-800 rounded px-3 py-2 overflow-x-auto leading-relaxed">
                      {finding.codeSnippet}
                    </pre>
                  )}

                  {finding.suggestedFix && (
                    <div className="bg-[#0E1420] border border-slate-800/80 rounded px-3 py-2 text-xs">
                      <span className="font-medium text-blue-300 mr-1.5">Suggested Fix:</span>
                      <span className="text-slate-300">{finding.suggestedFix}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
