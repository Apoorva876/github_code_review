import crypto from 'node:crypto';
import { Type } from '@google/genai';
import type {
  ApiIntegrationDetail,
  ArchitectureComponentCategory,
  ArchitectureComponentNode,
  AuthenticationFlowBreakdown,
  BackendArchitectureBreakdown,
  CommunicationFlowTrace,
  DatabaseArchitectureBreakdown,
  DatabaseEntityDetail,
  FrontendArchitectureBreakdown,
  IntelligenceCachedFile,
  IntelligenceDiagramSpec,
  Repository,
  RepositoryIntelligenceCollectionBundle,
  RepositoryIntelligenceCoverage,
  RepositoryIntelligenceReport,
  SourceBatch,
} from '../types.ts';
import {
  DEFAULT_GEMINI_MODEL,
  generateWithRetry,
  parseGeminiJson,
  redactSensitiveText,
  toSafeGeminiErrorMessage,
  type GeminiGenerateFn,
} from './geminiReviewService.ts';
import { chunkCollectedSources } from './repositoryAnalysisService.ts';

export interface IntelligenceProgressEvent {
  stage: 'analyzing_chunks' | 'synthesizing_architecture';
  totalChunks: number;
  completedChunks: number;
  message: string;
}

export interface RepositoryIntelligenceOptions {
  maxConcurrency?: number;
  maxChunkChars?: number;
  maxBatchChars?: number;
  maxBatchOutputTokens?: number;
  maxSynthesisOutputTokens?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  generateContentFn?: GeminiGenerateFn;
  onProgress?: (event: IntelligenceProgressEvent) => void;
}

interface BatchFileSummary {
  path: string;
  purpose: string;
  layer: string;
  symbols: string[];
}

interface BatchEndpoint {
  method: string;
  path: string;
  filePath: string;
  handler: string;
  purpose: string;
  authRequired: boolean;
}

interface BatchFrontendCall {
  callerFile: string;
  callerFunction: string;
  method: string;
  targetEndpoint: string;
  triggeredBy: string;
}

interface BatchAuthSignal {
  hasAuth: boolean;
  providers: string[];
  loginFiles: string[];
  backendVerificationFiles: string[];
  tokenHandling: string;
  protectedRoutes: string;
  logoutHandling: string;
}

interface ExtractedBatchFacts {
  fileSummaries: BatchFileSummary[];
  components: ArchitectureComponentNode[];
  endpoints: BatchEndpoint[];
  frontendCalls: BatchFrontendCall[];
  integrations: ApiIntegrationDetail[];
  databaseEntities: DatabaseEntityDetail[];
  authSignals: BatchAuthSignal[];
  techStackHints: string[];
}

const VALID_CATEGORIES = new Set<ArchitectureComponentCategory>([
  'frontend',
  'backend',
  'database',
  'auth',
  'external-api',
  'ai-service',
  'config',
  'module',
]);

function normalizeCategory(raw: unknown): ArchitectureComponentCategory {
  const val = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (VALID_CATEGORIES.has(val as ArchitectureComponentCategory)) {
    return val as ArchitectureComponentCategory;
  }
  if (val.includes('front') || val.includes('ui') || val.includes('react') || val.includes('view')) {
    return 'frontend';
  }
  if (val.includes('back') || val.includes('server') || val.includes('api') || val.includes('route')) {
    return 'backend';
  }
  if (val.includes('db') || val.includes('data') || val.includes('store') || val.includes('sql')) {
    return 'database';
  }
  if (val.includes('auth') || val.includes('oauth') || val.includes('login')) {
    return 'auth';
  }
  if (val.includes('ai') || val.includes('gemini') || val.includes('llm') || val.includes('model')) {
    return 'ai-service';
  }
  if (val.includes('ext') || val.includes('github') || val.includes('webhook')) {
    return 'external-api';
  }
  if (val.includes('conf') || val.includes('env') || val.includes('build')) {
    return 'config';
  }
  return 'module';
}

function slugId(raw: string, fallbackPrefix = 'comp'): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || `${fallbackPrefix}-${crypto.randomUUID().slice(0, 6)}`;
}

function cleanStringList(input: unknown, maxItems = 25): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const trimmed = redactSensitiveText(item.trim());
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function resolveKnownPaths(
  input: unknown,
  knownPathSet: Set<string>,
  lowerKnownPathMap: Map<string, string>,
  maxItems = 25
): string[] {
  const candidates = cleanStringList(input, maxItems * 2);
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    const clean = raw.replace(/^\.\//, '').replace(/^\/+/, '');
    const exact = knownPathSet.has(clean)
      ? clean
      : lowerKnownPathMap.get(clean.toLowerCase()) ?? null;
    if (exact && !seen.has(exact)) {
      seen.add(exact);
      resolved.push(exact);
    }
    if (resolved.length >= maxItems) break;
  }
  return resolved;
}

function sanitizeMermaidLabel(label: string): string {
  return redactSensitiveText(label)
    .replace(/["`<>]/g, "'")
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

export function sanitizeMermaidSyntax(
  rawCode: unknown,
  expectedType: 'flowchart' | 'sequence' | 'er',
  fallbackCode: string
): string {
  if (typeof rawCode !== 'string' || !rawCode.trim()) {
    return fallbackCode;
  }

  let code = rawCode
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (!code || code.length < 12) {
    return fallbackCode;
  }

  // Reject HTML/script injection attempts inside Mermaid strings
  if (/<script|<iframe|javascript:/i.test(code)) {
    return fallbackCode;
  }

  const firstLine = code.split('\n')[0]?.trim() || '';
  if (expectedType === 'sequence') {
    if (!/^sequenceDiagram\b/i.test(firstLine)) {
      code = `sequenceDiagram\n${code}`;
    }
    return redactSensitiveText(code);
  }

  if (expectedType === 'er') {
    if (!/^erDiagram\b/i.test(firstLine)) {
      return fallbackCode;
    }
    return redactSensitiveText(code);
  }

  // Flowchart cleanup: quote unquoted [Label] blocks that may contain parentheses/colons/slashes
  if (!/^(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i.test(firstLine)) {
    code = `flowchart TD\n${code}`;
  }

  const lines = code.split('\n').map((line) => {
    // Skip comments and subgraph/end lines except fixing simple node [text] syntax
    if (/^\s*(%%|subgraph\b|end\b|classDef\b|class\b|style\b|linkStyle\b)/.test(line)) {
      return line;
    }
    return line.replace(
      /([A-Za-z0-9_]+)\[([^"\]]+)\]/g,
      (_match, id: string, label: string) => `${id}["${sanitizeMermaidLabel(label)}"]`
    );
  });

  return redactSensitiveText(lines.join('\n'));
}

function buildFallbackSystemMermaid(
  repoName: string,
  components: ArchitectureComponentNode[]
): string {
  if (components.length === 0) {
    return [
      'flowchart TD',
      `  Repo["${sanitizeMermaidLabel(repoName)}"] --> Core["Core Application Modules"]`,
      '  Core --> Config["Configuration & Dependencies"]',
    ].join('\n');
  }

  const top = components.slice(0, 12);
  const idMap = new Map<string, string>();
  top.forEach((c, idx) => {
    idMap.set(c.id, `N${idx + 1}`);
  });

  const lines: string[] = ['flowchart TD'];
  for (const c of top) {
    const nid = idMap.get(c.id)!;
    lines.push(`  ${nid}["${sanitizeMermaidLabel(`${c.name} (${c.category})`)}"]`);
  }

  let edgeCount = 0;
  for (const c of top) {
    const fromId = idMap.get(c.id)!;
    for (const target of c.connectedIds) {
      const toId = idMap.get(target);
      if (toId && toId !== fromId) {
        lines.push(`  ${fromId} --> ${toId}`);
        edgeCount += 1;
      }
    }
  }

  if (edgeCount === 0 && top.length > 1) {
    for (let i = 0; i < top.length - 1; i += 1) {
      lines.push(`  N${i + 1} --> N${i + 2}`);
    }
  }
  return lines.join('\n');
}

function buildFallbackErMermaid(entities: DatabaseEntityDetail[]): string {
  if (entities.length === 0) {
    return [
      'flowchart LR',
      '  App["Application Runtime"] --> State["No Dedicated SQL/ORM Schema Detected"]',
      '  State --> Note["Check Config / Store Files for Persistence Details"]',
    ].join('\n');
  }

  const lines: string[] = ['erDiagram'];
  for (const entity of entities.slice(0, 10)) {
    const safeName = entity.name.replace(/[^A-Za-z0-9_]/g, '_') || 'Entity';
    lines.push(`  ${safeName} {`);
    const fields = entity.fields.slice(0, 10);
    if (fields.length === 0) {
      lines.push('    string id PK');
    } else {
      for (const f of fields) {
        const fType = (f.type || 'string').replace(/[^A-Za-z0-9_]/g, '') || 'string';
        const fName = (f.name || 'field').replace(/[^A-Za-z0-9_]/g, '_') || 'field';
        const keySuffix = f.key === 'PK' || f.key === 'FK' ? ` ${f.key}` : '';
        lines.push(`    ${fType} ${fName}${keySuffix}`);
      }
    }
    lines.push('  }');
  }
  return lines.join('\n');
}

function buildFallbackAuthSequence(auth: Partial<AuthenticationFlowBreakdown>): string {
  if (!auth.hasAuthentication) {
    return [
      'sequenceDiagram',
      '  participant User',
      '  participant App as Application',
      '  User->>App: Access public routes / CLI / module',
      '  App-->>User: Executes without authentication barrier',
    ].join('\n');
  }
  const provider = sanitizeMermaidLabel((auth.providers ?? [])[0] || 'Auth Provider');
  return [
    'sequenceDiagram',
    '  participant User',
    '  participant Client as Frontend Client',
    `  participant Provider as ${provider}`,
    '  participant Backend as Backend Verification',
    '  User->>Client: Initiate Sign-In',
    '  Client->>Provider: Authenticate Credentials / OAuth',
    '  Provider-->>Client: Session / Access Token',
    '  Client->>Backend: Request with Token / Cookie',
    '  Backend->>Backend: Verify Identity & Permissions',
    '  Backend-->>Client: Authorized Response',
  ].join('\n');
}

async function analyzeBatchForFacts(params: {
  repositoryFullName: string;
  branch: string;
  batch: SourceBatch;
  totalBatches: number;
  options: RepositoryIntelligenceOptions;
}): Promise<ExtractedBatchFacts> {
  const { batch } = params;
  const safePromptSource = redactSensitiveText(batch.promptText);

  const prompt = [
    `Repository: ${params.repositoryFullName}`,
    `Branch: ${params.branch}`,
    `Source Batch: ${batch.batchIndex} of ${params.totalBatches}`,
    `Files in batch: ${batch.filePaths.join(', ')}`,
    '',
    'Inspect ONLY the numbered source files below. Extract factual architecture building blocks, symbols, routes, API calls, database schemas, and auth mechanisms. Do NOT invent anything not present in these files, and NEVER include secret values.',
    '',
    safePromptSource,
  ].join('\n');

  const rawText = await generateWithRetry({
    model: DEFAULT_GEMINI_MODEL,
    contents: prompt,
    systemInstruction:
      'You are a Principal Software Architect analyzing a subset of repository source files. Return strict, factual JSON grounded only in the files provided. Never fabricate file paths, API routes, tables, or symbols.',
    thinkingLevel: 'LOW',
    maxOutputTokens: params.options.maxBatchOutputTokens ?? 4096,
    maxRetries: params.options.maxRetries ?? 2,
    retryDelayMs: params.options.retryDelayMs ?? 600,
    generateContentFn: params.options.generateContentFn,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        techStackHints: { type: Type.ARRAY, items: { type: Type.STRING } },
        fileSummaries: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              path: { type: Type.STRING },
              purpose: { type: Type.STRING },
              layer: { type: Type.STRING },
              symbols: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['path', 'purpose', 'layer', 'symbols'],
          },
        },
        components: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              category: { type: Type.STRING },
              purpose: { type: Type.STRING },
              filePaths: { type: Type.ARRAY, items: { type: Type.STRING } },
              symbols: { type: Type.ARRAY, items: { type: Type.STRING } },
              connectedNames: { type: Type.ARRAY, items: { type: Type.STRING } },
              simpleExplanation: { type: Type.STRING },
              technicalExplanation: { type: Type.STRING },
            },
            required: ['name', 'category', 'purpose', 'filePaths'],
          },
        },
        endpoints: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              method: { type: Type.STRING },
              path: { type: Type.STRING },
              filePath: { type: Type.STRING },
              handler: { type: Type.STRING },
              purpose: { type: Type.STRING },
              authRequired: { type: Type.BOOLEAN },
            },
            required: ['method', 'path', 'filePath', 'purpose'],
          },
        },
        frontendCalls: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              callerFile: { type: Type.STRING },
              callerFunction: { type: Type.STRING },
              method: { type: Type.STRING },
              targetEndpoint: { type: Type.STRING },
              triggeredBy: { type: Type.STRING },
            },
            required: ['callerFile', 'targetEndpoint'],
          },
        },
        integrations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              provider: { type: Type.STRING },
              kind: { type: Type.STRING },
              purpose: { type: Type.STRING },
              clientInitialization: { type: Type.STRING },
              callingFile: { type: Type.STRING },
              callingFunction: { type: Type.STRING },
              endpointOrMethod: { type: Type.STRING },
              requestFlow: { type: Type.STRING },
              responseHandling: { type: Type.STRING },
              envVarNames: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['provider', 'purpose', 'callingFile'],
          },
        },
        databaseEntities: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              kind: { type: Type.STRING },
              sourceFile: { type: Type.STRING },
              fields: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    type: { type: Type.STRING },
                    key: { type: Type.STRING },
                    notes: { type: Type.STRING },
                  },
                  required: ['name', 'type'],
                },
              },
              relationships: { type: Type.ARRAY, items: { type: Type.STRING } },
              accessorFunctions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['name', 'kind', 'sourceFile'],
          },
        },
        authSignal: {
          type: Type.OBJECT,
          nullable: true,
          properties: {
            hasAuth: { type: Type.BOOLEAN },
            providers: { type: Type.ARRAY, items: { type: Type.STRING } },
            loginFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            backendVerificationFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            tokenHandling: { type: Type.STRING },
            protectedRoutes: { type: Type.STRING },
            logoutHandling: { type: Type.STRING },
          },
        },
      },
      required: ['fileSummaries', 'components', 'endpoints', 'integrations', 'databaseEntities'],
    },
  });

  const parsed = parseGeminiJson<Record<string, unknown>>(rawText) || {};

  const fileSummaries: BatchFileSummary[] = Array.isArray(parsed.fileSummaries)
    ? parsed.fileSummaries
        .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'))
        .map((f) => ({
          path: String(f.path || '').trim(),
          purpose: redactSensitiveText(String(f.purpose || '').trim()),
          layer: String(f.layer || 'module').trim(),
          symbols: cleanStringList(f.symbols, 12),
        }))
        .filter((f) => f.path && f.purpose)
    : [];

  const components: ArchitectureComponentNode[] = Array.isArray(parsed.components)
    ? parsed.components
        .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
        .map((c) => {
          const name = String(c.name || '').trim();
          const purpose = redactSensitiveText(String(c.purpose || '').trim());
          return {
            id: slugId(name),
            name,
            category: normalizeCategory(c.category),
            purpose,
            filePaths: cleanStringList(c.filePaths, 12),
            symbols: cleanStringList(c.symbols, 15),
            connectedIds: cleanStringList(c.connectedNames, 12).map((n) => slugId(n)),
            simpleExplanation: redactSensitiveText(
              String(c.simpleExplanation || purpose).trim()
            ),
            technicalExplanation: redactSensitiveText(
              String(c.technicalExplanation || purpose).trim()
            ),
            confidence: 'confirmed' as const,
          };
        })
        .filter((c) => c.name && c.purpose)
    : [];

  const endpoints: BatchEndpoint[] = Array.isArray(parsed.endpoints)
    ? parsed.endpoints
        .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
        .map((e) => ({
          method: String(e.method || 'GET').toUpperCase().trim(),
          path: String(e.path || '').trim(),
          filePath: String(e.filePath || '').trim(),
          handler: String(e.handler || 'handler').trim(),
          purpose: redactSensitiveText(String(e.purpose || '').trim()),
          authRequired: Boolean(e.authRequired),
        }))
        .filter((e) => e.path)
    : [];

  const frontendCalls: BatchFrontendCall[] = Array.isArray(parsed.frontendCalls)
    ? parsed.frontendCalls
        .filter((fc): fc is Record<string, unknown> => Boolean(fc && typeof fc === 'object'))
        .map((fc) => ({
          callerFile: String(fc.callerFile || '').trim(),
          callerFunction: String(fc.callerFunction || '').trim(),
          method: String(fc.method || 'GET').toUpperCase().trim(),
          targetEndpoint: String(fc.targetEndpoint || '').trim(),
          triggeredBy: String(fc.triggeredBy || '').trim(),
        }))
        .filter((fc) => fc.callerFile && fc.targetEndpoint)
    : [];

  const integrations: ApiIntegrationDetail[] = Array.isArray(parsed.integrations)
    ? parsed.integrations
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => {
          const provider = String(item.provider || '').trim();
          const rawKind = String(item.kind || 'external-api').toLowerCase();
          const kind: ApiIntegrationDetail['kind'] =
            rawKind.includes('ai') || rawKind.includes('gemini') || rawKind.includes('llm')
              ? 'ai-service'
              : rawKind.includes('internal')
                ? 'internal-endpoint'
                : rawKind.includes('db') || rawKind.includes('data')
                  ? 'database-service'
                  : 'external-api';
          return {
            id: slugId(provider, 'api'),
            provider,
            kind,
            purpose: redactSensitiveText(String(item.purpose || '').trim()),
            clientInitialization: redactSensitiveText(String(item.clientInitialization || '').trim()),
            callingFile: String(item.callingFile || '').trim(),
            callingFunction: String(item.callingFunction || '').trim(),
            endpointOrMethod: redactSensitiveText(String(item.endpointOrMethod || '').trim()),
            requestFlow: redactSensitiveText(String(item.requestFlow || '').trim()),
            responseHandling: redactSensitiveText(String(item.responseHandling || '').trim()),
            envVarNames: cleanStringList(item.envVarNames, 10).filter((v) =>
              /^[A-Z0-9_]{2,64}$/.test(v)
            ),
            confidence: 'confirmed' as const,
          };
        })
        .filter((item) => item.provider && item.callingFile)
    : [];

  const databaseEntities: DatabaseEntityDetail[] = Array.isArray(parsed.databaseEntities)
    ? parsed.databaseEntities
        .filter((d): d is Record<string, unknown> => Boolean(d && typeof d === 'object'))
        .map((d) => {
          const rawKind = String(d.kind || 'table').toLowerCase();
          const kind: DatabaseEntityDetail['kind'] =
            rawKind === 'collection'
              ? 'collection'
              : rawKind === 'model'
                ? 'model'
                : rawKind === 'schema'
                  ? 'schema'
                  : 'table';
          const fields = Array.isArray(d.fields)
            ? d.fields
                .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'))
                .map((f) => {
                  const keyRaw = String(f.key || '').toUpperCase();
                  const key: 'PK' | 'FK' | 'UNIQUE' | '' =
                    keyRaw === 'PK' || keyRaw === 'FK' || keyRaw === 'UNIQUE' ? keyRaw : '';
                  return {
                    name: String(f.name || '').trim(),
                    type: String(f.type || 'string').trim(),
                    key,
                    notes: String(f.notes || '').trim(),
                  };
                })
                .filter((f) => f.name)
            : [];
          return {
            name: String(d.name || '').trim(),
            kind,
            sourceFile: String(d.sourceFile || '').trim(),
            fields,
            relationships: cleanStringList(d.relationships, 10),
            accessorFunctions: cleanStringList(d.accessorFunctions, 10),
            confidence: 'confirmed' as const,
          };
        })
        .filter((d) => d.name && d.sourceFile)
    : [];

  const authSignals: BatchAuthSignal[] = [];
  if (parsed.authSignal && typeof parsed.authSignal === 'object') {
    const a = parsed.authSignal as Record<string, unknown>;
    if (a.hasAuth) {
      authSignals.push({
        hasAuth: true,
        providers: cleanStringList(a.providers, 8),
        loginFiles: cleanStringList(a.loginFiles, 8),
        backendVerificationFiles: cleanStringList(a.backendVerificationFiles, 8),
        tokenHandling: redactSensitiveText(String(a.tokenHandling || '').trim()),
        protectedRoutes: redactSensitiveText(String(a.protectedRoutes || '').trim()),
        logoutHandling: redactSensitiveText(String(a.logoutHandling || '').trim()),
      });
    }
  }

  return {
    fileSummaries,
    components,
    endpoints,
    frontendCalls,
    integrations,
    databaseEntities,
    authSignals,
    techStackHints: cleanStringList(parsed.techStackHints, 12),
  };
}

export async function generateRepositoryIntelligenceReport(params: {
  repository: Repository;
  bundle: RepositoryIntelligenceCollectionBundle;
  options?: RepositoryIntelligenceOptions;
}): Promise<RepositoryIntelligenceReport> {
  const startedAt = Date.now();
  const { repository, bundle } = params;
  const options = params.options ?? {};

  const knownPathSet = new Set<string>();
  const lowerKnownPathMap = new Map<string, string>();
  for (const node of bundle.treeNodes) {
    if (node.type === 'file') {
      knownPathSet.add(node.path);
      lowerKnownPathMap.set(node.path.toLowerCase(), node.path);
    }
  }

  const { chunks, batches } = chunkCollectedSources(bundle.collectedFiles, {
    maxChunkChars: options.maxChunkChars ?? 16000,
    maxBatchChars: options.maxBatchChars ?? 26000,
    overlapLines: 10,
  });

  const emitProgress = (evt: IntelligenceProgressEvent) => {
    if (!options.onProgress) return;
    try {
      options.onProgress(evt);
    } catch {
      // Ignore progress listener errors
    }
  };

  emitProgress({
    stage: 'analyzing_chunks',
    totalChunks: chunks.length,
    completedChunks: 0,
    message: `Inspecting ${bundle.filesCollected} collected source files across ${batches.length} chunk batch${batches.length === 1 ? '' : 'es'}...`,
  });

  // Step 1: Execute batch extraction with controlled concurrency (<= 3)
  const concurrency = Math.max(1, Math.min(3, options.maxConcurrency ?? 3));
  const batchResults: Array<ExtractedBatchFacts | null> = new Array(batches.length).fill(null);
  let nextBatchIdx = 0;
  let completedChunks = 0;
  let failedBatches = 0;
  let lastBatchError: string | null = null;

  const runWorker = async () => {
    while (true) {
      const idx = nextBatchIdx;
      nextBatchIdx += 1;
      if (idx >= batches.length) break;

      const batch = batches[idx];
      try {
        batchResults[idx] = await analyzeBatchForFacts({
          repositoryFullName: repository.fullName,
          branch: bundle.branch,
          batch,
          totalBatches: batches.length,
          options,
        });
      } catch (err) {
        failedBatches += 1;
        lastBatchError = toSafeGeminiErrorMessage(err);
      } finally {
        completedChunks += batch.chunks.length;
        emitProgress({
          stage: 'analyzing_chunks',
          totalChunks: chunks.length,
          completedChunks: Math.min(chunks.length, completedChunks),
          message: `Analyzed batch ${Math.min(batches.length, idx + 1)}/${batches.length} (${Math.min(chunks.length, completedChunks)}/${chunks.length} chunks)...`,
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, batches.length)) }, () => runWorker())
  );

  const succeededBatches = batchResults.filter((r): r is ExtractedBatchFacts => Boolean(r));
  if (succeededBatches.length === 0 && batches.length > 0) {
    throw new Error(
      lastBatchError || 'All AI repository chunk analysis batches failed.'
    );
  }

  // Merge factual extractions across batches
  const fileSummaryMap = new Map<string, BatchFileSummary>();
  const componentMap = new Map<string, ArchitectureComponentNode>();
  const endpointList: BatchEndpoint[] = [];
  const frontendCallList: BatchFrontendCall[] = [];
  const integrationMap = new Map<string, ApiIntegrationDetail>();
  const dbEntityMap = new Map<string, DatabaseEntityDetail>();
  const authSignals: BatchAuthSignal[] = [];
  const techStackSet = new Set<string>();

  for (const batchFact of succeededBatches) {
    for (const hint of batchFact.techStackHints) techStackSet.add(hint);

    for (const fsItem of batchFact.fileSummaries) {
      const exactPath =
        knownPathSet.has(fsItem.path)
          ? fsItem.path
          : lowerKnownPathMap.get(fsItem.path.toLowerCase()) ?? null;
      if (exactPath && !fileSummaryMap.has(exactPath)) {
        fileSummaryMap.set(exactPath, { ...fsItem, path: exactPath });
      }
    }

    for (const comp of batchFact.components) {
      const resolvedFiles = resolveKnownPaths(comp.filePaths, knownPathSet, lowerKnownPathMap, 15);
      const existing = componentMap.get(comp.id);
      if (!existing) {
        componentMap.set(comp.id, {
          ...comp,
          filePaths: resolvedFiles,
        });
      } else {
        existing.filePaths = Array.from(new Set([...existing.filePaths, ...resolvedFiles]));
        existing.symbols = Array.from(new Set([...existing.symbols, ...comp.symbols])).slice(0, 20);
        existing.connectedIds = Array.from(
          new Set([...existing.connectedIds, ...comp.connectedIds])
        );
      }
    }

    for (const ep of batchFact.endpoints) {
      const exactPath =
        knownPathSet.has(ep.filePath)
          ? ep.filePath
          : lowerKnownPathMap.get(ep.filePath.toLowerCase()) ?? ep.filePath;
      endpointList.push({ ...ep, filePath: exactPath });
    }

    for (const fc of batchFact.frontendCalls) {
      const exactPath =
        knownPathSet.has(fc.callerFile)
          ? fc.callerFile
          : lowerKnownPathMap.get(fc.callerFile.toLowerCase()) ?? fc.callerFile;
      frontendCallList.push({ ...fc, callerFile: exactPath });
    }

    for (const integ of batchFact.integrations) {
      const exactPath =
        knownPathSet.has(integ.callingFile)
          ? integ.callingFile
          : lowerKnownPathMap.get(integ.callingFile.toLowerCase()) ?? integ.callingFile;
      const key = `${integ.provider.toLowerCase()}::${exactPath}`;
      if (!integrationMap.has(key)) {
        integrationMap.set(key, { ...integ, callingFile: exactPath });
      }
    }

    for (const ent of batchFact.databaseEntities) {
      const exactPath =
        knownPathSet.has(ent.sourceFile)
          ? ent.sourceFile
          : lowerKnownPathMap.get(ent.sourceFile.toLowerCase()) ?? ent.sourceFile;
      const key = ent.name.toLowerCase();
      if (!dbEntityMap.has(key)) {
        dbEntityMap.set(key, { ...ent, sourceFile: exactPath });
      }
    }

    for (const auth of batchFact.authSignals) {
      authSignals.push(auth);
    }
  }

  const mergedComponents = Array.from(componentMap.values()).slice(0, 32);
  const mergedEndpoints = endpointList.slice(0, 45);
  const mergedFrontendCalls = frontendCallList.slice(0, 40);
  const mergedIntegrations = Array.from(integrationMap.values()).slice(0, 25);
  const mergedDbEntities = Array.from(dbEntityMap.values()).slice(0, 25);

  emitProgress({
    stage: 'synthesizing_architecture',
    totalChunks: chunks.length,
    completedChunks: chunks.length,
    message: `Synthesizing 10-section architecture intelligence and interactive Mermaid diagrams...`,
  });

  // Step 2: Global Synthesis via Gemini
  const directorySummary = bundle.treeNodes
    .filter((n) => n.type === 'dir')
    .slice(0, 80)
    .map((n) => n.path);

  const coverageLimitations: string[] = [];
  if (bundle.treeTruncated) {
    coverageLimitations.push('GitHub recursive tree response was truncated due to repository size.');
  }
  if (bundle.filesSkipped > 0) {
    coverageLimitations.push(
      `${bundle.filesSkipped} repository files were skipped (unsupported extensions, binaries, sensitive files, lockfiles, or byte-budget limits).`
    );
  }
  if (bundle.failedFiles > 0) {
    coverageLimitations.push(
      `${bundle.failedFiles} files could not be retrieved from GitHub during collection.`
    );
  }
  if (failedBatches > 0) {
    coverageLimitations.push(
      `${failedBatches}/${batches.length} AI source batch${failedBatches === 1 ? '' : 'es'} failed during chunk analysis.`
    );
  }

  const synthesisPrompt = [
    `Repository: ${repository.fullName} (${repository.isPrivate ? 'Private' : 'Public'})`,
    `Description: ${repository.description || 'None provided'}`,
    `Primary Language: ${repository.language} | Branch: ${bundle.branch} | Commit SHA: ${bundle.analyzedCommitSha}`,
    `Coverage: ${bundle.filesCollected} files analyzed out of ${bundle.totalFiles} files (${bundle.eligibleFiles} eligible, ${bundle.filesSkipped} skipped, ${bundle.failedFiles} failed, ${bundle.filesTruncated} truncated).`,
    coverageLimitations.length > 0 ? `Limitations: ${coverageLimitations.join(' ')}` : 'Coverage: Full eligible source coverage.',
    '',
    `TOP DIRECTORIES (${directorySummary.length}): ${directorySummary.join(', ')}`,
    `TECH STACK HINTS: ${Array.from(techStackSet).join(', ')}`,
    '',
    'EXTRACTED FILE SUMMARIES:',
    ...Array.from(fileSummaryMap.values())
      .slice(0, 75)
      .map((f) => `- ${f.path} [${f.layer}]: ${f.purpose} (Symbols: ${f.symbols.slice(0, 6).join(', ')})`),
    '',
    'EXTRACTED COMPONENTS:',
    ...mergedComponents.map(
      (c) => `- ${c.id} | ${c.name} [${c.category}] | Files: ${c.filePaths.join(', ')} | ${c.purpose}`
    ),
    '',
    'EXTRACTED BACKEND ENDPOINTS:',
    ...mergedEndpoints.map(
      (e) => `- ${e.method} ${e.path} (${e.filePath} -> ${e.handler}) auth=${e.authRequired}: ${e.purpose}`
    ),
    '',
    'EXTRACTED FRONTEND API CALLS:',
    ...mergedFrontendCalls.map(
      (fc) => `- ${fc.callerFile}:${fc.callerFunction} -> ${fc.method} ${fc.targetEndpoint} (trigger: ${fc.triggeredBy})`
    ),
    '',
    'EXTRACTED EXTERNAL / AI / INTERNAL INTEGRATIONS:',
    ...mergedIntegrations.map(
      (i) => `- ${i.provider} [${i.kind}] in ${i.callingFile} (${i.callingFunction}) | EnvVars: ${i.envVarNames.join(', ')} | ${i.purpose}`
    ),
    '',
    'EXTRACTED DATABASE ENTITIES:',
    ...mergedDbEntities.map(
      (d) =>
        `- ${d.name} (${d.kind}) in ${d.sourceFile}: fields=[${d.fields
          .slice(0, 8)
          .map((f) => `${f.name}:${f.type}${f.key ? ` ${f.key}` : ''}`)
          .join(', ')}] rels=[${d.relationships.join('; ')}]`
    ),
    '',
    'EXTRACTED AUTH SIGNALS:',
    ...authSignals.map(
      (a) =>
        `- Providers: ${a.providers.join(', ')} | Login: ${a.loginFiles.join(', ')} | BackendVerify: ${a.backendVerificationFiles.join(', ')} | Token: ${a.tokenHandling} | Protected: ${a.protectedRoutes}`
    ),
    '',
    'Synthesize a comprehensive, crystal-clear architectural intelligence report for BOTH beginners and senior engineers. Produce valid Mermaid syntax (wrap node labels in double quotes like A["Label text"], no HTML tags, no markdown fences inside strings). NEVER invent files, routes, databases, or auth systems if absent in the repository.',
  ].join('\n');

  const rawSynth = await generateWithRetry({
    model: DEFAULT_GEMINI_MODEL,
    contents: synthesisPrompt,
    systemInstruction:
      'You are the CodeRubric Repository Intelligence Architect. Synthesize verified code facts into clear beginner + technical explanations and valid Mermaid diagrams (flowchart TD, sequenceDiagram, erDiagram). Strictly cite only observed files and clearly mark inferred details.',
    thinkingLevel: 'MEDIUM',
    maxOutputTokens: options.maxSynthesisOutputTokens ?? 8192,
    maxRetries: options.maxRetries ?? 2,
    retryDelayMs: options.retryDelayMs ?? 600,
    generateContentFn: options.generateContentFn,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        overview: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING },
            architectureStyle: { type: Type.STRING },
            simpleSummary: { type: Type.STRING },
            technicalSummary: { type: Type.STRING },
            techStack: { type: Type.ARRAY, items: { type: Type.STRING } },
            entryPoints: {
              type: Type.OBJECT,
              properties: {
                frontend: { type: Type.ARRAY, items: { type: Type.STRING } },
                backend: { type: Type.ARRAY, items: { type: Type.STRING } },
                config: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
            },
            confirmedFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
            inferredDetails: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['headline', 'architectureStyle', 'simpleSummary', 'technicalSummary', 'techStack'],
        },
        systemArchitecture: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            mermaidCode: { type: Type.STRING },
            simpleExplanation: { type: Type.STRING },
            technicalExplanation: { type: Type.STRING },
          },
          required: ['mermaidCode', 'simpleExplanation', 'technicalExplanation'],
        },
        frontendArchitecture: {
          type: Type.OBJECT,
          properties: {
            hasFrontend: { type: Type.BOOLEAN },
            frameworkSummary: { type: Type.STRING },
            entryPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            rootComponents: { type: Type.ARRAY, items: { type: Type.STRING } },
            pagesAndViews: { type: Type.ARRAY, items: { type: Type.STRING } },
            reusableComponents: { type: Type.ARRAY, items: { type: Type.STRING } },
            routingFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            stateAndContexts: { type: Type.ARRAY, items: { type: Type.STRING } },
            customHooks: { type: Type.ARRAY, items: { type: Type.STRING } },
            apiServiceFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            mermaidCode: { type: Type.STRING },
            simpleExplanation: { type: Type.STRING },
            technicalExplanation: { type: Type.STRING },
          },
          required: ['hasFrontend', 'frameworkSummary', 'mermaidCode', 'simpleExplanation', 'technicalExplanation'],
        },
        backendArchitecture: {
          type: Type.OBJECT,
          properties: {
            hasBackend: { type: Type.BOOLEAN },
            runtimeSummary: { type: Type.STRING },
            serverEntryPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            middlewareFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            routeAndControllerFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            serviceFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            databaseLayerFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            externalIntegrationFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            mermaidCode: { type: Type.STRING },
            simpleExplanation: { type: Type.STRING },
            technicalExplanation: { type: Type.STRING },
          },
          required: ['hasBackend', 'runtimeSummary', 'mermaidCode', 'simpleExplanation', 'technicalExplanation'],
        },
        communicationOverview: {
          type: Type.OBJECT,
          properties: {
            mermaidCode: { type: Type.STRING },
            simpleExplanation: { type: Type.STRING },
            technicalExplanation: { type: Type.STRING },
          },
          required: ['mermaidCode', 'simpleExplanation', 'technicalExplanation'],
        },
        communicationFlows: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              userAction: { type: Type.STRING },
              frontendComponent: { type: Type.STRING },
              frontendService: { type: Type.STRING },
              httpRequest: { type: Type.STRING },
              backendRoute: { type: Type.STRING },
              middleware: { type: Type.STRING },
              serviceLayer: { type: Type.STRING },
              databaseOrExternal: { type: Type.STRING },
              responseFormat: { type: Type.STRING },
              stateUpdate: { type: Type.STRING },
              uiRendering: { type: Type.STRING },
              sourceFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
              simpleExplanation: { type: Type.STRING },
              technicalExplanation: { type: Type.STRING },
              mermaidCode: { type: Type.STRING },
            },
            required: ['name', 'userAction', 'httpRequest', 'backendRoute', 'mermaidCode'],
          },
        },
        apiIntegrationsDiagram: {
          type: Type.OBJECT,
          properties: {
            mermaidCode: { type: Type.STRING },
            simpleExplanation: { type: Type.STRING },
            technicalExplanation: { type: Type.STRING },
          },
          required: ['mermaidCode', 'simpleExplanation', 'technicalExplanation'],
        },
        databaseArchitecture: {
          type: Type.OBJECT,
          properties: {
            hasDatabase: { type: Type.BOOLEAN },
            databaseTechSummary: { type: Type.STRING },
            schemaFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            mermaidCode: { type: Type.STRING },
            simpleExplanation: { type: Type.STRING },
            technicalExplanation: { type: Type.STRING },
          },
          required: ['hasDatabase', 'databaseTechSummary', 'mermaidCode', 'simpleExplanation', 'technicalExplanation'],
        },
        authenticationFlow: {
          type: Type.OBJECT,
          properties: {
            hasAuthentication: { type: Type.BOOLEAN },
            authSummary: { type: Type.STRING },
            providers: { type: Type.ARRAY, items: { type: Type.STRING } },
            loginInitiationFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            tokenOrSessionHandling: { type: Type.STRING },
            backendVerificationFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            protectedRoutesSummary: { type: Type.STRING },
            logoutHandling: { type: Type.STRING },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  step: { type: Type.INTEGER },
                  actor: { type: Type.STRING },
                  action: { type: Type.STRING },
                  filePath: { type: Type.STRING },
                  detail: { type: Type.STRING },
                },
                required: ['step', 'actor', 'action', 'detail'],
              },
            },
            mermaidCode: { type: Type.STRING },
            simpleExplanation: { type: Type.STRING },
            technicalExplanation: { type: Type.STRING },
          },
          required: ['hasAuthentication', 'authSummary', 'mermaidCode', 'simpleExplanation', 'technicalExplanation'],
        },
        applicationWorkflows: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              diagramType: { type: Type.STRING },
              mermaidCode: { type: Type.STRING },
              simpleExplanation: { type: Type.STRING },
              technicalExplanation: { type: Type.STRING },
              sourceFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['title', 'mermaidCode', 'simpleExplanation', 'technicalExplanation'],
          },
        },
      },
      required: [
        'overview',
        'systemArchitecture',
        'frontendArchitecture',
        'backendArchitecture',
        'communicationOverview',
        'apiIntegrationsDiagram',
        'databaseArchitecture',
        'authenticationFlow',
        'applicationWorkflows',
      ],
    },
  });

  const synth = parseGeminiJson<Record<string, any>>(rawSynth) || {};

  // Build cachedFiles map & enrich treeNodes with extracted purposes
  const cachedFiles: Record<string, IntelligenceCachedFile> = {};
  for (const collected of bundle.collectedFiles) {
    const rawContent = bundle.rawContentByPath[collected.path] ?? '';
    const summary = fileSummaryMap.get(collected.path);
    const relatedIds = mergedComponents
      .filter((c) => c.filePaths.includes(collected.path))
      .map((c) => c.id);

    cachedFiles[collected.path] = {
      path: collected.path,
      language: collected.language,
      size: collected.originalSize,
      lineCount: collected.lineCount,
      rawContent,
      truncated: collected.truncated,
      purpose:
        summary?.purpose ||
        `${collected.language} source module (${collected.lineCount} lines).`,
      layer: summary?.layer || 'module',
      symbols: summary?.symbols || [],
      relatedComponentIds: relatedIds,
    };
  }

  const enrichedTreeNodes = bundle.treeNodes.map((node) => {
    if (node.type !== 'file') return node;
    const summary = fileSummaryMap.get(node.path);
    return summary ? { ...node, purpose: summary.purpose } : node;
  });

  const fallbackSysMermaid = buildFallbackSystemMermaid(repository.fullName, mergedComponents);
  const sysRaw = synth.systemArchitecture || {};
  const systemArchitecture: IntelligenceDiagramSpec = {
    id: 'system-architecture',
    title: String(sysRaw.title || `${repository.name} System Architecture`),
    diagramType: 'flowchart',
    mermaidCode: sanitizeMermaidSyntax(sysRaw.mermaidCode, 'flowchart', fallbackSysMermaid),
    simpleExplanation: redactSensitiveText(
      String(
        sysRaw.simpleExplanation ||
          'This diagram shows the major building blocks of the application and how they connect together.'
      )
    ),
    technicalExplanation: redactSensitiveText(
      String(
        sysRaw.technicalExplanation ||
          'High-level architectural topology across client, server, persistence, and external API boundaries.'
      )
    ),
    confidence: 'confirmed',
    relatedComponentIds: mergedComponents.map((c) => c.id),
    sourceFiles: mergedComponents.flatMap((c) => c.filePaths).slice(0, 20),
  };

  const feRaw = synth.frontendArchitecture || {};
  const fallbackFeMermaid = [
    'flowchart TD',
    '  Entry["Entry & Root App"] --> Router["Routing / Navigation"]',
    '  Router --> Pages["Pages & Feature Views"]',
    '  Pages --> Components["UI Components & Hooks"]',
    '  Pages --> ApiClient["Frontend API / Service Layer"]',
  ].join('\n');
  const frontendArchitecture: FrontendArchitectureBreakdown = {
    hasFrontend: Boolean(feRaw.hasFrontend),
    frameworkSummary: redactSensitiveText(
      String(feRaw.frameworkSummary || 'Frontend module summary derived from analyzed files.')
    ),
    entryPoints: resolveKnownPaths(feRaw.entryPoints, knownPathSet, lowerKnownPathMap, 10),
    rootComponents: resolveKnownPaths(feRaw.rootComponents, knownPathSet, lowerKnownPathMap, 10),
    pagesAndViews: resolveKnownPaths(feRaw.pagesAndViews, knownPathSet, lowerKnownPathMap, 25),
    reusableComponents: resolveKnownPaths(
      feRaw.reusableComponents,
      knownPathSet,
      lowerKnownPathMap,
      25
    ),
    routingFiles: resolveKnownPaths(feRaw.routingFiles, knownPathSet, lowerKnownPathMap, 10),
    stateAndContexts: resolveKnownPaths(
      feRaw.stateAndContexts,
      knownPathSet,
      lowerKnownPathMap,
      12
    ),
    customHooks: resolveKnownPaths(feRaw.customHooks, knownPathSet, lowerKnownPathMap, 15),
    apiServiceFiles: resolveKnownPaths(feRaw.apiServiceFiles, knownPathSet, lowerKnownPathMap, 12),
    diagram: {
      id: 'frontend-architecture',
      title: 'Frontend Architecture & Component Hierarchy',
      diagramType: 'flowchart',
      mermaidCode: sanitizeMermaidSyntax(feRaw.mermaidCode, 'flowchart', fallbackFeMermaid),
      simpleExplanation: redactSensitiveText(
        String(
          feRaw.simpleExplanation ||
            'Shows how the user interface loads, navigates between screens, manages data, and talks to backend services.'
        )
      ),
      technicalExplanation: redactSensitiveText(
        String(
          feRaw.technicalExplanation ||
            'Frontend entry point, component tree, state management, hooks, and HTTP client boundaries.'
        )
      ),
      confidence: 'confirmed',
      relatedComponentIds: mergedComponents
        .filter((c) => c.category === 'frontend')
        .map((c) => c.id),
      sourceFiles: [
        ...resolveKnownPaths(feRaw.entryPoints, knownPathSet, lowerKnownPathMap, 5),
        ...resolveKnownPaths(feRaw.pagesAndViews, knownPathSet, lowerKnownPathMap, 10),
      ],
    },
  };

  const beRaw = synth.backendArchitecture || {};
  const fallbackBeMermaid = [
    'flowchart TD',
    '  Server["Server Entry"] --> Middleware["Middleware & Validation"]',
    '  Middleware --> Routes["API Routes / Controllers"]',
    '  Routes --> Services["Domain Services"]',
    '  Services --> Persistence["Database / Store / External APIs"]',
  ].join('\n');
  const backendArchitecture: BackendArchitectureBreakdown = {
    hasBackend: Boolean(beRaw.hasBackend),
    runtimeSummary: redactSensitiveText(
      String(beRaw.runtimeSummary || 'Backend runtime summary derived from analyzed files.')
    ),
    serverEntryPoints: resolveKnownPaths(
      beRaw.serverEntryPoints,
      knownPathSet,
      lowerKnownPathMap,
      10
    ),
    middlewareFiles: resolveKnownPaths(beRaw.middlewareFiles, knownPathSet, lowerKnownPathMap, 12),
    routeAndControllerFiles: resolveKnownPaths(
      beRaw.routeAndControllerFiles,
      knownPathSet,
      lowerKnownPathMap,
      20
    ),
    serviceFiles: resolveKnownPaths(beRaw.serviceFiles, knownPathSet, lowerKnownPathMap, 25),
    databaseLayerFiles: resolveKnownPaths(
      beRaw.databaseLayerFiles,
      knownPathSet,
      lowerKnownPathMap,
      12
    ),
    externalIntegrationFiles: resolveKnownPaths(
      beRaw.externalIntegrationFiles,
      knownPathSet,
      lowerKnownPathMap,
      15
    ),
    endpoints: mergedEndpoints,
    diagram: {
      id: 'backend-architecture',
      title: 'Backend Architecture & Request Pipeline',
      diagramType: 'flowchart',
      mermaidCode: sanitizeMermaidSyntax(beRaw.mermaidCode, 'flowchart', fallbackBeMermaid),
      simpleExplanation: redactSensitiveText(
        String(
          beRaw.simpleExplanation ||
            'Shows how the backend server receives requests, checks permissions, runs business logic, and stores or fetches data.'
        )
      ),
      technicalExplanation: redactSensitiveText(
        String(
          beRaw.technicalExplanation ||
            'Server bootstrap, middleware chain, route dispatch, service layer, and persistence/external adapters.'
        )
      ),
      confidence: 'confirmed',
      relatedComponentIds: mergedComponents
        .filter((c) => c.category === 'backend' || c.category === 'database')
        .map((c) => c.id),
      sourceFiles: [
        ...resolveKnownPaths(beRaw.serverEntryPoints, knownPathSet, lowerKnownPathMap, 5),
        ...resolveKnownPaths(beRaw.routeAndControllerFiles, knownPathSet, lowerKnownPathMap, 10),
      ],
    },
  };

  const commRaw = synth.communicationOverview || {};
  const fallbackCommSequence = [
    'sequenceDiagram',
    '  participant User',
    '  participant UI as Frontend Component',
    '  participant API as Frontend Service',
    '  participant Server as Backend Route & Service',
    '  participant Store as Storage / External API',
    '  User->>UI: Triggers action',
    '  UI->>API: Invokes API helper',
    '  API->>Server: HTTP Request',
    '  Server->>Store: Read / Write / Call External API',
    '  Store-->>Server: Result payload',
    '  Server-->>API: JSON Response',
    '  API-->>UI: Update State & Re-render',
  ].join('\n');

  const communicationOverviewDiagram: IntelligenceDiagramSpec = {
    id: 'frontend-backend-communication',
    title: 'Frontend-to-Backend Request Lifecycle',
    diagramType: 'sequence',
    mermaidCode: sanitizeMermaidSyntax(
      commRaw.mermaidCode,
      'sequence',
      fallbackCommSequence
    ),
    simpleExplanation: redactSensitiveText(
      String(
        commRaw.simpleExplanation ||
          'Traces what happens step by step when a user interacts with the interface and data travels to the backend and back.'
      )
    ),
    technicalExplanation: redactSensitiveText(
      String(
        commRaw.technicalExplanation ||
          'End-to-end request lifecycle across UI handlers, typed HTTP client calls, Express/backend routes, services, and state updates.'
      )
    ),
    confidence: mergedFrontendCalls.length > 0 || mergedEndpoints.length > 0 ? 'confirmed' : 'inferred',
    relatedComponentIds: [],
    sourceFiles: Array.from(
      new Set([
        ...mergedFrontendCalls.map((f) => f.callerFile),
        ...mergedEndpoints.map((e) => e.filePath),
      ])
    ).slice(0, 15),
  };

  const communicationFlows: CommunicationFlowTrace[] = Array.isArray(synth.communicationFlows)
    ? synth.communicationFlows
        .filter((f: any) => Boolean(f && typeof f === 'object' && f.name))
        .slice(0, 6)
        .map((f: any, idx: number) => ({
          id: `flow-${idx + 1}`,
          name: redactSensitiveText(String(f.name)),
          userAction: redactSensitiveText(String(f.userAction || '')),
          frontendComponent: redactSensitiveText(String(f.frontendComponent || '')),
          frontendService: redactSensitiveText(String(f.frontendService || '')),
          httpRequest: redactSensitiveText(String(f.httpRequest || '')),
          backendRoute: redactSensitiveText(String(f.backendRoute || '')),
          middleware: redactSensitiveText(String(f.middleware || 'Standard JSON / Auth middleware')),
          serviceLayer: redactSensitiveText(String(f.serviceLayer || '')),
          databaseOrExternal: redactSensitiveText(String(f.databaseOrExternal || '')),
          responseFormat: redactSensitiveText(String(f.responseFormat || 'JSON')),
          stateUpdate: redactSensitiveText(String(f.stateUpdate || '')),
          uiRendering: redactSensitiveText(String(f.uiRendering || '')),
          sourceFiles: resolveKnownPaths(f.sourceFiles, knownPathSet, lowerKnownPathMap, 10),
          simpleExplanation: redactSensitiveText(String(f.simpleExplanation || '')),
          technicalExplanation: redactSensitiveText(String(f.technicalExplanation || '')),
          confidence: 'confirmed' as const,
          mermaidCode: sanitizeMermaidSyntax(f.mermaidCode, 'sequence', fallbackCommSequence),
        }))
    : [];

  const apiDiagRaw = synth.apiIntegrationsDiagram || {};
  const fallbackApiMermaid = [
    'flowchart LR',
    `  App["${sanitizeMermaidLabel(repository.name)}"]`,
    ...mergedIntegrations.slice(0, 8).map(
      (integ, idx) =>
        `  App --> API${idx + 1}["${sanitizeMermaidLabel(`${integ.provider} (${integ.kind})`)}"]`
    ),
    ...(mergedIntegrations.length === 0
      ? ['  App --> NoExt["No External Third-Party APIs Detected"]']
      : []),
  ].join('\n');

  const apiIntegrationsDiagram: IntelligenceDiagramSpec = {
    id: 'api-integrations',
    title: 'External Services, AI & Internal Endpoint Map',
    diagramType: 'flowchart',
    mermaidCode: sanitizeMermaidSyntax(apiDiagRaw.mermaidCode, 'flowchart', fallbackApiMermaid),
    simpleExplanation: redactSensitiveText(
      String(
        apiDiagRaw.simpleExplanation ||
          'Shows every external service, AI provider, and internal API boundary detected in the codebase without exposing secret credentials.'
      )
    ),
    technicalExplanation: redactSensitiveText(
      String(
        apiDiagRaw.technicalExplanation ||
          'Maps external SDK clients, outbound REST integrations, internal API endpoints, and referenced environment variable names.'
      )
    ),
    confidence: 'confirmed',
    relatedComponentIds: mergedComponents
      .filter((c) => c.category === 'external-api' || c.category === 'ai-service')
      .map((c) => c.id),
    sourceFiles: mergedIntegrations.map((i) => i.callingFile).slice(0, 15),
  };

  const dbRaw = synth.databaseArchitecture || {};
  const hasDatabase = Boolean(dbRaw.hasDatabase) || mergedDbEntities.length > 0;
  const fallbackDbMermaid = buildFallbackErMermaid(mergedDbEntities);
  const databaseArchitecture: DatabaseArchitectureBreakdown = {
    hasDatabase,
    databaseTechSummary: redactSensitiveText(
      String(
        dbRaw.databaseTechSummary ||
          (hasDatabase
            ? 'Persistence entities detected in analyzed schemas.'
            : 'No dedicated relational SQL or document database schema was detected in the analyzed source files.')
      )
    ),
    schemaFiles: Array.from(
      new Set([
        ...resolveKnownPaths(dbRaw.schemaFiles, knownPathSet, lowerKnownPathMap, 12),
        ...mergedDbEntities.map((e) => e.sourceFile).filter((p) => knownPathSet.has(p)),
      ])
    ),
    entities: mergedDbEntities,
    diagram: {
      id: 'database-architecture',
      title: hasDatabase ? 'Database Schema & Entity Relationships' : 'Persistence Overview',
      diagramType: hasDatabase && mergedDbEntities.length > 0 ? 'er' : 'flowchart',
      mermaidCode: sanitizeMermaidSyntax(
        dbRaw.mermaidCode,
        hasDatabase && mergedDbEntities.length > 0 ? 'er' : 'flowchart',
        fallbackDbMermaid
      ),
      simpleExplanation: redactSensitiveText(
        String(
          dbRaw.simpleExplanation ||
            (hasDatabase
              ? 'Illustrates the stored data tables or collections and how records link together.'
              : 'No traditional database schema was found; the app relies on stateless processing, client state, or external APIs.')
        )
      ),
      technicalExplanation: redactSensitiveText(
        String(
          dbRaw.technicalExplanation ||
            'Entity definitions, keys, relationships, and backend data accessor modules verified in source files.'
        )
      ),
      confidence: mergedDbEntities.length > 0 ? 'confirmed' : 'inferred',
      relatedComponentIds: mergedComponents
        .filter((c) => c.category === 'database')
        .map((c) => c.id),
      sourceFiles: mergedDbEntities.map((e) => e.sourceFile).slice(0, 10),
    },
  };

  const authRaw = synth.authenticationFlow || {};
  const hasAuthentication = Boolean(authRaw.hasAuthentication) || authSignals.length > 0;
  const fallbackAuthMermaid = buildFallbackAuthSequence({
    hasAuthentication,
    providers: cleanStringList(authRaw.providers, 6),
  });
  const authenticationFlow: AuthenticationFlowBreakdown = {
    hasAuthentication,
    authSummary: redactSensitiveText(
      String(
        authRaw.authSummary ||
          (hasAuthentication
            ? 'Authentication and session verification flow detected.'
            : 'No explicit user authentication or login system was detected in the analyzed files.')
      )
    ),
    providers: cleanStringList(
      authRaw.providers ?? authSignals.flatMap((a) => a.providers),
      8
    ),
    loginInitiationFiles: resolveKnownPaths(
      authRaw.loginInitiationFiles,
      knownPathSet,
      lowerKnownPathMap,
      10
    ),
    tokenOrSessionHandling: redactSensitiveText(
      String(authRaw.tokenOrSessionHandling || 'Not applicable or not detected.')
    ),
    backendVerificationFiles: resolveKnownPaths(
      authRaw.backendVerificationFiles,
      knownPathSet,
      lowerKnownPathMap,
      10
    ),
    protectedRoutesSummary: redactSensitiveText(
      String(authRaw.protectedRoutesSummary || 'No protected route guards detected.')
    ),
    logoutHandling: redactSensitiveText(
      String(authRaw.logoutHandling || 'No explicit logout flow detected.')
    ),
    steps: Array.isArray(authRaw.steps)
      ? authRaw.steps
          .filter((s: any) => Boolean(s && typeof s === 'object'))
          .slice(0, 12)
          .map((s: any, idx: number) => ({
            step: typeof s.step === 'number' ? s.step : idx + 1,
            actor: redactSensitiveText(String(s.actor || 'User')),
            action: redactSensitiveText(String(s.action || '')),
            filePath:
              resolveKnownPaths([s.filePath], knownPathSet, lowerKnownPathMap, 1)[0] || '',
            detail: redactSensitiveText(String(s.detail || '')),
          }))
      : [],
    diagram: {
      id: 'authentication-flow',
      title: 'Authentication & Authorization Sequence',
      diagramType: 'sequence',
      mermaidCode: sanitizeMermaidSyntax(authRaw.mermaidCode, 'sequence', fallbackAuthMermaid),
      simpleExplanation: redactSensitiveText(
        String(
          authRaw.simpleExplanation ||
            (hasAuthentication
              ? 'Explains how users sign in, receive credentials/tokens, and get verified before accessing protected features.'
              : 'This project does not enforce user sign-in in the analyzed source files.')
        )
      ),
      technicalExplanation: redactSensitiveText(
        String(
          authRaw.technicalExplanation ||
            'Detailed credential exchange, token verification, session persistence, and route authorization checks.'
        )
      ),
      confidence: hasAuthentication ? 'confirmed' : 'inferred',
      relatedComponentIds: mergedComponents
        .filter((c) => c.category === 'auth')
        .map((c) => c.id),
      sourceFiles: resolveKnownPaths(
        [...(authRaw.loginInitiationFiles ?? []), ...(authRaw.backendVerificationFiles ?? [])],
        knownPathSet,
        lowerKnownPathMap,
        10
      ),
    },
  };

  const fallbackWorkflow: IntelligenceDiagramSpec = {
    id: 'workflow-1',
    title: 'Application Startup & Core Execution Workflow',
    diagramType: 'flowchart',
    mermaidCode: [
      'flowchart TD',
      '  Boot["1. Application Startup & Configuration Load"] --> Init["2. Initialize Core Modules & Services"]',
      '  Init --> Ready["3. Render UI / Listen for Requests"]',
      '  Ready --> Exec["4. Execute Primary Feature Logic"]',
      '  Exec --> Output["5. Return Output / Update View"]',
    ].join('\n'),
    simpleExplanation:
      'Step-by-step walkthrough of how the application boots up, prepares its services, and handles primary tasks.',
    technicalExplanation:
      'Runtime bootstrap order, initialization dependencies, and main request/feature execution pipeline.',
    confidence: 'confirmed',
    relatedComponentIds: [],
    sourceFiles: [
      ...frontendArchitecture.entryPoints,
      ...backendArchitecture.serverEntryPoints,
    ].slice(0, 8),
  };

  const applicationWorkflows: IntelligenceDiagramSpec[] = Array.isArray(synth.applicationWorkflows)
    ? synth.applicationWorkflows
        .filter((w: any) => Boolean(w && typeof w === 'object' && w.title))
        .slice(0, 6)
        .map((w: any, idx: number) => {
          const dtype =
            String(w.diagramType || '').toLowerCase() === 'sequence' ? 'sequence' : 'flowchart';
          return {
            id: `workflow-${idx + 1}`,
            title: redactSensitiveText(String(w.title)),
            diagramType: dtype,
            mermaidCode: sanitizeMermaidSyntax(
              w.mermaidCode,
              dtype,
              fallbackWorkflow.mermaidCode
            ),
            simpleExplanation: redactSensitiveText(String(w.simpleExplanation || '')),
            technicalExplanation: redactSensitiveText(String(w.technicalExplanation || '')),
            confidence: 'confirmed' as const,
            relatedComponentIds: [],
            sourceFiles: resolveKnownPaths(w.sourceFiles, knownPathSet, lowerKnownPathMap, 8),
          };
        })
    : [fallbackWorkflow];

  if (applicationWorkflows.length === 0) {
    applicationWorkflows.push(fallbackWorkflow);
  }

  const ovRaw = synth.overview || {};
  const coverage: RepositoryIntelligenceCoverage = {
    totalTreeEntries: bundle.totalTreeEntries,
    totalDirectories: bundle.totalDirectories,
    totalFiles: bundle.totalFiles,
    eligibleFiles: bundle.eligibleFiles,
    analyzedFiles: bundle.filesCollected,
    skippedFiles: bundle.filesSkipped,
    failedFiles: bundle.failedFiles,
    truncatedFiles: bundle.filesTruncated,
    totalBytesCollected: bundle.totalBytesCollected,
    treeTruncated: bundle.treeTruncated,
    coverageComplete: bundle.coverageComplete && failedBatches === 0,
    totalChunksAnalyzed: chunks.length,
    limitations: coverageLimitations,
  };

  const report: RepositoryIntelligenceReport = {
    id: `intel-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    repositoryId: repository.id,
    repositoryFullName: repository.fullName,
    owner: repository.owner,
    name: repository.name,
    description: repository.description || '',
    defaultBranch: repository.defaultBranch,
    branch: bundle.branch,
    language: repository.language,
    stars: repository.stars,
    forks: repository.forks ?? 0,
    htmlUrl: repository.htmlUrl,
    isPrivate: Boolean(repository.isPrivate),
    analyzedCommitSha: bundle.analyzedCommitSha,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    analysisStatus: coverage.coverageComplete ? 'completed' : 'partial',
    coverage,
    overview: {
      headline: redactSensitiveText(
        String(ovRaw.headline || `${repository.fullName} Architecture Intelligence`)
      ),
      architectureStyle: redactSensitiveText(
        String(ovRaw.architectureStyle || 'Modular Application Architecture')
      ),
      simpleSummary: redactSensitiveText(
        String(
          ovRaw.simpleSummary ||
            `Analyzed ${bundle.filesCollected} files in ${repository.fullName} to map how its components, data, and workflows fit together.`
        )
      ),
      technicalSummary: redactSensitiveText(
        String(
          ovRaw.technicalSummary ||
            `Repository analysis at commit ${bundle.analyzedCommitSha.slice(0, 7)} covering ${bundle.filesCollected}/${bundle.eligibleFiles} eligible files across ${chunks.length} chunks.`
        )
      ),
      techStack: Array.from(
        new Set([
          ...cleanStringList(ovRaw.techStack, 16),
          ...Array.from(techStackSet).slice(0, 8),
        ])
      ).slice(0, 18),
      entryPoints: {
        frontend: resolveKnownPaths(
          ovRaw.entryPoints?.frontend ?? frontendArchitecture.entryPoints,
          knownPathSet,
          lowerKnownPathMap,
          8
        ),
        backend: resolveKnownPaths(
          ovRaw.entryPoints?.backend ?? backendArchitecture.serverEntryPoints,
          knownPathSet,
          lowerKnownPathMap,
          8
        ),
        config: resolveKnownPaths(ovRaw.entryPoints?.config, knownPathSet, lowerKnownPathMap, 8),
      },
      confirmedFacts: cleanStringList(ovRaw.confirmedFacts, 12),
      inferredDetails: cleanStringList(ovRaw.inferredDetails, 10),
    },
    treeNodes: enrichedTreeNodes,
    cachedFiles,
    components: mergedComponents,
    systemArchitecture,
    frontendArchitecture,
    backendArchitecture,
    communicationFlows,
    communicationOverviewDiagram,
    apiIntegrations: mergedIntegrations,
    apiIntegrationsDiagram,
    databaseArchitecture,
    authenticationFlow,
    applicationWorkflows,
  };

  return report;
}
