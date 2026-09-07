import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const HOST = '127.0.0.1';
const PORT = 3200;
const ISSUER = `http://${HOST}:${PORT}`;
const KEY_ID = 'splitbook-playwright-google';

interface AuthorizationGrant {
  clientId: string;
  codeChallenge: string;
  email: string;
  name: string;
  nonce?: string;
  subject: string;
}

const grants = new Map<string, AuthorizationGrant>();
const accessTokens = new Map<string, AuthorizationGrant>();
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
}

function signedIdToken(grant: AuthorizationGrant): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iss: ISSUER,
      aud: grant.clientId,
      sub: grant.subject,
      email: grant.email,
      email_verified: true,
      name: grant.name,
      picture: null,
      ...(grant.nonce ? { nonce: grant.nonce } : {}),
      iat: now,
      exp: now + 300,
    }),
  );
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${base64Url(signature)}`;
}

function callbackLink(
  callbackUrl: string,
  state: string | null,
  grant: AuthorizationGrant,
): string {
  const code = randomUUID();
  grants.set(code, grant);
  const callback = new URL(callbackUrl);
  callback.searchParams.set('code', code);
  if (state) callback.searchParams.set('state', state);
  return callback.toString().replaceAll('&', '&amp;');
}

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', ISSUER);

  if (url.pathname === '/health') {
    json(response, 200, { ok: true });
    return;
  }

  if (url.pathname === '/.well-known/openid-configuration') {
    json(response, 200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
      jwks_uri: `${ISSUER}/jwks`,
      scopes_supported: ['openid', 'profile', 'email'],
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
    });
    return;
  }

  if (url.pathname === '/jwks') {
    json(response, 200, { keys: [{ ...jwk, alg: 'RS256', kid: KEY_ID, use: 'sig' }] });
    return;
  }

  if (url.pathname === '/authorize') {
    const callbackUrl = url.searchParams.get('redirect_uri');
    const clientId = url.searchParams.get('client_id');
    const codeChallenge = url.searchParams.get('code_challenge');
    const nonce = url.searchParams.get('nonce');
    const state = url.searchParams.get('state');
    if (!callbackUrl || !clientId || !codeChallenge) {
      json(response, 400, { error: 'invalid_request' });
      return;
    }

    const commonGrantFields = { clientId, codeChallenge, ...(nonce ? { nonce } : {}) };
    const approved = callbackLink(callbackUrl, state, {
      ...commonGrantFields,
      subject: 'approved-playwright-user',
      email: 'approved.playwright@splitbook.local',
      name: 'Approved Playwright User',
    });
    const unapproved = callbackLink(callbackUrl, state, {
      ...commonGrantFields,
      subject: 'unapproved-playwright-user',
      email: 'unapproved.playwright@splitbook.local',
      name: 'Unapproved Playwright User',
    });

    html(
      response,
      `<!doctype html><html><body><h1>Local Google OAuth stand-in</h1><a href="${approved}">Continue as approved tester</a><a href="${unapproved}">Continue as unapproved tester</a></body></html>`,
    );
    return;
  }

  if (url.pathname === '/token' && request.method === 'POST') {
    const params = new URLSearchParams(await requestBody(request));
    const code = params.get('code');
    const codeVerifier = params.get('code_verifier');
    const grant = code ? grants.get(code) : undefined;
    const challenge = codeVerifier
      ? createHash('sha256').update(codeVerifier).digest('base64url')
      : null;
    if (!grant || challenge !== grant.codeChallenge) {
      json(response, 400, { error: 'invalid_grant' });
      return;
    }

    grants.delete(code as string);
    const accessToken = randomUUID();
    accessTokens.set(accessToken, grant);
    json(response, 200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 300,
      scope: 'openid profile email',
      id_token: signedIdToken(grant),
    });
    return;
  }

  if (url.pathname === '/userinfo') {
    const accessToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const grant = accessToken ? accessTokens.get(accessToken) : undefined;
    if (!grant) {
      json(response, 401, { error: 'invalid_token' });
      return;
    }
    json(response, 200, {
      sub: grant.subject,
      email: grant.email,
      email_verified: true,
      name: grant.name,
      picture: null,
    });
    return;
  }

  json(response, 404, { error: 'not_found' });
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error(error);
    json(response, 500, { error: 'server_error' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Local Google OAuth stand-in listening on ${ISSUER}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
