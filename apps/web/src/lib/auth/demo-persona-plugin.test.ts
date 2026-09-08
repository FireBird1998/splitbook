/**
 * Demo persona plugin against Better Auth's in-memory adapter: the guard that
 * keeps the route out of non-demo configurations, the lookup, and the shape
 * of a successful entry (session cookie + persona user).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { APIError } from 'better-auth/api';
import { DEMO_PERSONA_IDS, DEMO_PERSONAS } from '@/lib/demo-personas';
import {
  DEMO_PERSONA_RATE_LIMIT,
  DEMO_PERSONA_SIGN_IN_PATH,
  demoPersona,
  demoPersonaPluginIfAllowed,
} from '@/lib/auth/demo-persona-plugin';

const BASE_URL = 'http://localhost:3100';

function seededDb(seedUsers = true) {
  const now = new Date();
  return {
    user: seedUsers
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

function createAuth(options: { withPlugin?: boolean; seedUsers?: boolean } = {}) {
  const db = seededDb(options.seedUsers ?? true);
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: 'demo-persona-plugin-test-secret-with-enough-entropy',
    database: memoryAdapter(db),
    plugins: options.withPlugin === false ? [] : [demoPersona()],
  });
  return { auth, db };
}

async function postSignIn(auth: ReturnType<typeof createAuth>['auth'], personaId: string) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${DEMO_PERSONA_SIGN_IN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId }),
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('demoPersonaPluginIfAllowed', () => {
  it('registers nothing outside demo mode', () => {
    expect(demoPersonaPluginIfAllowed({ AUTH_MODE: 'google' })).toBeNull();
    expect(demoPersonaPluginIfAllowed({})).toBeNull();
  });

  it('registers nothing in production without the explicit override', () => {
    expect(demoPersonaPluginIfAllowed({ AUTH_MODE: 'demo', NODE_ENV: 'production' })).toBeNull();
    expect(
      demoPersonaPluginIfAllowed({
        AUTH_MODE: 'demo',
        NODE_ENV: 'production',
        ALLOW_DEMO_AUTH: 'yes',
      }),
    ).toBeNull();
  });

  it('registers the plugin when demo auth is allowed', () => {
    expect(demoPersonaPluginIfAllowed({ AUTH_MODE: 'demo', NODE_ENV: 'development' })?.id).toBe(
      'demo-persona',
    );
    expect(
      demoPersonaPluginIfAllowed({
        AUTH_MODE: 'demo',
        NODE_ENV: 'production',
        ALLOW_DEMO_AUTH: 'true',
      })?.id,
    ).toBe('demo-persona');
  });
});

describe('POST /demo-persona/sign-in', () => {
  it('does not exist when the plugin is not registered', async () => {
    vi.stubEnv('AUTH_MODE', 'demo');
    const { auth } = createAuth({ withPlugin: false });
    const response = await postSignIn(auth, 'alex');
    expect(response.status).toBe(404);
  });

  it('answers 404 when demo mode was switched off after the instance was built', async () => {
    vi.stubEnv('AUTH_MODE', 'demo');
    const { auth } = createAuth();
    vi.stubEnv('AUTH_MODE', 'google');
    const response = await postSignIn(auth, 'alex');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'DEMO_PERSONA_NOT_FOUND' });
  });

  it('creates a session for a seeded persona by key or id and sets the cookie', async () => {
    vi.stubEnv('AUTH_MODE', 'demo');
    const { auth, db } = createAuth();

    const response = await postSignIn(auth, 'alex');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user).toMatchObject({
      id: DEMO_PERSONA_IDS.alex,
      name: 'Alex Rivera',
      email: 'alex.demo@splitbook.local',
    });
    expect(typeof body.token).toBe('string');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('better-auth.session_token=');
    expect(setCookie).toContain('HttpOnly');
    expect(db.session).toHaveLength(1);
    expect(db.session[0]).toMatchObject({ userId: DEMO_PERSONA_IDS.alex, token: body.token });

    // The cookie carries a real session: get-session resolves the persona.
    const cookie = setCookie.split(',').map((part) => part.split(';')[0].trim());
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie.join('; ') }),
    });
    expect(session?.user.id).toBe(DEMO_PERSONA_IDS.alex);

    const byId = await postSignIn(auth, ` ${DEMO_PERSONA_IDS.priya} `);
    expect(byId.status).toBe(200);
    expect((await byId.json()).user.id).toBe(DEMO_PERSONA_IDS.priya);
  });

  it('rejects unknown personas with 404 and never creates a session', async () => {
    vi.stubEnv('AUTH_MODE', 'demo');
    const { auth, db } = createAuth();
    const response = await postSignIn(auth, 'mallory');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'DEMO_PERSONA_NOT_FOUND' });
    expect(db.session).toHaveLength(0);
  });

  it('reports an unseeded persona instead of inventing a user', async () => {
    vi.stubEnv('AUTH_MODE', 'demo');
    const { auth, db } = createAuth({ seedUsers: false });
    const response = await postSignIn(auth, 'sam');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'DEMO_PERSONA_NOT_SEEDED' });
    expect(db.user).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });

  it('is callable through the typed server API', async () => {
    vi.stubEnv('AUTH_MODE', 'demo');
    const { auth } = createAuth();
    const result = await auth.api.demoPersonaSignIn({ body: { personaId: 'sam' } });
    expect(result.user.id).toBe(DEMO_PERSONA_IDS.sam);
    await expect(
      auth.api.demoPersonaSignIn({ body: { personaId: 'nobody' } }),
    ).rejects.toBeInstanceOf(APIError);
  });
});

describe('plugin shape', () => {
  it('rate limits the sign-in path to ten entries per minute', () => {
    const plugin = demoPersona();
    expect(plugin.rateLimit).toHaveLength(1);
    const [rule] = plugin.rateLimit;
    expect(rule.pathMatcher(DEMO_PERSONA_SIGN_IN_PATH)).toBe(true);
    expect(rule.pathMatcher('/sign-in/social')).toBe(false);
    expect({ window: rule.window, max: rule.max }).toEqual(DEMO_PERSONA_RATE_LIMIT);
    expect(DEMO_PERSONA_RATE_LIMIT).toEqual({ window: 60, max: 10 });
  });
});
