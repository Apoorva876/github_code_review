import type {
  AIAgent,
  CodeReview,
  DailyActivityPoint,
  Finding,
  Repository,
  RepositoryAnalysisJob,
  ReviewStatus,
  Severity,
} from '../types';
import { formatRelativeTime } from './formatters';

export type DateRangeFilter = '24h' | '7d' | '14d' | '30d' | 'all';

export function isWithinDateRange(
  isoDate: string,
  range: DateRangeFilter,
  nowMs = Date.now()
): boolean {
  if (range === 'all') return true;
  const ts = new Date(isoDate).getTime();
  if (!Number.isFinite(ts)) return false;
  const diffMs = Math.max(0, nowMs - ts);
  const days = diffMs / (1000 * 60 * 60 * 24);
  if (range === '24h') return days <= 1;
  if (range === '7d') return days <= 7;
  if (range === '14d') return days <= 14;
  if (range === '30d') return days <= 30;
  return true;
}

export function filterDailyActivityByRange(
  dailyActivity: DailyActivityPoint[],
  range: DateRangeFilter
): DailyActivityPoint[] {
  if (range === '7d' || range === '24h') {
    return dailyActivity.slice(-7);
  }
  return dailyActivity;
}

export type AgentLiveExecutionState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'idle';

export interface AgentActivityRecord {
  agent: AIAgent;
  executionState: AgentLiveExecutionState;
  findingsCount: number;
  durationMs: number | null;
  meanScore: number | null;
  latestActivityLabel: string;
  latestActivityTime: string | null;
  lastJobId: string | null;
  lastSummary: string | null;
}

export function deriveAgentLiveActivities(
  agents: AIAgent[],
  reviews: CodeReview[],
  analysisJobs: RepositoryAnalysisJob[]
): AgentActivityRecord[] {
  const sortedJobs = [...analysisJobs].sort(
    (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
  );
  const activeJob = sortedJobs.find(
    (j) =>
      j.status === 'queued' ||
      j.status === 'collecting_files' ||
      j.status === 'running_agents' ||
      j.status === 'synthesizing'
  );
  const latestJob = activeJob ?? sortedJobs[0] ?? null;

  return agents.map((agent) => {
    // Check reviews directly run by or attributed to this agent
    const matchingReviews = reviews
      .filter(
        (r) =>
          r.agentId === agent.id ||
          r.agentName === agent.name ||
          r.agentBreakdown?.some((b) => b.agentId === agent.id) ||
          r.findings.some(
            (f) =>
              f.agentId === agent.id ||
              f.contributingAgents?.some((ca) => ca.agentId === agent.id)
          )
      )
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    const latestReview = matchingReviews[0] ?? null;
    const latestBreakdownFromReview = latestReview?.agentBreakdown?.find(
      (b) => b.agentId === agent.id
    );
    const latestBreakdownFromJob = latestJob?.agentBreakdown?.find(
      (b) => b.agentId === agent.id
    );

    let executionState: AgentLiveExecutionState = agent.enabled ? 'idle' : 'skipped';
    let durationMs: number | null =
      latestBreakdownFromJob?.durationMs ??
      latestBreakdownFromReview?.durationMs ??
      (latestReview && latestReview.agentId === agent.id ? latestReview.durationMs : null);
    let lastSummary: string | null =
      latestBreakdownFromJob?.summary ?? latestBreakdownFromReview?.summary ?? null;

    if (activeJob) {
      if (!agent.enabled) {
        executionState = 'skipped';
      } else if (latestBreakdownFromJob) {
        executionState = latestBreakdownFromJob.analysisStatus;
      } else if (
        activeJob.status === 'queued' ||
        activeJob.status === 'collecting_files'
      ) {
        executionState = 'queued';
      } else {
        executionState = 'running';
      }
    } else if (latestJob && latestBreakdownFromJob) {
      executionState = latestBreakdownFromJob.analysisStatus;
    } else if (!agent.enabled) {
      executionState = 'skipped';
    } else if (latestBreakdownFromReview) {
      executionState = latestBreakdownFromReview.analysisStatus;
    } else if (latestReview) {
      executionState = 'completed';
    }

    const totalContributedFindings = reviews.reduce((sum, rev) => {
      const fromBreakdown = rev.agentBreakdown?.find((b) => b.agentId === agent.id);
      if (fromBreakdown) return sum + fromBreakdown.findingsCount;
      const matchingFindings = rev.findings.filter(
        (f) =>
          f.agentId === agent.id ||
          f.agentName === agent.name ||
          f.contributingAgents?.some((ca) => ca.agentId === agent.id)
      ).length;
      if (matchingFindings > 0) return sum + matchingFindings;
      if (rev.agentId === agent.id) return sum + rev.findings.length;
      return sum;
    }, 0);

    const findingsCount =
      latestBreakdownFromJob !== undefined
        ? latestBreakdownFromJob.findingsCount
        : totalContributedFindings;

    const scoredReviews = matchingReviews.filter((r) => typeof r.score === 'number');
    const meanScore =
      scoredReviews.length > 0
        ? Math.round(
            scoredReviews.reduce((acc, r) => acc + r.score, 0) / scoredReviews.length
          )
        : null;

    let latestActivityLabel = agent.enabled ? 'Ready for review' : 'Disabled in workspace';
    let latestActivityTime: string | null = null;

    if (activeJob && agent.enabled) {
      latestActivityLabel = `${activeJob.repositoryFullName} (${activeJob.branch})`;
      latestActivityTime = formatRelativeTime(activeJob.updatedAt || activeJob.createdAt);
    } else if (latestJob && latestBreakdownFromJob) {
      latestActivityLabel = `${latestJob.repositoryFullName} (${latestJob.branch})`;
      latestActivityTime = formatRelativeTime(
        latestJob.completedAt || latestJob.updatedAt || latestJob.createdAt
      );
    } else if (latestReview) {
      latestActivityLabel =
        latestReview.reviewScope === 'repository'
          ? `${latestReview.repositoryFullName} (Repo)`
          : `${latestReview.repositoryFullName} #${latestReview.prNumber}`;
      latestActivityTime = formatRelativeTime(latestReview.createdAt);
    }

    return {
      agent,
      executionState,
      findingsCount,
      durationMs,
      meanScore,
      latestActivityLabel,
      latestActivityTime,
      lastJobId: latestJob?.id ?? null,
      lastSummary,
    };
  });
}

export interface RepositoryAnalysisSnapshot {
  latestReview: CodeReview | null;
  latestJob: RepositoryAnalysisJob | null;
  lastCommitSha: string | null;
  lastAnalyzedAt: string | null;
  analysisStatus: 'completed' | 'partial' | 'failed' | 'running' | 'not_analyzed';
  coverageLabel: string | null;
  filesAnalyzed: number | null;
  eligibleFiles: number | null;
}

export function getRepositoryAnalysisSnapshot(
  repo: Repository,
  reviews: CodeReview[],
  analysisJobs: RepositoryAnalysisJob[]
): RepositoryAnalysisSnapshot {
  const repoJobs = analysisJobs
    .filter(
      (j) =>
        j.repositoryId === repo.id ||
        j.repositoryFullName.toLowerCase() === repo.fullName.toLowerCase()
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt).getTime() -
        new Date(a.updatedAt || a.createdAt).getTime()
    );

  const repoReviews = reviews
    .filter(
      (r) =>
        r.reviewScope === 'repository' &&
        (r.repositoryId === repo.id ||
          r.repositoryFullName.toLowerCase() === repo.fullName.toLowerCase())
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const latestJob = repoJobs[0] ?? null;
  const latestReview = repoReviews[0] ?? null;

  let analysisStatus: RepositoryAnalysisSnapshot['analysisStatus'] = 'not_analyzed';
  if (latestJob) {
    if (
      latestJob.status === 'queued' ||
      latestJob.status === 'collecting_files' ||
      latestJob.status === 'running_agents' ||
      latestJob.status === 'synthesizing'
    ) {
      analysisStatus = 'running';
    } else if (latestJob.status === 'failed') {
      analysisStatus = 'failed';
    } else if (latestJob.status === 'partial') {
      analysisStatus = 'partial';
    } else {
      analysisStatus = 'completed';
    }
  } else if (latestReview) {
    analysisStatus = latestReview.analysisStatus === 'partial' ? 'partial' : 'completed';
  }

  const lastCommitSha =
    latestJob?.analyzedCommitSha || latestReview?.analyzedCommitSha || null;
  const lastAnalyzedAt =
    latestJob?.completedAt ||
    latestJob?.updatedAt ||
    latestReview?.createdAt ||
    repo.lastReviewedAt ||
    null;

  const coverage = latestJob
    ? latestJob.collectionCoverage
    : latestReview?.collectionCoverage || null;
  const filesAnalyzed = latestJob
    ? coverage?.totalFilesAnalyzed ?? latestJob.filesAnalyzed
    : coverage?.totalFilesAnalyzed ?? latestReview?.filesChanged ?? null;
  const eligibleFiles = latestJob
    ? coverage?.eligibleFiles ?? latestJob.eligibleFiles
    : coverage?.eligibleFiles ?? null;

  let coverageLabel: string | null = null;
  if (filesAnalyzed !== null && eligibleFiles !== null && eligibleFiles > 0) {
    const pct = Math.min(100, Math.round((filesAnalyzed / eligibleFiles) * 100));
    coverageLabel = `${filesAnalyzed}/${eligibleFiles} files (${pct}%)`;
  } else if (filesAnalyzed !== null && (latestReview || (latestJob && filesAnalyzed > 0))) {
    coverageLabel = `${filesAnalyzed} files audited`;
  }

  return {
    latestReview,
    latestJob,
    lastCommitSha,
    lastAnalyzedAt,
    analysisStatus,
    coverageLabel,
    filesAnalyzed,
    eligibleFiles,
  };
}

export type ReviewSortField = 'date' | 'score' | 'findings' | 'duration' | 'title';
export type SortDirection = 'asc' | 'desc';

export interface ReviewFilterOptions {
  search: string;
  status: 'all' | ReviewStatus;
  source: 'all' | 'live' | 'demo';
  severity: 'all' | Severity;
  agent: string;
  repository: string;
  dateRange: DateRangeFilter;
  sortField: ReviewSortField;
  sortDirection: SortDirection;
}

export function sortAndFilterReviews(
  reviews: CodeReview[],
  options: ReviewFilterOptions,
  nowMs = Date.now()
): CodeReview[] {
  const q = options.search.trim().toLowerCase();

  const filtered = reviews.filter((rev) => {
    if (q) {
      const matchesMeta =
        rev.title.toLowerCase().includes(q) ||
        rev.repositoryFullName.toLowerCase().includes(q) ||
        rev.author.toLowerCase().includes(q) ||
        rev.branch.toLowerCase().includes(q) ||
        rev.agentName.toLowerCase().includes(q) ||
        (rev.analyzedCommitSha?.toLowerCase().includes(q) ?? false);
      const matchesFinding = rev.findings.some(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.filePath.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q)
      );
      if (!matchesMeta && !matchesFinding) return false;
    }

    if (options.status !== 'all' && rev.status !== options.status) return false;
    if (options.source === 'live' && rev.isDemo) return false;
    if (options.source === 'demo' && !rev.isDemo) return false;
    if (options.repository !== 'all' && rev.repositoryFullName !== options.repository) {
      return false;
    }
    if (options.severity !== 'all') {
      const hasSeverity = rev.findings.some((f) => f.severity === options.severity);
      if (!hasSeverity) return false;
    }
    if (options.agent !== 'all') {
      const matchesAgent =
        rev.agentName === options.agent ||
        rev.agentId === options.agent ||
        Boolean(rev.agentBreakdown?.some((b) => b.agentName === options.agent)) ||
        rev.findings.some(
          (f) =>
            f.agentName === options.agent ||
            f.contributingAgents?.some((ca) => ca.agentName === options.agent)
        );
      if (!matchesAgent) return false;
    }
    if (!isWithinDateRange(rev.createdAt, options.dateRange, nowMs)) return false;

    return true;
  });

  const dir = options.sortDirection === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => {
    switch (options.sortField) {
      case 'score':
        return (a.score - b.score) * dir;
      case 'findings':
        return (a.findings.length - b.findings.length) * dir;
      case 'duration':
        return (a.durationMs - b.durationMs) * dir;
      case 'title':
        return a.title.localeCompare(b.title) * dir;
      case 'date':
      default:
        return (
          (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
        );
    }
  });
}

export interface GlobalFindingMatch {
  finding: Finding;
  review: CodeReview;
}

export interface GlobalSearchResults {
  repositories: Repository[];
  reviews: CodeReview[];
  findings: GlobalFindingMatch[];
  agents: AIAgent[];
}

export function buildGlobalSearchResults(
  query: string,
  repositories: Repository[],
  reviews: CodeReview[],
  agents: AIAgent[]
): GlobalSearchResults {
  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      repositories: repositories.slice(0, 4),
      reviews: reviews.slice(0, 4),
      findings: [],
      agents: agents.slice(0, 6),
    };
  }

  const matchedRepos = repositories
    .filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.language.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.defaultBranch.toLowerCase().includes(q)
    )
    .slice(0, 6);

  const matchedReviews = reviews
    .filter(
      (rev) =>
        rev.title.toLowerCase().includes(q) ||
        rev.repositoryFullName.toLowerCase().includes(q) ||
        rev.author.toLowerCase().includes(q) ||
        rev.branch.toLowerCase().includes(q) ||
        String(rev.prNumber).includes(q)
    )
    .slice(0, 6);

  const matchedFindings: GlobalFindingMatch[] = [];
  for (const rev of reviews) {
    for (const finding of rev.findings) {
      if (
        finding.title.toLowerCase().includes(q) ||
        finding.filePath.toLowerCase().includes(q) ||
        finding.category.toLowerCase().includes(q) ||
        finding.severity.toLowerCase().includes(q) ||
        finding.explanation.toLowerCase().includes(q)
      ) {
        matchedFindings.push({ finding, review: rev });
        if (matchedFindings.length >= 6) break;
      }
    }
    if (matchedFindings.length >= 6) break;
  }

  const matchedAgents = agents
    .filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.focus.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
    )
    .slice(0, 6);

  return {
    repositories: matchedRepos,
    reviews: matchedReviews,
    findings: matchedFindings,
    agents: matchedAgents,
  };
}
