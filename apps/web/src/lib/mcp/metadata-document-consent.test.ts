import { createHash, randomBytes } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';
import { describe, expect, it, vi } from 'vitest';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { buildAuthOptions } from '@/lib/auth/create-auth';
import { MCP_LEDGER_SCOPE } from './config';

/* An assistant identified by its Client ID Metadata Document, the way ChatGPT and Claude are,
 * with only the document's fetch stubbed: the approval page shows the name it publishes and its
 * address as host and path (#614). */

const assistant = vi.hoisted(() => ({
  clientId: 'https://fictional-helper.example.test/oauth/client.json',
  redirectUri: 'https://fictional-helper.example.test/callback',
}));
vi.mock('@better-auth/cimd/node', () => ({
  fetchClientMetadataResource: vi.fn(async () =>
    Response.json({
      client_id: assistant.clientId,
      client_name: 'Fictional Published Helper',
      redirect_uris: [assistant.redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  ),
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

describe('the approval page for an assistant with a metadata document', () => {
  it('shows the name the document publishes and the address with its path (#614)', async () => {
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
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const query = new URLSearchParams({
      client_id: assistant.clientId,
      redirect_uri: assistant.redirectUri,
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
});
