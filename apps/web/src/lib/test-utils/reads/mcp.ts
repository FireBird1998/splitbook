import { createHash, randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, vi } from 'vitest';
import { APP_URL } from '../signed-in-route';
import { MCP_DRAFT_SCOPE, MCP_LEDGER_SCOPE } from '@/lib/mcp/config';

/** The real authorization-code/PKCE flow, issued to the fixture's signed-in demo member. */
export async function readGrant(cookie: string, excludedGroups: readonly string[] = []) {
  const { auth } = await import('@/lib/auth');
  const scope = `${MCP_LEDGER_SCOPE} ${MCP_DRAFT_SCOPE} offline_access`;
  const post = (path: string, body: unknown) =>
    auth.handler(
      new Request(`${APP_URL}/api/auth${path}`, {
        method: 'POST',
        headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  const registration = await post('/oauth2/register', {
    client_name: 'Read census assistant',
    redirect_uris: ['https://read-client.example.test/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope,
  });
  const registered = await registration.json();
  expect(registration.status, JSON.stringify(registered)).toBe(201);
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id: registered.client_id,
    redirect_uri: 'https://read-client.example.test/callback',
    response_type: 'code',
    prompt: 'consent',
    scope,
    resource: `${APP_URL}/api/mcp`,
    state: 'read-census-state',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  const authorize = await auth.handler(
    new Request(`${APP_URL}/api/auth/oauth2/authorize?${query}`, { headers: { cookie } }),
  );
  const location = authorize.headers.get('location') ?? (await authorize.json()).url;
  const consentUrl = new URL(location, APP_URL);
  expect(consentUrl.pathname).toBe('/mcp/consent');
  const details = await auth.handler(
    new Request(
      `${APP_URL}/api/auth/mcp/consent-details?${new URLSearchParams({ oauth_query: consentUrl.search.slice(1) })}`,
      { headers: { cookie } },
    ),
  );
  expect(details.status).toBe(200);
  const consent = await post('/oauth2/consent', {
    accept: true,
    oauth_query: consentUrl.search.slice(1),
    scope,
    excluded_groups: excludedGroups,
  });
  const accepted = await consent.json();
  expect(consent.status, JSON.stringify(accepted)).toBe(200);
  const callback = new URL(accepted.url ?? accepted.redirect_uri);
  expect(callback.searchParams.get('state')).toBe('read-census-state');
  const exchange = await auth.handler(
    new Request(`${APP_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: callback.searchParams.get('code')!,
        client_id: registered.client_id,
        redirect_uri: 'https://read-client.example.test/callback',
        code_verifier: verifier,
        resource: `${APP_URL}/api/mcp`,
      }),
    }),
  );
  const issued = await exchange.json();
  expect(exchange.status, JSON.stringify(issued)).toBe(200);
  expect(issued.access_token).toBeTypeOf('string');
  const connection = await (
    await auth.$context
  ).adapter.findOne<{ id: string; excludedGroupIds?: string[] }>({
    model: 'mcpConnection',
    where: [{ field: 'clientId', value: registered.client_id }],
  });
  expect(connection).not.toBeNull();
  expect(connection?.excludedGroupIds ?? []).toEqual(excludedGroups);
  return {
    token: issued.access_token as string,
    clientId: registered.client_id as string,
    revoke: async () => {
      expect((await post('/mcp/revoke', { id: connection!.id })).status).toBe(200);
    },
  };
}

/** SDK transport requests enter the production MCP route, including its live-grant checks. */
export async function mcpRead(token: string, name: string, args: Record<string, unknown> = {}) {
  const route = await import('@/app/api/mcp/route');
  const { auth } = await import('@/lib/auth');
  const networkFetch = globalThis.fetch;
  // The public-key fetch is the network edge. Its response still comes from Better Auth.
  const jwks = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === `${APP_URL}/api/auth/jwks`) return auth.handler(request);
    return networkFetch(request);
  });
  let status: number | undefined;
  let transportStatus: number | undefined;
  const client = new Client({ name: 'read-census', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(`${APP_URL}/api/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const method = (
        await request
          .clone()
          .json()
          .catch(() => null)
      )?.method;
      const response = await route.POST(request);
      transportStatus = response.status;
      if (method === 'tools/call') status = response.status;
      return response;
    },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    return { status: status ?? transportStatus, result };
  } catch (error) {
    if (error instanceof Error)
      return {
        status: status ?? transportStatus,
        error: {
          name: error.name,
          message: error.message,
          ...('code' in error ? { code: error.code } : {}),
        },
      };
    throw error;
  } finally {
    try {
      await client.close();
    } finally {
      jwks.mockRestore();
    }
  }
}
