import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { MongoClient } from 'mongodb';
import { createSplitbookAuth } from '@/lib/auth/create-auth';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { DEMO_PERSONAS } from '@/lib/demo-personas';

const state = vi.hoisted(() => ({
  auth: null as ReturnType<typeof createSplitbookAuth> | null,
  headers: new Headers(),
}));
// Keep the real auth instance and route/page code; replace only Next's request context
// and the singleton's database so each run owns its synthetic users and sessions.
vi.mock('@/lib/auth', () => ({
  auth: {
    get $context() {
      return state.auth!.$context;
    },
    handler: (request: Request) => state.auth!.handler(request),
    api: {
      getSession: (args: { headers: Headers }) => state.auth!.api.getSession(args),
    },
  },
}));
vi.mock('next/headers', () => ({ headers: async () => state.headers }));

import { GET, POST } from '@/app/api/auth/[...all]/route';
import { GET as mcpGet, POST as mcpPost } from '@/app/api/mcp/route';
import { GET as discovery } from '@/app/.well-known/[...path]/route';
import Home from '@/app/page';

export function availabilityTests(mongo = false) {
  const origin = 'http://localhost:31618';
  let client: MongoClient | undefined;
  let database: ReturnType<typeof memoryAdapter> | ReturnType<typeof mongodbAdapter>;
  beforeAll(async () => {
    const now = new Date();
    const users = DEMO_PERSONAS.map((persona) => ({
      id: persona.id,
      name: persona.name,
      email: persona.email,
      emailVerified: false,
      image: persona.image,
      createdAt: now,
      updatedAt: now,
    }));
    const records: MemoryDB = {
      user: users,
      session: [],
      account: [],
      verification: [],
      rateLimit: [],
      jwks: [],
      oauthClient: [],
      oauthAccessToken: [],
      oauthRefreshToken: [],
      oauthConsent: [],
      oauthClientAssertion: [],
      oauthResource: [],
      oauthClientResource: [],
      mcpConnection: [],
    };
    database = memoryAdapter(records);
    if (mongo) {
      const target = integrationTestDb('mcp-availability');
      client = new MongoClient(target.uri);
      await client.connect();
      await client.db().dropDatabase();
      const { ObjectId } = await import('mongodb');
      await client
        .db()
        .collection('users')
        .insertMany(users.map(({ id, ...user }) => ({ _id: new ObjectId(id), ...user })));
      database = mongodbAdapter(client.db(), { usePlural: true, transaction: false });
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    state.headers = new Headers();
  });
  afterAll(async () => {
    await client?.db().dropDatabase();
    await client?.close();
  });

  describe('invalid MCP inactivity configuration at the app boundary', () => {
    it.each(['60', 'abc'])(
      'keeps sign-in and the normal page working while MCP returns 503 for timeout %s',
      async (timeout) => {
        const env = {
          NODE_ENV: 'test',
          AUTH_MODE: 'demo',
          MOBILE_APP_ENV: 'staging',
          AUTH_SECRET: 'synthetic-mcp-availability-test-secret-32-characters',
          AUTH_RATE_LIMIT_ENABLED: 'false',
          NEXT_PUBLIC_APP_URL: origin,
          MCP_ENABLED: 'true',
          MCP_DEPLOYMENT: 'staging',
          MCP_IDLE_TIMEOUT_SECONDS: timeout,
        };
        for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
        state.auth = createSplitbookAuth({ database, env });
        expect(await Home()).toBeTruthy();
        const entered = await POST(
          new Request(`${origin}/api/auth/demo-persona/sign-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body: JSON.stringify({ personaId: 'priya' }),
          }),
        );
        expect(entered.status).toBe(200);
        const cookie = entered.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; ');
        state.headers = new Headers({ cookie });
        const session = await GET(
          new Request(`${origin}/api/auth/get-session`, { headers: state.headers }),
        );
        expect(session.status).toBe(200);
        expect((await session.json()).user.email).toBe('priya.demo@splitbook.local');
        // The real Home server component reads the session and takes its normal signed-in path.
        await expect(Home()).rejects.toThrow('NEXT_REDIRECT');
        for (const path of [
          '/mcp/connections',
          '/oauth2/authorize',
          '/oauth2/token',
          '/oauth2/register',
          '/oauth2/consent',
          '/oauth2/continue',
          '/mcp/revoke',
          '/jwks',
          '/.well-known/oauth-authorization-server',
          '/.well-known/openid-configuration',
        ]) {
          for (const handler of [GET, POST]) {
            const response = await handler(
              new Request(`${origin}/api/auth${path}`, {
                method: handler === POST ? 'POST' : 'GET',
                headers: state.headers,
              }),
            );
            expect(response.status, path).toBe(503);
            expect(response.headers.get('Cache-Control')).toBe('no-store');
          }
        }
        expect((await mcpGet(new Request(`${origin}/api/mcp`))).status).toBe(503);
        expect((await mcpPost(new Request(`${origin}/api/mcp`, { method: 'POST' }))).status).toBe(
          503,
        );
        expect(
          (await discovery(new Request(`${origin}/.well-known/oauth-authorization-server`))).status,
        ).toBe(503);
      },
    );
    it.each([
      { label: 'empty staging timeout', timeout: '', deployment: 'staging' },
      { label: 'copied invalid production override', timeout: 'abc', deployment: 'production' },
    ])('keeps MCP available with $label', async ({ timeout, deployment }) => {
      const env = {
        NODE_ENV: 'test',
        AUTH_MODE: 'demo',
        AUTH_SECRET: 'synthetic-mcp-availability-test-secret-32-characters',
        NEXT_PUBLIC_APP_URL: origin,
        MCP_ENABLED: 'true',
        MCP_DEPLOYMENT: 'staging',
        MOBILE_APP_ENV: deployment,
        MCP_IDLE_TIMEOUT_SECONDS: timeout,
      };
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      state.auth = createSplitbookAuth({ database, env });
      expect(await Home()).toBeTruthy();
      expect((await GET(new Request(`${origin}/api/auth/get-session`))).status).toBe(200);
      expect(
        (await discovery(new Request(`${origin}/.well-known/oauth-authorization-server/api/auth`)))
          .status,
      ).toBe(200);
      // A missing bearer token still gets the normal OAuth challenge, not quarantine.
      expect((await mcpPost(new Request(`${origin}/api/mcp`, { method: 'POST' }))).status).toBe(
        401,
      );
    });
  });
}
