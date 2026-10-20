import mongoose from 'mongoose';
import { connectedAssistantName } from './assistant-name';
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
import { expenseDraftService } from '@/lib/services/expense-draft.service';

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
        currentMcpGrant(
          (await auth.$context).adapter,
          env,
          subject,
          client,
          generation,
          scopes,
          true,
        ),
      async (server, id, scopes, authorize, clientId) => {
        if (exposeTools)
          registerSplitbookTools(
            server,
            {
              id,
              authorize,
              assistant: {
                name: await connectedAssistantName((await auth.$context).adapter, clientId),
              },
            },
            scopes,
            origin,
          );
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
    const connectionList = async () => {
      const response = await fetch(`${origin}/api/auth/mcp/connections`, { headers: { cookie } });
      expect(response.status).toBe(200);
      return (await response.json()).connections as Array<{
        id: string;
        name: string;
        access: string;
        lastUsedAt: string | null;
      }>;
    };

    it('lists the assistant metadata name, access and Not used yet before an authorized call', async () => {
      expect(await connectionList()).toMatchObject([
        {
          name: 'Synthetic MCP Client',
          access: 'Ledger',
          lastUsedAt: null,
        },
      ]);
    });

    it('records authorized SDK calls at most once a minute and does not count refused calls or Settings reads', async () => {
      const now = new Date();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);
      const client = new Client({ name: 'last-use-test', version: '1' });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(resource), {
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
          }),
        );
        expect((await connectionList())[0].lastUsedAt).toBe(now.toISOString());
        vi.setSystemTime(new Date(now.getTime() + 59_999));
        await client.callTool({ name: 'connection_status', arguments: {} });
        expect((await connectionList())[0].lastUsedAt).toBe(now.toISOString());
        const later = new Date(now.getTime() + 60_000);
        vi.setSystemTime(later);
        await Promise.all([
          client.listTools(),
          client.callTool({ name: 'connection_status', arguments: {} }),
        ]);
        expect((await connectionList())[0].lastUsedAt).toBe(later.toISOString());
        vi.setSystemTime(new Date(now.getTime() + 120_000));
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
              headers: { Authorization: `Bearer ${token}`, Origin: 'https://untrusted.example' },
            })
          ).status,
        ).toBe(403);
        expect((await connectionList())[0].lastUsedAt).toBe(later.toISOString());
      } finally {
        await client.close();
        vi.useRealTimers();
      }
    });

    it('keeps an authorized HTTP call working when last-use storage fails and retries next call', async () => {
      const now = new Date(Date.now() + 180_000);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);
      const client = new Client({ name: 'last-use-failure-test', version: '1' });
      const adapter = (await auth.$context).adapter;
      const originalUpdate = adapter.update.bind(adapter);
      let failLastUse = false;
      const update = vi.spyOn(adapter, 'update').mockImplementation(async (args) => {
        if (args.model === 'mcpConnection' && failLastUse) {
          failLastUse = false;
          throw new Error('Synthetic last-use storage failure');
        }
        return originalUpdate(args);
      });
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(resource), {
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
          }),
        );
        const previous = (await connectionList())[0].lastUsedAt;
        const later = new Date(now.getTime() + 60_000);
        vi.setSystemTime(later);
        failLastUse = true;
        await expect(client.listTools()).resolves.toHaveProperty('tools');
        expect((await connectionList())[0].lastUsedAt).toBe(previous);
        expect(warning).toHaveBeenCalledWith(
          'Could not record assistant last use; the next authorized call will retry.',
        );
        await client.listTools();
        expect((await connectionList())[0].lastUsedAt).toBe(later.toISOString());
      } finally {
        update.mockRestore();
        warning.mockRestore();
        await client.close();
        vi.useRealTimers();
      }
    });

    it('challenges anonymous callers with resource discovery and rejects browser cookies as MCP credentials', async () => {
      const response = await fetch(resource, { method: 'POST', headers: { cookie } });
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
    });

    it.each([
      { enabled: true, allowDrafts: true },
      { enabled: true, allowDrafts: false },
      { enabled: false, allowDrafts: false },
    ])(
      'follows the challenge through consent and tools (enabled=$enabled, opted in=$allowDrafts)',
      async ({ enabled, allowDrafts }) => {
        const previousRoute = route;
        vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', String(enabled));
        const handler = createMcpConnectionHandler(
          auth,
          resource,
          async (subject, client, generation, scopes) =>
            currentMcpGrant(
              (await auth.$context).adapter,
              env,
              subject,
              client,
              generation,
              scopes,
              true,
            ),
          (server, id, scopes, authorize) =>
            registerSplitbookTools(server, { id, authorize }, scopes, origin),
        );
        route = (request) =>
          new URL(request.url).pathname === '/api/mcp' ? handler(request) : auth.handler(request);
        const client = new Client({ name: 'challenge-client', version: '1' });
        try {
          const challenge = await fetch(resource, { method: 'POST' });
          expect(challenge.status).toBe(401);
          const scopes = challenge.headers.get('WWW-Authenticate')?.match(/\bscope="([^"]+)"/)?.[1];
          expect(scopes?.split(' ')).toEqual(
            enabled ? [MCP_LEDGER_SCOPE, MCP_DRAFT_SCOPE] : [MCP_LEDGER_SCOPE],
          );
          if (!scopes) throw new Error('Missing challenge scopes');
          const verifier = randomBytes(32).toString('base64url');
          // Like a real assistant, request only the scopes advertised by the server.
          const query = new URLSearchParams({
            client_id: clientId,
            redirect_uri: 'https://mcp-client.example.test/callback',
            response_type: 'code',
            prompt: 'consent',
            scope: scopes,
            resource,
            state: 'challenge-state',
            code_challenge_method: 'S256',
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          });
          const authorization = await fetch(`${origin}/api/auth/oauth2/authorize?${query}`, {
            headers: { cookie },
            redirect: 'manual',
          });
          const location =
            authorization.headers.get('location') ?? (await authorization.json()).url;
          const consentURL = new URL(location, origin);
          expect(consentURL.pathname).toBe('/mcp/consent');
          const details = await fetch(
            `${origin}/api/auth/mcp/consent-details?${new URLSearchParams({ oauth_query: consentURL.search.slice(1) })}`,
            { headers: { cookie } },
          );
          expect(details.status).toBe(200);
          const offered = (await details.json()).scopes as string[];
          expect(offered).toEqual(scopes.split(' '));
          expect(offered.includes(MCP_DRAFT_SCOPE)).toBe(enabled);
          const consent = await post(
            '/oauth2/consent',
            {
              accept: true,
              oauth_query: consentURL.search.slice(1),
              scope: offered.filter((scope) => scope !== MCP_DRAFT_SCOPE || allowDrafts).join(' '),
            },
            true,
          );
          expect(consent.status).toBe(200);
          const accepted = await consent.json();
          const callback = new URL(accepted.url ?? accepted.redirect_uri);
          expect(callback.searchParams.get('state')).toBe('challenge-state');
          const exchange = await exchangeCode({
            code: callback.searchParams.get('code')!,
            verifier,
          });
          expect(exchange.status).toBe(200);
          const issued = await exchange.json();
          expect(issued.scope.split(' ').includes(MCP_DRAFT_SCOPE)).toBe(allowDrafts);
          await client.connect(
            new StreamableHTTPClientTransport(new URL(resource), {
              requestInit: { headers: { Authorization: `Bearer ${issued.access_token}` } },
            }),
          );
          expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(
            [
              'connection_status',
              'group_balances',
              'group_context',
              'group_spending',
              'list_groups',
              ...(allowDrafts
                ? ['create_drafts', 'discard_draft', 'list_drafts', 'replace_draft']
                : []),
            ].sort(),
          );
        } finally {
          await client.close();
          route = previousRoute;
          vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
          await authorizeClient();
        }
      },
    );

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
      expect((await connectionList())[0].access).toBe('Ledger');
      const withDrafts = await authorizeClient(true, true);
      expect(withDrafts.scope.split(' ')).toContain(MCP_DRAFT_SCOPE);
      expect((await connectionList())[0].access).toBe('Ledger + To review');
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
            JSON.parse((pageTwo.content as Array<{ text: string }>)[0].text).expenses[0].id,
          ).not.toBe(report.expenses[0].id);
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
          const creation = JSON.parse((created.content as Array<{ text: string }>)[0].text);
          expect(creation).toMatchObject({
            summary: 'Added 2 to To review in Splitbook',
            reviewUrl: `${origin}/groups/${groupId}/review`,
            drafts: [
              {
                preparedBy: { kind: 'assistant', name: 'Synthetic MCP Client' },
                changedBy: { kind: 'assistant', name: 'Synthetic MCP Client' },
              },
              {
                preparedBy: { kind: 'assistant', name: 'Synthetic MCP Client' },
                changedBy: { kind: 'assistant', name: 'Synthetic MCP Client' },
              },
            ],
          });
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

    type NamesakeGroup = { groupId: string; connectedId: string; namesakeId: string };
    type ToolReply = { text: string; reply: Record<string, unknown> };
    /** An email or photo key, any email address, or the fixtures' photo and receipt links. */
    const privateData =
      /"(email|image)"\s*:|[\w.+-]+@[\w-]+(\.[\w-]+)+|images\.example|receipts\.example/;
    /**
     * A Group shared with a namesake who has a photo, an Expense the namesake paid and a payment
     * to them, worked on through the tools as the connected member (#438).
     */
    async function withNamesakeGroup<T>(
      work: (
        call: (tool: string, args?: Record<string, unknown>) => Promise<ToolReply>,
        group: NamesakeGroup & { tools: string[] },
      ) => Promise<T>,
      drafts = false,
    ): Promise<T> {
      exposeTools = true;
      const db = mongoClient!.db();
      const connected = await db.collection('users').findOne({ email: 'connection@example.test' });
      const namesake = new mongoose.Types.ObjectId();
      const groupId = new mongoose.Types.ObjectId();
      await db.collection('users').insertOne({
        _id: namesake,
        name: 'Synthetic Connection',
        email: 'namesake@example.test',
        image: 'https://images.example.test/namesake.png',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db
        .collection('users')
        .updateOne(
          { _id: connected!._id },
          { $set: { image: 'https://images.example.test/connected.png' } },
        );
      await db.collection('groups').insertOne({
        _id: groupId,
        name: 'Namesake Group',
        defaultCurrency: 'INR',
        tags: [],
        members: [
          { user: connected!._id, joinedAt: new Date() },
          { user: namesake, joinedAt: new Date() },
        ],
      });
      await db.collection('expenses').insertOne({
        group: groupId,
        description: 'Namesake dinner',
        currency: 'INR',
        amount: 1000,
        date: new Date('2026-10-10T00:00:00.000Z'),
        paidBy: [{ user: namesake, amount: 1000 }],
        splitBetween: [
          { user: connected!._id, amount: 500 },
          { user: namesake, amount: 500 },
        ],
        splitMethod: 'equal',
        category: 'food',
        tag: '',
        notes: 'Window table',
        receiptUrl: 'https://receipts.example.test/private.png',
        createdBy: namesake,
        isDeleted: false,
        createdAt: new Date(),
      });
      await db.collection('settlements').insertOne({
        group: groupId,
        paidBy: connected!._id,
        paidTo: namesake,
        amount: 200,
        currency: 'INR',
        createdBy: connected!._id,
        createdAt: new Date(),
      });
      const grant = drafts ? await authorizeClient(true, true) : await authorizeClient();
      const client = new Client({ name: 'namesake-test', version: '1' });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(resource), {
            requestInit: { headers: { Authorization: `Bearer ${grant.access_token}` } },
          }),
        );
        const call = async (tool: string, args: Record<string, unknown> = {}) => {
          const result = await client.callTool({ name: tool, arguments: args });
          const text = (result.content as Array<{ text: string }>)[0].text;
          expect(result.isError, text).not.toBe(true);
          // connection_status answers in words; every other tool answers in JSON.
          return { text, reply: tool === 'connection_status' ? {} : JSON.parse(text) };
        };
        return await work(call, {
          groupId: String(groupId),
          connectedId: String(connected!._id),
          namesakeId: String(namesake),
          tools: (await client.listTools()).tools.map((tool) => tool.name),
        });
      } finally {
        exposeTools = false;
        await client.close();
        await db.collection('users').deleteOne({ _id: namesake });
        await db.collection('users').updateOne({ _id: connected!._id }, { $unset: { image: '' } });
        await db.collection('groups').deleteOne({ _id: groupId });
        for (const name of ['expenses', 'settlements', 'expensedrafts'])
          await db.collection(name).deleteMany({ group: groupId });
      }
    }
    /** One ledger tool's reply about the namesake Group. */
    const readNamesakeGroup = (tool: string, args: Record<string, unknown> = {}) =>
      withNamesakeGroup(async (call, group) => ({
        ...(await call(tool, { groupId: group.groupId, ...args })),
        ...group,
      }));

    if (mongo)
      it('never sends an email or photo in any tool reply', async () => {
        const replies = await withNamesakeGroup(async (call, group) => {
          const { groupId, connectedId, namesakeId } = group;
          const created = await call('create_drafts', {
            groupId,
            requestKey: 'namesake-drafts',
            drafts: [
              {
                description: 'Namesake taxi',
                amount: 300,
                paidBy: [{ user: namesakeId }],
                splitMethod: 'equal',
                splitBetween: [{ user: connectedId }, { user: namesakeId }],
              },
            ],
          });
          const [draft] = created.reply.drafts as Array<{ id: string; revision: number }>;
          const replaced = await call('replace_draft', {
            groupId,
            draftId: draft.id,
            revision: draft.revision,
            values: { description: 'Namesake taxi home', amount: 300 },
          });
          const calls: Record<string, ToolReply> = {
            connection_status: await call('connection_status'),
            list_groups: await call('list_groups'),
            group_context: await call('group_context', { groupId }),
            group_balances: await call('group_balances', { groupId }),
            group_spending: await call('group_spending', {
              groupId,
              from: '2026-10-01',
              to: '2026-10-31',
            }),
            create_drafts: created,
            replace_draft: replaced,
            list_drafts: await call('list_drafts', { groupId }),
            discard_draft: await call('discard_draft', {
              groupId,
              draftId: draft.id,
              revision: replaced.reply.revision,
            }),
          };
          // A tool added later must be added here, so its reply is checked too.
          expect(Object.keys(calls).sort()).toEqual([...group.tools].sort());
          return calls;
        }, true);
        for (const [tool, { text }] of Object.entries(replies))
          expect(text, tool).not.toMatch(privateData);
      });

    if (mongo)
      it('marks the connected member in group_context, even beside a namesake', async () => {
        const { reply, connectedId, namesakeId } = await readNamesakeGroup('group_context');
        expect(reply.members).toEqual(
          expect.arrayContaining([
            { id: connectedId, name: 'Synthetic Connection', you: true },
            { id: namesakeId, name: 'Synthetic Connection' },
          ]),
        );
        expect(reply.members).toHaveLength(2);
      });

    if (mongo)
      it('names a member whose account is gone as a Former member in group_context', async () => {
        const { reply, connectedId } = await withNamesakeGroup(async (call, group) => {
          await mongoClient!
            .db()
            .collection<{ members: Array<{ user: mongoose.Types.ObjectId; joinedAt: Date }> }>(
              'groups',
            )
            .updateOne(
              { _id: new mongoose.Types.ObjectId(group.groupId) },
              { $push: { members: { user: new mongoose.Types.ObjectId(), joinedAt: new Date() } } },
            );
          return { ...(await call('group_context', { groupId: group.groupId })), ...group };
        });
        expect(reply.members).toEqual(
          expect.arrayContaining([
            { id: connectedId, name: 'Synthetic Connection', you: true },
            { id: null, name: 'Former member' },
          ]),
        );
      });

    if (mongo)
      it('names members in group_balances by id and name only, marking the connected member', async () => {
        const { text, reply, connectedId, namesakeId } = await readNamesakeGroup('group_balances');
        expect(text).not.toMatch(privateData);
        const you = { id: connectedId, name: 'Synthetic Connection', you: true };
        const namesake = { id: namesakeId, name: 'Synthetic Connection' };
        const inr = {
          currency: 'INR',
          balances: expect.arrayContaining([
            { user: you, balance: -300 },
            { user: namesake, balance: 300 },
          ]),
          debts: [{ from: you, to: namesake, amount: 300 }],
        };
        expect(reply.balances).toEqual({ ...inr, byCurrency: [inr], hasMixedCurrencies: false });
      });

    if (mongo)
      it('lists Expenses in group_spending from an explicit field list, members by id and name', async () => {
        const { text, reply, connectedId, namesakeId } = await readNamesakeGroup('group_spending', {
          from: '2026-10-01',
          to: '2026-10-31',
        });
        expect(text).not.toMatch(privateData);
        const you = { id: connectedId, name: 'Synthetic Connection', you: true };
        const namesake = { id: namesakeId, name: 'Synthetic Connection' };
        expect(reply.expenses).toEqual([
          {
            id: expect.stringMatching(/^[a-f0-9]{24}$/),
            description: 'Namesake dinner',
            amount: 1000,
            currency: 'INR',
            date: '2026-10-10T00:00:00.000Z',
            category: 'food',
            tag: '',
            notes: 'Window table',
            splitMethod: 'equal',
            paidBy: [{ user: namesake, amount: 1000 }],
            splitBetween: [
              { user: you, amount: 500 },
              { user: namesake, amount: 500 },
            ],
            createdBy: namesake,
          },
        ]);
      });

    if (mongo)
      it('enforces To review attribution, quotas and revocation through the MCP boundary', async () => {
        exposeTools = true;
        const db = mongoClient!.db();
        const user = await db.collection('users').findOne({ email: 'connection@example.test' });
        const group = new mongoose.Types.ObjectId();
        const other = new mongoose.Types.ObjectId();
        await db.collection('groups').insertOne({
          _id: group,
          name: 'To review Group',
          defaultCurrency: 'INR',
          tags: [],
          members: [{ user: user!._id }, { user: other }],
        });
        const adapter = (await auth.$context).adapter;
        await adapter.update({
          model: 'oauthClient',
          where: [{ field: 'clientId', value: clientId }],
          update: { name: '  Synthetic\n Assistant\u0000  ' },
        });
        const grant = await authorizeClient(true, true);
        const client = new Client({ name: 'to-review-test', version: '1' });
        const payload = (result: Awaited<ReturnType<Client['callTool']>>) =>
          JSON.parse((result.content as Array<{ text: string }>)[0].text);
        const call = (name: string, args: Record<string, unknown> = {}) =>
          client.callTool({ name, arguments: { groupId: String(group), ...args } });
        const create = (count: number, requestKey: string) =>
          call('create_drafts', {
            requestKey,
            drafts: Array.from({ length: count }, () => ({})),
          });
        const list = async () => payload(await call('list_drafts')).drafts;
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(resource), {
              requestInit: { headers: { Authorization: `Bearer ${grant.access_token}` } },
            }),
          );
          const tools = (await client.listTools()).tools;
          // An exhaustive tool allowlist makes any new ledger-writing tool an explicit review.
          expect(tools.map((tool) => tool.name).sort()).toEqual([
            'connection_status',
            'create_drafts',
            'discard_draft',
            'group_balances',
            'group_context',
            'group_spending',
            'list_drafts',
            'list_groups',
            'replace_draft',
          ]);
          for (const tool of tools.filter((tool) => /draft/.test(tool.name))) {
            expect(tool.description).toContain('To review');
            expect(tool.description).toContain('100 per member per Group');
            expect(tool.description).toContain('only the member can save');
            expect(tool.description).not.toMatch(/private drafts|collection/i);
          }
          // ADR 0008: the tool that discards an item says the delete can't be undone (#579).
          expect(tools.find((tool) => tool.name === 'discard_draft')?.description).toMatch(
            /^PERMANENTLY delete one unfinished item .*Content cannot be recovered\./,
          );
          const connections = (
            await (
              await fetch(`${origin}/api/auth/mcp/connections`, {
                headers: { cookie },
              })
            ).json()
          ).connections;
          expect(connections[0].name).toBe('Synthetic Assistant');
          const assistant = { kind: 'assistant', name: connections[0].name };
          const one = await create(1, 'to-review-single');
          expect(payload(one)).toMatchObject({
            summary: 'Added 1 to To review in Splitbook',
            reviewUrl: `${origin}/groups/${group}/review`,
            drafts: [{ preparedBy: assistant, changedBy: assistant }],
          });
          expect(await create(1, 'to-review-single')).toEqual(one);
          const row = payload(one).drafts[0];
          // The existing schema refuses attribution supplied either outside or inside values.
          for (const forged of [{ kind: 'member' }, { kind: 'assistant', name: 'Forged name' }]) {
            for (const args of [
              {
                preparedBy: forged,
                changedBy: forged,
                assistant: { name: 'Forged name' },
                drafts: [{}],
              },
              { drafts: [{ preparedBy: forged, changedBy: forged }] },
            ]) {
              const result = await call('create_drafts', {
                requestKey: 'forged-attribution',
                ...args,
              }).catch(() => null);
              if (result) expect(result.isError).toBe(true);
              expect(await list()).toEqual([row]);
              expect(await db.collection('expensedrafts').find({ group }).toArray()).toMatchObject([
                { preparedBy: assistant, changedBy: assistant },
              ]);
            }
            for (const args of [
              { changedBy: forged, values: {} },
              { values: { preparedBy: forged, changedBy: forged } },
            ]) {
              const result = await call('replace_draft', {
                draftId: row.id,
                revision: 0,
                ...args,
              }).catch(() => null);
              if (result) expect(result.isError).toBe(true);
              expect(await list()).toEqual([row]);
            }
          }
          // A pre-existing member Draft remains member-prepared when the assistant edits it.
          await db.collection('expensedrafts').updateOne(
            { _id: new mongoose.Types.ObjectId(row.id) },
            {
              $set: { preparedBy: { kind: 'member' }, changedBy: { kind: 'member' } },
            },
          );
          const edited = payload(
            await call('replace_draft', {
              draftId: row.id,
              revision: 0,
              values: { description: 'Member correction' },
            }),
          );
          expect(edited).toMatchObject({
            preparedBy: { kind: 'member' },
            changedBy: assistant,
            revision: 1,
          });
          expect(await list()).toEqual([edited]);
          const discarded = payload(await call('discard_draft', { draftId: row.id, revision: 1 }));
          expect(discarded).toMatchObject({
            state: 'discarded',
            preparedBy: { kind: 'member' },
            changedBy: assistant,
          });
          // Seed old records and another member's full allocation; neither uses this member's capacity.
          await db.collection('expensedrafts').insertMany(
            Array.from({ length: 100 }, (_, itemIndex) => ({
              group,
              owner: other,
              state: 'active',
              revision: 0,
              values: {},
              requestKey: 'other-member',
              itemIndex,
              createdAt: new Date(),
              updatedAt: new Date(),
            })),
          );
          await db.collection('expensedrafts').insertOne({
            group,
            owner: user!._id,
            state: 'saved',
            revision: 1,
            expenseId: String(new mongoose.Types.ObjectId()),
            requestKey: 'already-saved',
            itemIndex: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          for (let i = 0; i < 9; i++)
            expect((await create(10, `quota-fill-${i}`)).isError).not.toBe(true);
          await create(5, 'quota-fill-five');
          expect(await list()).toHaveLength(95);
          const over = await create(6, 'quota-over-batch');
          expect(over.isError).toBe(true);
          expect((over.content as Array<{ text: string }>)[0].text).toBe(
            'You have 100 items waiting in this Group. Save or delete some before keeping more.',
          );
          expect(await list()).toHaveLength(95);
          const raced = await Promise.all([
            create(5, 'quota-race-one'),
            create(5, 'quota-race-two'),
          ]);
          expect(raced.filter((result) => result.isError)).toHaveLength(1);
          expect(await list()).toHaveLength(100);
          expect((await create(1, 'quota-at-limit')).isError).toBe(true);
          expect(await list()).toHaveLength(100);
          expect(await db.collection('expenses').countDocuments({ group })).toBe(0);
          expect(await db.collection('activities').countDocuments({ group })).toBe(0);
          expect((await post('/mcp/revoke', { id: connections[0].id }, true)).status).toBe(200);
          await expect(call('list_drafts')).rejects.toThrow();
          await expect(create(1, 'revoked-create')).rejects.toThrow();
        } finally {
          exposeTools = false;
          await client.close();
          await adapter.update({
            model: 'oauthClient',
            where: [{ field: 'clientId', value: clientId }],
            update: { name: 'Synthetic MCP Client' },
          });
          // Later connection tests start from a fresh, ledger-only grant.
          const restored = await authorizeClient();
          token = restored.access_token;
          refreshToken = restored.refresh_token;
        }
      });

    if (mongo)
      it('shows assistants the Category choices, how to prepare a Ready item, and To review words', async () => {
        exposeTools = true;
        const db = mongoClient!.db();
        const user = await db.collection('users').findOne({ email: 'connection@example.test' });
        const groupId = new mongoose.Types.ObjectId();
        await db.collection('groups').insertOne({
          _id: groupId,
          name: 'Category choices',
          defaultCurrency: 'INR',
          tags: [],
          members: [{ user: user!._id, joinedAt: new Date() }],
        });
        const grant = await authorizeClient(true, true);
        const client = new Client({ name: 'category-choices-test', version: '1' });
        const payload = (result: Awaited<ReturnType<Client['callTool']>>) =>
          (result.content as Array<{ text: string }>)[0].text;
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(resource), {
              requestInit: { headers: { Authorization: `Bearer ${grant.access_token}` } },
            }),
          );
          const tools = Object.fromEntries(
            (await client.listTools()).tools.map((tool) => [tool.name, tool]),
          );
          const ids = [
            'food',
            'transport',
            'accommodation',
            'travel',
            'entertainment',
            'shopping',
            'housing',
            'health',
            'education',
            'other',
          ];
          type Schema = { properties: Record<string, Schema>; items: Schema };
          const created = tools.create_drafts.inputSchema as unknown as Schema;
          const replaced = tools.replace_draft.inputSchema as unknown as Schema;
          for (const category of [
            created.properties.drafts.items.properties.category,
            replaced.properties.values.properties.category,
          ]) {
            expect(category).toMatchObject({ enum: ids });
            expect(JSON.stringify(category)).toContain('food = Food & Drink');
            expect(JSON.stringify(category)).toContain('other = Other');
          }
          for (const name of ['create_drafts', 'replace_draft']) {
            expect(tools[name].description).toContain(
              'For one payer, give who paid; they paid the whole amount. For several payers, give each amount.',
            );
            expect(tools[name].description).toContain(
              "Choose a Category only when the member's words make it clear; otherwise omit it, and it's saved as Other.",
            );
            // A Tag is required and has no default, so a clear match is set and anything else is asked.
            expect(tools[name].description).toContain(
              "Set the Group Tag that clearly matches the member's words (for example a meal and Food); if none clearly fits, ask the member.",
            );
          }
          for (const name of ['list_drafts', 'create_drafts', 'replace_draft', 'discard_draft']) {
            expect(tools[name].description).toContain("items in the member's To review");
            expect(tools[name].description).toContain('never call them drafts');
          }
          const context = JSON.parse(
            payload(
              await client.callTool({
                name: 'group_context',
                arguments: { groupId: String(groupId) },
              }),
            ),
          );
          expect(context.categories).toHaveLength(ids.length);
          expect(context.categories).toContainEqual({ id: 'food', label: 'Food & Drink' });
          const create = (category: string, requestKey: string) =>
            client.callTool({
              name: 'create_drafts',
              arguments: {
                groupId: String(groupId),
                requestKey,
                drafts: [{ description: 'Dinner', category }],
              },
            });
          const food = await create('food', 'category-choice-food');
          expect(food.isError).not.toBe(true);
          expect(JSON.parse(payload(food)).drafts[0].values.category).toBe('food');
          const unknown = await create('snacks', 'category-choice-unknown');
          expect(unknown.isError).toBe(true);
          expect(payload(unknown)).toMatch(/category/);
          expect(await db.collection('expensedrafts').countDocuments({ group: groupId })).toBe(1);
        } finally {
          exposeTools = false;
          await client.close();
          const restored = await authorizeClient();
          token = restored.access_token;
          refreshToken = restored.refresh_token;
        }
      });

    if (mongo)
      it("makes Claude's staging item ready and saves it with the payer paying the whole amount", async () => {
        exposeTools = true;
        const db = mongoClient!.db();
        const user = await db.collection('users').findOne({ email: 'connection@example.test' });
        const groupId = new mongoose.Types.ObjectId();
        const tagId = new mongoose.Types.ObjectId();
        await db.collection('groups').insertOne({
          _id: groupId,
          name: 'Staging replay',
          defaultCurrency: 'INR',
          tags: [{ _id: tagId, name: 'Food', isArchived: false, isDeleted: false }],
          members: [{ user: user!._id, joinedAt: new Date() }],
        });
        const grant = await authorizeClient(true, true);
        const client = new Client({ name: 'staging-replay-test', version: '1' });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(resource), {
              requestInit: { headers: { Authorization: `Bearer ${grant.access_token}` } },
            }),
          );
          // What Claude sent on staging: one payer without an amount, and no Category.
          const created = await client.callTool({
            name: 'create_drafts',
            arguments: {
              groupId: String(groupId),
              requestKey: 'staging-replay-dinner',
              drafts: [
                {
                  description: 'Dinner',
                  amount: 1200,
                  currency: 'INR',
                  date: '2026-10-16',
                  tagId: String(tagId),
                  paidBy: [{ user: String(user!._id) }],
                  splitMethod: 'equal',
                  splitBetween: [{ user: String(user!._id) }],
                },
              ],
            },
          });
          expect(created.isError).not.toBe(true);
          const member = { id: String(user!._id) };
          const read = await expenseDraftService.toReview(member);
          const [item] = read.groups.find((group) => group.groupId === String(groupId))!.items;
          expect(item).toMatchObject({ problems: [], draft: { missingFields: [] } });
          const { review } = await expenseDraftService.review(
            member,
            String(groupId),
            item.draft.id,
          );
          const [outcome] = await expenseDraftService.save(member, String(groupId), {
            drafts: [{ id: item.draft.id, revision: item.draft.revision, review }],
          });
          expect(outcome.status).toBe('saved');
          const expense = await db.collection('expenses').findOne({ group: groupId });
          expect(expense).toMatchObject({
            description: 'Dinner',
            amount: 1200,
            category: 'other',
            paidBy: [{ user: user!._id, amount: 1200 }],
            preparedBy: { kind: 'assistant', name: 'Synthetic MCP Client' },
          });
        } finally {
          exposeTools = false;
          await client.close();
          const restored = await authorizeClient();
          token = restored.access_token;
          refreshToken = restored.refresh_token;
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
    describe('inactivity expiry', () => {
      const day = 86_400_000;
      const signIn = async () => {
        const response = await post('/sign-in/email', {
          email: 'connection@example.test',
          password: 'synthetic-password-for-test-only',
        });
        expect(response.status).toBe(200);
        cookie = response.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; ');
      };
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
      const use = async (accessToken: string) => {
        const client = new Client({ name: 'expiry-test', version: '1' });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(resource), {
              requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
            }),
          );
          expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
            'connection_status',
          );
        } finally {
          await client.close();
        }
      };
      const freshConnection = async () => {
        await signIn();
        for (const connection of await connectionList())
          expect((await post('/mcp/revoke', { id: connection.id }, true)).status).toBe(200);
        return authorizeClient();
      };

      it('expires a never-used connection at 90 days and lets the member reconnect', async () => {
        const start = Math.floor(Date.now() / 1000) * 1000;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(start);
        try {
          const issued = await freshConnection();
          expect((await connectionList())[0].lastUsedAt).toBeNull();
          vi.setSystemTime(start + 90 * day);
          await signIn();
          expect(await connectionList()).toEqual([]);
          expect((await refresh(issued.refresh_token)).ok).toBe(false);
          const reconnected = await authorizeClient();
          await use(reconnected.access_token);
          expect(await connectionList()).toHaveLength(1);
          expect((await refresh(issued.refresh_token)).ok).toBe(false);
        } finally {
          vi.useRealTimers();
          await signIn();
        }
      });

      it('keeps rolling refresh alive within 90 days of use and refuses a fresh token at idle expiry', async () => {
        const start = Math.floor(Date.now() / 1000) * 1000;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(start);
        try {
          const issued = await freshConnection();
          await use(issued.access_token);
          vi.setSystemTime(start + 89 * day);
          const response = await refresh(issued.refresh_token);
          expect(response.status, await response.clone().text()).toBe(200);
          const active = await response.json();
          await use(active.access_token);
          // Rotating tokens alone is not assistant use. Mint a token just before
          // the idle deadline so its five-minute JWT lifetime cannot hide the bug.
          vi.setSystemTime(start + 179 * day - 60_000);
          const late = await refresh(active.refresh_token);
          expect(late.status, await late.clone().text()).toBe(200);
          const stillValid = await late.json();
          await signIn();
          expect((await connectionList())[0].lastUsedAt).toBe(
            new Date(start + 89 * day).toISOString(),
          );
          vi.setSystemTime(start + 179 * day);
          expect(
            (
              await fetch(resource, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${stillValid.access_token}`,
                },
              })
            ).status,
          ).toBe(403);
          expect((await refresh(stillValid.refresh_token)).ok).toBe(false);
          expect(await connectionList()).toEqual([]);
          const reconnected = await authorizeClient();
          await use(reconnected.access_token);
          expect(
            (
              await fetch(resource, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${stillValid.access_token}`,
                },
              })
            ).status,
          ).toBe(403);
          expect((await refresh(stillValid.refresh_token)).ok).toBe(false);
        } finally {
          vi.useRealTimers();
          await signIn();
        }
      });
    });
  });
}
