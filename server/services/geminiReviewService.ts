import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type GenerateContentConfig,
  type Schema,
} from '@google/genai';
import type {
  AIAgent,
  Finding,
  FindingCategory,
  ReviewStatus,
  RubricBreakdown,
  Severity,
} from '../types.ts';

export interface GeminiReviewResult {
  summary: string;
  score: number;
  recommendedStatus: ReviewStatus;
  rubricBreakdown: RubricBreakdown;
  findings: Finding[];
}

export type GeminiGenerateFn = (request: {
  model: string;
  contents: string;
  config: GenerateContentConfig;
}) => Promise<{ text?: string }>;

export interface GeminiRetryOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  maxOutputTokens?: number;
  generateContentFn?: GeminiGenerateFn;
}

export class GeminiServiceError extends Error {
  status: number;
  retryable: boolean;

  constructor(message: string, status = 500, retryable = false) {
    super(message);
    this.name = 'GeminiServiceError';
    this.status = status;
    this.retryable = retryable;
  }
}

const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
const PROHIBITED_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

export function resolveSupportedModel(requestedModel?: string): string {
  const candidate = (requestedModel ?? '').trim();
  if (!candidate || PROHIBITED_MODELS.has(candidate.toLowerCase())) {
    return DEFAULT_GEMINI_MODEL;
  }
  return candidate;
}

export function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiServiceError(
      'GEMINI_API_KEY is not configured on the server. Add it in AI Studio Settings > Secrets.',
      500,
      false
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function mapThinkingLevel(level: AIAgent['thinkingLevel']): ThinkingLevel {
  if (level === 'LOW') return ThinkingLevel.LOW;
  if (level === 'HIGH') return ThinkingLevel.HIGH;
  return ThinkingLevel.MEDIUM;
}

function supportsThinkingConfig(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes('gemini-3') || lower.includes('gemini-4');
}

export function extractGeminiErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const record = err as Record<string, unknown>;
  for (const key of ['status', 'statusCode', 'code']) {
    const raw = record[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === 'string' && /^\d{3}$/.test(raw)) {
      return Number(raw);
    }
  }
  if (record.error && typeof record.error === 'object') {
    const nested = extractGeminiErrorStatus(record.error);
    if (nested !== null) return nested;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const statusMatch = msg.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
  return statusMatch ? Number(statusMatch[1]) : null;
}

export function isRetryableGeminiError(err: unknown): boolean {
  if (err instanceof GeminiServiceError) {
    return err.retryable;
  }
  const status = extractGeminiErrorStatus(err);
  if (status === 429 || status === 503) {
    return true;
  }
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return false;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
  if (
    msg.includes('API_KEY_INVALID') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('INVALID_ARGUMENT') ||
    msg.includes('UNAUTHENTICATED') ||
    msg.includes('NOT_FOUND')
  ) {
    return false;
  }
  if (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('RATE LIMIT') ||
    msg.includes('TOO MANY REQUESTS') ||
    msg.includes('OVERLOADED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('EAI_AGAIN') ||
    msg.includes('FETCH FAILED')
  ) {
    return true;
  }
  return false;
}

export function redactSensitiveText(input: string): string {
  return input
    .replace(/AIza[0-9A-Za-z_-]{16,}/g, '[REDACTED_KEY]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{16,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/(?:api[_-]?key|client_secret|access_token)\s*[:=]\s*[^\s,;&]+/gi, (m) => {
      const key = m.split(/[:=]/)[0].trim();
      return `${key}=[REDACTED]`;
    });
}

export function toSafeGeminiErrorMessage(err: unknown): string {
  if (err instanceof GeminiServiceError) {
    return redactSensitiveText(err.message);
  }
  const status = extractGeminiErrorStatus(err);
  const rawMsg = redactSensitiveText(err instanceof Error ? err.message : String(err));

  if (status === 401 || status === 403 || /PERMISSION_DENIED|UNAUTHENTICATED/i.test(rawMsg)) {
    return 'Gemini API authentication or permission error. Verify GEMINI_API_KEY in Settings > Secrets.';
  }
  if (status === 400 || /API_KEY_INVALID|INVALID_ARGUMENT/i.test(rawMsg)) {
    return 'Gemini API rejected the request or API key configuration (400).';
  }
  if (status === 404 || /NOT_FOUND/i.test(rawMsg)) {
    return 'Configured Gemini model was not found or is unsupported (404).';
  }
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(rawMsg)) {
    return 'Gemini API rate limit or quota exceeded (429). Retry shortly.';
  }
  if (status === 503 || /UNAVAILABLE/i.test(rawMsg)) {
    return 'Gemini API temporarily unavailable (503). Retry shortly.';
  }
  return rawMsg || 'Gemini analysis request failed.';
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseGeminiJson<T>(rawText: string | undefined): T {
  const trimmed = (rawText ?? '').trim();
  if (!trimmed) {
    throw new GeminiServiceError('Gemini returned an empty response payload.', 502, false);
  }

  const candidates: string[] = [trimmed];

  // Strip Markdown code fences (e.g. ```json ... ``` or ``` ... ```)
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    candidates.push(fenceMatch[1].trim());
  }

  // Fallback substring extraction from outermost JSON object or array
  const firstObj = trimmed.indexOf('{');
  const lastObj = trimmed.lastIndexOf('}');
  if (firstObj !== -1 && lastObj > firstObj) {
    candidates.push(trimmed.slice(firstObj, lastObj + 1));
  }
  const firstArr = trimmed.indexOf('[');
  const lastArr = trimmed.lastIndexOf(']');
  if (firstArr !== -1 && lastArr > firstArr) {
    candidates.push(trimmed.slice(firstArr, lastArr + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try next cleanup candidate
    }
  }

  throw new GeminiServiceError(
    'Gemini returned malformed or incomplete JSON that could not be parsed.',
    502,
    false
  );
}

export async function generateWithRetry(params: {
  model?: string;
  contents: string;
  systemInstruction?: string;
  thinkingLevel?: AIAgent['thinkingLevel'];
  responseMimeType?: string;
  responseSchema?: Schema;
  maxOutputTokens?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  generateContentFn?: GeminiGenerateFn;
}): Promise<string> {
  const model = resolveSupportedModel(params.model);
  const maxRetries = Math.max(0, Math.min(4, params.maxRetries ?? 2));
  const retryDelayMs = Math.max(0, params.retryDelayMs ?? 600);

  const config: GenerateContentConfig = {};
  if (params.systemInstruction) {
    config.systemInstruction = params.systemInstruction;
  }
  if (params.thinkingLevel && supportsThinkingConfig(model)) {
    config.thinkingConfig = {
      thinkingLevel: mapThinkingLevel(params.thinkingLevel),
    };
  }
  if (params.responseMimeType) {
    config.responseMimeType = params.responseMimeType;
  }
  if (params.responseSchema) {
    config.responseSchema = params.responseSchema;
  }
  if (
    typeof params.maxOutputTokens === 'number' &&
    Number.isFinite(params.maxOutputTokens) &&
    params.maxOutputTokens > 0
  ) {
    config.maxOutputTokens = Math.round(params.maxOutputTokens);
  }

  const executor: GeminiGenerateFn =
    params.generateContentFn ??
    (async (request) => {
      const ai = getGenAIClient();
      return ai.models.generateContent(request);
    });

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await executor({
        model,
        contents: params.contents,
        config,
      });
      const text = (response?.text ?? '').trim();
      if (!text) {
        throw new GeminiServiceError('Gemini returned an empty response payload.', 502, false);
      }
      return text;
    } catch (err) {
      lastError = err;
      const retryable = isRetryableGeminiError(err);
      if (!retryable || attempt >= maxRetries) {
        const status = extractGeminiErrorStatus(err) ?? (err instanceof GeminiServiceError ? err.status : 502);
        throw new GeminiServiceError(toSafeGeminiErrorMessage(err), status, retryable);
      }
      const backoffMs = retryDelayMs * Math.pow(2, attempt);
      await sleep(backoffMs);
    }
  }

  throw new GeminiServiceError(toSafeGeminiErrorMessage(lastError), 502, false);
}

export function normalizeSeverity(val: unknown): Severity {
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'critical' || lower === 'high' || lower === 'medium' || lower === 'low') {
      return lower;
    }
  }
  return 'medium';
}

export function normalizeCategory(val: unknown): FindingCategory {
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'security') return 'Security';
    if (lower === 'reliability') return 'Reliability';
    if (lower === 'performance') return 'Performance';
    if (lower === 'maintainability') return 'Maintainability';
    if (lower === 'testing') return 'Testing';
    if (lower === 'documentation' || lower === 'api & documentation') return 'Documentation';
  }
  return 'Maintainability';
}

export function normalizeReviewStatus(val: unknown, score: number): ReviewStatus {
  if (val === 'approved' || val === 'changes_requested' || val === 'in_review') {
    return val;
  }
  return score >= 80 ? 'approved' : 'changes_requested';
}

export function clampScore(val: unknown, fallback = 80): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function runGeminiCodeReview(
  params: {
    repositoryFullName: string;
    prTitle: string;
    prNumber: number;
    diffText: string;
    agent: AIAgent;
  } & GeminiRetryOptions
): Promise<GeminiReviewResult> {
  const prompt = [
    `Repository: ${params.repositoryFullName}`,
    `Pull Request #${params.prNumber}: ${params.prTitle}`,
    `Review Strictness: ${params.agent.strictness}`,
    `Focus Area: ${params.agent.focus}`,
    '',
    'Analyze the following code diff or source snippet carefully using our engineering rubric.',
    'Identify concrete issues with exact file paths, approximate line numbers, clear technical explanations, and drop-in fixes.',
    'Score each rubric pillar (security, reliability, maintainability, performance) from 0 to 100 and compute an overall score.',
    '',
    'CODE DIFF:',
    params.diffText,
  ].join('\n');

  const rawText = await generateWithRetry({
    model: params.agent.model,
    contents: prompt,
    systemInstruction: params.agent.systemPrompt,
    thinkingLevel: params.agent.thinkingLevel,
    maxOutputTokens: params.maxOutputTokens ?? 6144,
    maxRetries: params.maxRetries,
    retryDelayMs: params.retryDelayMs,
    generateContentFn: params.generateContentFn,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.STRING,
          description: 'Concise 2-3 sentence engineering summary of the pull request quality and risks.',
        },
        score: {
          type: Type.INTEGER,
          description: 'Overall rubric score from 0 to 100.',
        },
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
        findings: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              severity: {
                type: Type.STRING,
                description: 'Must be one of: critical, high, medium, low.',
              },
              category: {
                type: Type.STRING,
                description:
                  'Must be one of: Security, Reliability, Performance, Maintainability, Testing, Documentation.',
              },
              filePath: { type: Type.STRING },
              lineStart: { type: Type.INTEGER },
              lineEnd: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
              suggestedFix: { type: Type.STRING },
              codeSnippet: { type: Type.STRING },
            },
            required: [
              'title',
              'severity',
              'category',
              'filePath',
              'lineStart',
              'lineEnd',
              'explanation',
              'suggestedFix',
              'codeSnippet',
            ],
          },
        },
      },
      required: ['summary', 'score', 'recommendedStatus', 'rubricBreakdown', 'findings'],
    },
  });

  const parsed = parseGeminiJson<{
    summary?: string;
    score?: number;
    recommendedStatus?: string;
    rubricBreakdown?: Partial<RubricBreakdown>;
    findings?: Array<Partial<Finding>>;
  }>(rawText);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GeminiServiceError('Gemini returned an invalid review structure.', 502, false);
  }

  const score = clampScore(parsed.score, 82);

  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings: Finding[] = rawFindings.map((item, index) => {
    const start = Math.max(1, Math.round(Number(item?.lineStart) || 1));
    const end = Math.max(start, Math.round(Number(item?.lineEnd) || start));
    return {
      id: `find-${Date.now()}-${index + 1}`,
      title: typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : 'Code rubric observation',
      severity: normalizeSeverity(item?.severity),
      category: normalizeCategory(item?.category),
      filePath: typeof item?.filePath === 'string' && item.filePath.trim() ? item.filePath.trim() : 'diff.patch',
      lineStart: start,
      lineEnd: end,
      explanation: typeof item?.explanation === 'string' ? item.explanation : '',
      suggestedFix: typeof item?.suggestedFix === 'string' ? item.suggestedFix : '',
      codeSnippet: typeof item?.codeSnippet === 'string' ? item.codeSnippet : '',
      resolved: false,
    };
  });

  return {
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : 'Automated Gemini rubric analysis completed.',
    score,
    recommendedStatus: normalizeReviewStatus(parsed.recommendedStatus, score),
    rubricBreakdown: {
      security: clampScore(parsed.rubricBreakdown?.security, score),
      reliability: clampScore(parsed.rubricBreakdown?.reliability, score),
      maintainability: clampScore(parsed.rubricBreakdown?.maintainability, score),
      performance: clampScore(parsed.rubricBreakdown?.performance, score),
    },
    findings,
  };
}
