import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { MongoClient } from 'mongodb';
import { EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';
import { signTestIdToken } from '@/lib/auth/test-id-token';
import { buildAuthOptions } from '@/lib/auth/create-auth';
import { integrationTestDb } from '@/lib/test-utils/integration-db';

/** Real auth/OAuth HTTP handlers, repeated against Mongo in the integration suite. */
export function switchAccountTests(mongo = false) {
  const origin = 'http://localhost:3735';
  const resource = `${origin}/api/mcp`;
  const redirectUri = 'https://assistant.example.test/callback';
  const db = integrationTestDb('mcp-switch-account');
  let client: MongoClient | undefined;
  let auth: { handler: (request: Request) => Promise<Response> };
  let firstCookie: string;
  let otherSession: string;
  let clientId: string;
  let signedQuery: string;
  let verifier: string;

  function request(
    path: string,
    cookie = '',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { origin, cookie, 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }
  function sessionCookie(response: Response) {
    const value = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('better-auth.session_token='));
    expect(value).toBeTruthy();
    return value!.split(';')[0];
  }
  async function login(email: string) {
    const response = await request('/sign-in/social', '', {
      provider: 'google',
      idToken: {
        token: signTestIdToken(
          {
            sub: email,
            email,
            name: email === 'first@example.test' ? 'First Member' : 'Second Member',
          },
          'fictional-switch-google-verifier',
        ),
      },
    });
    expect(response.status).toBe(200);
    return sessionCookie(response);
  }
  async function connections(cookie: string) {
    const response = await request('/mcp/connections', cookie);
    expect(response.status).toBe(200);
    return (await response.json()).connections;
  }

  beforeAll(async () => {
    if (mongo) {
      await db.connect();
      client = new MongoClient(db.uri);
      await client.connect();
    }
  });
  afterAll(async () => {
    if (client) {
      await client.close();
      await db.teardown();
    }
  });
  beforeEach(async () => {
    if (mongo) await db.reset();
    const database = client
      ? mongodbAdapter(client.db(), { usePlural: true, transaction: false })
      : memoryAdapter(
          Object.fromEntries(
            [
              'user',
              'session',
              'account',
              'verification',
              'rateLimit',
              'jwks',
              'oauthClient',
              'oauthAccessToken',
              'oauthRefreshToken',
              'oauthConsent',
              'oauthClientAssertion',
              'oauthResource',
              'oauthClientResource',
              'mcpConnection',
              'mcpPendingExclusion',
            ].map((name) => [name, []]),
          ),
        );
    auth = betterAuth({
      ...buildAuthOptions({
        database,
        env: {
          NODE_ENV: 'test',
          NEXT_PUBLIC_APP_URL: origin,
          AUTH_SECRET: 'fictional-switch-account-test-secret-only',
          AUTH_RATE_LIMIT_ENABLED: 'false',
          AUTH_ALLOWED_EMAILS: 'first@example.test,second@example.test',
          AUTH_GOOGLE_ID: 'fictional-client',
          AUTH_GOOGLE_SECRET: 'fictional-client-secret',
          AUTH_TEST_ID_TOKEN_SECRET: 'fictional-switch-google-verifier',
          MCP_ENABLED: 'true',
          MCP_ALLOW_DCR: 'true',
        },
      }),
    });
    firstCookie = await login('first@example.test');
    otherSession = await login('first@example.test');
    const registration = await request('/oauth2/register', '', {
      client_name: 'Fictional Switch Assistant',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'ledger:read drafts:write offline_access',
    });
    expect(registration.status).toBe(201);
    clientId = (await registration.json()).client_id;
    verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      prompt: 'consent',
      scope: 'ledger:read drafts:write offline_access',
      resource,
      state: 'same state + & / ? =',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    const response = await request(`/oauth2/authorize?${query}`, firstCookie);
    const location = response.headers.get('location') ?? (await response.json()).url;
    const approval = new URL(location, origin);
    expect(approval.pathname).toBe('/mcp/consent');
    signedQuery = approval.search.slice(1);
  });

  describe('switching accounts on a pending assistant approval (#735)', () => {
    it.each(['https://outside.example.test', '//outside.example.test', '/\\outside.example.test'])(
      'refuses a supplied return address (%s) without ending the session',
      async (callbackUrl) => {
        const response = await request('/mcp/switch-account', firstCookie, {
          oauth_query: signedQuery,
          callbackUrl,
        });
        expect(response.status).toBe(400);
        expect(response.headers.get('location')).toBeNull();
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(await (await request('/get-session', firstCookie)).json()).toMatchObject({
          user: { email: 'first@example.test' },
        });
      },
    );

    it('refuses a tampered or expired request without signing the member out', async () => {
      const tampered = new URLSearchParams(signedQuery);
      tampered.set('state', 'changed');
      expect(
        (await request('/mcp/switch-account', firstCookie, { oauth_query: tampered.toString() }))
          .status,
      ).toBe(400);
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(
          new Date((Number(new URLSearchParams(signedQuery).get('exp')) + 1) * 1000),
        );
        const expired = await request('/mcp/switch-account', firstCookie, {
          oauth_query: signedQuery,
        });
        expect(expired.status).toBe(400);
        expect(await expired.json()).toMatchObject({
          error: 'invalid_signature',
        });
        expect(expired.headers.getSetCookie()).toEqual([]);
        expect(await (await request('/get-session', firstCookie)).json()).toMatchObject({
          user: { email: 'first@example.test' },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('refuses consent when the unchanged approval expires while signing in again', async () => {
      expect(
        (await request('/mcp/switch-account', firstCookie, { oauth_query: signedQuery })).status,
      ).toBe(200);
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(
          new Date((Number(new URLSearchParams(signedQuery).get('exp')) + 1) * 1000),
        );
        const secondCookie = await login('second@example.test');
        expect(
          (
            await request(
              `/mcp/consent-details?${new URLSearchParams({ oauth_query: signedQuery })}`,
              secondCookie,
            )
          ).status,
        ).toBe(400);
        const response = await request('/oauth2/consent', secondCookie, {
          accept: true,
          oauth_query: signedQuery,
          scope: 'ledger:read',
        });
        expect(response.ok).toBe(false);
        expect(await connections(otherSession)).toEqual([]);
        expect(await connections(secondCookie)).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('requires this session, its expected account and a trusted origin', async () => {
      const body = { oauth_query: signedQuery };
      expect((await request('/mcp/switch-account', '', body)).status).toBe(401);
      expect(
        (
          await request('/mcp/switch-account', firstCookie, body, {
            origin: 'https://outside.example.test',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request('/mcp/switch-account', firstCookie, body, {
            [EXPECTED_ACCOUNT_HEADER]: 'other-account',
          })
        ).status,
      ).toBe(419);
      expect(await (await request('/get-session', firstCookie)).json()).toMatchObject({
        user: { email: 'first@example.test' },
      });
    });

    it('ends only this session and returns the unchanged signed approval without granting either account access', async () => {
      const switched = await request('/mcp/switch-account', firstCookie, {
        oauth_query: signedQuery,
      });
      expect(switched.status).toBe(200);
      const loginUrl = new URL((await switched.json()).url, origin);
      expect(loginUrl.origin).toBe(origin);
      expect(loginUrl.pathname).toBe('/login');
      const callback = loginUrl.searchParams.get('callbackUrl');
      expect(callback).toBe(`/mcp/consent?${signedQuery}`);
      expect(switched.headers.getSetCookie()).toContainEqual(
        expect.stringMatching(/^better-auth\.session_token=;.*Max-Age=0/),
      );
      expect(switched.headers.getSetCookie()).toContainEqual(
        expect.stringMatching(/^better-auth\.session_data=;.*Max-Age=0/),
      );
      expect(await (await request('/get-session', firstCookie)).json()).toBeNull();
      expect(await (await request('/get-session', otherSession)).json()).toMatchObject({
        user: { email: 'first@example.test' },
      });
      const secondCookie = await login('second@example.test');
      const returnedQuery = new URL(callback!, origin).search.slice(1);
      const details = await request(
        `/mcp/consent-details?${new URLSearchParams({ oauth_query: returnedQuery })}`,
        secondCookie,
      );
      expect(details.status).toBe(200);
      expect(await details.json()).toMatchObject({
        clientId,
        scopes: ['ledger:read', 'drafts:write', 'offline_access'],
      });
      expect(await connections(otherSession)).toEqual([]);
      expect(await connections(secondCookie)).toEqual([]);
      // Only an explicit new approval may now issue a code, for the second account.
      const consent = await request('/oauth2/consent', secondCookie, {
        oauth_query: returnedQuery,
        accept: true,
        scope: 'ledger:read offline_access',
      });
      expect(consent.status).toBe(200);
      const accepted = await consent.json();
      const destination = new URL(accepted.url ?? accepted.redirect_uri);
      expect(destination.searchParams.get('state')).toBe('same state + & / ? =');
      const exchange = await auth.handler(
        new Request(`${origin}/api/auth/oauth2/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code: destination.searchParams.get('code')!,
            code_verifier: verifier,
            redirect_uri: redirectUri,
            resource,
          }),
        }),
      );
      expect(exchange.status).toBe(200);
      expect((await exchange.json()).access_token).toBeTypeOf('string');
      expect(await connections(otherSession)).toEqual([]);
      expect(await connections(secondCookie)).toHaveLength(1);
    });
  });
}
