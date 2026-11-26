import crypto from 'node:crypto';
import { Type } from '@google/genai';
import type {
  RepositoryChatEvidenceStatus,
  RepositoryChatMessage,
  RepositoryChatReference,
  RepositoryIntelligenceReport,
} from '../types.ts';
import {
  DEFAULT_GEMINI_MODEL,
  generateWithRetry,
  parseGeminiJson,
  redactSensitiveText,
  type GeminiGenerateFn,
} from './geminiReviewService.ts';

export interface RepositoryQaOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  generateContentFn?: GeminiGenerateFn;
}

export interface RetrievedSourceSnippet {
  filePath: string;
  language: string;
  purpose: string;
  layer: string;
  symbols: string[];
  score: number;
  truncated: boolean;
  excerpt: string;
}

export interface RepositoryQaContextBundle {
  snippets: RetrievedSourceSnippet[];
  matchingTreePaths: Array<{ path: string; status: string; purpose: string }>;
  architectureSummary: string;
  totalCandidateFiles: number;
}

export interface RepositoryQaAnswerResult {
  answer: string;
  evidenceStatus: RepositoryChatEvidenceStatus;
  insufficientEvidenceReason?: string;
  references: RepositoryChatReference[];
  retrievedFileCount: number;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'how',
  'what',
  'does',
  'work',
  'works',
  'where',
  'when',
  'which',
  'about',
  'explain',
  'file',
  'code',
  'project',
  'repo',
  'repository',
  'used',
  'using',
  'are',
  'can',
  'you',
  'show',
  'tell',
  'data',
  'flow',
]);

function extractSearchTerms(question: string): {
  tokens: string[];
  pathFragments: string[];
} {
  const pathFragments: string[] = [];
  const pathMatches = question.match(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+|[A-Za-z0-9_-]+\.[a-z]{1,5}\b/g);
  if (pathMatches) {
    for (const match of pathMatches) {
      pathFragments.push(match.toLowerCase());
    }
  }

  const rawTokens = question
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  return {
    tokens: Array.from(new Set(rawTokens)).slice(0, 20),
    pathFragments: Array.from(new Set(pathFragments)),
  };
}

function buildCompactExcerpt(rawContent: string, tokens: string[], maxChars: number): string {
  const safeContent = redactSensitiveText(rawContent || '');
  if (safeContent.length <= maxChars) {
    return safeContent;
  }

  const lines = safeContent.split('\n');
  const matchedIndices: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lowerLine = lines[i].toLowerCase();
    if (tokens.some((tok) => lowerLine.includes(tok))) {
      matchedIndices.push(i);
    }
  }

  if (matchedIndices.length === 0) {
    return `${safeContent.slice(0, maxChars)}\n... [truncated to fit context window]`;
  }

  const selectedLineSet = new Set<number>();
  // Include top imports / file header first
  for (let i = 0; i < Math.min(20, lines.length); i += 1) {
    selectedLineSet.add(i);
  }
  // Include windows around matching lines
  for (const idx of matchedIndices.slice(0, 12)) {
    const start = Math.max(0, idx - 6);
    const end = Math.min(lines.length - 1, idx + 10);
    for (let j = start; j <= end; j += 1) {
      selectedLineSet.add(j);
    }
  }

  const sortedLines = Array.from(selectedLineSet).sort((a, b) => a - b);
  const parts: string[] = [];
  let prev = -1;
  for (const lineNum of sortedLines) {
    if (prev !== -1 && lineNum > prev + 1) {
      parts.push(`... [lines ${prev + 2}-${lineNum} omitted] ...`);
    }
    parts.push(`${lineNum + 1}: ${lines[lineNum]}`);
    prev = lineNum;
  }

  const joined = parts.join('\n');
  return joined.length <= maxChars
    ? joined
    : `${joined.slice(0, maxChars)}\n... [truncated to fit context window]`;
}

export function retrieveRelevantRepositoryContext(
  report: RepositoryIntelligenceReport,
  question: string,
  history: RepositoryChatMessage[] = []
): RepositoryQaContextBundle {
  const recentContextText = history
    .slice(-2)
    .map((m) => m.content)
    .join(' ');
  const { tokens, pathFragments } = extractSearchTerms(`${question} ${recentContextText}`);
  const questionOnlyTerms = extractSearchTerms(question);

  const cachedEntries = Object.values(report.cachedFiles || {});
  const scored: Array<{ file: (typeof cachedEntries)[number]; score: number }> = [];

  for (const file of cachedEntries) {
    const lowerPath = file.path.toLowerCase();
    const lowerPurpose = (file.purpose || '').toLowerCase();
    const lowerLayer = (file.layer || '').toLowerCase();
    const lowerSymbols = (file.symbols || []).map((s) => s.toLowerCase());
    const lowerContent = (file.rawContent || '').toLowerCase();

    let score = 0;

    for (const frag of questionOnlyTerms.pathFragments) {
      if (lowerPath === frag) score += 140;
      else if (lowerPath.endsWith(`/${frag}`) || lowerPath.endsWith(frag)) score += 110;
      else if (lowerPath.includes(frag)) score += 70;
    }

    for (const tok of questionOnlyTerms.tokens) {
      if (lowerPath.includes(tok)) score += 28;
      if (lowerPurpose.includes(tok)) score += 14;
      if (lowerLayer.includes(tok)) score += 8;
      if (lowerSymbols.some((s) => s.includes(tok))) score += 24;
      if (lowerContent.includes(tok)) score += 10;
    }

    // Light boost from recent history follow-up context
    for (const frag of pathFragments) {
      if (lowerPath.includes(frag)) score += 12;
    }

    // Light priority boost for entry points & README when question is broad ("what does this project do?")
    if (/readme\.md$/i.test(file.path) && /overview|project|what does|purpose|about|summary/i.test(question)) {
      score += 45;
    }
    if (/package\.json$/i.test(file.path) && /tech|stack|dependenc|package|script|start/i.test(question)) {
      score += 40;
    }
    if (
      report.overview.entryPoints.frontend.includes(file.path) ||
      report.overview.entryPoints.backend.includes(file.path)
    ) {
      score += 10;
    }

    // Boost files referenced by matched endpoints/integrations/auth/database
    const matchesQuestionDomain =
      (/auth|login|sign|token|oauth|session|firebase/i.test(question) &&
        (report.authenticationFlow.loginInitiationFiles.includes(file.path) ||
          report.authenticationFlow.backendVerificationFiles.includes(file.path))) ||
      (/db|database|schema|table|model|store|persist/i.test(question) &&
        report.databaseArchitecture.schemaFiles.includes(file.path)) ||
      (/api|route|endpoint|backend|server|express/i.test(question) &&
        (report.backendArchitecture.routeAndControllerFiles.includes(file.path) ||
          report.backendArchitecture.serviceFiles.includes(file.path))) ||
      (/frontend|ui|page|component|view|react|comm/i.test(question) &&
        (report.frontendArchitecture.pagesAndViews.includes(file.path) ||
          report.frontendArchitecture.apiServiceFiles.includes(file.path)));

    if (matchesQuestionDomain) {
      score += 32;
    }

    scored.push({ file, score });
  }

  scored.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));

  // Take top-scoring files (ensure at least 4 representative files if scores tie cleanly)
  const MAX_SNIPPET_FILES = 8;
  const MAX_TOTAL_CONTEXT_CHARS = 22000;
  const snippets: RetrievedSourceSnippet[] = [];
  let usedChars = 0;

  for (const item of scored.slice(0, MAX_SNIPPET_FILES)) {
    if (snippets.length >= 3 && item.score === 0) break;
    const perFileBudget = Math.min(
      3600,
      Math.max(1200, MAX_TOTAL_CONTEXT_CHARS - usedChars)
    );
    if (perFileBudget < 500) break;

    const excerpt = buildCompactExcerpt(
      item.file.rawContent,
      questionOnlyTerms.tokens,
      perFileBudget
    );
    usedChars += excerpt.length;
    snippets.push({
      filePath: item.file.path,
      language: item.file.language,
      purpose: item.file.purpose,
      layer: item.file.layer,
      symbols: item.file.symbols.slice(0, 12),
      score: item.score,
      truncated: item.file.truncated || excerpt.length < (item.file.rawContent || '').length,
      excerpt,
    });
  }

  // Also include matching tree nodes (for files that weren't cached in full so AI knows what exists/skipped)
  const snippetPathSet = new Set(snippets.map((s) => s.filePath));
  const matchingTreePaths = report.treeNodes
    .filter((node) => node.type === 'file' && !snippetPathSet.has(node.path))
    .map((node) => {
      const lp = node.path.toLowerCase();
      const lpurp = (node.purpose || '').toLowerCase();
      let score = 0;
      for (const tok of questionOnlyTerms.tokens) {
        if (lp.includes(tok)) score += 10;
        if (lpurp.includes(tok)) score += 6;
      }
      return { node, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((x) => ({
      path: x.node.path,
      status: x.node.status || 'analyzed',
      purpose: x.node.purpose || '',
    }));

  const architectureSummary = [
    `Repository: ${report.repositoryFullName} (branch: ${report.branch}, commit: ${report.analyzedCommitSha.slice(0, 10)})`,
    `Style: ${report.overview.architectureStyle} | Stack: ${report.overview.techStack.join(', ')}`,
    `Coverage: ${report.coverage.analyzedFiles}/${report.coverage.totalFiles} files analyzed, ${report.coverage.skippedFiles} skipped, ${report.coverage.failedFiles} failed, ${report.coverage.truncatedFiles} truncated.`,
    report.coverage.limitations.length > 0
      ? `Coverage Limitations: ${report.coverage.limitations.join(' ')}`
      : '',
    `Overview (Simple): ${report.overview.simpleSummary}`,
    `Overview (Technical): ${report.overview.technicalSummary}`,
    `Entry Points: Frontend=[${report.overview.entryPoints.frontend.join(', ')}], Backend=[${report.overview.entryPoints.backend.join(', ')}], Config=[${report.overview.entryPoints.config.join(', ')}]`,
    report.components.length > 0
      ? `Mapped Components (${report.components.length}):\n${report.components
          .slice(0, 16)
          .map(
            (c) =>
              `- ${c.name} [${c.category}] (${c.filePaths.slice(0, 4).join(', ')}): ${c.purpose}`
          )
          .join('\n')}`
      : '',
    report.backendArchitecture.endpoints.length > 0
      ? `Backend Endpoints (${report.backendArchitecture.endpoints.length}):\n${report.backendArchitecture.endpoints
          .slice(0, 20)
          .map(
            (ep) =>
              `- ${ep.method} ${ep.path} -> ${ep.handler} (${ep.filePath}): ${ep.purpose}`
          )
          .join('\n')}`
      : 'Backend Endpoints: None detected.',
    report.apiIntegrations.length > 0
      ? `API Integrations:\n${report.apiIntegrations
          .slice(0, 12)
          .map(
            (i) =>
              `- ${i.provider} (${i.kind}) in ${i.callingFile}::${i.callingFunction} [${i.endpointOrMethod}] envVars=[${i.envVarNames.join(', ')}]`
          )
          .join('\n')}`
      : 'API Integrations: None detected.',
    report.databaseArchitecture.hasDatabase
      ? `Database (${report.databaseArchitecture.databaseTechSummary}): Entities=[${report.databaseArchitecture.entities
          .map((e) => `${e.name}(${e.kind})@${e.sourceFile}`)
          .join(', ')}]`
      : 'Database: None detected.',
    report.authenticationFlow.hasAuthentication
      ? `Authentication (${report.authenticationFlow.providers.join(', ')}): ${report.authenticationFlow.authSummary} | LoginFiles=[${report.authenticationFlow.loginInitiationFiles.join(', ')}] | BackendVerify=[${report.authenticationFlow.backendVerificationFiles.join(', ')}]`
      : 'Authentication: None detected.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    snippets,
    matchingTreePaths,
    architectureSummary: redactSensitiveText(architectureSummary),
    totalCandidateFiles: cachedEntries.length,
  };
}

export async function answerRepositoryQuestion(
  params: {
    report: RepositoryIntelligenceReport;
    question: string;
    history?: RepositoryChatMessage[];
  } & RepositoryQaOptions
): Promise<RepositoryQaAnswerResult> {
  const cleanQuestion = params.question.trim();
  const history = params.history ?? [];
  const context = retrieveRelevantRepositoryContext(params.report, cleanQuestion, history);

  // Build strict allowed path lookup map to prevent any hallucinated file references
  const validPathMap = new Map<string, string>();
  for (const node of params.report.treeNodes) {
    if (node.type === 'file') {
      validPathMap.set(node.path.toLowerCase(), node.path);
    }
  }
  for (const cachedPath of Object.keys(params.report.cachedFiles || {})) {
    validPathMap.set(cachedPath.toLowerCase(), cachedPath);
  }

  const recentConversation = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const sourceBlock =
    context.snippets.length > 0
      ? context.snippets
          .map(
            (s) =>
              `=== FILE: ${s.filePath} (${s.language}, layer=${s.layer}) ===\nPurpose: ${s.purpose}\nSymbols: ${s.symbols.join(', ') || 'n/a'}\n${s.excerpt}`
          )
          .join('\n\n')
      : 'No matching cached source file excerpts were found for the search terms.';

  const uncachedTreeNote =
    context.matchingTreePaths.length > 0
      ? `\nAdditional matching repository tree entries (metadata only):\n${context.matchingTreePaths
          .map((m) => `- ${m.path} [${m.status}] ${m.purpose}`)
          .join('\n')}`
      : '';

  const prompt = [
    'REPOSITORY ARCHITECTURE DIGEST:',
    context.architectureSummary,
    '',
    'RETRIEVED SOURCE FILE EXCERPTS (TOP MATCHED FILES ONLY):',
    sourceBlock,
    uncachedTreeNote,
    recentConversation ? `\nRECENT CONVERSATION:\n${recentConversation}` : '',
    '',
    `USER QUESTION:\n${cleanQuestion}`,
  ]
    .filter(Boolean)
    .join('\n');

  const systemInstruction = [
    'You are CodeRubric Repository Assistant answering questions strictly from verified repository analysis and retrieved source code excerpts.',
    'Rules:',
    '1. Ground every claim in the provided architecture digest and retrieved source file excerpts. Explicitly name exact file paths and symbol/function names you observed.',
    '2. Write clearly so someone new to the codebase can understand, then explain the technical flow (files, functions, routes, state, DB, auth) accurately.',
    '3. NEVER invent file paths, functions, API endpoints, database tables, or dependencies that are not present in the context.',
    '4. NEVER expose or guess API keys, secrets, tokens, or raw .env values. Only mention environment variable names if shown in code.',
    '5. If the provided files do not contain enough evidence to answer part or all of the question, clearly state what is missing or could not be verified from analyzed files, and set evidenceStatus to "insufficient" or "partial".',
  ].join('\n');

  const rawJson = await generateWithRetry({
    model: DEFAULT_GEMINI_MODEL,
    contents: prompt,
    systemInstruction,
    thinkingLevel: 'MEDIUM',
    maxOutputTokens: 4096,
    maxRetries: params.maxRetries,
    retryDelayMs: params.retryDelayMs,
    generateContentFn: params.generateContentFn,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        answer: {
          type: Type.STRING,
          description:
            'Clear, source-grounded explanation with beginner-friendly summary and exact technical details.',
        },
        evidenceStatus: {
          type: Type.STRING,
          description: 'Must be one of: grounded, partial, insufficient.',
        },
        insufficientEvidenceReason: {
          type: Type.STRING,
          description:
            'If evidenceStatus is partial or insufficient, explain concisely what information or unanalyzed files are missing.',
        },
        references: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              filePath: { type: Type.STRING },
              symbol: { type: Type.STRING },
              lineHint: { type: Type.STRING },
              reason: { type: Type.STRING },
            },
            required: ['filePath', 'reason'],
          },
        },
      },
      required: ['answer', 'evidenceStatus', 'references'],
    },
  });

  const parsed = parseGeminiJson<{
    answer?: string;
    evidenceStatus?: string;
    insufficientEvidenceReason?: string;
    references?: Array<{
      filePath?: string;
      symbol?: string;
      lineHint?: string;
      reason?: string;
    }>;
  }>(rawJson);

  const normalizedStatus: RepositoryChatEvidenceStatus =
    parsed.evidenceStatus === 'insufficient' || parsed.evidenceStatus === 'partial'
      ? parsed.evidenceStatus
      : 'grounded';

  // Verify every cited file path exists in the actual repository tree/cache
  const verifiedRefs: RepositoryChatReference[] = [];
  const seenRefs = new Set<string>();
  for (const ref of Array.isArray(parsed.references) ? parsed.references : []) {
    const rawPath = (ref?.filePath ?? '').trim().replace(/^\.\//, '').replace(/^\/+/, '');
    if (!rawPath) continue;
    const exactPath = validPathMap.get(rawPath.toLowerCase());
    if (!exactPath || seenRefs.has(exactPath)) continue;
    seenRefs.add(exactPath);
    verifiedRefs.push({
      filePath: exactPath,
      ...(typeof ref?.symbol === 'string' && ref.symbol.trim()
        ? { symbol: redactSensitiveText(ref.symbol.trim()) }
        : {}),
      ...(typeof ref?.lineHint === 'string' && ref.lineHint.trim()
        ? { lineHint: redactSensitiveText(ref.lineHint.trim()) }
        : {}),
      reason:
        typeof ref?.reason === 'string' && ref.reason.trim()
          ? redactSensitiveText(ref.reason.trim())
          : 'Referenced in repository intelligence context.',
    });
  }

  const answerText = redactSensitiveText(
    typeof parsed.answer === 'string' && parsed.answer.trim()
      ? parsed.answer.trim()
      : 'Insufficient evidence found in the currently analyzed repository files to answer this question accurately.'
  );

  const insufficientReason =
    typeof parsed.insufficientEvidenceReason === 'string' && parsed.insufficientEvidenceReason.trim()
      ? redactSensitiveText(parsed.insufficientEvidenceReason.trim())
      : undefined;

  return {
    answer: answerText,
    evidenceStatus: normalizedStatus,
    ...(insufficientReason ? { insufficientEvidenceReason: insufficientReason } : {}),
    references: verifiedRefs,
    retrievedFileCount: context.snippets.length,
  };
}

export function createChatMessageRecord(params: {
  role: 'user' | 'assistant';
  content: string;
  userId: string;
  repositoryId: string;
  references?: RepositoryChatReference[];
  evidenceStatus?: RepositoryChatEvidenceStatus;
  insufficientEvidenceReason?: string;
}): RepositoryChatMessage {
  return {
    id: `qa-${params.role}-${crypto.randomUUID().slice(0, 10)}`,
    role: params.role,
    content: redactSensitiveText(params.content),
    createdAt: new Date().toISOString(),
    userId: params.userId,
    repositoryId: params.repositoryId,
    references: params.references ?? [],
    ...(params.evidenceStatus ? { evidenceStatus: params.evidenceStatus } : {}),
    ...(params.insufficientEvidenceReason
      ? { insufficientEvidenceReason: params.insufficientEvidenceReason }
      : {}),
  };
}
