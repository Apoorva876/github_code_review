import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';

export interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}

export type FirebaseTokenVerifier = (idToken: string) => Promise<VerifiedFirebaseUser>;

export class FirebaseAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = 'FirebaseAuthError';
    this.status = status;
  }
}

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface CertCacheEntry {
  certs: Record<string, string>;
  expiresAt: number;
}

let certCache: CertCacheEntry | null = null;

function readConfiguredFirebaseProjectId(): string {
  const fromEnv = process.env.FIREBASE_PROJECT_ID?.trim();
  if (fromEnv) return fromEnv;

  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        projectId?: string;
      };
      if (parsed?.projectId?.trim()) {
        return parsed.projectId.trim();
      }
    }
  } catch {
    // Fall through if unreadable
  }
  return '';
}

function parseMaxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl) return 300;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) return 300;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 86400) : 300;
}

async function getGoogleSecureTokenCerts(): Promise<Record<string, string>> {
  if (certCache && Date.now() < certCache.expiresAt) {
    return certCache.certs;
  }

  const response = await fetch(GOOGLE_CERTS_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new FirebaseAuthError(
      'Unable to fetch Firebase verification certificates. Please retry shortly.',
      503
    );
  }

  const certs = (await response.json()) as Record<string, string>;
  if (!certs || typeof certs !== 'object' || Array.isArray(certs)) {
    throw new FirebaseAuthError('Invalid Firebase public certificate payload.', 503);
  }

  const ttlMs = parseMaxAgeSeconds(response.headers.get('cache-control')) * 1000;
  certCache = {
    certs,
    expiresAt: Date.now() + ttlMs,
  };
  return certs;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const raw = Buffer.from(padded, 'base64').toString('utf-8');
  return JSON.parse(raw) as T;
}

function base64UrlToBuffer(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
  const token = idToken.trim();
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new FirebaseAuthError('Malformed Firebase authentication token.', 401);
  }

  const [headerSeg, payloadSeg, sigSeg] = parts;
  let header: { alg?: string; kid?: string };
  let payload: {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  try {
    header = decodeBase64UrlJson(headerSeg);
    payload = decodeBase64UrlJson(payloadSeg);
  } catch {
    throw new FirebaseAuthError('Invalid Firebase token encoding.', 401);
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) {
    throw new FirebaseAuthError('Unsupported Firebase token signing algorithm or key ID.', 401);
  }

  const projectId = readConfiguredFirebaseProjectId();
  if (!projectId) {
    throw new FirebaseAuthError('Firebase project configuration is missing on the server.', 500);
  }

  const certs = await getGoogleSecureTokenCerts();
  const certPem = certs[header.kid];
  if (!certPem) {
    // Force refresh once in case Google rotated signing keys
    certCache = null;
    const refreshedCerts = await getGoogleSecureTokenCerts();
    const refreshedPem = refreshedCerts[header.kid];
    if (!refreshedPem) {
      throw new FirebaseAuthError('Firebase token key ID is unrecognized or expired.', 401);
    }
    return validateSignatureAndClaims(headerSeg, payloadSeg, sigSeg, refreshedPem, payload, projectId);
  }

  return validateSignatureAndClaims(headerSeg, payloadSeg, sigSeg, certPem, payload, projectId);
}

function validateSignatureAndClaims(
  headerSeg: string,
  payloadSeg: string,
  sigSeg: string,
  certPem: string,
  payload: {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  },
  projectId: string
): VerifiedFirebaseUser {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerSeg}.${payloadSeg}`);
  verifier.end();

  const signature = base64UrlToBuffer(sigSeg);
  let validSig = false;
  try {
    validSig = verifier.verify(certPem, signature);
  } catch {
    validSig = false;
  }

  if (!validSig) {
    throw new FirebaseAuthError('Firebase token signature verification failed.', 401);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId) {
    throw new FirebaseAuthError('Firebase token audience mismatch.', 401);
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new FirebaseAuthError('Firebase token issuer mismatch.', 401);
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new FirebaseAuthError('Firebase token subject (uid) is invalid.', 401);
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    throw new FirebaseAuthError('Your Google sign-in session has expired. Please sign in again.', 401);
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + 300) {
    throw new FirebaseAuthError('Firebase token issued-at timestamp is invalid.', 401);
  }
  if (typeof payload.auth_time !== 'number' || payload.auth_time > nowSeconds + 300) {
    throw new FirebaseAuthError('Firebase authentication time claim is invalid.', 401);
  }
  if (payload.email_verified !== true) {
    throw new FirebaseAuthError(
      'Your Google account email must be verified before using Ask Your Repository.',
      403
    );
  }

  return {
    uid: payload.sub.trim(),
    email: typeof payload.email === 'string' ? payload.email : undefined,
    emailVerified: true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
  };
}

export async function authenticateFirebaseRequest(
  req: Request,
  verifierFn: FirebaseTokenVerifier = verifyFirebaseIdToken
): Promise<VerifiedFirebaseUser> {
  const rawAuth = req.headers.authorization;
  if (!rawAuth || typeof rawAuth !== 'string') {
    throw new FirebaseAuthError(
      'Google sign-in is required to access Repository Q&A history and ask questions.',
      401
    );
  }
  const match = rawAuth.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]?.trim()) {
    throw new FirebaseAuthError('Missing Bearer authentication token.', 401);
  }

  return verifierFn(match[1].trim());
}
