import { createTransport } from '../data/transport';
import { manualTimer, within, gatewayFailures } from './transport-faults';
import {
  parseRecordedBatch,
  parseRecordedSettlement,
  parseSettlementHistory,
} from '../data/settlement';
import { parseCreatedGroup } from '../data/dto';
import { parseRateSuggestionResponse } from '@splitbook/shared/cross-currency-payment';
import { describe, expect, it, vi } from 'vitest';
import { parseGroup, parseGroups, parseSession, parseSignIn } from '../data/dto';
import { parseExpensePage, parseGroupBalances, parseHomeBalances } from '../data/financial-dto';
import { fakeSplitbook } from './fake-splitbook';

function faultTransport(server: ReturnType<typeof fakeSplitbook>) {
  const timers = manualTimer();
  const transport = createTransport({
    apiBase: 'http://local',
    authOrigin: 'http://local',
    secureTransport: false,
    googleEnabled: false,
    fetch: server.fetch,
    timer: timers.timer,
    now: () => 1,
    session: { current: () => true, cookie: () => null, saveCookie: async () => undefined },
    onExpired: async () => undefined,
    onGroupDenied: async () => undefined,
  });
  return { ...transport, ...timers };
}

// HTTP is the seam: default responses must be readable by the actual app.
describe('fake Splitbook', () => {
  it('answers a persona session and the default world in the app readers’ wire shapes', async () => {
    const server = fakeSplitbook();
    const call = (path: string, init: RequestInit = {}) =>
      server.fetch('http://localhost:4138' + path, init);
    const signed = await call('/api/auth/demo-persona/sign-in', {
      method: 'POST',
      body: JSON.stringify({ personaId: 'alex' }),
    });
    expect(parseSignIn(await signed.json()).name).toBe('Alex Rivera');
    const cookie = signed.headers.get('Set-Cookie')!.split(';')[0];
    const read = async (path: string) => (await call(path, { headers: { Cookie: cookie } })).json();
    expect(parseSession(await read('/api/auth/get-session'))?.user.id).toBe(
      'a00000000000000000000001',
    );
    expect(parseGroups(await read('/api/groups'))).toHaveLength(1);
    const id = server.world.groups[0]!._id;
    expect(parseGroup(await read(`/api/groups/${id}`)).name).toBe('Maple House');
    expect(parseHomeBalances(await read('/api/user/balances')).buckets).toEqual([]);
    expect(parseGroupBalances(await read(`/api/groups/${id}/balances`))).toEqual([]);
    expect(
      parseExpensePage(await read(`/api/groups/${id}/expenses?page=1&limit=20`), id, 'INR')
        .expenses,
    ).toEqual([]);
    expect(server.unanswered).toEqual([]);
  });
  it('replaces the next or every matching answer and records requests including unanswered ones', async () => {
    const server = fakeSplitbook();
    server.reply(
      'GET',
      '/probe',
      ({ headers }) => Response.json({ marker: headers.get('X-Probe') }),
      { once: true },
    );
    server.reply('POST', '/probe', ({ body }) => Response.json(body));
    const read = await server.fetch('http://local/probe?a=1', { headers: { 'X-Probe': 'next' } });
    expect(await read.json()).toEqual({ marker: 'next' });
    for (const value of [1, 2]) {
      const reply = await server.fetch('http://local/probe', {
        method: 'POST',
        body: JSON.stringify({ value }),
      });
      expect(await reply.json()).toEqual({ value });
    }
    expect((await server.fetch('http://local/probe', {})).status).toBe(404);
    expect(server.requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: 'GET', path: '/probe?a=1', body: undefined },
      { method: 'POST', path: '/probe', body: { value: 1 } },
      { method: 'POST', path: '/probe', body: { value: 2 } },
      { method: 'GET', path: '/probe', body: undefined },
    ]);
    expect(server.unanswered).toEqual(['GET /probe']);
  });
  it('answers default payment reads and writes through their readers without applying writes to the world', async () => {
    const server = fakeSplitbook();
    const signed = await server.fetch('http://local/api/auth/demo-persona/sign-in', {
      method: 'POST',
      body: JSON.stringify({ personaId: 'alex' }),
    });
    const headers = { Cookie: signed.headers.get('Set-Cookie')!.split(';')[0] };
    const call = async (path: string, body?: unknown) =>
      (
        await server.fetch('http://local' + path, {
          headers,
          ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
        })
      ).json();
    const id = server.world.groups[0]!._id,
      base = `/api/groups/${id}`;
    expect(parseSettlementHistory(await call(base + '/settlements'), id)).toEqual([]);
    expect(parseRateSuggestionResponse(await call(base + '/rates?from=EUR&to=INR'))).toMatchObject({
      suggestion: null,
    });
    const before = structuredClone(server.world);
    expect(
      parseCreatedGroup(
        await call('/api/groups', { name: 'New home', category: 'home', defaultCurrency: 'INR' }),
      ).name,
    ).toBe('New home');
    const plain = {
      paidBy: server.world.people.alex.id,
      paidTo: server.world.people.sam.id,
      amount: 10,
      currency: 'INR',
      note: 'Cash',
    };
    expect(
      parseRecordedSettlement(await call(base + '/settlements', plain), id, JSON.stringify(plain))
        .amountMinor,
    ).toBe(1000);
    const batch = {
      paidBy: plain.paidBy,
      paidTo: plain.paidTo,
      paidCurrency: 'INR',
      settlements: [
        { amount: 10, currency: 'INR' },
        {
          amount: 2,
          currency: 'EUR',
          amountPaidMinor: 18000,
          appliedRate: '90',
          rateKind: 'entered',
        },
      ],
    };
    expect(
      parseRecordedBatch(await call(base + '/settlements/batch', batch), id, JSON.stringify(batch))
        .totalPaidMinor,
    ).toBe(19000);
    expect(server.world).toEqual(before);
    expect(server.unanswered).toEqual([]);
  });
  it.each(['offline', 'lost-reply', 'body-fails'] as const)(
    'makes %s a network failure to the real transport',
    async (kind) => {
      const server = fakeSplitbook();
      server.fault('POST', '/probe', kind, { once: true });
      const t = faultTransport(server);
      await expect(t.request('/probe', 1, { method: 'POST', body: '{}' })).rejects.toMatchObject({
        kind: 'network',
        networkFailure: true,
      });
      expect(server.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
        'POST /probe',
      ]);
      expect(server.unanswered).toEqual([]);
    },
  );
  it.each(['headers', 'body'] as const)(
    'times out a reply hung at its %s with the real transport',
    async (stage) => {
      const server = fakeSplitbook();
      server.fault('GET', '/probe', stage);
      const t = faultTransport(server);
      const error = t.request('/probe', 1).catch((error) => error);
      await vi.waitFor(() => expect(server.requests).toHaveLength(1));
      t.elapse(20_000);
      expect(await within(error)).toMatchObject({ kind: 'timeout', networkFailure: true });
    },
  );
  it.each(gatewayFailures)(
    'makes a gateway %s with %s the same network failure as the real reply',
    async (status, body) => {
      const server = fakeSplitbook();
      server.fault('GET', '/probe', { status, body });
      await expect(faultTransport(server).request('/probe', 1)).rejects.toMatchObject({
        kind: 'network',
        status: 0,
        networkFailure: true,
      });
    },
  );
  it('can hold a request before deferring to its normal answer, and lists unknown API requests', async () => {
    const server = fakeSplitbook();
    let release!: () => void;
    const wait = new Promise<void>((done) => {
      release = done;
    });
    server.reply(
      'GET',
      '/api/not-a-route',
      async () => {
        await wait;
        return undefined;
      },
      { once: true },
    );
    const pending = server.fetch('http://local/api/not-a-route', {});
    expect(server.requests).toHaveLength(1);
    release();
    expect((await pending).status).toBe(404);
    expect(server.unanswered).toEqual(['GET /api/not-a-route']);
  });
  it('records requests on a disconnected device and answers again when its connection returns', async () => {
    const server = fakeSplitbook();
    server.online = false;
    await expect(
      server.fetch('http://local/api/auth/demo-persona/sign-in', {
        method: 'POST',
        body: JSON.stringify({ personaId: 'alex' }),
      }),
    ).rejects.toThrow('Network request failed');
    server.online = true;
    expect(
      (
        await server.fetch('http://local/api/auth/demo-persona/sign-in', {
          method: 'POST',
          body: JSON.stringify({ personaId: 'alex' }),
        })
      ).status,
    ).toBe(200);
    expect(server.requests).toHaveLength(2);
  });
});
