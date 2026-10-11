import mongoose from 'mongoose';
import { registerSplitbookTools } from './tools';
import { createServer, type Server } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildAuthOptions } from '@/lib/auth/create-auth';
import { createMcpConnectionHandler, MCP_LEDGER_SCOPE } from './connection';
import { MongoClient } from 'mongodb';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { currentMcpGrant } from './grants';
import { MCP_DRAFT_SCOPE } from './config';

/** Real HTTP + real OAuth/PKCE + real SDK. Synthetic users and ephemeral in-memory auth only. */
export function connectionTests(mongo = false) {
  let database: ReturnType<typeof memoryAdapter> | ReturnType<typeof mongodbAdapter>;
  let mongoClient: MongoClient | undefined;
  const records: MemoryDB = {
    user: [],
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
  let server: Server;
  let origin: string;
  let resource: string;
  let route: (request: Request) => Promise<Response>;
  let auth: ReturnType<typeof makeAuth>;
  let token: string;
  let refreshToken: string;
  let clientId: string;
  let cookie: string;
  let exposeTools = false;

  const env = {
    AUTH_SECRET: 'synthetic-mcp-connection-test-secret-32-characters',
    AUTH_ALLOWED_EMAILS: 'connection@example.test,other@example.test',
    NODE_ENV: 'test',
    AUTH_GOOGLE_ID: 'synthetic-client',
    AUTH_GOOGLE_SECRET: 'synthetic-secret',
    AUTH_RATE_LIMIT_ENABLED: 'false',
    MCP_ENABLED: 'true',
    MCP_ALLOW_DCR: 'true',
  };
  function makeAuth(baseURL: string) {
    const base = buildAuthOptions({
      database,
      env: {
        ...env,
        NEXT_PUBLIC_APP_URL: baseURL,
      },
    });
    return betterAuth({ ...base, emailAndPassword: { enabled: true } });
  }

  async function post(path: string, body: unknown, authenticated = false) {
    return fetch(`${origin}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        ...(authenticated ? { cookie } : {}),
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
  }

  async function authorizeCode(drafts = false, allowDrafts = false, login = false) {
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'https://mcp-client.example.test/callback',
      response_type: 'code',
      prompt: 'consent',
      scope: `${MCP_LEDGER_SCOPE} offline_access${drafts ? ` ${MCP_DRAFT_SCOPE}` : ''}`,
      resource,
      state: 'connection-test-state',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    let authorize = await fetch(`${origin}/api/auth/oauth2/authorize?${query}`, {
      headers: login ? {} : { cookie },
      redirect: 'manual',
    });
    if (login) {
      const location = authorize.headers.get('location') ?? (await authorize.json()).url;
      const loginUrl = new URL(location, origin);
      expect(loginUrl.pathname).toBe('/mcp/login');
      authorize = await post(
        '/oauth2/continue',
        { selected: true, oauth_query: loginUrl.search.slice(1) },
        true,
      );
    }
    const authorizationBody = authorize.headers.get('location') ? null : await authorize.json();
    const consentLocation = authorize.headers.get('location') ?? authorizationBody?.url;
    expect(consentLocation, JSON.stringify(authorizationBody)).toBeTypeOf('string');
    const consentURL = new URL(consentLocation, origin);
    expect(consentURL.pathname).toBe('/mcp/consent');
    const details = await fetch(
      `${origin}/api/auth/mcp/consent-details?${new URLSearchParams({ oauth_query: consentURL.search.slice(1) })}`,
      { headers: { cookie } },
    );
    expect(details.status).toBe(200);
    const consent = await post(
      '/oauth2/consent',
      {
        accept: true,
        oauth_query: consentURL.search.slice(1),
        scope: `${MCP_LEDGER_SCOPE} offline_access${allowDrafts ? ` ${MCP_DRAFT_SCOPE}` : ''}`,
      },
      true,
    );
    const accepted = await consent.json();
    expect(consent.status, JSON.stringify(accepted)).toBe(200);
    const callback = new URL(accepted.url ?? accepted.redirect_uri);
    expect(callback.searchParams.get('state')).toBe('connection-test-state');
    return { code: callback.searchParams.get('code')!, verifier };
  }

  async function exchangeCode({ code, verifier }: { code: string; verifier: string }) {
    return fetch(`${origin}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: 'https://mcp-client.example.test/callback',
        resource,
      }),
    });
  }

  async function authorizeClient(drafts = false, allowDrafts = false, login = false) {
    const exchange = await exchangeCode(await authorizeCode(drafts, allowDrafts, login));
    const issued = await exchange.json();
    expect(exchange.status, JSON.stringify(issued)).toBe(200);
    expect(issued.access_token).toBeTypeOf('string');
    expect(issued.refresh_token).toBeTypeOf('string');
    return issued;
  }

  beforeAll(async () => {
    vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
    database = memoryAdapter(records);
    if (mongo) {
      const target = integrationTestDb('mcp-connection');
      await target.connect();
      mongoClient = new MongoClient(target.uri);
      await mongoClient.connect();
      await mongoClient.db().dropDatabase();
      database = mongodbAdapter(mongoClient.db(), { usePlural: true, transaction: false });
    }
    server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers))
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        const request = new Request(`${origin}${incoming.url}`, {
          method: incoming.method,
          headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        });
        const response = await route(request);
        const responseHeaders: Record<string, string | string[]> = Object.fromEntries(
          response.headers,
        );
        if (response.headers.getSetCookie().length)
          responseHeaders['set-cookie'] = response.headers.getSetCookie();
        outgoing.writeHead(response.status, responseHeaders);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        outgoing.writeHead(500);
        outgoing.end('Test server failure');
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    origin = `http://127.0.0.1:${address.port}`;
    resource = `${origin}/api/mcp`;
    auth = makeAuth(origin);
    const mcpHandler = createMcpConnectionHandler(
      auth,
      resource,
      async (subject, client, generation, scopes) =>
        currentMcpGrant((await auth.$context).adapter, env, subject, client, generation, scopes),
      (server, id, scopes, authorize) => {
        if (exposeTools) registerSplitbookTools(server, { id, authorize }, scopes, origin);
      },
    );
    route = (request) =>
      new URL(request.url).pathname === '/api/mcp' ? mcpHandler(request) : auth.handler(request);

    const signup = await post('/sign-up/email', {
      email: 'connection@example.test',
      name: 'Synthetic Connection',
      password: 'synthetic-password-for-test-only',
    });
    expect(signup.status).toBe(200);
    cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const signedIn = await fetch(`${origin}/api/auth/get-session`, { headers: { cookie } });
    expect((await signedIn.json())?.user?.email).toBe('connection@example.test');
    const registration = await post('/oauth2/register', {
      client_name: 'Synthetic MCP Client',
      redirect_uris: ['https://mcp-client.example.test/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: `${MCP_LEDGER_SCOPE} ${MCP_DRAFT_SCOPE} offline_access`,
    });
    const registered = await registration.json();
    expect(registration.status, JSON.stringify(registered)).toBe(201);
    clientId = registered.client_id;
    const issued = await authorizeClient();
    token = issued.access_token;
    refreshToken = issued.refresh_token;
  });

  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (mongoClient) {
      await mongoClient.db().dropDatabase();
      await mongoClient.close();
      await mongoose.disconnect();
    }
  });

  describe('MCP connection authorization', () => {
    it('challenges anonymous callers with resource discovery and rejects browser cookies as MCP credentials', async () => {
      const response = await fetch(resource, { method: 'POST', headers: { cookie } });
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
    });

    it.each(['modern', 'legacy'] as const)(
      'connects using %s transport and calls an authenticated tool',
      async (era) => {
        const client = new Client(
          { name: 'splitbook-test', version: '1' },
          {
            versionNegotiation:
              era === 'modern' ? { mode: { pin: '2026-07-28' } } : { mode: 'legacy' },
          },
        );
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(resource), {
              requestInit: { headers: { Authorization: `Bearer ${token}` } },
            }),
          );
          expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
            'connection_status',
          ]);
          expect(
            (await client.callTool({ name: 'connection_status', arguments: {} })).structuredContent,
          ).toEqual({ connected: true, mode: 'connection-test' });
        } finally {
          await client.close();
        }
      },
    );

    it('rejects tampered tokens and unexpected browser origins', async () => {
      expect(
        (
          await fetch(resource, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}broken` },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(resource, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              Origin: 'https://other.example',
            },
          })
        ).status,
      ).toBe(403);
    });

    it('serves canonical discovery with CIMD and explicit DCR fallback', async () => {
      const response = await fetch(`${origin}/.well-known/oauth-protected-resource/api/mcp`);
      expect(response.status).toBe(200);
      const metadata = await response.json();
      expect(metadata.resource).toBe(resource);
      const as = await fetch(`${origin}/.well-known/oauth-authorization-server/api/auth`);
      expect(as.status).toBe(200);
      const issuer = await as.json();
      expect(issuer.client_id_metadata_document_supported).toBe(true);
      expect(issuer.registration_endpoint).toContain('/oauth2/register');
    });

    it('preserves the signed login request and keeps Draft permission opt-in', async () => {
      const ledgerOnly = await authorizeClient(true, false, true);
      expect(ledgerOnly.scope.split(' ')).not.toContain(MCP_DRAFT_SCOPE);
      const withDrafts = await authorizeClient(true, true);
      expect(withDrafts.scope.split(' ')).toContain(MCP_DRAFT_SCOPE);
      await authorizeClient(); // return to ledger-only consent for later assertions
    });

    it('rejects forged consent, anonymous management and generic consent mutations', async () => {
      expect((await fetch(`${origin}/api/auth/mcp/connections`)).status).toBe(401);
      const details = await fetch(
        `${origin}/api/auth/mcp/consent-details?oauth_query=client_id%3Dforged`,
        { headers: { cookie } },
      );
      expect(details.status).toBe(400);
      expect((await post('/oauth2/delete-consent', { id: 'unknown' }, true)).status).toBe(403);
      expect(
        (
          await post(
            '/oauth2/update-consent',
            { id: 'unknown', update: { scopes: [MCP_DRAFT_SCOPE] } },
            true,
          )
        ).status,
      ).toBe(403);
      expect((await post('/mcp/revoke', { id: '000000000000000000000001' }, true)).status).toBe(
        404,
      );
    });

    it('prevents another member or a cross-origin request from disconnecting a connection', async () => {
      const listing = await fetch(`${origin}/api/auth/mcp/connections`, { headers: { cookie } });
      const { connections } = await listing.json();
      const signup = await post('/sign-up/email', {
        email: 'other@example.test',
        name: 'Other member',
        password: 'synthetic-password-for-other-only',
      });
      expect(signup.status).toBe(200);
      const otherCookie = signup.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      const wrongOwner = await fetch(`${origin}/api/auth/mcp/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          cookie: otherCookie,
        },
        body: JSON.stringify({ id: connections[0].id }),
      });
      expect(wrongOwner.status).toBe(404);
      const crossOrigin = await fetch(`${origin}/api/auth/mcp/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://untrusted.example',
          cookie,
        },
        body: JSON.stringify({ id: connections[0].id }),
      });
      expect(crossOrigin.status).toBe(403);
    });

    it('keeps durable grants across a fresh auth instance and rejects stale page identities', async () => {
      const fresh = makeAuth(origin);
      const response = await fresh.handler(
        new Request(`${origin}/api/auth/mcp/connections`, { headers: { cookie } }),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).connections).toHaveLength(1);
      const stale = await fetch(`${origin}/api/auth/mcp/connections`, {
        headers: { cookie, 'X-Expected-Account': 'a-different-member' },
      });
      expect(stale.status).toBe(419);
    });

    it('checks current account eligibility on every request', async () => {
      const adapter = (await auth.$context).adapter;
      const user = await adapter.findOne<{ id: string; email: string }>({
        model: 'user',
        where: [{ field: 'email', value: 'connection@example.test' }],
      });
      if (!user) throw new Error('Missing fixture');
      await adapter.update({
        model: 'user',
        where: [{ field: 'id', value: user.id }],
        update: { email: 'removed@example.test' },
      });
      try {
        expect(
          (await fetch(resource, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }))
            .status,
        ).toBe(403);
      } finally {
        await adapter.update({
          model: 'user',
          where: [{ field: 'id', value: user.id }],
          update: { email: user.email },
        });
      }
    });

    if (mongo)
      it('runs ledger and private Draft tools through real OAuth and the official SDK without ledger effects', async () => {
        exposeTools = true;
        const db = mongoClient!.db();
        const user = await db.collection('users').findOne({ email: 'connection@example.test' });
        const groupId = new mongoose.Types.ObjectId();
        await db.collection('groups').insertOne({
          _id: groupId,
          name: 'Tool Group',
          defaultCurrency: 'INR',
          tags: [],
          members: [{ user: user!._id, joinedAt: new Date() }],
        });
        const ledgerRows = [
          ['2026-10-01T00:00:00.000Z', 'INR', 10],
          ['2026-10-31T23:59:59.999Z', 'USD', 20],
          ['2026-11-01T00:00:00.000Z', 'INR', 99],
        ] as const;
        await db.collection('expenses').insertMany(
          ledgerRows.map(([date, currency, amount]) => ({
            group: groupId,
            description: 'Boundary Expense',
            currency,
            amount,
            date: new Date(date),
            paidBy: [{ user: user!._id, amount }],
            splitBetween: [{ user: user!._id, amount }],
            splitMethod: 'equal',
            createdBy: user!._id,
            isDeleted: false,
            createdAt: new Date(),
          })),
        );
        const ledger = await authorizeClient();
        const ledgerClient = new Client({ name: 'ledger-tools-test', version: '1' });
        const draftClient = new Client({ name: 'draft-tools-test', version: '1' });
        try {
          await ledgerClient.connect(
            new StreamableHTTPClientTransport(new URL(resource), {
              requestInit: { headers: { Authorization: `Bearer ${ledger.access_token}` } },
            }),
          );
          const ledgerNames = (await ledgerClient.listTools()).tools.map((tool) => tool.name);
          expect(ledgerNames).toContain('group_balances');
          expect(ledgerNames).not.toContain('list_drafts');
          await expect(
            ledgerClient.callTool({ name: 'list_drafts', arguments: { groupId: String(groupId) } }),
          ).rejects.toThrow('not found');
          const groups = await ledgerClient.callTool({ name: 'list_groups', arguments: {} });
          expect(JSON.stringify(groups)).toContain('Tool Group');
          const balances = await ledgerClient.callTool({
            name: 'group_balances',
            arguments: { groupId: String(groupId) },
          });
          expect(balances.isError).not.toBe(true);
          const spending = await ledgerClient.callTool({
            name: 'group_spending',
            arguments: { groupId: String(groupId), from: '2026-10-01', to: '2026-10-31', limit: 1 },
          });
          expect(JSON.stringify(spending)).toContain('UTC');
          const text = (spending.content as Array<{ text: string }>)[0].text;
          const report = JSON.parse(text);
          expect(report.expenses).toHaveLength(1);
          expect(report.pagination.total).toBe(2);
          expect(report.summary).not.toHaveProperty('totalAmount');
          expect(report.summary).not.toHaveProperty('userOwes');
          expect(report.summary).not.toHaveProperty('userGetsBack');
          expect(report.summary.totalsByCurrency).toEqual(
            expect.arrayContaining([
              { currency: 'INR', totalAmount: 10 },
              { currency: 'USD', totalAmount: 20 },
            ]),
          );
          const pageTwo = await ledgerClient.callTool({
            name: 'group_spending',
            arguments: {
              groupId: String(groupId),
              from: '2026-10-01',
              to: '2026-10-31',
              limit: 1,
              page: 2,
            },
          });
          expect(
            JSON.parse((pageTwo.content as Array<{ text: string }>)[0].text).expenses[0]._id,
          ).not.toBe(report.expenses[0]._id);
          const granted = await authorizeClient(true, true);
          await draftClient.connect(
            new StreamableHTTPClientTransport(new URL(resource), {
              requestInit: { headers: { Authorization: `Bearer ${granted.access_token}` } },
            }),
          );
          expect(
            (await draftClient.listTools()).tools
              .map((tool) => tool.name)
              .some((name) => name.includes('save')),
          ).toBe(false);
          const args = {
            groupId: String(groupId),
            requestKey: 'sdk-create-drafts',
            drafts: [{ amount: 450 }, {}],
          };
          const created = await draftClient.callTool({ name: 'create_drafts', arguments: args });
          expect(created.isError).not.toBe(true);
          expect(await draftClient.callTool({ name: 'create_drafts', arguments: args })).toEqual(
            created,
          );
          const rows = await db.collection('expensedrafts').find({ group: groupId }).toArray();
          expect(rows).toHaveLength(2);
          const changed = await draftClient.callTool({
            name: 'replace_draft',
            arguments: {
              groupId: String(groupId),
              draftId: String(rows[0]._id),
              revision: 0,
              values: { description: 'Taxi', amount: 450 },
            },
          });
          expect(changed.isError).not.toBe(true);
          expect(
            (
              await draftClient.callTool({
                name: 'discard_draft',
                arguments: { groupId: String(groupId), draftId: String(rows[0]._id), revision: 0 },
              })
            ).isError,
          ).toBe(true);
          expect(
            (
              await draftClient.callTool({
                name: 'discard_draft',
                arguments: { groupId: String(groupId), draftId: String(rows[0]._id), revision: 1 },
              })
            ).isError,
          ).not.toBe(true);
          expect(await db.collection('expenses').countDocuments({ group: groupId })).toBe(3);
          expect(await db.collection('activities').countDocuments({ group: groupId })).toBe(0);
          await db.collection('groups').updateOne({ _id: groupId }, { $set: { members: [] } });
          expect(
            (
              await draftClient.callTool({
                name: 'list_drafts',
                arguments: { groupId: String(groupId) },
              })
            ).isError,
          ).toBe(true);
        } finally {
          exposeTools = false;
          await ledgerClient.close();
          await draftClient.close();
        }
      });

    it('refreshes, disconnects, reconnects, and never revives the old authorization generation', async () => {
      const refresh = (value: string) =>
        fetch(`${origin}/api/auth/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: value,
            resource,
          }),
        });
      const response = await refresh(refreshToken);
      expect(response.status).toBe(200);
      const refreshed = await response.json();
      const unfinished = await authorizeCode();
      const listing = await fetch(`${origin}/api/auth/mcp/connections`, { headers: { cookie } });
      expect(listing.status).toBe(200);
      const { connections } = await listing.json();
      expect(connections).toHaveLength(1);
      expect(connections[0].scopes).not.toContain(MCP_DRAFT_SCOPE);
      expect((await post('/mcp/revoke', { id: connections[0].id }, true)).status).toBe(200);
      for (const value of [token, refreshed.access_token])
        expect(
          (await fetch(resource, { method: 'POST', headers: { Authorization: `Bearer ${value}` } }))
            .status,
        ).toBe(403);
      expect((await refresh(refreshed.refresh_token)).ok).toBe(false);
      const reconnected = await authorizeClient();
      expect((await exchangeCode(unfinished)).ok).toBe(false);
      const client = new Client({ name: 'reconnected-test', version: '1' });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(resource), {
            requestInit: { headers: { Authorization: `Bearer ${reconnected.access_token}` } },
          }),
        );
        expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
          'connection_status',
        ]);
      } finally {
        await client.close();
      }
      expect(
        (await fetch(resource, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }))
          .status,
      ).toBe(403);
      expect((await refresh(refreshed.refresh_token)).ok).toBe(false);
    });
  });
}
