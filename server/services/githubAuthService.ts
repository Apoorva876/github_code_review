import crypto from 'node:crypto';
import type { Request, Response } from 'express';

export interface GitHubAuthUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
}

export interface GitHubOAuthSession {
  sessionId: string;
  accessToken: string;
  scopes: string[];
  user: GitHubAuthUser;
  createdAt: number;
}

interface PendingOAuthState {
  createdAt: number;
}

const SESSION_COOKIE_NAME = 'coderubric_gh_sid';
const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');
const sessions = new Map<string, GitHubOAuthSession>();
const pendingStates = new Map<string, PendingOAuthState>();

const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSigningSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret !== 'CHANGE_ME_SESSION_HMAC_SECRET') {
    return envSecret;
  }
  return EPHEMERAL_SECRET;
}

export function isGitHubOAuthConfigured(): boolean {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  return Boolean(
    clientId &&
      clientSecret &&
      clientId !== 'YOUR_GITHUB_OAUTH_CLIENT_ID' &&
      clientSecret !== 'YOUR_GITHUB_OAUTH_CLIENT_SECRET'
  );
}

export function getGitHubCallbackUrl(req: Request): string {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && appUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(appUrl)) {
    return `${appUrl.replace(/\/+$/, '')}/auth/github/callback`;
  }
  const host = req.get('host') || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto']?.toString().split(',')[0] || req.protocol || 'http';
  return `${proto}://${host}/auth/github/callback`;
}

function signSessionId(sessionId: string): string {
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(sessionId)
    .digest('hex');
  return `${sessionId}.${sig}`;
}

function verifySignedSessionId(rawCookie: string): string | null {
  const dotIdx = rawCookie.indexOf('.');
  if (dotIdx <= 0) return null;
  const sessionId = rawCookie.slice(0, dotIdx);
  const providedSig = rawCookie.slice(dotIdx + 1);
  if (!sessionId || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(sessionId)
    .digest('hex');

  const a = Buffer.from(providedSig, 'utf-8');
  const b = Buffer.from(expectedSig, 'utf-8');
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return sessionId;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = decodeURIComponent(part.slice(eqIdx + 1).trim());
    result[key] = val;
  }
  return result;
}

export function getSessionFromRequest(req: Request): GitHubOAuthSession | null {
  const cookies = parseCookies(req);
  const raw = cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;

  const sessionId = verifySignedSessionId(raw);
  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;

  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE_NAME, signSessionId(sessionId), {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionFromRequest(req: Request, res: Response): void {
  const cookies = parseCookies(req);
  const raw = cookies[SESSION_COOKIE_NAME];
  if (raw) {
    const sessionId = verifySignedSessionId(raw);
    if (sessionId) {
      sessions.delete(sessionId);
    }
  }
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
  });
}

export function createGitHubAuthorizeUrl(req: Request): string {
  if (!isGitHubOAuthConfigured()) {
    throw new Error(
      'GitHub OAuth is not configured on the server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.'
    );
  }

  // Prune expired pending states
  const now = Date.now();
  for (const [key, value] of pendingStates.entries()) {
    if (now - value.createdAt > STATE_TTL_MS) {
      pendingStates.delete(key);
    }
  }

  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, { createdAt: now });

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!.trim(),
    redirect_uri: getGitHubCallbackUrl(req),
    scope: 'repo read:user',
    state,
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export function consumeOAuthState(state: string): boolean {
  if (!state) return false;
  const entry = pendingStates.get(state);
  if (!entry) return false;
  pendingStates.delete(state);
  return Date.now() - entry.createdAt <= STATE_TTL_MS;
}

export async function exchangeGitHubCodeForSession(
  code: string,
  redirectUri: string
): Promise<GitHubOAuthSession> {
  if (!isGitHubOAuthConfigured()) {
    throw new Error('GitHub OAuth credentials are not configured on the server.');
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'CodeRubric-AI-Reviewer',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID!.trim(),
      client_secret: process.env.GITHUB_CLIENT_SECRET!.trim(),
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`GitHub token exchange failed (${tokenRes.status}).`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (tokenData.error || !tokenData.access_token) {
    throw new Error(
      tokenData.error_description || tokenData.error || 'GitHub did not return an access token.'
    );
  }

  const accessToken = tokenData.access_token;

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'CodeRubric-AI-Reviewer',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!userRes.ok) {
    throw new Error(`Failed to fetch authenticated GitHub profile (${userRes.status}).`);
  }

  const headerScopes = userRes.headers.get('x-oauth-scopes');
  const rawScopes = headerScopes || tokenData.scope || '';
  const scopes = rawScopes
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const rawUser = (await userRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
    html_url: string;
  };

  const sessionId = crypto.randomBytes(32).toString('hex');
  const session: GitHubOAuthSession = {
    sessionId,
    accessToken,
    scopes,
    user: {
      id: rawUser.id,
      login: rawUser.login,
      name: rawUser.name,
      avatarUrl: rawUser.avatar_url,
      htmlUrl: rawUser.html_url,
    },
    createdAt: Date.now(),
  };

  sessions.set(sessionId, session);
  return session;
}
