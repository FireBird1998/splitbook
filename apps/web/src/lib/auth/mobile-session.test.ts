/** Real Better Auth handler and mobile controller; synthetic Google tokens are explicit. */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { buildAuthOptions } from './create-auth';
import { signTestIdToken } from './test-id-token';
import { createMobileController } from '../../../../mobile/src/data/mobile-controller';

const origin = 'https://staging.splitbook.test';
const clientId = '123-test.apps.googleusercontent.com';
const secret = 'isolated-test-only-google-token-secret';
function setup(email: string) {
  const db = { user: [], session: [], account: [], verification: [], rateLimit: [] };
  const auth = betterAuth({
    ...buildAuthOptions({
      database: memoryAdapter(db),
      env: {
        NEXT_PUBLIC_APP_URL: origin,
        AUTH_MODE: 'google',
        AUTH_SECRET: 'isolated-better-auth-session-secret-for-tests',
        AUTH_GOOGLE_ID: clientId,
        AUTH_GOOGLE_SECRET: 'test-client-secret',
        AUTH_ALLOWED_EMAILS: 'invited@example.com',
        AUTH_TEST_ID_TOKEN_SECRET: secret,
        NODE_ENV: 'test',
      },
    }),
    advanced: { database: { generateId: () => randomBytes(12).toString('hex') } },
  });
  let saved: string | null = null;
  const controller = createMobileController(
    {
      apiBaseUrl: origin,
      authOrigin: origin,
      developmentPersonaEnabled: false,
      googleWebClientId: clientId,
    },
    {
      googleSignIn: async () => ({
        status: 'success',
        nonce: 'request-nonce',
        idToken: signTestIdToken(
          {
            sub: `google-${email}`,
            email,
            name: 'Beta Tester',
            aud: clientId,
            nonce: 'request-nonce',
          },
          secret,
        ),
      }),
      credentials: {
        load: async () => saved,
        save: async (value) => {
          saved = value;
        },
        clear: async () => {
          saved = null;
        },
      },
      fetch: async (url, init) => {
        const path = new URL(url).pathname;
        // Deployment identity is a fixture; real deployments refuse synthetic-token mode.
        if (path === '/.well-known/splitbook-mobile.json')
          return Response.json({ environment: 'staging', googleWebClientId: clientId });
        if (path.startsWith('/api/auth/')) return auth.handler(new Request(url, init));
        if (path === '/api/groups') return Response.json({ data: [], status: 200 });
        if (path === '/api/user/balances')
          return Response.json({ data: { buckets: [] }, status: 200 });
        return Response.json({}, { status: 404 });
      },
    },
  );
  return { controller, db, saved: () => saved };
}
describe('Android token exchange through Better Auth', () => {
  it('admits an approved identity, restores its secure cookie, and revokes it on logout', async () => {
    const test = setup('invited@example.com');
    await test.controller.signInWithGoogle();
    expect(test.controller.getSnapshot().auth, 'synthetic Google token exchange').toMatchObject({
      status: 'authenticated',
      user: { email: 'invited@example.com' },
    });
    expect(test.saved()).toMatch(/^__Secure-better-auth.session_token=/);
    expect(test.db.session).toHaveLength(1);
    await test.controller.restore();
    expect(test.controller.getSnapshot().auth.status).toBe('authenticated');
    await test.controller.signOut();
    expect(test.db.session).toHaveLength(0);
    expect(test.saved()).toBeNull();
  });
  it('surfaces the actual allowlist denial and creates no account or session', async () => {
    const test = setup('not-invited@example.com');
    await test.controller.signInWithGoogle();
    expect(test.controller.getSnapshot().auth).toMatchObject({
      status: 'signed-out',
      message: expect.stringContaining('not invited'),
    });
    expect(test.db.user).toHaveLength(0);
    expect(test.db.session).toHaveLength(0);
    expect(test.saved()).toBeNull();
  });
});
