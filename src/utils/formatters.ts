import type {
  CodeReview,
  RepositoryAnalysisJobStatus,
  ReviewStatus,
  Severity,
} from '../types';

export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'Just now';

  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function getStatusLabel(status: ReviewStatus): string {
  if (status === 'approved') return 'Approved';
  if (status === 'changes_requested') return 'Changes Requested';
  return 'In Review';
}

export function getStatusColorClass(status: ReviewStatus): string {
  if (status === 'approved') return 'text-emerald-400';
  if (status === 'changes_requested') return 'text-red-400';
  return 'text-amber-400';
}

export function getSeverityLabel(severity: Severity): string {
  if (severity === 'critical') return 'Critical';
  if (severity === 'high') return 'High';
  if (severity === 'medium') return 'Medium';
  return 'Low';
}

export function getSeverityColorClass(severity: Severity): string {
  if (severity === 'critical') return 'text-red-400';
  if (severity === 'high') return 'text-orange-400';
  if (severity === 'medium') return 'text-amber-400';
  return 'text-slate-400';
}

export function getScoreColorClass(score: number): string {
  if (score >= 85) return 'text-emerald-400';
  if (score >= 70) return 'text-amber-400';
  return 'text-red-400';
}

export function getSourceLabel(
  review: Pick<CodeReview, 'isDemo' | 'source' | 'reviewScope'>
): string {
  if (review.isDemo || review.source === 'demo') return 'Demo data';
  if (review.reviewScope === 'repository') return 'Repository Analysis · Gemini';
  if (review.source === 'github-live') return 'Live GitHub · Gemini';
  return 'Manual Diff · Gemini';
}

export function getJobStatusLabel(status: RepositoryAnalysisJobStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'collecting_files':
      return 'Collecting Files';
    case 'running_agents':
      return 'Running AI Agents';
    case 'synthesizing':
      return 'Synthesizing Review';
    case 'completed':
      return 'Completed';
    case 'partial':
      return 'Completed (Partial)';
    case 'failed':
      return 'Failed';
  }
}

export function getJobStatusColorClass(status: RepositoryAnalysisJobStatus): string {
  switch (status) {
    case 'completed':
      return 'text-emerald-400';
    case 'partial':
      return 'text-amber-400';
    case 'failed':
      return 'text-red-400';
    default:
      return 'text-blue-400';
  }
}

export function formatCommitSha(sha: string | null | undefined): string {
  if (!sha) return '—';
  return sha.slice(0, 7);
}

export function formatFindingLocation(
  filePath: string,
  lineStart: number | null | undefined,
  lineEnd: number | null | undefined
): string {
  if (lineStart === null || lineStart === undefined || !Number.isFinite(lineStart)) {
    return `${filePath} · Line unavailable`;
  }
  const hasRange =
    lineEnd !== null &&
    lineEnd !== undefined &&
    Number.isFinite(lineEnd) &&
    lineEnd > lineStart;
  return hasRange ? `${filePath}:${lineStart}-${lineEnd}` : `${filePath}:${lineStart}`;
}

export function downloadReviewsCsv(reviews: CodeReview[]): void {
  const header = [
    'ID',
    'Repository',
    'PR Number',
    'Title',
    'Author',
    'Agent',
    'Status',
    'Rubric Score',
    'Findings',
    'Source',
    'Created At',
  ];

  const escapeCsv = (val: string | number) => {
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = reviews.map((r) =>
    [
      r.id,
      r.repositoryFullName,
      r.prNumber,
      r.title,
      r.author,
      r.agentName,
      getStatusLabel(r.status),
      r.score,
      r.findings.length,
      getSourceLabel(r),
      r.createdAt,
    ]
      .map(escapeCsv)
      .join(',')
  );

  const csvContent = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `coderubric-reviews-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
