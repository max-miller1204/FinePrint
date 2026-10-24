import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './app.js';
import { ApiError } from './errors.js';

// Firebase ID token auth for /v1 (spec §5.2, §13). The app signs in
// anonymously; Sign in with Apple links to the same uid later.

export type AuthProvider = 'anonymous' | 'apple' | 'other';

export interface AuthUser {
  uid: string;
  provider: AuthProvider;
}

export type AuthEnv = {
  Variables: AppEnv['Variables'] & { user: AuthUser };
};

// The token itself is wrong: the client should get a fresh one. Anything
// else a verifier throws means the check could not run.
export class InvalidTokenError extends Error {
  readonly reason: 'expired' | 'invalid';

  constructor(reason: 'expired' | 'invalid') {
    super(`ID token ${reason}`);
    this.name = 'InvalidTokenError';
    this.reason = reason;
  }
}

// Resolves with the signed-in user or throws `InvalidTokenError`.
export type VerifyIdToken = (idToken: string) => Promise<AuthUser>;

export function requireAuth(verify: VerifyIdToken): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const token = bearerToken(c.req.header('Authorization'));
    if (token === null) {
      c.get('log').info('auth rejected', { reason: 'missing' });
      throw unauthenticated(c, 'Missing ID token');
    }
    let user: AuthUser;
    try {
      user = await verify(token);
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        c.get('log').info('auth rejected', { reason: err.reason });
        throw unauthenticated(c, err.reason === 'expired' ? 'ID token expired' : 'Invalid ID token');
      }
      // Never log the token or the error message, which can quote it.
      c.get('log').error('auth check failed', { errorName: err instanceof Error ? err.name : typeof err });
      throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Sign-in check is unavailable');
    }
    c.set('user', user);
    await next();
  };
}

function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer +([A-Za-z0-9._~+/-]+=*) *$/i);
  return match?.[1] ?? null;
}

// RFC 6750: a 401 names the scheme the client should use.
function unauthenticated(c: Parameters<MiddlewareHandler<AuthEnv>>[0], message: string) {
  c.header('WWW-Authenticate', 'Bearer realm="fineprint"');
  return new ApiError(401, 'UNAUTHENTICATED', message);
}

const INVALID_TOKEN_CODES = new Set([
  'auth/argument-error',
  'auth/invalid-id-token',
  'auth/id-token-revoked',
  'auth/user-disabled',
  // Only from the revocation lookup the Auth emulator always runs.
  'auth/user-not-found',
]);

// Verifies with firebase-admin. The project comes from FIREBASE_PROJECT_ID,
// else GOOGLE_CLOUD_PROJECT, else Application Default Credentials. Under
// FIREBASE_AUTH_EMULATOR_HOST, firebase-admin skips the signature check, so
// emulator mode is refused for anything but a `demo-` project.
export function firebaseIdTokenVerifier(env: NodeJS.ProcessEnv = process.env): VerifyIdToken {
  const projectId = env.FIREBASE_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT;
  if (env.FIREBASE_AUTH_EMULATOR_HOST && !projectId?.startsWith('demo-')) {
    throw new Error('FIREBASE_AUTH_EMULATOR_HOST is set, so the project ID must start with "demo-"');
  }
  let auth: ReturnType<typeof getAuth> | undefined;
  return async (idToken) => {
    auth ??= getAuth(getApps()[0] ?? initializeApp(projectId ? { projectId } : undefined));
    try {
      const decoded = await auth.verifyIdToken(idToken);
      return { uid: decoded.uid, provider: providerOf(decoded.firebase?.sign_in_provider) };
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 'auth/id-token-expired') throw new InvalidTokenError('expired');
      if (typeof code === 'string' && INVALID_TOKEN_CODES.has(code)) throw new InvalidTokenError('invalid');
      throw err;
    }
  };
}

function providerOf(signInProvider: string | undefined): AuthProvider {
  if (signInProvider === 'anonymous') return 'anonymous';
  if (signInProvider === 'apple.com') return 'apple';
  return 'other';
}
