export type NavSection =
  | 'dashboard'
  | 'analyze'
  | 'repository-intelligence'
  | 'pr-review'
  | 'repositories'
  | 'reviews'
  | 'agents'
  | 'history'
  | 'analytics'
  | 'settings';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type ReviewStatus = 'approved' | 'changes_requested' | 'in_review';

export type DataSource = 'demo' | 'github-live' | 'manual-diff';

export type ThinkingMode = 'LOW' | 'MEDIUM' | 'HIGH';

export type AgentStrictness = 'strict' | 'balanced' | 'advisory';

export type FindingCategory =
  | 'Security'
  | 'Reliability'
  | 'Performance'
  | 'Maintainability'
  | 'Testing'
  | 'Documentation';

export interface AgentAttribution {
  agentId: string;
  agentName: string;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: FindingCategory;
  filePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  explanation: string;
  suggestedFix: string;
  codeSnippet: string;
  resolved: boolean;
  agentId?: string;
  agentName?: string;
  contributingAgents?: AgentAttribution[];
  evidence?: string;
  confidence?: 'confirmed' | 'potential';
}

export interface RubricBreakdown {
  security: number;
  reliability: number;
  maintainability: number;
  performance: number;
}

export type RepositoryAgentStatus = 'completed' | 'failed' | 'skipped';

export interface RepositoryAgentExecutionSummary {
  agentId: string;
  agentName: string;
  model: string;
  strictness: AgentStrictness;
  thinkingLevel: ThinkingMode;
  analysisStatus: RepositoryAgentStatus;
  summary: string;
  findingsCount: number;
  strengths: string[];
  filesReviewedCount: number;
  chunksAnalyzed: number;
  durationMs: number;
  error?: string;
}

export interface RepositoryCollectionCoverageSummary {
  totalTreeEntries: number;
  eligibleFiles: number;
  filesCollected: number;
  filesSkipped: number;
  filesTruncated: number;
  failedFiles: number;
  totalBytesCollected: number;
  truncationDetected: boolean;
  coverageComplete: boolean;
  totalFilesAnalyzed: number;
  totalChunksAnalyzed: number;
}

export type RepositoryAnalysisJobStatus =
  | 'queued'
  | 'collecting_files'
  | 'running_agents'
  | 'synthesizing'
  | 'completed'
  | 'partial'
  | 'failed';

export interface RepositoryAnalysisJob {
  id: string;
  repositoryId: string;
  repositoryFullName: string;
  branch: string;
  status: RepositoryAnalysisJobStatus;
  progress: number;
  currentStep: string;
  message: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  analyzedCommitSha: string | null;
  totalTreeEntries: number;
  eligibleFiles: number;
  filesCollected: number;
  filesAnalyzed: number;
  filesSkipped: number;
  filesTruncated: number;
  totalChunks: number;
  completedChunks: number;
  totalAgents: number;
  completedAgents: number;
  failedAgents: number;
  agentBreakdown: RepositoryAgentExecutionSummary[];
  collectionCoverage: RepositoryCollectionCoverageSummary | null;
  resultReviewId: string | null;
  error: string | null;
  requestedByUserId?: number | null;
  requestedByLogin?: string | null;
}

export interface CodeReview {
  id: string;
  prNumber: number;
  title: string;
  repositoryId: string;
  repositoryFullName: string;
  branch: string;
  baseBranch: string;
  author: string;
  status: ReviewStatus;
  score: number;
  summary: string;
  rubricBreakdown: RubricBreakdown;
  findings: Finding[];
  agentId: string;
  agentName: string;
  source: DataSource;
  isDemo: boolean;
  diffPreview: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  prUrl?: string;
  createdAt: string;
  durationMs: number;
  reviewScope?: 'pr-diff' | 'manual-diff' | 'repository';
  analysisStatus?: 'completed' | 'partial';
  analysisJobId?: string;
  analyzedCommitSha?: string;
  strengths?: string[];
  agentBreakdown?: RepositoryAgentExecutionSummary[];
  collectionCoverage?: RepositoryCollectionCoverageSummary;
}

export interface Repository {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  description: string;
  language: string;
  defaultBranch: string;
  stars: number;
  forks?: number;
  openPrsCount: number;
  lastReviewedAt: string;
  healthScore: number;
  isDemo: boolean;
  isPrivate?: boolean;
  autoReviewEnabled: boolean;
  htmlUrl: string;
  activitySeries: number[];
}

export interface AIAgent {
  id: string;
  name: string;
  focus: string;
  description: string;
  model: string;
  thinkingLevel: ThinkingMode;
  systemPrompt: string;
  enabled: boolean;
  strictness: 'strict' | 'balanced' | 'advisory';
  reviewsRun: number;
  avgFindingsPerPr: number;
  isDemo: boolean;
}

export interface DailyActivityPoint {
  date: string;
  label: string;
  reviews: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  avgScore: number;
}

export interface DashboardPayload {
  overview: {
    totalReviews: number;
    weeklyReviews: number;
    openFindingsCount: number;
    criticalOpenCount: number;
    highOpenCount: number;
    meanScore: number;
    connectedReposCount: number;
    openPrsCount: number;
    approvalRate: number;
  };
  severityTotals: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  dailyActivity: DailyActivityPoint[];
  recentReviews: CodeReview[];
  repositories: Repository[];
  activeAgentsCount: number;
  hasDemoData: boolean;
}

export interface WorkspaceSettings {
  organizationName: string;
  defaultAgentId: string;
  defaultModel: string;
  autoPostPrSummary: boolean;
  minimumPassScore: number;
  githubTokenConfigured: boolean;
  githubTokenMask: string;
  storageMode: 'local-json' | 'firebase-firestore';
  persistenceNote: string;
}

export interface GitHubRateLimit {
  limit: number;
  remaining: number;
  resetAt: string | null;
}

export interface GitHubPagination {
  page: number;
  perPage: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface GitHubAuthStatus {
  configured: boolean;
  authenticated: boolean;
  user: {
    id: number;
    login: string;
    name: string | null;
    avatarUrl: string;
    htmlUrl: string;
  } | null;
  scopes: string[];
  hasPrivateScope: boolean;
  callbackUrl: string;
}

export interface GitHubUserRepoSummary {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  description: string;
  language: string;
  defaultBranch: string;
  isPrivate: boolean;
  stars: number;
  forks: number;
  openIssuesCount: number;
  updatedAt: string;
  htmlUrl: string;
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  state: string;
  user: string;
  headRef: string;
  baseRef: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubBranchSummary {
  name: string;
  commitSha: string;
  protected: boolean;
}

export interface GitHubCommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authorLogin: string | null;
  date: string;
  htmlUrl: string;
}

export interface GitHubLanguageEntry {
  name: string;
  bytes: number;
  percentage: number;
}

export interface GitHubRepositoryDetails {
  fullName: string;
  description: string;
  defaultBranch: string;
  isPrivate: boolean;
  visibility: string;
  stars: number;
  forks: number;
  openIssuesCount: number;
  htmlUrl: string;
  updatedAt: string;
  languages: GitHubLanguageEntry[];
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export interface GitHubDirectoryEntry {
  name: string;
  path: string;
  type: 'dir' | 'file' | 'submodule' | 'symlink';
  size: number;
  sha: string;
}

export interface GitHubContentsResult {
  isDemo: boolean;
  kind: 'dir' | 'file';
  path: string;
  ref: string;
  entries?: GitHubDirectoryEntry[];
  file?: {
    name: string;
    path: string;
    size: number;
    sha: string;
    encoding: string;
    content: string;
    isBinary: boolean;
    truncated: boolean;
    htmlUrl: string;
  };
  rateLimit: GitHubRateLimit | null;
}

export type IntelligenceFileStatus =
  | 'analyzed'
  | 'skipped'
  | 'failed'
  | 'binary'
  | 'sensitive'
  | 'truncated'
  | 'uncollected';

export interface IntelligenceTreeNode {
  path: string;
  name: string;
  type: 'dir' | 'file';
  size: number;
  sha: string;
  language: string | null;
  status?: IntelligenceFileStatus;
  purpose?: string;
}

export interface IntelligenceCachedFile {
  path: string;
  language: string;
  size: number;
  lineCount: number;
  rawContent: string;
  truncated: boolean;
  purpose: string;
  layer: string;
  symbols: string[];
  relatedComponentIds: string[];
}

export type ArchitectureComponentCategory =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'auth'
  | 'external-api'
  | 'ai-service'
  | 'config'
  | 'module';

export interface ArchitectureComponentNode {
  id: string;
  name: string;
  category: ArchitectureComponentCategory;
  purpose: string;
  filePaths: string[];
  symbols: string[];
  connectedIds: string[];
  simpleExplanation: string;
  technicalExplanation: string;
  confidence: 'confirmed' | 'inferred';
}

export interface IntelligenceDiagramSpec {
  id: string;
  title: string;
  diagramType: 'flowchart' | 'sequence' | 'er';
  mermaidCode: string;
  simpleExplanation: string;
  technicalExplanation: string;
  confidence: 'confirmed' | 'inferred';
  relatedComponentIds: string[];
  sourceFiles: string[];
}

export interface FrontendArchitectureBreakdown {
  hasFrontend: boolean;
  frameworkSummary: string;
  entryPoints: string[];
  rootComponents: string[];
  pagesAndViews: string[];
  reusableComponents: string[];
  routingFiles: string[];
  stateAndContexts: string[];
  customHooks: string[];
  apiServiceFiles: string[];
  diagram: IntelligenceDiagramSpec;
}

export interface BackendArchitectureBreakdown {
  hasBackend: boolean;
  runtimeSummary: string;
  serverEntryPoints: string[];
  middlewareFiles: string[];
  routeAndControllerFiles: string[];
  serviceFiles: string[];
  databaseLayerFiles: string[];
  externalIntegrationFiles: string[];
  endpoints: Array<{
    method: string;
    path: string;
    filePath: string;
    handler: string;
    purpose: string;
    authRequired: boolean;
  }>;
  diagram: IntelligenceDiagramSpec;
}

export interface CommunicationFlowTrace {
  id: string;
  name: string;
  userAction: string;
  frontendComponent: string;
  frontendService: string;
  httpRequest: string;
  backendRoute: string;
  middleware: string;
  serviceLayer: string;
  databaseOrExternal: string;
  responseFormat: string;
  stateUpdate: string;
  uiRendering: string;
  sourceFiles: string[];
  simpleExplanation: string;
  technicalExplanation: string;
  confidence: 'confirmed' | 'inferred';
  mermaidCode: string;
}

export interface ApiIntegrationDetail {
  id: string;
  provider: string;
  kind: 'external-api' | 'ai-service' | 'internal-endpoint' | 'database-service';
  purpose: string;
  clientInitialization: string;
  callingFile: string;
  callingFunction: string;
  endpointOrMethod: string;
  requestFlow: string;
  responseHandling: string;
  envVarNames: string[];
  confidence: 'confirmed' | 'inferred';
}

export interface DatabaseEntityDetail {
  name: string;
  kind: 'table' | 'collection' | 'model' | 'schema';
  sourceFile: string;
  fields: Array<{
    name: string;
    type: string;
    key?: 'PK' | 'FK' | 'UNIQUE' | '';
    notes?: string;
  }>;
  relationships: string[];
  accessorFunctions: string[];
  confidence: 'confirmed' | 'inferred';
}

export interface DatabaseArchitectureBreakdown {
  hasDatabase: boolean;
  databaseTechSummary: string;
  schemaFiles: string[];
  entities: DatabaseEntityDetail[];
  diagram: IntelligenceDiagramSpec;
}

export interface AuthenticationFlowBreakdown {
  hasAuthentication: boolean;
  authSummary: string;
  providers: string[];
  loginInitiationFiles: string[];
  tokenOrSessionHandling: string;
  backendVerificationFiles: string[];
  protectedRoutesSummary: string;
  logoutHandling: string;
  steps: Array<{
    step: number;
    actor: string;
    action: string;
    filePath: string;
    detail: string;
  }>;
  diagram: IntelligenceDiagramSpec;
}

export interface RepositoryIntelligenceCoverage {
  totalTreeEntries: number;
  totalDirectories: number;
  totalFiles: number;
  eligibleFiles: number;
  analyzedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  truncatedFiles: number;
  totalBytesCollected: number;
  treeTruncated: boolean;
  coverageComplete: boolean;
  totalChunksAnalyzed: number;
  limitations: string[];
}

export interface RepositoryIntelligenceReport {
  id: string;
  repositoryId: string;
  repositoryFullName: string;
  owner: string;
  name: string;
  description: string;
  defaultBranch: string;
  branch: string;
  language: string;
  stars: number;
  forks: number;
  htmlUrl: string;
  isPrivate: boolean;
  analyzedCommitSha: string;
  generatedAt: string;
  durationMs: number;
  analysisStatus: 'completed' | 'partial';
  coverage: RepositoryIntelligenceCoverage;
  overview: {
    headline: string;
    architectureStyle: string;
    simpleSummary: string;
    technicalSummary: string;
    techStack: string[];
    entryPoints: {
      frontend: string[];
      backend: string[];
      config: string[];
    };
    confirmedFacts: string[];
    inferredDetails: string[];
  };
  treeNodes: IntelligenceTreeNode[];
  cachedFiles: Record<string, IntelligenceCachedFile>;
  components: ArchitectureComponentNode[];
  systemArchitecture: IntelligenceDiagramSpec;
  frontendArchitecture: FrontendArchitectureBreakdown;
  backendArchitecture: BackendArchitectureBreakdown;
  communicationFlows: CommunicationFlowTrace[];
  communicationOverviewDiagram: IntelligenceDiagramSpec;
  apiIntegrations: ApiIntegrationDetail[];
  apiIntegrationsDiagram: IntelligenceDiagramSpec;
  databaseArchitecture: DatabaseArchitectureBreakdown;
  authenticationFlow: AuthenticationFlowBreakdown;
  applicationWorkflows: IntelligenceDiagramSpec[];
}

export type RepositoryIntelligenceJobStatus =
  | 'queued'
  | 'retrieving_tree'
  | 'collecting_files'
  | 'analyzing_chunks'
  | 'synthesizing_architecture'
  | 'completed'
  | 'partial'
  | 'failed';

export interface RepositoryIntelligenceJob {
  id: string;
  repositoryId: string;
  repositoryFullName: string;
  branch: string;
  status: RepositoryIntelligenceJobStatus;
  progress: number;
  currentStep: string;
  message: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  analyzedCommitSha: string | null;
  totalTreeEntries: number;
  totalFiles: number;
  eligibleFiles: number;
  filesCollected: number;
  filesAnalyzed: number;
  filesSkipped: number;
  failedFiles: number;
  truncatedFiles: number;
  totalChunks: number;
  completedChunks: number;
  reportId: string | null;
  fromCache: boolean;
  error: string | null;
}

export interface RepositoryChatReference {
  filePath: string;
  symbol?: string;
  lineHint?: string;
  reason: string;
}

export type RepositoryChatEvidenceStatus = 'grounded' | 'partial' | 'insufficient';

export interface RepositoryChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  userId: string;
  repositoryId: string;
  references: RepositoryChatReference[];
  evidenceStatus?: RepositoryChatEvidenceStatus;
  insufficientEvidenceReason?: string;
}

