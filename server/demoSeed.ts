import type {
  AIAgent,
  CodeReview,
  DailyActivityPoint,
  Repository,
  StoreState,
  WorkspaceSettings,
} from './types.ts';

export function createDefaultAgents(): AIAgent[] {
  return [
    {
      id: 'agent-security-sentinel',
      name: 'Security Sentinel',
      focus: 'OWASP, AuthZ, Secrets & Injection',
      description:
        'Audits authentication boundaries, cryptographic verification, SQL/NoSQL injection vectors, and secret leakage.',
      model: 'gemini-4-hydrogen',
      thinkingLevel: 'HIGH',
      systemPrompt:
        'You are Security Sentinel, a staff application security engineer. Inspect diffs strictly for auth bypasses, missing signature checks, injection flaws, SSRF, unsafe deserialization, and PII/secret exposure. Cite exact line numbers and give drop-in remediations.',
      enabled: true,
      strictness: 'strict',
      reviewsRun: 142,
      avgFindingsPerPr: 3.4,
      isDemo: true,
    },
    {
      id: 'agent-arch-reviewer',
      name: 'Architecture Rubric',
      focus: 'Modularity, Types & Maintainability',
      description:
        'Evaluates separation of concerns, TypeScript type safety, error boundaries, and API contract stability.',
      model: 'gemini-4-hydrogen',
      thinkingLevel: 'MEDIUM',
      systemPrompt:
        'You are Architecture Rubric, a principal systems engineer. Review pull request diffs for brittle coupling, leaky abstractions, missing error propagation, unsafe `any` casts, and backward compatibility risks.',
      enabled: true,
      strictness: 'balanced',
      reviewsRun: 198,
      avgFindingsPerPr: 2.8,
      isDemo: true,
    },
    {
      id: 'agent-perf-profiler',
      name: 'Performance Profiler',
      focus: 'N+1 Queries, Memory & Latency',
      description:
        'Identifies unbounded loops, N+1 database queries, blocking I/O on hot paths, and memory leaks.',
      model: 'gemini-4-hydrogen',
      thinkingLevel: 'MEDIUM',
      systemPrompt:
        'You are Performance Profiler. Analyze code diffs for algorithmic complexity regressions, N+1 queries, unindexed filters, missing pagination, unnecessary re-renders, and unclosed streams or listeners.',
      enabled: true,
      strictness: 'balanced',
      reviewsRun: 87,
      avgFindingsPerPr: 2.1,
      isDemo: true,
    },
    {
      id: 'agent-reliability-guard',
      name: 'Reliability Guard',
      focus: 'Idempotency, Retries & Edge Cases',
      description:
        'Checks race conditions, partial failure handling, idempotency keys, and test coverage gaps.',
      model: 'gemini-4-hydrogen',
      thinkingLevel: 'LOW',
      systemPrompt:
        'You are Reliability Guard. Focus on concurrency hazards, missing timeouts on external HTTP calls, non-idempotent retries, null/undefined boundary bugs, and missing failure-mode tests.',
      enabled: false,
      strictness: 'advisory',
      reviewsRun: 64,
      avgFindingsPerPr: 1.9,
      isDemo: true,
    },
    {
      id: 'agent-testing-auditor',
      name: 'Testing & Coverage Auditor',
      focus: 'Test quality, missing coverage, edge cases and regression risks.',
      description:
        'Audits unit and integration test suites for missing edge-case coverage, weak assertions, untested error paths, and regression risks.',
      model: 'gemini-4-hydrogen',
      thinkingLevel: 'MEDIUM',
      systemPrompt:
        'You are a senior software testing engineer. Analyze source code and available test files to identify missing unit tests, integration tests, edge-case coverage, weak assertions, untested error paths, boundary conditions and regression risks. Recommend specific tests with meaningful inputs and expected outcomes. Never claim a test is missing without checking the available repository files. Do not invent test execution results.',
      enabled: true,
      strictness: 'balanced',
      reviewsRun: 0,
      avgFindingsPerPr: 0,
      isDemo: false,
    },
    {
      id: 'agent-api-docs-reviewer',
      name: 'API & Documentation Reviewer',
      focus: 'API consistency, validation, documentation and coding standards.',
      description:
        'Evaluates API routes, request/response contracts, input validation, HTTP status codes, error schemas, documentation completeness, and coding standards.',
      model: 'gemini-4-hydrogen',
      thinkingLevel: 'MEDIUM',
      systemPrompt:
        'You are a senior API design and documentation reviewer. Analyze API routes, request and response contracts, validation, HTTP status codes, naming consistency, error responses, documentation completeness and coding standards. Identify undocumented or inconsistent behavior and recommend precise improvements. Support every finding with actual source-code evidence.',
      enabled: true,
      strictness: 'balanced',
      reviewsRun: 0,
      avgFindingsPerPr: 0,
      isDemo: false,
    },
  ];
}

export function createDemoSeed(): StoreState {
  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 3600 * 1000).toISOString();
  const daysAgo = (d: number) => new Date(now - d * 24 * 3600 * 1000);

  const repositories: Repository[] = [
    {
      id: 'repo-demo-1',
      fullName: 'acme-cloud/payment-gateway',
      owner: 'acme-cloud',
      name: 'payment-gateway',
      description: 'Idempotent ledger service, Stripe webhook verifier, and multi-currency settlement workers.',
      language: 'TypeScript',
      defaultBranch: 'main',
      stars: 412,
      openPrsCount: 6,
      lastReviewedAt: hoursAgo(1.5),
      healthScore: 84,
      isDemo: true,
      autoReviewEnabled: true,
      htmlUrl: 'https://github.com/acme-cloud/payment-gateway',
      activitySeries: [4, 7, 5, 9, 11, 8, 12],
    },
    {
      id: 'repo-demo-2',
      fullName: 'acme-cloud/auth-edge-worker',
      owner: 'acme-cloud',
      name: 'auth-edge-worker',
      description: 'JWT session validation, PKCE token exchange, and rate-limiter middleware at the edge.',
      language: 'TypeScript',
      defaultBranch: 'main',
      stars: 289,
      openPrsCount: 3,
      lastReviewedAt: hoursAgo(4),
      healthScore: 91,
      isDemo: true,
      autoReviewEnabled: true,
      htmlUrl: 'https://github.com/acme-cloud/auth-edge-worker',
      activitySeries: [3, 4, 6, 5, 8, 7, 9],
    },
    {
      id: 'repo-demo-3',
      fullName: 'acme-cloud/telemetry-pipeline',
      owner: 'acme-cloud',
      name: 'telemetry-pipeline',
      description: 'High-throughput OpenTelemetry span ingestion and batch compaction worker.',
      language: 'Go',
      defaultBranch: 'main',
      stars: 176,
      openPrsCount: 5,
      lastReviewedAt: hoursAgo(9),
      healthScore: 78,
      isDemo: true,
      autoReviewEnabled: true,
      htmlUrl: 'https://github.com/acme-cloud/telemetry-pipeline',
      activitySeries: [6, 5, 8, 4, 7, 10, 6],
    },
    {
      id: 'repo-demo-4',
      fullName: 'acme-cloud/ui-primitives',
      owner: 'acme-cloud',
      name: 'ui-primitives',
      description: 'Accessible React component primitives, keyboard navigation hooks, and design tokens.',
      language: 'TypeScript',
      defaultBranch: 'main',
      stars: 534,
      openPrsCount: 2,
      lastReviewedAt: hoursAgo(22),
      healthScore: 94,
      isDemo: true,
      autoReviewEnabled: false,
      htmlUrl: 'https://github.com/acme-cloud/ui-primitives',
      activitySeries: [2, 3, 4, 3, 5, 4, 6],
    },
  ];

  const agents: AIAgent[] = createDefaultAgents();

  const reviews: CodeReview[] = [
    {
      id: 'rev-demo-101',
      prNumber: 418,
      title: 'feat(webhooks): verify Stripe signature before queuing settlement job',
      repositoryId: 'repo-demo-1',
      repositoryFullName: 'acme-cloud/payment-gateway',
      branch: 'feat/webhook-raw-body-check',
      baseBranch: 'main',
      author: 'mira.chen',
      status: 'changes_requested',
      score: 72,
      summary:
        'Webhook signature verification is implemented, but the raw body buffer is parsed after Express JSON middleware mutates req.body, and an idempotency fallback silently swallows Redis timeouts.',
      rubricBreakdown: {
        security: 64,
        reliability: 70,
        maintainability: 84,
        performance: 78,
      },
      findings: [
        {
          id: 'find-101-1',
          title: 'Raw body parsed after JSON middleware breaks HMAC verification fallback',
          severity: 'critical',
          category: 'Security',
          filePath: 'src/routes/webhooks.ts',
          lineStart: 28,
          lineEnd: 39,
          explanation:
            'Calling JSON.stringify(req.body) when rawBody is undefined allows forged payloads if body-parser ran upstream without verify hook.',
          suggestedFix:
            'Reject requests with HTTP 400 immediately when req.rawBody Buffer is missing instead of falling back to JSON.stringify(req.body).',
          codeSnippet: `const payload = req.rawBody ?? JSON.stringify(req.body);\nconst event = stripe.webhooks.constructEvent(payload, sig, secret);`,
          resolved: false,
        },
        {
          id: 'find-101-2',
          title: 'Idempotency lock catch block proceeds on Redis timeout',
          severity: 'high',
          category: 'Reliability',
          filePath: 'src/services/settlementQueue.ts',
          lineStart: 64,
          lineEnd: 74,
          explanation:
            'Catching Redis connection errors and returning acquired=true can trigger double settlement under transient network partitions.',
          suggestedFix:
            'Fail closed on Redis errors and return 503 so Stripe retries the webhook delivery safely.',
          codeSnippet: `try {\n  return await redis.set(key, '1', 'NX', 'EX', 300);\n} catch (err) {\n  logger.warn('Redis unavailable', err);\n  return 'OK';\n}`,
          resolved: false,
        },
        {
          id: 'find-101-3',
          title: 'Missing structured metric tag for signature rejection reason',
          severity: 'low',
          category: 'Maintainability',
          filePath: 'src/routes/webhooks.ts',
          lineStart: 45,
          lineEnd: 49,
          explanation:
            'Logging only the static string obscures whether failures stem from clock skew or invalid signing secrets.',
          suggestedFix:
            'Include error.type in structured log metadata without logging the signature header itself.',
          codeSnippet: `logger.error('Webhook verification failed');`,
          resolved: true,
        },
      ],
      agentId: 'agent-security-sentinel',
      agentName: 'Security Sentinel',
      source: 'demo',
      isDemo: true,
      diffPreview: `diff --git a/src/routes/webhooks.ts b/src/routes/webhooks.ts
index 8a12d91..4f21c0e 100644
--- a/src/routes/webhooks.ts
+++ b/src/routes/webhooks.ts
@@ -25,16 +25,21 @@ router.post('/stripe', async (req, res) => {
   const sig = req.headers['stripe-signature'];
   if (!sig || Array.isArray(sig)) {
     return res.status(400).json({ error: 'Missing signature' });
   }
-  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
+  const payload = req.rawBody ?? JSON.stringify(req.body);
+  let event;
+  try {
+    event = stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET!);
+  } catch (err) {
+    logger.error('Webhook verification failed');
+    return res.status(400).json({ error: 'Invalid signature' });
+  }
   await enqueueSettlement(event);
   return res.json({ received: true });
 });`,
      filesChanged: 4,
      additions: 86,
      deletions: 19,
      prUrl: 'https://github.com/acme-cloud/payment-gateway/pull/418',
      createdAt: hoursAgo(1.5),
      durationMs: 2840,
    },
    {
      id: 'rev-demo-102',
      prNumber: 192,
      title: 'fix(jwks): cache public signing keys with stale-while-revalidate jitter',
      repositoryId: 'repo-demo-2',
      repositoryFullName: 'acme-cloud/auth-edge-worker',
      branch: 'fix/jwks-cache-stampede',
      baseBranch: 'main',
      author: 'devon.patel',
      status: 'approved',
      score: 94,
      summary:
        'Clean coalescing in-flight promise cache prevents JWKS thundering herds during key rotation. Minor suggestion to cap negative cache TTL.',
      rubricBreakdown: {
        security: 95,
        reliability: 96,
        maintainability: 92,
        performance: 94,
      },
      findings: [
        {
          id: 'find-102-1',
          title: 'Coalesced in-flight promise should clear on non-200 HTTP response',
          severity: 'medium',
          category: 'Reliability',
          filePath: 'src/jwks/keyCache.ts',
          lineStart: 41,
          lineEnd: 53,
          explanation:
            'If fetchJwks throws before finally clears pendingFetch, concurrent requests stay pinned briefly; moving cleanup to finally guarantees reset.',
          suggestedFix: 'Ensure pendingFetch = null executes inside a finally block around the fetch call.',
          codeSnippet: `pendingFetch = fetchJwks(issuerUrl);\nconst keys = await pendingFetch;\npendingFetch = null;`,
          resolved: true,
        },
      ],
      agentId: 'agent-arch-reviewer',
      agentName: 'Architecture Rubric',
      source: 'demo',
      isDemo: true,
      diffPreview: `diff --git a/src/jwks/keyCache.ts b/src/jwks/keyCache.ts
index 3e11a2b..9c40d11 100644
--- a/src/jwks/keyCache.ts
+++ b/src/jwks/keyCache.ts
@@ -38,9 +38,14 @@ export async function getSigningKey(kid: string, issuerUrl: string) {
   const cached = keyStore.get(kid);
   if (cached && cached.expiresAt > Date.now()) {
     return cached.key;
   }
-  const keys = await fetchJwks(issuerUrl);
+  if (!pendingFetch) {
+    pendingFetch = fetchJwks(issuerUrl);
+  }
+  const keys = await pendingFetch;
+  pendingFetch = null;
   return keys.find((k) => k.kid === kid) ?? null;
 }`,
      filesChanged: 2,
      additions: 48,
      deletions: 12,
      prUrl: 'https://github.com/acme-cloud/auth-edge-worker/pull/192',
      createdAt: hoursAgo(4),
      durationMs: 2150,
    },
    {
      id: 'rev-demo-103',
      prNumber: 87,
      title: 'perf(ingest): batch ClickHouse span inserts with bounded ring buffer',
      repositoryId: 'repo-demo-3',
      repositoryFullName: 'acme-cloud/telemetry-pipeline',
      branch: 'perf/ring-buffer-flusher',
      baseBranch: 'main',
      author: 'lucas.lindqvist',
      status: 'in_review',
      score: 79,
      summary:
        'Ring buffer reduces allocation churn by 60%, though the flush ticker goroutine can leak on graceful shutdown and slice capacity grows unbounded under backpressure.',
      rubricBreakdown: {
        security: 88,
        reliability: 72,
        maintainability: 80,
        performance: 76,
      },
      findings: [
        {
          id: 'find-103-1',
          title: 'Ticker not stopped when context cancels inside flush loop',
          severity: 'high',
          category: 'Performance',
          filePath: 'internal/ingest/batcher.go',
          lineStart: 78,
          lineEnd: 94,
          explanation:
            'time.NewTicker inside Run() lacks defer ticker.Stop(), leaking timer resources across worker restarts.',
          suggestedFix: 'Add defer ticker.Stop() immediately after creating the ticker.',
          codeSnippet: `ticker := time.NewTicker(b.flushInterval)\nfor {\n  select {\n  case <-ctx.Done():\n    return ctx.Err()`,
          resolved: false,
        },
        {
          id: 'find-103-2',
          title: 'Unbounded slice append when downstream ClickHouse stalls',
          severity: 'medium',
          category: 'Reliability',
          filePath: 'internal/ingest/batcher.go',
          lineStart: 52,
          lineEnd: 61,
          explanation:
            'Without a maxPendingSpans cap, prolonged ClickHouse downtime will OOM the ingestion pod.',
          suggestedFix: 'Drop oldest or reject with 429 once pending buffer reaches maxCapacity.',
          codeSnippet: `b.pending = append(b.pending, spans...)`,
          resolved: false,
        },
      ],
      agentId: 'agent-perf-profiler',
      agentName: 'Performance Profiler',
      source: 'demo',
      isDemo: true,
      diffPreview: `diff --git a/internal/ingest/batcher.go b/internal/ingest/batcher.go
index 12b88c..77d91a 100644
--- a/internal/ingest/batcher.go
+++ b/internal/ingest/batcher.go
@@ -75,6 +75,14 @@ func (b *Batcher) Run(ctx context.Context) error {
   ticker := time.NewTicker(b.flushInterval)
+  for {
+    select {
+    case <-ctx.Done():
+      b.flush(context.Background())
+      return ctx.Err()
+    case <-ticker.C:
+      b.flush(ctx)
+    }
+  }
 }`,
      filesChanged: 5,
      additions: 142,
      deletions: 67,
      prUrl: 'https://github.com/acme-cloud/telemetry-pipeline/pull/87',
      createdAt: hoursAgo(9),
      durationMs: 3190,
    },
    {
      id: 'rev-demo-104',
      prNumber: 304,
      title: 'refactor(ledger): enforce integer minor-units across currency adapters',
      repositoryId: 'repo-demo-1',
      repositoryFullName: 'acme-cloud/payment-gateway',
      branch: 'refactor/minor-units-branded-type',
      baseBranch: 'main',
      author: 'elena.rodriguez',
      status: 'approved',
      score: 91,
      summary:
        'Strong branded MinorUnits type eliminates floating-point rounding drift across USD, EUR, and JPY adapters.',
      rubricBreakdown: {
        security: 90,
        reliability: 94,
        maintainability: 92,
        performance: 89,
      },
      findings: [
        {
          id: 'find-104-1',
          title: 'Zero-decimal currencies (JPY, KRW) need explicit exponent lookup test',
          severity: 'low',
          category: 'Testing',
          filePath: 'src/domain/money.test.ts',
          lineStart: 19,
          lineEnd: 28,
          explanation: 'Unit suite covers USD and EUR but omits zero-decimal currency rounding.',
          suggestedFix: 'Add parameterized cases for JPY and BHD (3 decimals).',
          codeSnippet: `expect(toMinorUnits(12.5, 'USD')).toBe(1250);`,
          resolved: false,
        },
      ],
      agentId: 'agent-arch-reviewer',
      agentName: 'Architecture Rubric',
      source: 'demo',
      isDemo: true,
      diffPreview: `diff --git a/src/domain/money.ts b/src/domain/money.ts
index 9012f1..c18e23 100644
--- a/src/domain/money.ts
+++ b/src/domain/money.ts
@@ -1,6 +1,11 @@
-export type MoneyAmount = number;
+export type MinorUnits = number & { readonly __brand: 'MinorUnits' };
+
+export function asMinorUnits(value: number): MinorUnits {
+  if (!Number.isSafeInteger(value)) {
+    throw new RangeError('Currency minor units must be a safe integer');
+  }
+  return value as MinorUnits;
+}`,
      filesChanged: 7,
      additions: 118,
      deletions: 44,
      prUrl: 'https://github.com/acme-cloud/payment-gateway/pull/304',
      createdAt: hoursAgo(16),
      durationMs: 2410,
    },
    {
      id: 'rev-demo-105',
      prNumber: 63,
      title: 'feat(combobox): trap focus and announce listbox count via aria-live',
      repositoryId: 'repo-demo-4',
      repositoryFullName: 'acme-cloud/ui-primitives',
      branch: 'feat/combobox-a11y',
      baseBranch: 'main',
      author: 'samira.khalil',
      status: 'approved',
      score: 96,
      summary:
        'Exemplary ARIA 1.2 combobox implementation with roving tabindex and deterministic cleanup on unmount.',
      rubricBreakdown: {
        security: 98,
        reliability: 95,
        maintainability: 96,
        performance: 95,
      },
      findings: [],
      agentId: 'agent-arch-reviewer',
      agentName: 'Architecture Rubric',
      source: 'demo',
      isDemo: true,
      diffPreview: `diff --git a/src/combobox/useCombobox.ts b/src/combobox/useCombobox.ts
index 441a01..99b120 100644
--- a/src/combobox/useCombobox.ts
+++ b/src/combobox/useCombobox.ts
@@ -54,4 +54,9 @@ export function useCombobox(options: ComboboxOptions) {
   return {
     activeIndex,
+    ariaAttributes: {
+      role: 'combobox',
+      'aria-expanded': isOpen,
+      'aria-activedescendant': activeId,
+    },
   };
 }`,
      filesChanged: 3,
      additions: 94,
      deletions: 11,
      prUrl: 'https://github.com/acme-cloud/ui-primitives/pull/63',
      createdAt: hoursAgo(22),
      durationMs: 1890,
    },
  ];

  // 14-day demo activity timeline
  const baselinePoints = [
    { reviews: 11, critical: 1, high: 4, medium: 7, low: 6, avgScore: 81 },
    { reviews: 14, critical: 2, high: 3, medium: 9, low: 8, avgScore: 83 },
    { reviews: 9, critical: 0, high: 2, medium: 5, low: 5, avgScore: 88 },
    { reviews: 16, critical: 3, high: 5, medium: 8, low: 7, avgScore: 79 },
    { reviews: 18, critical: 1, high: 4, medium: 10, low: 9, avgScore: 84 },
    { reviews: 12, critical: 0, high: 3, medium: 6, low: 7, avgScore: 87 },
    { reviews: 15, critical: 2, high: 4, medium: 7, low: 6, avgScore: 82 },
    { reviews: 19, critical: 1, high: 6, medium: 9, low: 8, avgScore: 85 },
    { reviews: 14, critical: 0, high: 2, medium: 8, low: 5, avgScore: 89 },
    { reviews: 21, critical: 2, high: 5, medium: 11, low: 9, avgScore: 84 },
    { reviews: 17, critical: 1, high: 3, medium: 7, low: 8, avgScore: 86 },
    { reviews: 22, critical: 1, high: 4, medium: 9, low: 10, avgScore: 88 },
    { reviews: 16, critical: 0, high: 3, medium: 6, low: 6, avgScore: 90 },
    { reviews: 19, critical: 1, high: 3, medium: 5, low: 4, avgScore: 86 },
  ];

  const dailyActivity: DailyActivityPoint[] = baselinePoints.map((pt, idx) => {
    const d = daysAgo(baselinePoints.length - 1 - idx);
    const month = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    return {
      date: d.toISOString().slice(0, 10),
      label: `${month} ${day}`,
      ...pt,
    };
  });

  const settings: WorkspaceSettings = {
    organizationName: 'Acme Cloud Engineering',
    defaultAgentId: 'agent-security-sentinel',
    defaultModel: 'gemini-4-hydrogen',
    autoPostPrSummary: true,
    minimumPassScore: 80,
    githubTokenConfigured: false,
    githubTokenMask: '',
    storageMode: 'local-json',
    persistenceNote:
      'Cloud Firestore (database: ai-studio-coderubric-a62b149b-c49c-4d79-a80e-bdb404ef4d9d) with local JSON server persistence (data/coderubric-store.json). Sign in with Google in Settings or the top bar to sync workspace data across sessions.',
  };

  return {
    repositories,
    reviews,
    agents,
    dailyActivity,
    settings,
    analysisJobs: [],
  };
}
