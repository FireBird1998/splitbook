/**
 * The Better Auth instance options and the behaviours they drive, exercised
 * against the memory adapter: session policy, rate-limit storage, the demo
 * plugin guard, the Google ID-token path (approved, denied, re-linked to an
 * existing user) through the test verifier override, and sign-out, which
 * answers success only once the session is gone (#285).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';
import {
  buildAuthOptions,
  createSplitbookAuth,
  SESSION_COOKIE_CACHE_MAX_AGE_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  type AuthEnv,
} from '@/lib/auth/create-auth';
import { signTestIdToken } from '@/lib/auth/test-id-token';
import { DEMO_PERSONA_IDS, DEMO_PERSONAS } from '@/lib/demo-personas';

const BASE_URL = 'http://localhost:3100';
const TEST_SECRET = 'playwright-id-token-secret';

const baseEnv: AuthEnv = {
  NEXT_PUBLIC_APP_URL: BASE_URL,
  AUTH_SECRET: 'create-auth-test-secret-with-enough-entropy-1234',
  AUTH_GOOGLE_ID: 'client-id.apps.googleusercontent.com',
  AUTH_GOOGLE_SECRET: 'client-secret',
  AUTH_ALLOWED_EMAILS: 'approved@example.com, Existing@Example.com',
  NODE_ENV: 'test',
};

function memoryDb(seedPersonas = false): MemoryDB {
  const now = new Date();
  return {
    user: seedPersonas
      ? DEMO_PERSONAS.map((persona) => ({
          id: persona.id,
          name: persona.name,
          email: persona.email,
          emailVerified: false,
          image: persona.image,
          createdAt: now,
          updatedAt: now,
        }))
      : [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
  };
}

/**
 * Session-store faults the memory adapter can't produce on its own: `delete`
 * throws, as a write to an unreachable database does; `lookup` fails the
 * `findMany` Better Auth runs before a delete, which it swallows and then
 * deletes nothing, without an error.
 */
interface SessionFaults {
  delete: boolean;
  lookup: boolean;
}

function withSessionFaults(db: MemoryDB, faults: SessionFaults) {
  const base = memoryAdapter(db);
  return ((options) => {
    const adapter = base(options);
    const unavailable = () => Promise.reject(new Error('Session store unavailable'));
    return {
      ...adapter,
      delete: (args) =>
        faults.delete && args.model === 'session' ? unavailable() : adapter.delete(args),
      findMany: (args) =>
        faults.lookup && args.model === 'session' ? unavailable() : adapter.findMany(args),
    };
  }) satisfies typeof base;
}

function createAuth(env: Partial<AuthEnv> = {}, seedPersonas = false) {
  const db = memoryDb(seedPersonas);
  const faults: SessionFaults = { delete: false, lookup: false };
  const auth = createSplitbookAuth({
    database: withSessionFaults(db, faults),
    env: { ...baseEnv, ...env },
  });
  return { auth, db, faults };
}

async function idTokenSignIn(
  auth: ReturnType<typeof createAuth>['auth'],
  claims: { sub: string; email: string; name: string },
) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        idToken: { token: signTestIdToken(claims, TEST_SECRET) },
      }),
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildAuthOptions', () => {
  it('uses 30-day database sessions refreshed daily with a five-minute cookie cache', () => {
    const options = buildAuthOptions({ database: memoryAdapter(memoryDb()), env: baseEnv });
    expect(options.session).toEqual({
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    });
    expect(SESSION_EXPIRES_IN_SECONDS).toBe(2_592_000);
    expect(SESSION_UPDATE_AGE_SECONDS).toBe(86_400);
    expect(SESSION_COOKIE_CACHE_MAX_AGE_SECONDS).toBe(300);
  });

  it('stores rate-limit counters in the database and only overrides "enabled" when asked', () => {
    const db = memoryAdapter(memoryDb());
    expect(buildAuthOptions({ database: db, env: baseEnv }).rateLimit).toEqual({
      enabled: undefined,
      storage: 'database',
    });
    expect(
      buildAuthOptions({ database: db, env: { ...baseEnv, AUTH_RATE_LIMIT_ENABLED: 'false' } })
        .rateLimit.enabled,
    ).toBe(false);
    expect(
      buildAuthOptions({ database: db, env: { ...baseEnv, AUTH_RATE_LIMIT_ENABLED: 'true' } })
        .rateLimit.enabled,
    ).toBe(true);
  });

  it('derives base URL, secret and trusted origins from the existing variables', () => {
    const options = buildAuthOptions({ database: memoryAdapter(memoryDb()), env: baseEnv });
    expect(options.baseURL).toBe(BASE_URL);
    expect(options.secret).toBe(baseEnv.AUTH_SECRET);
    expect(options.trustedOrigins).toEqual([BASE_URL]);
    expect(options.socialProviders.google).toMatchObject({
      clientId: baseEnv.AUTH_GOOGLE_ID,
      clientSecret: baseEnv.AUTH_GOOGLE_SECRET,
      prompt: 'select_account',
    });
  });

  it('registers the demo persona plugin only when demo auth is allowed, nextCookies last', () => {
    const db = memoryAdapter(memoryDb());
    const google = buildAuthOptions({ database: db, env: baseEnv });
    expect(google.plugins.map((plugin) => plugin.id)).toEqual(['next-cookies']);

    const demo = buildAuthOptions({ database: db, env: { ...baseEnv, AUTH_MODE: 'demo' } });
    expect(demo.plugins.map((plugin) => plugin.id)).toEqual(['demo-persona', 'next-cookies']);

    const prod = buildAuthOptions({
      database: db,
      env: { ...baseEnv, AUTH_MODE: 'demo', NODE_ENV: 'production' },
    });
    expect(prod.plugins.map((plugin) => plugin.id)).toEqual(['next-cookies']);
  });

  it('only installs the test ID-token verifier when the environment allows it', () => {
    const db = memoryAdapter(memoryDb());
    expect(
      buildAuthOptions({ database: db, env: baseEnv }).socialProviders.google.verifyIdToken,
    ).toBeUndefined();
    expect(
      buildAuthOptions({
        database: db,
        env: { ...baseEnv, AUTH_TEST_ID_TOKEN_SECRET: TEST_SECRET },
      }).socialProviders.google.verifyIdToken,
    ).toBeTypeOf('function');
    expect(
      buildAuthOptions({
        database: db,
        env: { ...baseEnv, AUTH_TEST_ID_TOKEN_SECRET: TEST_SECRET, NODE_ENV: 'production' },
      }).socialProviders.google.verifyIdToken,
    ).toBeUndefined();
  });
});

describe('Google ID-token sign-in through the test verifier', () => {
  const withOverride = { AUTH_TEST_ID_TOKEN_SECRET: TEST_SECRET };

  it('admits an allowlisted identity, creating the user and a session', async () => {
    const { auth, db } = createAuth(withOverride);
    const response = await idTokenSignIn(auth, {
      sub: 'google-approved',
      email: 'approved@example.com',
      name: 'Approved Tester',
    });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const body = JSON.parse(text);
    expect(body.user).toMatchObject({ email: 'approved@example.com', name: 'Approved Tester' });
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=');
    expect(db.user).toHaveLength(1);
    expect(db.user[0]).toMatchObject({ email: 'approved@example.com', preferredCurrency: 'INR' });
    expect(db.account).toHaveLength(1);
    expect(db.account[0]).toMatchObject({ providerId: 'google', accountId: 'google-approved' });
    expect(db.session).toHaveLength(1);
  });

  it('denies an identity outside the allowlist with email_not_allowed and provisions nothing', async () => {
    const { auth, db } = createAuth(withOverride);
    const response = await idTokenSignIn(auth, {
      sub: 'google-stranger',
      email: 'stranger@example.com',
      name: 'Stranger',
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'email_not_allowed' });
    expect(db.user).toHaveLength(0);
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });

  it('links a Google login to the existing (migrated) user with that email, keeping the id', async () => {
    const { auth, db } = createAuth(withOverride);
    const existingId = 'a00000000000000000000042';
    db.user.push({
      id: existingId,
      name: 'Existing Tester',
      email: 'existing@example.com',
      // The migration marks users with an Auth.js Google account as verified.
      emailVerified: true,
      image: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const response = await idTokenSignIn(auth, {
      sub: 'google-existing',
      email: 'Existing@Example.com',
      name: 'Existing Tester',
    });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(JSON.parse(text).user.id).toBe(existingId);
    expect(db.user).toHaveLength(1);
    expect(db.account).toHaveLength(1);
    expect(db.account[0]).toMatchObject({ userId: existingId, providerId: 'google' });
  });

  it('refuses to link a Google login to an existing user whose row is not verified', async () => {
    // Better Auth's takeover guard: the migration must set emailVerified for
    // Auth.js users, otherwise they cannot sign in again after cutover.
    const { auth, db } = createAuth(withOverride);
    db.user.push({
      id: 'a00000000000000000000044',
      name: 'Unverified Row',
      email: 'existing@example.com',
      emailVerified: false,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const response = await idTokenSignIn(auth, {
      sub: 'google-existing',
      email: 'existing@example.com',
      name: 'Existing Tester',
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ message: 'account not linked' });
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });

  it('re-checks the allowlist on every sign-in of an existing user', async () => {
    const { auth, db } = createAuth({ ...withOverride, AUTH_ALLOWED_EMAILS: 'nobody@example.com' });
    db.user.push({
      id: 'a00000000000000000000043',
      name: 'Removed Tester',
      email: 'removed@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.account.push({
      id: 'acc-1',
      userId: 'a00000000000000000000043',
      providerId: 'google',
      accountId: 'google-removed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await idTokenSignIn(auth, {
      sub: 'google-removed',
      email: 'removed@example.com',
      name: 'Removed Tester',
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'email_not_allowed' });
    expect(db.session).toHaveLength(0);
  });

  it('rejects ID tokens when the override is off', async () => {
    const { auth, db } = createAuth();
    const response = await idTokenSignIn(auth, {
      sub: 'google-approved',
      email: 'approved@example.com',
      name: 'Approved Tester',
    });
    expect(response.status).toBe(401);
    expect(db.user).toHaveLength(0);
  });
});

describe('demo persona route through the full instance', () => {
  it('exists in demo mode and is absent in Google mode', async () => {
    vi.stubEnv('AUTH_MODE', 'demo');
    const demo = createAuth({ AUTH_MODE: 'demo' }, true);
    const entered = await demo.auth.handler(
      new Request(`${BASE_URL}/api/auth/demo-persona/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personaId: 'priya' }),
      }),
    );
    expect(entered.status).toBe(200);
    expect((await entered.json()).user.id).toBe(DEMO_PERSONA_IDS.priya);

    const google = createAuth({ AUTH_MODE: 'google' }, true);
    const missing = await google.auth.handler(
      new Request(`${BASE_URL}/api/auth/demo-persona/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personaId: 'priya' }),
      }),
    );
    expect(missing.status).toBe(404);
  });
});

describe('sign-out', () => {
  const withOverride = { AUTH_TEST_ID_TOKEN_SECRET: TEST_SECRET };
  const approved = { sub: 'google-approved', email: 'approved@example.com', name: 'Tester' };

  /** The session token alone: without the cookie cache, get-session reads the database. */
  function sessionCookie(response: Response) {
    const cookie = response.headers
      .getSetCookie()
      .find((header) => header.startsWith('better-auth.session_token='));
    if (!cookie) throw new Error('The sign-in set no session cookie');
    return cookie.split(';')[0];
  }

  async function signedIn() {
    const test = createAuth(withOverride);
    const response = await idTokenSignIn(test.auth, approved);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(test.db.session).toHaveLength(1);
    return { ...test, cookie: sessionCookie(response) };
  }

  function signOut(auth: ReturnType<typeof createAuth>['auth'], cookie?: string) {
    return auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-out`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: BASE_URL,
          ...(cookie ? { cookie } : {}),
        },
        body: '{}',
      }),
    );
  }

  async function currentSession(auth: ReturnType<typeof createAuth>['auth'], cookie: string) {
    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/get-session`, { headers: { cookie } }),
    );
    expect(response.status).toBe(200);
    return response.json();
  }

  it('ends the session and clears its cookies when the delete works', async () => {
    const { auth, db, cookie } = await signedIn();

    const response = await signOut(auth, cookie);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    const cleared = response.headers.getSetCookie();
    expect(cleared).toContainEqual(
      expect.stringMatching(/^better-auth\.session_token=;.*Max-Age=0/),
    );
    expect(cleared).toContainEqual(
      expect.stringMatching(/^better-auth\.session_data=;.*Max-Age=0/),
    );
    expect(db.session).toHaveLength(0);
    await expect(currentSession(auth, cookie)).resolves.toBeNull();

    // A retry whose first answer was lost has nothing left to end: still success.
    expect((await signOut(auth, cookie)).status).toBe(200);
  });

  it('answers 500 and keeps the session and its cookie when the delete fails', async () => {
    const { auth, db, faults, cookie } = await signedIn();
    faults.delete = true;

    const response = await signOut(auth, cookie);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'SESSION_NOT_ENDED' });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(db.session).toHaveLength(1);
    await expect(currentSession(auth, cookie)).resolves.toMatchObject({
      user: { email: approved.email },
    });

    // Once the store recovers, the same cookie signs out.
    faults.delete = false;
    expect((await signOut(auth, cookie)).status).toBe(200);
    await expect(currentSession(auth, cookie)).resolves.toBeNull();
  });

  it('answers 500 when the delete reports no error but the session remains', async () => {
    const { auth, db, faults, cookie } = await signedIn();
    faults.lookup = true;

    const response = await signOut(auth, cookie);
    expect(response.status).toBe(500);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(db.session).toHaveLength(1);
    await expect(currentSession(auth, cookie)).resolves.toMatchObject({
      user: { email: approved.email },
    });
  });

  it('answers 200 to a sign-out with no readable session cookie, touching no session', async () => {
    const { auth, db, faults } = await signedIn();
    faults.delete = true;
    faults.lookup = true;

    expect((await signOut(auth)).status).toBe(200);
    expect((await signOut(auth, 'better-auth.session_token=forged.unsigned')).status).toBe(200);
    expect(db.session).toHaveLength(1);
  });
});
