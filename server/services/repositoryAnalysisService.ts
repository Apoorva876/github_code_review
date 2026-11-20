import { Type } from '@google/genai';
import { addReview } from '../store.ts';
import type {
  AIAgent,
  AgentAttribution,
  CodeReview,
  CollectedSourceFile,
  RepositoryAgentExecutionResult,
  RepositoryAgentExecutionSummary,
  RepositoryAgentFinding,
  RepositoryAnalysisOverallStatus,
  RepositoryAnalysisResult,
  RepositoryCollectionCoverageSummary,
  RepositoryCollectionReport,
  RepositorySynthesisStatus,
  ReviewStatus,
  RubricBreakdown,
  Severity,
  SourceBatch,
  SourceChunk,
} from '../types.ts';
import {
  clampScore,
  generateWithRetry,
  normalizeCategory,
  normalizeReviewStatus,
  normalizeSeverity,
  parseGeminiJson,
  toSafeGeminiErrorMessage,
  type GeminiGenerateFn,
} from './geminiReviewService.ts';

export const DEFAULT_ANALYSIS_LIMITS = {
  maxConcurrency: 3,
  maxChunkChars: 18000,
  maxBatchChars: 28000,
  overlapLines: 12,
  maxAgentOutputTokens: 6144,
  maxSynthesisOutputTokens: 4096,
  maxRetries: 2,
  retryDelayMs: 600,
} as const;

export interface RepositoryAnalysisProgressEvent {
  stage: 'running_agents' | 'synthesizing';
  totalAgents: number;
  completedAgents: number;
  failedAgents: number;
  totalChunks: number;
  completedChunks: number;
  currentStep: string;
  message: string;
  agentBreakdown?: RepositoryAgentExecutionSummary[];
}

export interface RepositoryAnalysisOptions {
  maxConcurrency?: number;
  maxChunkChars?: number;
  maxBatchChars?: number;
  overlapLines?: number;
  maxAgentOutputTokens?: number;
  maxSynthesisOutputTokens?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  generateContentFn?: GeminiGenerateFn;
  onProgress?: (event: RepositoryAnalysisProgressEvent) => void;
}

interface NumberedLine {
  lineNumber: number;
  text: string;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'when',
  'where',
  'have',
  'been',
  'will',
  'your',
  'code',
  'file',
  'line',
  'should',
  'could',
  'without',
  'missing',
  'using',
]);

function parseNumberedSourceLines(file: CollectedSourceFile): NumberedLine[] {
  const rawLines = file.content.replace(/\r\n/g, '\n').split('\n');
  const startIdx = rawLines[0]?.startsWith('FILE: ') ? 1 : 0;
  const parsed: NumberedLine[] = [];

  for (let i = startIdx; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    const match = line.match(/^\[(\d+)\]\s?(.*)$/);
    if (match) {
      parsed.push({
        lineNumber: Number(match[1]),
        text: match[2],
      });
    } else if (line.length > 0 || i < rawLines.length - 1) {
      parsed.push({
        lineNumber: parsed.length + 1,
        text: line,
      });
    }
  }

  if (parsed.length === 0) {
    return [{ lineNumber: 1, text: '' }];
  }
  return parsed;
}

function isLogicalBoundaryLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^(export\s+)?(async\s+)?(function|class|interface|type|enum|def|func|fn|struct|impl|public|private|protected)\b/.test(
    trimmed
  );
}

export function chunkCollectedSources(
  collectedFiles: CollectedSourceFile[],
  options?: {
    maxChunkChars?: number;
    maxBatchChars?: number;
    overlapLines?: number;
  }
): { chunks: SourceChunk[]; batches: SourceBatch[] } {
  const maxChunkChars = Math.max(400, options?.maxChunkChars ?? DEFAULT_ANALYSIS_LIMITS.maxChunkChars);
  const maxBatchChars = Math.max(
    maxChunkChars,
    options?.maxBatchChars ?? DEFAULT_ANALYSIS_LIMITS.maxBatchChars
  );
  const overlapLines = Math.max(0, Math.min(50, options?.overlapLines ?? DEFAULT_ANALYSIS_LIMITS.overlapLines));

  const allChunks: SourceChunk[] = [];

  for (const file of collectedFiles) {
    const lines = parseNumberedSourceLines(file);
    const fileSlices: Array<{ lines: NumberedLine[] }> = [];

    let cursor = 0;
    while (cursor < lines.length) {
      let endIdx = cursor;
      let runningChars = `FILE: ${file.path}\n`.length;

      while (endIdx < lines.length) {
        const formattedLine = `[${lines[endIdx].lineNumber}] ${lines[endIdx].text}\n`;
        const nextChars = runningChars + formattedLine.length;
        if (nextChars > maxChunkChars && endIdx > cursor) {
          break;
        }
        runningChars = nextChars;
        endIdx += 1;
      }

      // If splitting before EOF, prefer backing up to a logical function/class/blank boundary
      if (endIdx < lines.length && endIdx - cursor > 6) {
        const minPreferredCut = cursor + Math.max(1, Math.floor((endIdx - cursor) * 0.65));
        for (let probe = endIdx - 1; probe >= minPreferredCut; probe -= 1) {
          if (isLogicalBoundaryLine(lines[probe].text)) {
            if (probe > cursor) {
              endIdx = probe;
            }
            break;
          }
        }
      }

      fileSlices.push({ lines: lines.slice(cursor, endIdx) });
      if (endIdx >= lines.length) {
        break;
      }

      const nextCursor = Math.max(cursor + 1, endIdx - overlapLines);
      cursor = nextCursor;
    }

    const totalFileChunks = fileSlices.length;
    fileSlices.forEach((slice, idx) => {
      const lineStart = slice.lines[0]?.lineNumber ?? 1;
      const lineEnd = slice.lines[slice.lines.length - 1]?.lineNumber ?? lineStart;
      const header =
        totalFileChunks > 1
          ? `FILE: ${file.path} (lines ${lineStart}-${lineEnd}, chunk ${idx + 1}/${totalFileChunks})`
          : `FILE: ${file.path} (lines ${lineStart}-${lineEnd})`;
      const body = slice.lines.map((l) => `[${l.lineNumber}] ${l.text}`).join('\n');
      const content = `${header}\n${body}`;

      allChunks.push({
        chunkId: `${file.path}#${lineStart}-${lineEnd}`,
        filePath: file.path,
        language: file.language,
        chunkIndex: idx + 1,
        totalFileChunks,
        lineStart,
        lineEnd,
        charCount: content.length,
        content,
      });
    });
  }

  // Pack chunks into token-safe request batches without dropping any chunk
  const batches: SourceBatch[] = [];
  let currentChunks: SourceChunk[] = [];
  let currentChars = 0;

  const flushBatch = () => {
    if (currentChunks.length === 0) return;
    const filePaths = Array.from(new Set(currentChunks.map((c) => c.filePath)));
    const promptText = currentChunks.map((c) => c.content).join('\n\n');
    batches.push({
      batchIndex: batches.length + 1,
      chunks: currentChunks,
      filePaths,
      totalChars: promptText.length,
      promptText,
    });
    currentChunks = [];
    currentChars = 0;
  };

  for (const chunk of allChunks) {
    if (currentChunks.length > 0 && currentChars + chunk.charCount + 2 > maxBatchChars) {
      flushBatch();
    }
    currentChunks.push(chunk);
    currentChars += chunk.charCount + 2;
  }
  flushBatch();

  return { chunks: allChunks, batches };
}

function normalizeRepoPath(rawPath: string): string {
  return rawPath.trim().replace(/^\.\//, '').replace(/^\/+/, '');
}

function resolveCollectedFile(
  rawPath: unknown,
  fileMap: Map<string, CollectedSourceFile>,
  lowerFileMap: Map<string, CollectedSourceFile>
): CollectedSourceFile | null {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return null;
  const clean = normalizeRepoPath(rawPath);
  return fileMap.get(clean) ?? lowerFileMap.get(clean.toLowerCase()) ?? null;
}

function stripNumberedFileHeader(file: CollectedSourceFile): string {
  return file.content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .slice(1)
    .map((line) => line.replace(/^\[\d+\]\s?/, ''))
    .join('\n');
}

function snippetAppearsInFile(snippet: string, file: CollectedSourceFile): boolean {
  const cleanSnippet = snippet.trim();
  if (cleanSnippet.length < 6) return false;
  const normalizedFile = stripNumberedFileHeader(file).replace(/\s+/g, ' ').trim();
  const normalizedSnippet = cleanSnippet.replace(/\s+/g, ' ').trim();
  return normalizedFile.includes(normalizedSnippet);
}

function normalizePositiveLine(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isInteger(num)) return null;
  return num;
}

function tokenizeForSimilarity(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length >= 3 && !STOP_WORDS.has(tok));
  return new Set(tokens);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function linesOverlapOrAdjacent(a: RepositoryAgentFinding, b: RepositoryAgentFinding): boolean {
  if (a.lineStart !== null && b.lineStart !== null) {
    const aEnd = a.lineEnd ?? a.lineStart;
    const bEnd = b.lineEnd ?? b.lineStart;
    return a.lineStart <= bEnd + 2 && b.lineStart <= aEnd + 2;
  }
  if (a.lineStart === null && b.lineStart === null) {
    const snipA = a.codeSnippet.replace(/\s+/g, ' ').trim();
    const snipB = b.codeSnippet.replace(/\s+/g, ' ').trim();
    return Boolean(snipA && snipB && (snipA === snipB || snipA.includes(snipB) || snipB.includes(snipA)));
  }
  return false;
}

function areDuplicateFindings(a: RepositoryAgentFinding, b: RepositoryAgentFinding): boolean {
  if (a.filePath !== b.filePath) return false;
  if (!linesOverlapOrAdjacent(a, b)) return false;

  const tokensA = tokenizeForSimilarity(`${a.title} ${a.explanation} ${a.evidence} ${a.codeSnippet}`);
  const tokensB = tokenizeForSimilarity(`${b.title} ${b.explanation} ${b.evidence} ${b.codeSnippet}`);
  const similarity = jaccardSimilarity(tokensA, tokensB);

  const snipA = a.codeSnippet.replace(/\s+/g, ' ').trim();
  const snipB = b.codeSnippet.replace(/\s+/g, ' ').trim();
  const sameSnippet =
    snipA.length >= 8 &&
    snipB.length >= 8 &&
    (snipA === snipB || snipA.includes(snipB) || snipB.includes(snipA));

  if (a.category === b.category && (similarity >= 0.32 || sameSnippet)) {
    return true;
  }
  return similarity >= 0.5;
}

export function deduplicateRepositoryFindings(
  findings: RepositoryAgentFinding[]
): RepositoryAgentFinding[] {
  const merged: RepositoryAgentFinding[] = [];

  for (const incoming of findings) {
    const matchIdx = merged.findIndex((existing) => areDuplicateFindings(existing, incoming));
    if (matchIdx === -1) {
      merged.push({
        ...incoming,
        contributingAgents: [...incoming.contributingAgents],
      });
      continue;
    }

    const current = merged[matchIdx];
    const preferIncoming = SEVERITY_RANK[incoming.severity] > SEVERITY_RANK[current.severity];

    const attrMap = new Map<string, AgentAttribution>();
    for (const attr of [...current.contributingAgents, ...incoming.contributingAgents]) {
      if (!attrMap.has(attr.agentId)) {
        attrMap.set(attr.agentId, attr);
      }
    }

    let nextStart = current.lineStart;
    let nextEnd = current.lineEnd;
    if (current.lineStart !== null && incoming.lineStart !== null) {
      nextStart = Math.min(current.lineStart, incoming.lineStart);
      nextEnd = Math.max(current.lineEnd ?? current.lineStart, incoming.lineEnd ?? incoming.lineStart);
    } else if (current.lineStart === null && incoming.lineStart !== null) {
      nextStart = incoming.lineStart;
      nextEnd = incoming.lineEnd;
    }

    merged[matchIdx] = {
      ...current,
      title: preferIncoming ? incoming.title : current.title,
      severity: preferIncoming ? incoming.severity : current.severity,
      category: preferIncoming ? incoming.category : current.category,
      lineStart: nextStart,
      lineEnd: nextEnd,
      explanation:
        incoming.explanation.length > current.explanation.length
          ? incoming.explanation
          : current.explanation,
      suggestedFix:
        incoming.suggestedFix.length > current.suggestedFix.length
          ? incoming.suggestedFix
          : current.suggestedFix,
      codeSnippet:
        incoming.codeSnippet.length > current.codeSnippet.length
          ? incoming.codeSnippet
          : current.codeSnippet,
      evidence:
        incoming.evidence.length > current.evidence.length ? incoming.evidence : current.evidence,
      confidence:
        current.confidence === 'confirmed' || incoming.confidence === 'confirmed'
          ? 'confirmed'
          : 'potential',
      agentId: preferIncoming ? incoming.agentId : current.agentId,
      agentName: preferIncoming ? incoming.agentName : current.agentName,
      contributingAgents: Array.from(attrMap.values()),
    };
  }

  return merged.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    const pathDiff = a.filePath.localeCompare(b.filePath);
    if (pathDiff !== 0) return pathDiff;
    return (a.lineStart ?? Number.MAX_SAFE_INTEGER) - (b.lineStart ?? Number.MAX_SAFE_INTEGER);
  });
}

interface RawAgentBatchPayload {
  agentId?: unknown;
  agentName?: unknown;
  summary?: unknown;
  findings?: unknown;
  strengths?: unknown;
  filesReviewed?: unknown;
  analysisStatus?: unknown;
}

async function runSingleAgentAcrossBatches(params: {
  agent: AIAgent;
  repositoryFullName: string;
  branch: string;
  analyzedCommitSha: string;
  coverageComplete: boolean;
  batches: SourceBatch[];
  fileMap: Map<string, CollectedSourceFile>;
  lowerFileMap: Map<string, CollectedSourceFile>;
  options: RepositoryAnalysisOptions;
  onBatchComplete?: (chunksInBatch: number) => void;
}): Promise<RepositoryAgentExecutionResult> {
  const startedAt = Date.now();
  const { agent, batches, fileMap, lowerFileMap } = params;

  const systemInstruction = [
    agent.systemPrompt,
    '',
    'REPOSITORY ANALYSIS GROUNDING RULES:',
    `- You are "${agent.name}" (agentId: "${agent.id}", focus: "${agent.focus}", strictness: "${agent.strictness}").`,
    '- Base every finding strictly on the numbered source files provided in this prompt.',
    '- Never invent file paths, line numbers, functions, dependencies, or vulnerabilities.',
    '- Cite exact original line numbers from the `[lineNumber]` prefixes. If exact lines cannot be verified, return null for lineStart and lineEnd.',
    '- Distinguish confirmed issues (confidence: "confirmed") from potential risks (confidence: "potential").',
    '- Do not report missing features unless the supplied code contains direct evidence.',
    '- Keep your JSON concise and well-formed within the output token limit.',
  ].join('\n');

  const batchSummaries: string[] = [];
  const rawValidatedFindings: RepositoryAgentFinding[] = [];
  const strengthSet = new Set<string>();
  const reviewedSet = new Set<string>();
  let rejectedFindingsCount = 0;

  try {
    for (const batch of batches) {
      const prompt = [
        `Repository: ${params.repositoryFullName}`,
        `Branch: ${params.branch}`,
        `Commit SHA: ${params.analyzedCommitSha}`,
        `Collection Coverage Complete: ${params.coverageComplete ? 'yes' : 'no (partial collection)'}`,
        `Batch: ${batch.batchIndex} of ${batches.length}`,
        `Agent: ${agent.name} (${agent.id}) | Strictness: ${agent.strictness}`,
        '',
        'Analyze ONLY the source code below. Return valid JSON matching the schema.',
        '',
        batch.promptText,
      ].join('\n');

      const rawText = await generateWithRetry({
        model: agent.model,
        contents: prompt,
        systemInstruction,
        thinkingLevel: agent.thinkingLevel,
        maxOutputTokens:
          params.options.maxAgentOutputTokens ?? DEFAULT_ANALYSIS_LIMITS.maxAgentOutputTokens,
        maxRetries: params.options.maxRetries ?? DEFAULT_ANALYSIS_LIMITS.maxRetries,
        retryDelayMs: params.options.retryDelayMs ?? DEFAULT_ANALYSIS_LIMITS.retryDelayMs,
        generateContentFn: params.options.generateContentFn,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            agentId: { type: Type.STRING },
            agentName: { type: Type.STRING },
            summary: { type: Type.STRING },
            analysisStatus: { type: Type.STRING },
            strengths: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            filesReviewed: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            findings: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  severity: {
                    type: Type.STRING,
                    description: 'Critical, High, Medium, or Low.',
                  },
                  category: {
                    type: Type.STRING,
                    description:
                      'Security, Reliability, Performance, Maintainability, Testing, or Documentation.',
                  },
                  filePath: { type: Type.STRING },
                  lineStart: { type: Type.INTEGER, nullable: true },
                  lineEnd: { type: Type.INTEGER, nullable: true },
                  explanation: { type: Type.STRING },
                  suggestedFix: { type: Type.STRING },
                  codeSnippet: { type: Type.STRING },
                  evidence: { type: Type.STRING },
                  confidence: {
                    type: Type.STRING,
                    description: 'confirmed or potential.',
                  },
                },
                required: [
                  'title',
                  'severity',
                  'category',
                  'filePath',
                  'explanation',
                  'suggestedFix',
                  'codeSnippet',
                  'evidence',
                ],
              },
            },
          },
          required: ['summary', 'findings', 'strengths', 'filesReviewed', 'analysisStatus'],
        },
      });

      const parsed = parseGeminiJson<RawAgentBatchPayload>(rawText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Agent ${agent.name} returned an invalid JSON object.`);
      }
      if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
        throw new Error(`Agent ${agent.name} returned a response missing summary.`);
      }

      batchSummaries.push(parsed.summary.trim());

      if (Array.isArray(parsed.strengths)) {
        for (const item of parsed.strengths) {
          if (typeof item === 'string' && item.trim()) {
            strengthSet.add(item.trim());
          }
        }
      }

      const candidateReviewed = Array.isArray(parsed.filesReviewed) ? parsed.filesReviewed : [];
      for (const f of candidateReviewed) {
        const matched = resolveCollectedFile(f, fileMap, lowerFileMap);
        if (matched) reviewedSet.add(matched.path);
      }
      for (const pathInBatch of batch.filePaths) {
        reviewedSet.add(pathInBatch);
      }

      const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
      for (let idx = 0; idx < rawFindings.length; idx += 1) {
        const item = rawFindings[idx] as Record<string, unknown> | null;
        if (!item || typeof item !== 'object') {
          rejectedFindingsCount += 1;
          continue;
        }

        const matchedFile = resolveCollectedFile(item.filePath, fileMap, lowerFileMap);
        if (!matchedFile) {
          rejectedFindingsCount += 1;
          continue;
        }

        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
        if (!title || !explanation) {
          rejectedFindingsCount += 1;
          continue;
        }

        const codeSnippet = typeof item.codeSnippet === 'string' ? item.codeSnippet : '';
        const evidence =
          typeof item.evidence === 'string' && item.evidence.trim()
            ? item.evidence.trim()
            : codeSnippet.trim() || explanation;

        let lineStart = normalizePositiveLine(item.lineStart);
        let lineEnd = normalizePositiveLine(item.lineEnd);

        const rawStartProvided = item.lineStart !== null && item.lineStart !== undefined && item.lineStart !== '';
        const rawEndProvided = item.lineEnd !== null && item.lineEnd !== undefined && item.lineEnd !== '';

        const startInvalid =
          rawStartProvided &&
          (lineStart === null || lineStart < 1 || lineStart > matchedFile.lineCount);
        const endInvalid =
          rawEndProvided &&
          (lineEnd === null ||
            lineEnd < 1 ||
            lineEnd > matchedFile.lineCount ||
            (lineStart !== null && lineEnd < lineStart));

        if (startInvalid || endInvalid) {
          // Reject impossible line numbers; drop entire finding unless grounded via matching source snippet
          if (snippetAppearsInFile(codeSnippet, matchedFile)) {
            lineStart = null;
            lineEnd = null;
          } else {
            rejectedFindingsCount += 1;
            continue;
          }
        } else if (lineStart !== null && lineEnd === null) {
          lineEnd = lineStart;
        } else if (lineStart === null && lineEnd !== null) {
          lineEnd = null;
        }

        const confidenceRaw =
          typeof item.confidence === 'string' ? item.confidence.trim().toLowerCase() : '';
        const confidence: 'confirmed' | 'potential' =
          confidenceRaw === 'potential' ? 'potential' : 'confirmed';

        rawValidatedFindings.push({
          id: `find-${agent.id}-${Date.now()}-${rawValidatedFindings.length + 1}`,
          title,
          severity: normalizeSeverity(item.severity),
          category: normalizeCategory(item.category),
          filePath: matchedFile.path,
          lineStart,
          lineEnd,
          explanation,
          suggestedFix: typeof item.suggestedFix === 'string' ? item.suggestedFix.trim() : '',
          codeSnippet,
          evidence,
          confidence,
          resolved: false,
          agentId: agent.id,
          agentName: agent.name,
          contributingAgents: [{ agentId: agent.id, agentName: agent.name }],
        });
      }

      if (params.onBatchComplete) {
        try {
          params.onBatchComplete(batch.chunks.length);
        } catch {
          // Ignore progress callback failures
        }
      }
    }

    const dedupedAgentFindings = deduplicateRepositoryFindings(rawValidatedFindings);

    return {
      agentId: agent.id,
      agentName: agent.name,
      model: agent.model,
      strictness: agent.strictness,
      thinkingLevel: agent.thinkingLevel,
      analysisStatus: 'completed',
      summary: batchSummaries.join(' ').slice(0, 2000),
      findings: dedupedAgentFindings,
      strengths: Array.from(strengthSet),
      filesReviewed: Array.from(reviewedSet),
      chunksAnalyzed: batches.reduce((sum, b) => sum + b.chunks.length, 0),
      rejectedFindingsCount,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      model: agent.model,
      strictness: agent.strictness,
      thinkingLevel: agent.thinkingLevel,
      analysisStatus: 'failed',
      summary: '',
      findings: [],
      strengths: [],
      filesReviewed: [],
      chunksAnalyzed: 0,
      rejectedFindingsCount,
      durationMs: Date.now() - startedAt,
      error: toSafeGeminiErrorMessage(err),
    };
  }
}

interface RawSynthesisPayload {
  summary?: unknown;
  score?: unknown;
  recommendedStatus?: unknown;
  rubricBreakdown?: Partial<RubricBreakdown>;
  strengths?: unknown;
}

export async function analyzeRepositoryWithAgents(params: {
  collectionReport: RepositoryCollectionReport;
  agents: AIAgent[];
  options?: RepositoryAnalysisOptions;
}): Promise<RepositoryAnalysisResult> {
  const startedAt = Date.now();
  const options = params.options ?? {};
  const { collectionReport, agents } = params;

  if (!collectionReport || !Array.isArray(collectionReport.collectedFiles)) {
    throw new Error('A valid RepositoryCollectionReport is required.');
  }
  if (collectionReport.collectedFiles.length === 0) {
    throw new Error('No collected source files are available to analyze.');
  }

  const enabledAgents = agents.filter((a) => a.enabled);
  const disabledAgents = agents.filter((a) => !a.enabled);

  if (enabledAgents.length === 0) {
    throw new Error('At least one AI agent must be enabled to analyze the repository.');
  }

  const fileMap = new Map<string, CollectedSourceFile>();
  const lowerFileMap = new Map<string, CollectedSourceFile>();
  for (const file of collectionReport.collectedFiles) {
    const clean = normalizeRepoPath(file.path);
    fileMap.set(clean, file);
    lowerFileMap.set(clean.toLowerCase(), file);
  }

  const { chunks, batches } = chunkCollectedSources(collectionReport.collectedFiles, {
    maxChunkChars: options.maxChunkChars,
    maxBatchChars: options.maxBatchChars,
    overlapLines: options.overlapLines,
  });

  const concurrencyLimit = Math.max(
    1,
    Math.min(
      DEFAULT_ANALYSIS_LIMITS.maxConcurrency,
      options.maxConcurrency ?? DEFAULT_ANALYSIS_LIMITS.maxConcurrency
    )
  );

  // Execute enabled agents with controlled concurrency (strictly <= 3)
  const completedAgentResults: RepositoryAgentExecutionResult[] = new Array(enabledAgents.length);
  let nextAgentIdx = 0;
  const totalUnitChunks = Math.max(1, chunks.length * enabledAgents.length);
  let completedUnitChunks = 0;
  let completedAgentsCount = 0;
  let failedAgentsCount = 0;

  const emitProgress = (event: RepositoryAnalysisProgressEvent) => {
    if (!options.onProgress) return;
    try {
      options.onProgress(event);
    } catch {
      // Never allow progress listeners to disrupt analysis
    }
  };

  emitProgress({
    stage: 'running_agents',
    totalAgents: enabledAgents.length,
    completedAgents: 0,
    failedAgents: 0,
    totalChunks: chunks.length,
    completedChunks: 0,
    currentStep: 'running_agents',
    message: `Running ${enabledAgents.length} enabled AI agent${enabledAgents.length === 1 ? '' : 's'} across ${chunks.length} source chunk${chunks.length === 1 ? '' : 's'}.`,
  });

  const worker = async () => {
    while (true) {
      const idx = nextAgentIdx;
      nextAgentIdx += 1;
      if (idx >= enabledAgents.length) break;

      const agent = enabledAgents[idx];
      const result = await runSingleAgentAcrossBatches({
        agent,
        repositoryFullName: collectionReport.repositoryFullName,
        branch: collectionReport.branch,
        analyzedCommitSha: collectionReport.analyzedCommitSha,
        coverageComplete: collectionReport.coverageComplete,
        batches,
        fileMap,
        lowerFileMap,
        options,
        onBatchComplete: (chunksInBatch) => {
          completedUnitChunks += chunksInBatch;
          const approxChunks = Math.min(
            chunks.length,
            Math.floor((completedUnitChunks / totalUnitChunks) * chunks.length)
          );
          emitProgress({
            stage: 'running_agents',
            totalAgents: enabledAgents.length,
            completedAgents: completedAgentsCount,
            failedAgents: failedAgentsCount,
            totalChunks: chunks.length,
            completedChunks: approxChunks,
            currentStep: 'running_agents',
            message: `${agent.name} completed source batch (${completedAgentsCount + failedAgentsCount}/${enabledAgents.length} agents finished).`,
          });
        },
      });

      completedAgentResults[idx] = result;
      if (result.analysisStatus === 'completed') {
        completedAgentsCount += 1;
      } else {
        failedAgentsCount += 1;
      }

      const approxChunks = Math.min(
        chunks.length,
        Math.floor((completedUnitChunks / totalUnitChunks) * chunks.length)
      );
      emitProgress({
        stage: 'running_agents',
        totalAgents: enabledAgents.length,
        completedAgents: completedAgentsCount,
        failedAgents: failedAgentsCount,
        totalChunks: chunks.length,
        completedChunks: approxChunks,
        currentStep: 'running_agents',
        message:
          result.analysisStatus === 'completed'
            ? `${agent.name} finished (${completedAgentsCount}/${enabledAgents.length} completed).`
            : `${agent.name} failed (${failedAgentsCount} failed); continuing remaining agents.`,
      });
    }
  };

  const workerCount = Math.min(concurrencyLimit, enabledAgents.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const skippedAgentResults: RepositoryAgentExecutionResult[] = disabledAgents.map((agent) => ({
    agentId: agent.id,
    agentName: agent.name,
    model: agent.model,
    strictness: agent.strictness,
    thinkingLevel: agent.thinkingLevel,
    analysisStatus: 'skipped',
    summary: 'Agent is disabled in workspace configuration.',
    findings: [],
    strengths: [],
    filesReviewed: [],
    chunksAnalyzed: 0,
    rejectedFindingsCount: 0,
    durationMs: 0,
  }));

  const agentById = new Map<string, RepositoryAgentExecutionResult>();
  for (const r of [...completedAgentResults, ...skippedAgentResults]) {
    agentById.set(r.agentId, r);
  }
  const orderedAgentResults = agents
    .map((a) => agentById.get(a.id))
    .filter((r): r is RepositoryAgentExecutionResult => Boolean(r));

  const succeededAgents = completedAgentResults.filter((r) => r.analysisStatus === 'completed');
  const failedAgents = completedAgentResults.filter((r) => r.analysisStatus === 'failed');

  const agentBreakdown: RepositoryAgentExecutionSummary[] = orderedAgentResults.map((r) => ({
    agentId: r.agentId,
    agentName: r.agentName,
    model: r.model,
    strictness: r.strictness,
    thinkingLevel: r.thinkingLevel,
    analysisStatus: r.analysisStatus,
    summary: r.summary,
    findingsCount: r.findings.length,
    strengths: r.strengths,
    filesReviewedCount: r.filesReviewed.length,
    chunksAnalyzed: r.chunksAnalyzed,
    durationMs: r.durationMs,
    ...(r.error ? { error: r.error } : {}),
  }));

  const totalFilesAnalyzed = new Set(
    succeededAgents.flatMap((r) => r.filesReviewed)
  ).size || (succeededAgents.length > 0 ? collectionReport.filesCollected : 0);

  const collectionCoverage: RepositoryCollectionCoverageSummary = {
    totalTreeEntries: collectionReport.totalTreeEntries,
    eligibleFiles: collectionReport.eligibleFiles,
    filesCollected: collectionReport.filesCollected,
    filesSkipped: collectionReport.filesSkipped,
    filesTruncated: collectionReport.filesTruncated,
    failedFiles: collectionReport.failedFiles,
    totalBytesCollected: collectionReport.totalBytesCollected,
    truncationDetected: collectionReport.truncationDetected,
    coverageComplete: collectionReport.coverageComplete,
    totalFilesAnalyzed,
    totalChunksAnalyzed: succeededAgents.length > 0 ? chunks.length : 0,
  };

  const mergedFindings = deduplicateRepositoryFindings(
    succeededAgents.flatMap((r) => r.findings)
  );

  const mergedStrengths = Array.from(
    new Set(succeededAgents.flatMap((r) => r.strengths).map((s) => s.trim()).filter(Boolean))
  );

  if (succeededAgents.length === 0) {
    return {
      repositoryFullName: collectionReport.repositoryFullName,
      branch: collectionReport.branch,
      analyzedCommitSha: collectionReport.analyzedCommitSha,
      summary: 'Repository analysis failed because all enabled AI agents failed to complete.',
      score: null,
      recommendedStatus: 'in_review',
      rubricBreakdown: null,
      findings: [],
      strengths: [],
      agentBreakdown,
      agentResults: orderedAgentResults,
      collectionCoverage,
      analysisStatus: 'failed',
      synthesisStatus: 'skipped',
      allAgentsSucceeded: false,
      enabledAgentsCount: enabledAgents.length,
      succeededAgentsCount: 0,
      failedAgentsCount: failedAgents.length,
      skippedAgentsCount: skippedAgentResults.length,
      totalFilesCollected: collectionReport.filesCollected,
      totalFilesAnalyzed: 0,
      totalChunksAnalyzed: 0,
      persisted: false,
      durationMs: Date.now() - startedAt,
      error: failedAgents.map((f) => `${f.agentName}: ${f.error}`).join('; '),
    };
  }

  // Synthesize final repository-level review via Gemini
  emitProgress({
    stage: 'synthesizing',
    totalAgents: enabledAgents.length,
    completedAgents: succeededAgents.length,
    failedAgents: failedAgents.length,
    totalChunks: chunks.length,
    completedChunks: chunks.length,
    currentStep: 'synthesizing',
    message: `Synthesizing repository review from ${succeededAgents.length}/${enabledAgents.length} agent reports (${mergedFindings.length} deduplicated findings).`,
    agentBreakdown,
  });

  const coverageLimitations: string[] = [];
  if (!collectionReport.coverageComplete) {
    coverageLimitations.push(
      `Incomplete repository coverage: ${collectionReport.filesCollected}/${collectionReport.eligibleFiles} eligible files collected (${collectionReport.filesSkipped} skipped, ${collectionReport.filesTruncated} truncated, ${collectionReport.failedFiles} failed, treeTruncated=${collectionReport.truncationDetected}).`
    );
  }
  if (failedAgents.length > 0) {
    coverageLimitations.push(
      `Partial agent execution: ${failedAgents.length}/${enabledAgents.length} enabled agents failed (${failedAgents.map((a) => a.agentName).join(', ')}).`
    );
  }

  const synthesisPrompt = [
    `Repository: ${collectionReport.repositoryFullName}`,
    `Branch: ${collectionReport.branch}`,
    `Analyzed Commit SHA: ${collectionReport.analyzedCommitSha}`,
    `Files Collected: ${collectionReport.filesCollected} / ${collectionReport.eligibleFiles} eligible (${collectionReport.totalTreeEntries} total tree entries)`,
    `Collection Coverage Complete: ${collectionReport.coverageComplete}`,
    `Chunks Analyzed: ${chunks.length}`,
    `Enabled Agents Succeeded: ${succeededAgents.length} / ${enabledAgents.length}`,
    coverageLimitations.length > 0
      ? `IMPORTANT LIMITATIONS:\n- ${coverageLimitations.join('\n- ')}`
      : 'Coverage: Complete for all eligible source files.',
    '',
    'AGENT SUMMARIES:',
    ...succeededAgents.map(
      (a) =>
        `- ${a.agentName} (${a.findings.length} findings): ${a.summary}`
    ),
    ...(failedAgents.length > 0
      ? [
          '',
          'FAILED AGENTS:',
          ...failedAgents.map((a) => `- ${a.agentName}: ${a.error || 'Failed'}`),
        ]
      : []),
    '',
    `DEDUPLICATED FINDINGS (${mergedFindings.length}):`,
    ...mergedFindings.slice(0, 40).map(
      (f, idx) =>
        `${idx + 1}. [${f.severity.toUpperCase()}][${f.category}] ${f.filePath}:${f.lineStart ?? 'null'} — ${f.title} (Agents: ${f.contributingAgents.map((c) => c.agentName).join(', ')})`
    ),
    '',
    'STRENGTHS OBSERVED:',
    ...(mergedStrengths.length > 0 ? mergedStrengths.slice(0, 15).map((s) => `- ${s}`) : ['- None explicitly highlighted']),
    '',
    'Synthesize a balanced, evidence-grounded repository review. Do NOT award 100 purely because no issues were found. If coverage is incomplete or agents failed, state that limitation clearly in summary and keep status conservative.',
  ].join('\n');

  let synthesisStatus: RepositorySynthesisStatus = 'completed';
  let synthesisError: string | undefined;
  let finalSummary = '';
  let finalScore: number | null = null;
  let finalStatus: ReviewStatus = 'in_review';
  let finalBreakdown: RubricBreakdown | null = null;
  let finalStrengths = mergedStrengths;

  try {
    const rawSynthesis = await generateWithRetry({
      model: 'gemini-4-hydrogen',
      contents: synthesisPrompt,
      systemInstruction:
        'You are the CodeRubric Principal Engineering Synthesizer. Combine multi-agent audit outputs into a calibrated repository-level rubric score, breakdown, status, and concise executive summary. Never fabricate issues or grant a 100 score by default.',
      thinkingLevel: 'MEDIUM',
      maxOutputTokens:
        options.maxSynthesisOutputTokens ?? DEFAULT_ANALYSIS_LIMITS.maxSynthesisOutputTokens,
      maxRetries: options.maxRetries ?? DEFAULT_ANALYSIS_LIMITS.maxRetries,
      retryDelayMs: options.retryDelayMs ?? DEFAULT_ANALYSIS_LIMITS.retryDelayMs,
      generateContentFn: options.generateContentFn,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          score: { type: Type.INTEGER },
          recommendedStatus: {
            type: Type.STRING,
            description: 'Must be one of: approved, changes_requested, in_review.',
          },
          rubricBreakdown: {
            type: Type.OBJECT,
            properties: {
              security: { type: Type.INTEGER },
              reliability: { type: Type.INTEGER },
              maintainability: { type: Type.INTEGER },
              performance: { type: Type.INTEGER },
            },
            required: ['security', 'reliability', 'maintainability', 'performance'],
          },
          strengths: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['summary', 'score', 'recommendedStatus', 'rubricBreakdown', 'strengths'],
      },
    });

    const parsed = parseGeminiJson<RawSynthesisPayload>(rawSynthesis);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Synthesis returned an invalid JSON payload.');
    }
    if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
      throw new Error('Synthesis returned an empty summary.');
    }

    const breakdown: RubricBreakdown = {
      security: clampScore(parsed.rubricBreakdown?.security, 82),
      reliability: clampScore(parsed.rubricBreakdown?.reliability, 82),
      maintainability: clampScore(parsed.rubricBreakdown?.maintainability, 82),
      performance: clampScore(parsed.rubricBreakdown?.performance, 82),
    };

    let computedScore = clampScore(
      parsed.score,
      Math.round(
        (breakdown.security +
          breakdown.reliability +
          breakdown.maintainability +
          breakdown.performance) /
          4
      )
    );

    // Guard against naive perfect 100 scores when zero findings or incomplete coverage exist
    if (
      computedScore === 100 &&
      (mergedFindings.length === 0 || !collectionReport.coverageComplete || failedAgents.length > 0)
    ) {
      const avgPillar = Math.round(
        (breakdown.security +
          breakdown.reliability +
          breakdown.maintainability +
          breakdown.performance) /
          4
      );
      computedScore = avgPillar < 100 ? avgPillar : 95;
    }

    const hasCritical = mergedFindings.some((f) => f.severity === 'critical');
    let recommended = normalizeReviewStatus(parsed.recommendedStatus, computedScore);
    if (hasCritical && recommended === 'approved') {
      recommended = 'changes_requested';
    }
    if ((!collectionReport.coverageComplete || failedAgents.length > 0) && recommended === 'approved') {
      recommended = 'in_review';
    }

    let summaryText = parsed.summary.trim();
    if (
      coverageLimitations.length > 0 &&
      !/incomplete|partial|skipped|truncated|failed/i.test(summaryText)
    ) {
      summaryText = `${summaryText} Note: ${coverageLimitations.join(' ')}`;
    }

    if (Array.isArray(parsed.strengths)) {
      const synthStrengths = parsed.strengths
        .filter((s): s is string => typeof s === 'string' && Boolean(s.trim()))
        .map((s) => s.trim());
      if (synthStrengths.length > 0) {
        finalStrengths = Array.from(new Set([...synthStrengths, ...mergedStrengths]));
      }
    }

    finalSummary = summaryText;
    finalScore = computedScore;
    finalStatus = recommended;
    finalBreakdown = breakdown;
  } catch (err) {
    synthesisStatus = 'failed';
    synthesisError = toSafeGeminiErrorMessage(err);
    finalSummary = [
      `Partial repository analysis (${succeededAgents.length}/${enabledAgents.length} agents succeeded, synthesis failed).`,
      ...coverageLimitations,
      `Synthesis error: ${synthesisError}`,
    ].join(' ');
    finalScore = null;
    finalStatus = 'in_review';
    finalBreakdown = null;
  }

  const allAgentsSucceeded = failedAgents.length === 0;
  const analysisStatus: RepositoryAnalysisOverallStatus =
    synthesisStatus === 'completed' && allAgentsSucceeded ? 'completed' : 'partial';

  return {
    repositoryFullName: collectionReport.repositoryFullName,
    branch: collectionReport.branch,
    analyzedCommitSha: collectionReport.analyzedCommitSha,
    summary: finalSummary,
    score: finalScore,
    recommendedStatus: finalStatus,
    rubricBreakdown: finalBreakdown,
    findings: mergedFindings,
    strengths: finalStrengths,
    agentBreakdown,
    agentResults: orderedAgentResults,
    collectionCoverage,
    analysisStatus,
    synthesisStatus,
    allAgentsSucceeded,
    enabledAgentsCount: enabledAgents.length,
    succeededAgentsCount: succeededAgents.length,
    failedAgentsCount: failedAgents.length,
    skippedAgentsCount: skippedAgentResults.length,
    totalFilesCollected: collectionReport.filesCollected,
    totalFilesAnalyzed,
    totalChunksAnalyzed: chunks.length,
    persisted: false,
    durationMs: Date.now() - startedAt,
    ...(synthesisError
      ? { error: synthesisError }
      : failedAgents.length > 0
      ? { error: failedAgents.map((f) => `${f.agentName}: ${f.error}`).join('; ') }
      : {}),
  };
}

export function persistRepositoryAnalysisReview(params: {
  analysis: RepositoryAnalysisResult;
  repositoryId: string;
  analysisJobId?: string;
  author?: string;
  htmlUrl?: string;
  allowPartial?: boolean;
}): CodeReview {
  const { analysis } = params;
  if (
    analysis.analysisStatus === 'failed' ||
    analysis.synthesisStatus !== 'completed' ||
    analysis.succeededAgentsCount === 0 ||
    analysis.score === null ||
    analysis.rubricBreakdown === null
  ) {
    throw new Error(
      'Refusing to persist failed or unsynthesized repository analysis as a review.'
    );
  }

  const isPartial =
    analysis.analysisStatus === 'partial' ||
    !analysis.allAgentsSucceeded ||
    !analysis.collectionCoverage.coverageComplete;

  if (isPartial && !params.allowPartial) {
    throw new Error(
      'Refusing to persist incomplete repository analysis as a completed review.'
    );
  }

  const reviewId = params.analysisJobId
    ? `rev-job-${params.analysisJobId}`
    : `rev-repo-${Date.now()}`;

  const commitShort = analysis.analyzedCommitSha.slice(0, 7);
  const titlePrefix = isPartial ? '[Partial] ' : '';
  const summaryText =
    isPartial && !/partial|incomplete/i.test(analysis.summary)
      ? `[Partial Analysis] ${analysis.summary}`
      : analysis.summary;

  const review: CodeReview = {
    id: reviewId,
    prNumber: 0,
    title: `${titlePrefix}Repository Rubric Audit (${analysis.branch} @ ${commitShort})`,
    repositoryId: params.repositoryId,
    repositoryFullName: analysis.repositoryFullName,
    branch: analysis.branch,
    baseBranch: analysis.branch,
    author: params.author || 'multi-agent-engine',
    status: isPartial ? 'in_review' : analysis.recommendedStatus,
    score: analysis.score,
    summary: summaryText,
    rubricBreakdown: analysis.rubricBreakdown,
    findings: analysis.findings,
    agentId:
      analysis.agentBreakdown.find((a) => a.analysisStatus === 'completed')?.agentId ||
      'agent-security-sentinel',
    agentName: isPartial
      ? `Multi-Agent Partial (${analysis.succeededAgentsCount}/${analysis.enabledAgentsCount} agents)`
      : `Multi-Agent (${analysis.succeededAgentsCount} agents)`,
    source: 'github-live',
    isDemo: false,
    diffPreview: `Analyzed ${analysis.totalFilesAnalyzed} collected files across ${analysis.totalChunksAnalyzed} chunks at commit ${analysis.analyzedCommitSha}.`,
    filesChanged: analysis.totalFilesAnalyzed,
    additions: 0,
    deletions: 0,
    prUrl: params.htmlUrl,
    createdAt: new Date().toISOString(),
    durationMs: analysis.durationMs,
    reviewScope: 'repository',
    analysisStatus: isPartial ? 'partial' : 'completed',
    ...(params.analysisJobId ? { analysisJobId: params.analysisJobId } : {}),
    analyzedCommitSha: analysis.analyzedCommitSha,
    strengths: analysis.strengths,
    agentBreakdown: analysis.agentBreakdown,
    collectionCoverage: analysis.collectionCoverage,
  };

  return addReview(review);
}

export function persistCompletedRepositoryReview(params: {
  analysis: RepositoryAnalysisResult;
  repositoryId: string;
  author?: string;
  htmlUrl?: string;
}): CodeReview {
  return persistRepositoryAnalysisReview({
    ...params,
    allowPartial: false,
  });
}
