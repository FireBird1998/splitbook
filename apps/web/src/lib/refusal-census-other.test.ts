import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { auth } from '@/lib/auth';
import { connectMongo, getAuthDb } from '@/lib/mongodb-client';

vi.mock('next/headers', () => ({ headers: () => new Headers() }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: { getSession: vi.fn() },
    handler: vi.fn(),
    $context: Promise.resolve({ adapter: {} }),
  },
}));
vi.mock('@/lib/mongodb-client', async (load) => ({
  ...(await load<typeof import('@/lib/mongodb-client')>()),
  connectMongo: vi.fn(),
  getAuthDb: vi.fn(),
}));
vi.mock('@/lib/notifications/dispatch', () => ({ dispatchExpenseAlerts: vi.fn() }));
vi.mock('@/lib/rates/service', () => ({ refreshRates: vi.fn() }));
vi.mock('@better-auth/mcp', () => ({
  requireMcpAuth:
    (
      _auth: unknown,
      next: (request: Request, claims: Record<string, unknown>) => Promise<Response>,
    ) =>
    (request: Request) =>
      next(request, {
        sub: 'a00000000000000000000001',
        client_id: 'census-client',
        scope: 'ledger:read',
      }),
}));
vi.mock('@/lib/mcp/grants', () => ({ currentMcpGrant: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/mcp/request-limit', () => ({ allowMcpRequest: vi.fn().mockResolvedValue(false) }));
vi.spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => vi.unstubAllEnvs());
async function recorded(answer: Response) {
  const body = await answer.text();
  return {
    status: answer.status,
    body,
    hasCode: body ? Object.hasOwn(JSON.parse(body), 'code') : false,
  };
}
const user = { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const session = { id: 'a00000000000000000000004' };

it('records notification registration’s code-less refusals at HTTP', async () => {
  const { GET, POST } = await import('@/app/api/notifications/device/route');
  const installationId = '00000000-0000-4000-8000-000000000001';
  const installationKey = 'synthetic-key-for-the-census-only-1079';
  const registration = { createIndex: vi.fn(), findOne: vi.fn() };
  const sessions = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
  vi.mocked(getAuthDb).mockReturnValue({
    collection: (name: string) => (name === 'sessions' ? sessions : registration),
  } as never);
  vi.mocked(connectMongo).mockResolvedValue({
    startSession: () => ({
      withTransaction: (run: () => Promise<Response>) => run(),
      endSession: vi.fn(),
    }),
  } as never);
  const body = { installationId, installationKey, revision: 0, enabled: true };
  const request = (input = body) =>
    new Request('http://localhost/api/notifications/device', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  const census = [];
  vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
  census.push({ state: 'signed out', answer: await recorded(await POST(request())) });
  vi.mocked(auth.api.getSession).mockResolvedValue({ user, session } as never);
  vi.stubEnv('ANDROID_NOTIFICATIONS_ENABLED', 'false');
  const unavailable = await POST(request());
  expect(unavailable.headers.get('Cache-Control')).toBe('private, no-store');
  expect(unavailable.headers.get('Vary')).toBe('Cookie, X-Expected-Account, X-Installation-Key');
  const unavailableAnswer = await recorded(unavailable);
  expect(unavailableAnswer.body).toBe(
    '{"error":"Notifications are not available yet.","status":503,"code":"NOTIFICATIONS_UNAVAILABLE"}',
  );
  census.push({ state: 'feature disabled', answer: unavailableAnswer });
  vi.stubEnv('ANDROID_NOTIFICATIONS_ENABLED', 'true');
  registration.findOne.mockResolvedValue(null);
  census.push({ state: 'token missing', answer: await recorded(await POST(request())) });
  sessions.updateOne.mockResolvedValue({ matchedCount: 0 });
  census.push({ state: 'session revoked', answer: await recorded(await POST(request())) });
  sessions.updateOne.mockResolvedValue({ matchedCount: 1 });
  registration.findOne.mockResolvedValue({ keyHash: 'another installation key' });
  census.push({ state: 'installation key differs', answer: await recorded(await POST(request())) });
  census.push({
    state: 'read installation key differs',
    answer: await recorded(
      await GET(
        new Request('http://localhost/api/notifications/device?installationId=' + installationId, {
          headers: { 'X-Installation-Key': installationKey },
        }),
      ),
    ),
  });
  registration.findOne.mockResolvedValue({
    keyHash: createHash('sha256').update(installationKey).digest('hex'),
    revision: 1,
  });
  census.push({ state: 'revision differs', answer: await recorded(await POST(request())) });
  registration.findOne.mockResolvedValue(null);
  census.push({
    state: 'maintenance without a live binding',
    answer: await recorded(
      await POST(request({ ...body, token: 'synthetic-token', maintenance: true } as typeof body)),
    ),
  });
  expect(census).toMatchSnapshot();
});

it('records dispatch authorization, invalid requests and a failed pass at HTTP', async () => {
  const { POST } = await import('@/app/api/notifications/dispatch/route');
  const { dispatchExpenseAlerts } = await import('@/lib/notifications/dispatch');
  vi.stubEnv('NOTIFICATION_DISPATCH_SECRET', 'synthetic-dispatch-secret-for-census-1079');
  const census = [];
  census.push({
    state: 'no authorization',
    answer: await recorded(
      await POST(new Request('http://localhost/api/notifications/dispatch', { method: 'POST' })),
    ),
  });
  const headers = { authorization: 'Bearer synthetic-dispatch-secret-for-census-1079' };
  const invalid = await recorded(
    await POST(
      new Request('http://localhost/api/notifications/dispatch?bad=1', { method: 'POST', headers }),
    ),
  );
  expect(invalid).toEqual({
    status: 400,
    body: '{"error":"Invalid request","status":400,"code":"VALIDATION_ERROR"}',
    hasCode: true,
  });
  census.push({ state: 'unexpected query', answer: invalid });
  vi.mocked(dispatchExpenseAlerts).mockRejectedValue(new Error('provider unavailable'));
  census.push({
    state: 'dispatch failed',
    answer: await recorded(
      await POST(
        new Request('http://localhost/api/notifications/dispatch', { method: 'POST', headers }),
      ),
    ),
  });
  expect(census).toMatchSnapshot();
});

it('records the rates cron’s authorization and failure answers through its handler', async () => {
  const { GET } = await import('@/app/api/cron/exchange-rates/route');
  const { refreshRates } = await import('@/lib/rates/service');
  vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
  const census = [
    await recorded(await GET(new Request('http://localhost/api/cron/exchange-rates'))),
  ];
  vi.mocked(refreshRates).mockRejectedValue(new Error('provider unavailable'));
  census.push(
    await recorded(
      await GET(
        new Request('http://localhost/api/cron/exchange-rates', {
          headers: { authorization: 'Bearer synthetic-cron-secret' },
        }),
      ),
    ),
  );
  expect(census).toMatchSnapshot();
});

it('records MCP’s empty and outage refusals through its exported handlers', async () => {
  const { GET, POST } = await import('@/app/api/mcp/route');
  const census = [];
  vi.stubEnv('MCP_ENABLED', 'false');
  census.push(
    await recorded(await POST(new Request('http://localhost/api/mcp', { method: 'POST' }))),
  );
  census.push(await recorded(await GET(new Request('http://localhost/api/mcp'))));
  vi.stubEnv('MCP_DEPLOYMENT', 'staging');
  vi.stubEnv('MOBILE_APP_ENV', 'staging');
  vi.stubEnv('MCP_IDLE_TIMEOUT_SECONDS', 'invalid');
  census.push(
    await recorded(await POST(new Request('http://localhost/api/mcp', { method: 'POST' }))),
  );
  expect(census).toMatchSnapshot();
});

it('records MCP’s oversized request body, including its absent status and code fields', async () => {
  vi.stubEnv('MCP_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  vi.stubEnv('MCP_IDLE_TIMEOUT_SECONDS', '120');
  vi.stubEnv('MCP_DEPLOYMENT', 'staging');
  const { POST } = await import('@/app/api/mcp/route');
  const answer = await POST(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      body: 'x'.repeat(128 * 1024 + 1),
    }),
  );
  expect(await recorded(answer)).toMatchSnapshot();
});

it('records the repository’s MCP authorization and request-limit answers at HTTP', async () => {
  const { createMcpConnectionHandler } = await import('@/lib/mcp/connection');
  // Token verification is the network boundary. These are the repository's own answers after it.
  const handler = createMcpConnectionHandler(
    auth,
    'http://localhost:3000/api/mcp',
    async () => false,
  );
  const census = [];
  census.push(
    await recorded(
      await handler(
        new Request('http://localhost:3000/api/mcp', {
          method: 'POST',
          headers: { origin: 'http://another.example' },
        }),
      ),
    ),
  );
  census.push(
    await recorded(await handler(new Request('http://localhost:3000/api/mcp', { method: 'POST' }))),
  );
  vi.stubEnv('MCP_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  vi.stubEnv('MCP_DEPLOYMENT', 'staging');
  vi.stubEnv('MCP_IDLE_TIMEOUT_SECONDS', '120');
  const { POST } = await import('@/app/api/mcp/route');
  census.push(
    await recorded(
      await POST(new Request('http://localhost:3000/api/mcp', { method: 'POST', body: '{}' })),
    ),
  );
  expect(census).toMatchSnapshot();
});
