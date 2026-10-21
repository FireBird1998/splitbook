import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import mongoose from 'mongoose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseToReviewResponse } from '@splitbook/shared/to-review-read';
import { buildToReview } from '@splitbook/shared/to-review';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { callRoute, insertDemoPersonas, requireReplicaSet } from '@/lib/test-utils/signed-in-route';

// Only the external metadata document is faked; sessions, OAuth, MCP and Draft storage are real.
const published = vi.hoisted(() => ({ clientId: '', name: '' }));
const redirectUri = 'https://fictional-helper.example.test/callback';
vi.mock('@better-auth/cimd/node', () => ({
  fetchClientMetadataResource: vi.fn(async () =>
    Response.json({
      client_id: published.clientId,
      client_name: published.name,
      redirect_uris: ['https://fictional-helper.example.test/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  ),
}));
vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

const db = integrationTestDb('mcp-draft-attribution-route');
const scope = 'ledger:read drafts:write offline_access';
let server: Server;
let origin: string;
let auth: typeof import('@/lib/auth').auth;
let mcp: typeof import('./route');
let toReview: typeof import('@/app/api/user/to-review/route');
let cookie: string;

beforeAll(async () => {
  server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers))
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const request = new Request(`${origin}${incoming.url}`, {
        method: incoming.method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const response =
        incoming.url === '/api/mcp'
          ? request.method === 'POST'
            ? await mcp.POST(request)
            : await mcp.GET(request)
          : await auth.handler(request);
      const responseHeaders: Record<string, string | string[]> = Object.fromEntries(
        response.headers,
      );
      if (response.headers.getSetCookie().length)
        responseHeaders['set-cookie'] = response.headers.getSetCookie();
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(500);
      outgoing.end(String(error));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  origin = `http://127.0.0.1:${address.port}`;
  vi.stubEnv('AUTH_MODE', 'demo');
  vi.stubEnv('AUTH_SECRET', 'synthetic-draft-attribution-route-secret');
  vi.stubEnv('AUTH_RATE_LIMIT_ENABLED', 'false');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
  vi.stubEnv('MCP_ENABLED', 'true');
  vi.stubEnv('MCP_ALLOW_DCR', 'true');
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await db.connect();
  await requireReplicaSet();
  await insertDemoPersonas();
  ({ auth } = await import('@/lib/auth'));
  mcp = await import('./route');
  toReview = await import('@/app/api/user/to-review/route');
  const signedIn = await post('/demo-persona/sign-in', { personaId: 'alex' });
  expect(signedIn.status).toBe(200);
  cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
});
afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await db.teardown();
  vi.unstubAllEnvs();
});

function post(path: string, body: unknown) {
  return fetch(`${origin}/api/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
}

async function connect(clientId: string, expectedName: string) {
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    prompt: 'consent',
    scope,
    resource: `${origin}/api/mcp`,
    state: 'attribution-test',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  const authorize = await fetch(`${origin}/api/auth/oauth2/authorize?${query}`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const approval = new URL(
    authorize.headers.get('location') ?? (await authorize.json()).url,
    origin,
  );
  expect(approval.pathname).toBe('/mcp/consent');
  const details = await fetch(
    `${origin}/api/auth/mcp/consent-details?${new URLSearchParams({ oauth_query: approval.search.slice(1) })}`,
    { headers: { cookie } },
  );
  expect(details.status).toBe(200);
  expect(await details.json()).toMatchObject({ name: expectedName });
  const consent = await post('/oauth2/consent', {
    accept: true,
    oauth_query: approval.search.slice(1),
    scope,
  });
  const accepted = await consent.json();
  expect(consent.status, JSON.stringify(accepted)).toBe(200);
  const callback = new URL(accepted.url ?? accepted.redirect_uri);
  const exchange = await fetch(`${origin}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: callback.searchParams.get('code')!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: `${origin}/api/mcp`,
    }),
  });
  const issued = await exchange.json();
  expect(exchange.status, JSON.stringify(issued)).toBe(200);
  const client = new Client({ name: 'fictional-attribution-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${issued.access_token}` } },
    }),
  );
  return client;
}

function resultData(result: Awaited<ReturnType<Client['callTool']>>) {
  expect(result.isError).not.toBe(true);
  return JSON.parse((result.content as { text: string }[])[0].text);
}

describe('Draft attribution through the production MCP route (#745)', () => {
  it.each([
    {
      label: 'posing published name',
      host: 'poser-helper.example.test',
      publishedName: 'Official chatgpt.com',
      expectedName: 'poser-helper.example.test',
    },
    {
      // Past 40 characters the host stays whole, so its real domain is never cut off.
      label: 'posing published name on a long host',
      host: 'chatgpt.com.secure-assistant-connector.evil.example.test',
      publishedName: 'Official chatgpt.com',
      expectedName: 'chatgpt.com.secure-assistant-connector.evil.example.test',
    },
    {
      label: 'honest published name',
      host: 'honest-helper.example.test',
      publishedName: '  Fictional Trip Helper  ',
      expectedName: 'Fictional Trip Helper',
    },
    {
      label: 'unnamed registered client',
      host: null,
      publishedName: '',
      expectedName: 'Assistant',
    },
  ])(
    'credits the $label as the approval page does in create_drafts, list_drafts and To review',
    async ({ host, publishedName, expectedName }) => {
      published.clientId = `https://${host}/oauth/client.json`;
      published.name = publishedName;
      let clientId = published.clientId;
      if (!host) {
        const registered = await post('/oauth2/register', {
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          scope,
        });
        expect(registered.status).toBe(201);
        clientId = (await registered.json()).client_id;
      }
      const client = await connect(clientId, expectedName);
      try {
        const group = await groupService.create(
          {
            name: 'Fictional attribution trip',
            category: 'trip',
            defaultCurrency: 'INR',
            alternateCurrencies: [],
          },
          DEMO_PERSONA_IDS.alex,
        );
        const groupId = String(group._id);
        // A pre-change stored credit is deliberately not rewritten by a new read or creation.
        const legacyId = new mongoose.Types.ObjectId();
        const legacyCredit = { kind: 'assistant', name: 'Official chatgpt.com' };
        await mongoose.connection.db!.collection('expensedrafts').insertOne({
          _id: legacyId,
          group: group._id,
          owner: new mongoose.Types.ObjectId(DEMO_PERSONA_IDS.alex),
          requestKey: 'legacy-attribution',
          requestFingerprint: 'legacy-fixture',
          itemIndex: 0,
          revision: 0,
          state: 'active',
          preparedBy: legacyCredit,
          changedBy: legacyCredit,
          values: { description: 'Earlier taxi' },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const created = resultData(
          await client.callTool({
            name: 'create_drafts',
            arguments: {
              groupId,
              requestKey: 'new-attribution',
              drafts: [{ description: 'Fictional taxi' }],
            },
          }),
        );
        const credit = { kind: 'assistant', name: expectedName };
        expect(created.drafts).toHaveLength(1);
        expect(created.drafts[0].preparedBy).toEqual(credit);
        const listed = resultData(
          await client.callTool({ name: 'list_drafts', arguments: { groupId } }),
        );
        expect(listed.drafts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: created.drafts[0].id, preparedBy: credit }),
            expect.objectContaining({ id: String(legacyId), preparedBy: legacyCredit }),
          ]),
        );
        // Web and Android consume this same To review response and its stored preparedBy.
        const review = await callRoute(toReview.GET, {
          method: 'GET',
          path: '/api/user/to-review',
          cookie,
        });
        expect(review.status).toBe(200);
        expect(review.body.data.groups).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              groupId,
              items: expect.arrayContaining([
                expect.objectContaining({
                  draft: expect.objectContaining({ id: created.drafts[0].id, preparedBy: credit }),
                }),
                expect.objectContaining({
                  draft: expect.objectContaining({
                    id: String(legacyId),
                    preparedBy: legacyCredit,
                  }),
                }),
              ]),
            }),
          ]),
        );
      } finally {
        await client.close();
      }
    },
  );
});

describe('Group currencies through MCP (#732)', () => {
  it('lists the main and extra currencies in list_groups and group_context', async () => {
    published.clientId = 'https://currency-helper.example.test/client.json';
    published.name = 'Fictional Currency Helper';
    const client = await connect(published.clientId, published.name);
    try {
      const group = await groupService.create(
        {
          name: 'Fictional multi-currency trip',
          category: 'trip',
          defaultCurrency: 'INR',
          alternateCurrencies: ['EUR', 'JPY'],
        },
        DEMO_PERSONA_IDS.alex,
      );
      const groupId = String(group._id);
      const listed = resultData(await client.callTool({ name: 'list_groups', arguments: {} }));
      expect(listed.groups).toContainEqual(
        expect.objectContaining({
          id: groupId,
          currency: 'INR',
          alternateCurrencies: ['EUR', 'JPY'],
        }),
      );
      const context = resultData(
        await client.callTool({ name: 'group_context', arguments: { groupId } }),
      );
      expect(context).toMatchObject({
        id: groupId,
        currency: 'INR',
        alternateCurrencies: ['EUR', 'JPY'],
      });
    } finally {
      await client.close();
    }
  });
});

it('keeps listed assistant Drafts ready and unlisted Drafts needing details until either currency fix (#732)', async () => {
  published.clientId = 'https://draft-currencies.example.test/client.json';
  published.name = 'Fictional Receipt Helper';
  const client = await connect(published.clientId, published.name);
  try {
    const group = await groupService.create(
      {
        name: 'Fictional receipts abroad',
        category: 'trip',
        defaultCurrency: 'INR',
        alternateCurrencies: ['EUR', 'JPY'],
      },
      DEMO_PERSONA_IDS.alex,
    );
    const groupId = String(group._id);
    const values = (currency: string, amount: number) => ({
      description: `Dinner in ${currency}`,
      currency,
      amount,
      date: '2026-10-21',
      tag: 'Food',
      paidBy: [{ user: DEMO_PERSONA_IDS.alex }],
      splitMethod: 'equal',
      splitBetween: [{ user: DEMO_PERSONA_IDS.alex }],
    });
    const created = resultData(
      await client.callTool({
        name: 'create_drafts',
        arguments: {
          groupId,
          requestKey: 'currency-receipts-001',
          drafts: [
            values('EUR', 20),
            values('JPY', 2500),
            values('GBP', 30),
            values('CHF', 40),
            { currency: 'USD' },
          ],
        },
      }),
    );
    const [euro, yen, pound, franc, incomplete] = created.drafts;
    const readItems = async () => {
      const response = await callRoute(toReview.GET, {
        method: 'GET',
        path: '/api/user/to-review',
        cookie,
      });
      expect(response.status).toBe(200);
      const read = parseToReviewResponse(response.body);
      const own = read.groups.find((row) => row.groupId === groupId)!;
      expect(own).toMatchObject({ currency: 'INR', alternateCurrencies: ['EUR', 'JPY'] });
      return buildToReview({ total: own.count, groups: [own] }, [], new Date());
    };
    const model = await readItems();
    const byId = (id: string) => model.items.find((row) => row.id === id)!;
    for (const draft of [euro, yen]) expect(byId(draft.id).state).toBe('ready');
    expect(model.ready.totals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: 'EUR', amountMinor: 2000 }),
        expect.objectContaining({ currency: 'JPY', amountMinor: 2500 }),
      ]),
    );
    for (const draft of [pound, franc, incomplete]) {
      expect(draft.missingFields).toContain('currency');
      expect(byId(draft.id)).toMatchObject({
        state: 'needs-details',
        accountItem: { problems: expect.arrayContaining(['CURRENCY_NOT_LISTED']) },
      });
    }
    const listed = resultData(
      await client.callTool({ name: 'list_drafts', arguments: { groupId } }),
    );
    expect(listed.drafts.find((row: { id: string }) => row.id === pound.id)).toMatchObject({
      values: { currency: 'GBP', amount: 30 },
      missingFields: ['currency'],
    });
    const reviewRoute = await import('@/app/api/groups/[id]/drafts/review/route');
    const saveRoute = await import('@/app/api/groups/[id]/drafts/save/route');
    const checked = await callRoute(reviewRoute.POST, {
      method: 'POST',
      path: `/api/groups/${groupId}/drafts/review`,
      params: { id: groupId },
      cookie,
      body: { ids: [pound.id] },
    });
    expect(checked.status).toBe(200);
    expect(checked.body.data[0].problems).toEqual(['CURRENCY_NOT_LISTED']);
    const refused = await callRoute(saveRoute.POST, {
      method: 'POST',
      path: `/api/groups/${groupId}/drafts/save`,
      params: { id: groupId },
      cookie,
      body: {
        drafts: [{ id: pound.id, revision: pound.revision, review: checked.body.data[0].review }],
      },
    });
    expect(refused.body.data).toEqual([
      { id: pound.id, status: 'failed', message: 'Invalid Draft: CURRENCY_NOT_LISTED' },
    ]);
    // Changing the Expense currency fixes one item without changing the Group list.
    const replaced = resultData(
      await client.callTool({
        name: 'replace_draft',
        arguments: {
          groupId,
          draftId: pound.id,
          revision: pound.revision,
          values: { ...values('EUR', 30), description: 'Later dinner' },
        },
      }),
    );
    expect(replaced).toMatchObject({
      revision: 1,
      values: { currency: 'EUR', amount: 30 },
      missingFields: [],
    });
    expect((await readItems()).items.find((row) => row.id === pound.id)?.state).toBe('ready');
    // Adding the other currency fixes its existing item, without rewriting its amount.
    const groupRoute = await import('@/app/api/groups/[id]/route');
    const added = await callRoute(groupRoute.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${groupId}`,
      params: { id: groupId },
      cookie,
      body: { alternateCurrencies: ['EUR', 'JPY', 'CHF'] },
    });
    expect(added.status).toBe(200);
    const response = await callRoute(toReview.GET, {
      method: 'GET',
      path: '/api/user/to-review',
      cookie,
    });
    const after = buildToReview(parseToReviewResponse(response.body), [], new Date());
    expect(after.items.find((row) => row.id === franc.id)).toMatchObject({
      state: 'ready',
      accountItem: { draft: { revision: 0, values: { currency: 'CHF', amount: 40 } } },
    });
    const balances = resultData(
      await client.callTool({ name: 'group_balances', arguments: { groupId } }),
    );
    expect(
      balances.balances.byCurrency.every((bucket: { balances: { balance: number }[] }) =>
        bucket.balances.every((row) => row.balance === 0),
      ),
    ).toBe(true);
  } finally {
    await client.close();
  }
});
