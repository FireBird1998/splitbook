import { createHash, randomBytes } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { buildAuthOptions } from '@/lib/auth/create-auth';
import { MCP_LEDGER_SCOPE } from './config';

/* Assistants identified by their Client ID Metadata Documents, the way ChatGPT and Claude are,
 * with only the documents' fetch stubbed: the approval page shows the name one publishes and its
 * address as host and path (#614), and Settings names it the same way once approved (#615). */

const assistant = vi.hoisted(() => ({
  clientId: 'https://fictional-helper.example.test/oauth/client.json',
  redirectUri: 'https://fictional-helper.example.test/callback',
  name: 'Fictional Published Helper',
}));
/** One whose published name poses as another assistant's address, so it is no name. */
const poser = vi.hoisted(() => ({
  clientId: 'https://poser-helper.example.test/oauth/client.json',
  redirectUri: 'https://poser-helper.example.test/callback',
  name: 'Official chatgpt.com',
}));
/** Approved before #615, whose row kept the posing name it published. */
const elder = vi.hoisted(() => ({
  clientId: 'https://elder-helper.example.test/oauth/client.json',
  redirectUri: 'https://elder-helper.example.test/callback',
  name: 'Claude by claude.ai',
}));
/** Approved before connections stored a name at all. */
const quiet = vi.hoisted(() => ({
  clientId: 'https://quiet-helper.example.test/oauth/client.json',
  redirectUri: 'https://quiet-helper.example.test/callback',
  name: 'Official chatgpt.com',
}));
vi.mock('@better-auth/cimd/node', () => ({
  fetchClientMetadataResource: vi.fn(async (input: string | URL) => {
    const { clientId, redirectUri, name } =
      [poser, elder, quiet].find(({ clientId }) => clientId === String(input)) ?? assistant;
    return Response.json({
      client_id: clientId,
      client_name: name,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  }),
}));

const origin = 'http://localhost:4614';
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
  mcpPendingExclusion: [],
};
const auth = betterAuth({
  ...buildAuthOptions({
    database: memoryAdapter(records),
    env: {
      AUTH_SECRET: 'synthetic-metadata-document-test-secret-32-chars',
      AUTH_ALLOWED_EMAILS: 'metadata@example.test',
      NODE_ENV: 'test',
      AUTH_GOOGLE_ID: 'synthetic-client',
      AUTH_GOOGLE_SECRET: 'synthetic-secret',
      AUTH_RATE_LIMIT_ENABLED: 'false',
      MCP_ENABLED: 'true',
      NEXT_PUBLIC_APP_URL: origin,
    },
  }),
  emailAndPassword: { enabled: true },
});
const call = (path: string, init?: RequestInit) =>
  auth.handler(new Request(`${origin}/api/auth${path}`, init));

let cookie = '';
beforeAll(async () => {
  const signup = await call('/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      email: 'metadata@example.test',
      name: 'Synthetic Metadata Member',
      password: 'synthetic-password-for-test-only',
    }),
  });
  expect(signup.status).toBe(200);
  cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
});

/** The approval page's address for a connection request from this assistant. */
async function askApproval({ clientId, redirectUri }: typeof assistant) {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    prompt: 'consent',
    scope: MCP_LEDGER_SCOPE,
    resource: `${origin}/api/mcp`,
    state: 'metadata-document-test',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256')
      .update(randomBytes(32).toString('base64url'))
      .digest('base64url'),
  });
  const authorize = await call(`/oauth2/authorize?${query}`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const location = authorize.headers.get('location') ?? (await authorize.json()).url;
  const approval = new URL(location, origin);
  expect(approval.pathname).toBe('/mcp/consent');
  return approval;
}

/** The member approves the request on the approval page. */
async function approve(approval: URL) {
  const consent = await call('/oauth2/consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, cookie },
    body: JSON.stringify({
      accept: true,
      oauth_query: approval.search.slice(1),
      scope: MCP_LEDGER_SCOPE,
    }),
  });
  expect(consent.status, await consent.clone().text()).toBe(200);
}

/** This assistant's connection as Settings lists it. */
async function listed({ clientId }: typeof assistant) {
  const response = await call('/mcp/connections', { headers: { cookie } });
  expect(response.status).toBe(200);
  const { connections } = (await response.json()) as {
    connections: Array<{ clientId: string; name: string; access: string }>;
  };
  return connections.find((connection) => connection.clientId === clientId);
}

describe('the approval page for an assistant with a metadata document', () => {
  it('shows the name the document publishes and the address with its path (#614)', async () => {
    const approval = await askApproval(assistant);
    expect(fetchClientMetadataResource).toHaveBeenCalled();
    const details = await call(
      `/mcp/consent-details?${new URLSearchParams({ oauth_query: approval.search.slice(1) })}`,
      { headers: { cookie } },
    );
    expect(details.status).toBe(200);
    expect(await details.json()).toMatchObject({
      name: 'Fictional Published Helper',
      address: 'fictional-helper.example.test/oauth/client.json',
    });
  });

  it('names one whose published name poses as another address by its host in Settings, as the approval page does (#615)', async () => {
    const approval = await askApproval(poser);
    const details = await call(
      `/mcp/consent-details?${new URLSearchParams({ oauth_query: approval.search.slice(1) })}`,
      { headers: { cookie } },
    );
    expect(await details.json()).toMatchObject({ name: 'poser-helper.example.test' });
    await approve(approval);
    expect(await listed(poser)).toMatchObject({
      name: 'poser-helper.example.test',
      access: 'Ledger',
    });
  });
});

describe('Settings for connections approved before #615', () => {
  /** The stored row of this member's connection to the assistant, as the database holds it. */
  const row = ({ clientId }: typeof assistant) =>
    (records.mcpConnection as Array<{ clientId: string; name?: string | null }>).find(
      (entry) => entry.clientId === clientId,
    )!;

  it('names a row stored with a posing name by its host, with no migration', async () => {
    await approve(await askApproval(elder));
    row(elder).name = 'Claude by claude.ai'; // As main's #615 stored a cleaned published name.
    expect(await listed(elder)).toMatchObject({ name: 'elder-helper.example.test' });
  });

  it('names a row stored without a name as the approval page names the assistant', async () => {
    await approve(await askApproval(quiet));
    row(quiet).name = null;
    expect(await listed(quiet)).toMatchObject({ name: 'quiet-helper.example.test' });
  });
});
