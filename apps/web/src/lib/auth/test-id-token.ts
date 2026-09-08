/**
 * Test-only Google ID tokens.
 *
 * The Google-mode browser suite proves the approved and denied sign-in
 * outcomes through Better Auth's ID-token sign-in endpoint
 * (`POST /api/auth/sign-in/social` with `idToken`), which is also the path
 * the native mobile clients will use. Real tokens are signed by Google; the
 * suite signs its own HS256 tokens under `AUTH_TEST_ID_TOKEN_SECRET`, and
 * when that variable is set the Google provider's `verifyIdToken` is replaced
 * by `verifyTestIdToken`. Better Auth then reads the profile from the token
 * payload exactly as it would for a Google-issued one.
 *
 * The override is refused under `NODE_ENV=production` unless
 * `ALLOW_TEST_ID_TOKEN=true` is also set — the same two-variable rule that
 * guards demo personas (`ALLOW_DEMO_AUTH`), because CI runs the browser
 * suites against a production build. Never set either variable on a real
 * deployment.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TestIdTokenClaims {
  /** Google account id (`sub`). */
  sub: string;
  email: string;
  name: string;
  email_verified?: boolean;
  picture?: string | null;
  /** OAuth client id the token is minted for. */
  aud?: string;
  nonce?: string;
  /** Seconds since the epoch; defaults to five minutes from now. */
  exp?: number;
}

export interface TestIdTokenEnv {
  AUTH_TEST_ID_TOKEN_SECRET?: string | undefined;
  ALLOW_TEST_ID_TOKEN?: string | undefined;
  NODE_ENV?: string | undefined;
}

export const TEST_ID_TOKEN_ISSUER = 'https://accounts.google.com';

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function signTestIdToken(claims: TestIdTokenClaims, secret: string): string {
  if (!secret) throw new Error('A secret is required to sign a test ID token');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: TEST_ID_TOKEN_ISSUER,
      iat: now,
      exp: claims.exp ?? now + 300,
      email_verified: true,
      ...claims,
    }),
  );
  const signature = base64url(hmac(secret, `${header}.${payload}`));
  return `${header}.${payload}.${signature}`;
}

/**
 * Verify a token produced by `signTestIdToken`: HS256 signature under the
 * secret, not expired, and — when the sign-in supplied a nonce — a matching
 * `nonce` claim. Never throws.
 */
export function verifyTestIdToken(token: string, secret: string, nonce?: string): boolean {
  try {
    if (!secret) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [header, payload, signature] = parts;
    const expected = hmac(secret, `${header}.${payload}`);
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (decodedHeader?.alg !== 'HS256') return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims?.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000))
      return false;
    if (nonce !== undefined && claims.nonce !== nonce) return false;
    return typeof claims.sub === 'string' && typeof claims.email === 'string';
  } catch {
    return false;
  }
}

/** Whether the environment asks for — and is allowed — the test verifier. */
export function isTestIdTokenOverrideEnabled(env: TestIdTokenEnv = process.env): boolean {
  if (!env.AUTH_TEST_ID_TOKEN_SECRET) return false;
  if (env.NODE_ENV === 'production') return env.ALLOW_TEST_ID_TOKEN === 'true';
  return true;
}
