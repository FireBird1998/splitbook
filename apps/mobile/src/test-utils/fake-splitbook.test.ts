import { tagRead } from '../data/tag-management';
import { parseExpenseRecord } from '../data/expense-record';
import { parseActivityPage } from '../data/activity';
import { parseTripSummaryResponse } from '@splitbook/shared/trip-summary-read';
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
import {
  fakeSplitbook,
  rateSuggestion,
  expenseFixture,
  pagesFor,
  expensePage,
  activityPage,
} from './fake-splitbook';

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
  it.each([
    ['alex', 'Alex Rivera', 'a00000000000000000000001'],
    ['sam', 'Sam Chen', 'a00000000000000000000002'],
    ['priya', 'Priya Shah', 'a00000000000000000000003'],
  ])(
    'answers %s’s session and the default world in the app readers’ wire shapes',
    async (personaId, name, userId) => {
      const server = fakeSplitbook();
      const call = (path: string, init: RequestInit = {}) =>
        server.fetch('http://localhost:4138' + path, init);
      const signed = await call('/api/auth/demo-persona/sign-in', {
        method: 'POST',
        body: JSON.stringify({ personaId }),
      });
      expect(parseSignIn(await signed.json()).name).toBe(name);
      const cookie = signed.headers.get('Set-Cookie')!.split(';')[0];
      const read = async (path: string) =>
        (await call(path, { headers: { Cookie: cookie } })).json();
      expect(parseSession(await read('/api/auth/get-session'))?.user.id).toBe(userId);
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
    },
  );
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
  it('keeps live sent views with or without queries without losing the complete request log', async () => {
    const server = fakeSplitbook(),
      sent = server.sent(),
      paths = server.sent({ query: false });
    await server.fetch('http://local/probe?page=1', {});
    expect(sent).toEqual(['GET /probe?page=1']);
    expect(paths).toEqual(['GET /probe']);
    sent.length = 0;
    await server.fetch('http://local/probe?page=2', { method: 'POST', body: '{"value":2}' });
    expect(sent).toEqual(['POST /probe?page=2']);
    expect(paths).toEqual(['GET /probe', 'POST /probe']);
    expect(server.requests.map((r) => r.path)).toEqual(['/probe?page=1', '/probe?page=2']);
  });
  it('loses the connection after taking a request, separately from a body that fails after headers', async () => {
    const server = fakeSplitbook();
    server.fault('POST', '/accepted', 'lost-reply', { once: true });
    await expect(
      server.fetch('http://local/accepted', { method: 'POST', body: '{"receipt":1}' }),
    ).rejects.toThrow('Network request failed');
    expect(server.requests[0]?.body).toEqual({ receipt: 1 });
    server.fault('GET', '/body', 'body-fails', { once: true });
    const headers = await server.fetch('http://local/body', {});
    expect(headers.status).toBe(200);
    await expect(headers.json()).rejects.toThrow('Network request failed');
  });
  it('reads payment-world figures, Debt rows, history and rates through the app readers', async () => {
    const server = fakeSplitbook(),
      id = server.world.groups[0]!._id;
    const alex = server.world.groups[0]!.members[0]!.user,
      sam = server.world.groups[0]!.members[1]!.user;
    server.world.home = {
      buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }],
      groups: [{ groupId: id, balances: [{ currency: 'INR', balance: -30 }] }],
    };
    server.world.balances[id] = {
      byCurrency: [
        {
          currency: 'INR',
          balances: [
            { user: alex, balance: -30 },
            { user: sam, balance: 30 },
          ],
          debts: [{ from: alex, to: sam, amount: 30 }],
        },
      ],
    };
    server.world.settlements[id] = [
      {
        _id: 'c00000000000000000000001',
        group: id,
        paidBy: alex,
        paidTo: sam,
        amount: 10,
        amountMinor: 1000,
        moneyVersion: 1,
        currency: 'INR',
        note: 'Cash',
        createdAt: '2026-09-28T12:00:00Z',
      },
    ];
    server.world.rates[id] = { 'EUR→INR': rateSuggestion('EUR', 'INR', '92.1') };
    const signed = await server.fetch('http://local/api/auth/demo-persona/sign-in', {
      method: 'POST',
      body: '{"personaId":"alex"}',
    });
    const Cookie = signed.headers.get('Set-Cookie')!.split(';')[0];
    const read = async (path: string) =>
      (await server.fetch('http://local' + path, { headers: { Cookie } })).json();
    expect(parseHomeBalances(await read('/api/user/balances'))).toMatchObject({
      buckets: [{ youOwe: 30 }],
      byGroup: { [id]: [{ balance: -30 }] },
    });
    expect(parseGroupBalances(await read(`/api/groups/${id}/balances`))[0]).toMatchObject({
      debts: [{ amount: 30 }],
      balances: [{ balance: -30 }, { balance: 30 }],
    });
    expect(
      parseSettlementHistory(await read(`/api/groups/${id}/settlements`), id)[0],
    ).toMatchObject({ amountMinor: 1000 });
    expect(
      parseRateSuggestionResponse(await read(`/api/groups/${id}/rates?from=EUR&to=INR`)),
    ).toMatchObject({ suggestion: { rate: '92.1', source: 'frankfurter' } });
  });
  it('answers a default Trip summary and a chosen currency through the Trip reader', async () => {
    const server = fakeSplitbook(),
      id = server.world.groups[0]!._id;
    const signed = await server.fetch('http://local/api/auth/demo-persona/sign-in', {
      method: 'POST',
      body: '{"personaId":"alex"}',
    });
    const Cookie = signed.headers.get('Set-Cookie')!.split(';')[0];
    const read = async (query: string) =>
      parseTripSummaryResponse(
        await (
          await server.fetch(
            `http://local/api/groups/${id}/trip-summary?tz=Asia%2FKolkata${query}`,
            { headers: { Cookie } },
          )
        ).json(),
      );
    const empty = await read('');
    expect(empty).toMatchObject({
      timeZone: 'Asia/Kolkata',
      currency: 'INR',
      spentMinor: 0,
      expenseCount: 0,
      hasExpenses: false,
    });
    server.world.tripSummaries[id] = {
      EUR: { ...empty, currency: 'EUR', spentMinor: 2000, expenseCount: 1, hasExpenses: true },
    };
    expect(await read('&currency=EUR')).toMatchObject({
      currency: 'EUR',
      spentMinor: 2000,
      expenseCount: 1,
    });
    expect(server.unanswered).toEqual([]);
  });
  it('builds the common Expense row in the app reader’s wire shape', async () => {
    const server = fakeSplitbook(),
      group = server.world.groups[0]!;
    const row = expenseFixture(group, 'b00000000000000000000009', 'Dinner');
    const page = {
      status: 200,
      data: {
        expenses: [row],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        summary: {
          count: 1,
          totalsByCurrency: [{ currency: 'INR', totalAmount: 10 }],
          userOwes: 0,
          userGetsBack: 0,
          byMember: [],
        },
      },
    };
    expect(parseExpensePage(page, group._id, 'INR').expenses[0]).toMatchObject({
      id: 'b00000000000000000000009',
      description: 'Dinner',
      amount: 10,
      amountMinor: 1000,
      paidBy: [{ user: { id: 'a00000000000000000000001' }, amountMinor: 1000 }],
    });
  });
  it('reads Expense records and filtered history pages from the world with the app readers', async () => {
    const server = fakeSplitbook(),
      group = server.world.groups[0]!,
      id = 'b00000000000000000000009';
    server.world.expenseRecords[group._id] = {
      [id]: { ...expenseFixture(group, id), revision: 3, isDeleted: false, editHistory: [] },
    };
    server.world.activities[group._id] = [
      {
        _id: 'd00000000000000000000001',
        group: group._id,
        actor: group.members[0]!.user,
        createdAt: group.updatedAt,
        type: 'expense_added',
        metadata: { expenseId: id, description: 'Groceries' },
      },
      {
        _id: 'd00000000000000000000002',
        group: group._id,
        actor: group.members[0]!.user,
        createdAt: group.updatedAt,
        type: 'expense_added',
        metadata: { expenseId: 'b00000000000000000000008', description: 'Other' },
      },
    ];
    const signed = await server.fetch('http://local/api/auth/demo-persona/sign-in', {
      method: 'POST',
      body: '{"personaId":"alex"}',
    });
    const Cookie = signed.headers.get('Set-Cookie')!.split(';')[0];
    const read = async (path: string) =>
      (await server.fetch('http://local' + path, { headers: { Cookie } })).json();
    expect(
      parseExpenseRecord(await read(`/api/groups/${group._id}/expenses/${id}`), group._id, id),
    ).toMatchObject({ revision: 3, amountMinor: 1000 });
    expect(
      parseActivityPage(
        await read(`/api/groups/${group._id}/activity?expenseId=${id}&page=1&limit=20`),
        group._id,
        1,
        id,
      ).events.map((e) => e._id),
    ).toEqual(['d00000000000000000000001']);
    expect(
      parseActivityPage(
        await read(`/api/groups/${group._id}/activity?page=2&limit=20`),
        group._id,
        2,
      ).events,
    ).toEqual([]);
    expect(server.unanswered).toEqual([]);
  });
  it.each(['request', 'reply'] as const)(
    'holds at the %s boundary and captures the answer at the matching moment',
    async (at) => {
      const server = fakeSplitbook();
      let value = 'before';
      server.reply('GET', '/probe', () => Response.json({ value }));
      const hold = server.hold('GET', /^\/probe/, { at });
      const reading = server.fetch('http://local/probe?page=1', {});
      await hold.arrived;
      expect(server.requests.map((r) => r.path)).toEqual(['/probe?page=1']);
      value = 'after';
      hold.release();
      expect(await (await reading).json()).toEqual({
        value: at === 'request' ? 'after' : 'before',
      });
      expect(await (await server.fetch('http://local/probe', {})).json()).toEqual({
        value: 'after',
      });
    },
  );
  it('loses a held reply after the request was taken, without returning its captured response', async () => {
    const server = fakeSplitbook();
    let accepted = 0;
    server.reply('POST', '/probe', () => {
      accepted++;
      return Response.json({ accepted });
    });
    const held = server.hold('POST', '/probe');
    const reading = server.fetch('http://local/probe', { method: 'POST', body: '{}' });
    await held.arrived;
    expect(accepted).toBe(1);
    held.release('lost-reply');
    await expect(reading).rejects.toThrow('Network request failed');
    expect(server.requests).toHaveLength(1);
  });
  it('logs the time a request was sent, including an offline attempt', async () => {
    const server = fakeSplitbook();
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);
    try {
      await server.fetch('http://local/first', {});
      now.mockReturnValue(200);
      server.online = false;
      await expect(server.fetch('http://local/second', {})).rejects.toThrow(
        'Network request failed',
      );
      expect(server.requests.map(({ path, at }) => ({ path, at }))).toEqual([
        { path: '/first', at: 100 },
        { path: '/second', at: 200 },
      ]);
    } finally {
      now.mockRestore();
    }
  });
  it('reads each account’s Groups and Home figures from its world data', async () => {
    const server = fakeSplitbook(),
      group = server.world.groups[0]!;
    server.world.groupsByAccount[server.world.people.alex.id] = [group];
    server.world.groupsByAccount[server.world.people.sam.id] = [];
    server.world.homeByAccount[server.world.people.alex.id] = {
      buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }],
      groups: [{ groupId: group._id, balances: [{ currency: 'INR', balance: -30 }] }],
    };
    server.world.homeByAccount[server.world.people.sam.id] = {
      buckets: [{ currency: 'INR', youOwe: 50, youAreOwed: 0 }],
    };
    for (const [persona, count, owe] of [
      ['alex', 1, 30],
      ['sam', 0, 50],
    ] as const) {
      const signed = await server.fetch('http://local/api/auth/demo-persona/sign-in', {
        method: 'POST',
        body: JSON.stringify({ personaId: persona }),
      });
      const Cookie = signed.headers.get('Set-Cookie')!.split(';')[0];
      const read = async (path: string) =>
        (await server.fetch('http://local' + path, { headers: { Cookie } })).json();
      expect(parseGroups(await read('/api/groups'))).toHaveLength(count);
      expect(parseHomeBalances(await read('/api/user/balances')).buckets).toEqual([
        { currency: 'INR', youOwe: owe, youAreOwed: 0 },
      ]);
    }
  });
  it('answers fixed Month and Activity pages by query regardless of parameter order', async () => {
    const server = fakeSplitbook(),
      group = server.world.groups[0]!,
      base = `/api/groups/${group._id}`;
    const august = { ...expenseFixture(group), description: 'August groceries' };
    const september = { ...expenseFixture(group), description: 'September groceries' };
    const events = Array.from({ length: 21 }, (_, i) => ({
      _id: `d${String(i + 1).padStart(23, '0')}`,
      group: group._id,
      actor: group.members[0]!.user,
      createdAt: group.updatedAt,
      type: 'expense_added',
      metadata: { description: 'Groceries' },
    }));
    Object.assign(
      server.world.pages,
      pagesFor(base + '/expenses', [
        [
          { dateFrom: '2026-08-01', dateTo: '2026-08-31', page: 1, limit: 20 },
          expensePage([august]),
        ],
        [
          { dateFrom: '2026-09-01', dateTo: '2026-09-30', page: 1, limit: 20 },
          expensePage([september]),
        ],
      ]),
      pagesFor(base + '/activity', [[{ page: 2, limit: 20 }, activityPage(events, 2)]]),
    );
    const signed = await server.fetch('http://local/api/auth/demo-persona/sign-in', {
      method: 'POST',
      body: '{"personaId":"alex"}',
    });
    const Cookie = signed.headers.get('Set-Cookie')!.split(';')[0];
    const read = async (path: string) =>
      (await server.fetch('http://local' + path, { headers: { Cookie } })).json();
    for (const [month, description] of [
      ['08', 'August groceries'],
      ['09', 'September groceries'],
    ]) {
      const last = month === '08' ? '31' : '30';
      expect(
        parseExpensePage(
          await read(
            `${base}/expenses?limit=20&page=1&dateTo=2026-${month}-${last}&dateFrom=2026-${month}-01`,
          ),
          group._id,
          'INR',
        ).expenses[0]?.description,
      ).toBe(description);
    }
    expect(
      parseActivityPage(await read(base + '/activity?limit=20&page=2'), group._id, 2).events.map(
        (e) => e._id,
      ),
    ).toEqual(['d00000000000000000000021']);
    expect(server.unanswered).toEqual([]);
  });
  it('distinguishes offline attempts from requests sent while connected', async () => {
    const server = fakeSplitbook();
    server.online = false;
    await expect(server.fetch('http://local/probe', {})).rejects.toThrow('Network request failed');
    server.online = true;
    await server.fetch('http://local/probe', {});
    expect(server.requests.map((r) => r.online)).toEqual([false, true]);
  });
  it('answers empty and populated Tags in the app reader’s wire shape', async () => {
    const server = fakeSplitbook(),
      group = server.world.groups[0]!;
    const signed = await server.fetch('http://local/api/auth/demo-persona/sign-in', {
      method: 'POST',
      body: '{"personaId":"alex"}',
    });
    const Cookie = signed.headers.get('Set-Cookie')!.split(';')[0];
    const read = async () =>
      tagRead({
        source: 'network',
        refreshedAt: 100,
        value: await (
          await server.fetch(`http://local/api/groups/${group._id}/tag-actions`, {
            headers: { Cookie },
          })
        ).json(),
      });
    expect((await read()).snapshot).toEqual({ canManage: false, tags: [] });
    server.world.tags[group._id] = {
      canManage: true,
      tags: [
        {
          id: 'c00000000000000000000001',
          name: 'Food',
          revision: 0,
          isArchived: false,
          isDeleted: false,
        },
      ],
    };
    expect((await read()).snapshot).toEqual({
      canManage: true,
      tags: [
        {
          id: 'c00000000000000000000001',
          name: 'Food',
          revision: 0,
          isArchived: false,
          isDeleted: false,
        },
      ],
    });
  });

  it('keeps a mutable pathname-only view without clearing the complete request log', async () => {
    const server = fakeSplitbook(),
      paths = server.sent({ query: false, method: false });
    await server.fetch('http://local/first?page=1', {});
    expect(paths).toEqual(['/first']);
    paths.length = 0;
    await server.fetch('http://local/second?page=2', { method: 'POST', body: '{}' });
    expect(paths).toEqual(['/second']);
    expect(server.requests).toHaveLength(2);
  });
});

it('owns seeded and rotated sessions and refuses one after it expires or is revoked', async () => {
  const server = fakeSplitbook();
  const cookie = server.auth.issue('alex', 'better-auth.session_token=stored.signature');
  const call = () => server.fetch('http://local/api/auth/get-session', {headers:{Cookie:cookie}});
  expect(parseSession(await (await call()).json())?.user.id).toBe('a00000000000000000000001');
  server.auth.rotate = true;
  const rotated = await call();
  const next = rotated.headers.get('Set-Cookie')!.split(';')[0];
  expect(server.auth.sessions.has(cookie)).toBe(true);
  expect(server.auth.sessions.has(next)).toBe(true);
  server.auth.expired = true;
  expect((await call()).status).toBe(401);
  server.auth.expired = false;
  server.auth.sessions.delete(cookie);
  expect((await call()).status).toBe(401);
  expect(server.auth.issuedTo.get(cookie)?.name).toBe('Alex Rivera');
});

it('refuses sign-in and revoke without silently changing the server session', async () => {
  const server = fakeSplitbook();
  const signIn = () => server.fetch('http://local/api/auth/demo-persona/sign-in', {method:'POST',body:'{"personaId":"alex"}'});
  server.auth.signInStatus = 403;
  expect((await signIn()).status).toBe(403);
  expect(server.auth.sessions.size).toBe(0);
  server.auth.signInStatus = 200;
  const signed = await signIn();
  const cookie = signed.headers.get('Set-Cookie')!.split(';')[0];
  server.auth.signOutStatus = 503;
  const revoke = () => server.fetch('http://local/api/auth/sign-out', {method:'POST',headers:{Cookie:cookie}});
  expect((await revoke()).status).toBe(503);
  expect(server.auth.sessions.has(cookie)).toBe(true);
  server.auth.signOutStatus = 200;
  expect((await revoke()).status).toBe(200);
  expect(server.auth.sessions.has(cookie)).toBe(false);
});

it('checks the native Google backend and exchanges either persona’s identity for a secure session', async () => {
  const server = fakeSplitbook();
  server.auth.bootstrap = {environment:'staging',googleWebClientId:'test-client'};
  server.auth.secureCookies=true;
  const marker = await server.fetch('https://staging.splitbook.test/.well-known/splitbook-mobile.json', {});
  expect(await marker.json()).toEqual({environment:'staging',googleWebClientId:'test-client'});
  const signed = await server.fetch('https://staging.splitbook.test/api/auth/sign-in/social', {
    method:'POST',body:JSON.stringify({provider:'google',idToken:{token:'google-token-sam',nonce:'n'}}),
  });
  expect(parseSignIn(await signed.json()).name).toBe('Sam Chen');
  expect(signed.headers.get('Set-Cookie')).toContain('__Secure-better-auth.session_token=sam-1.signature');
  const cookie=signed.headers.get('Set-Cookie')!.split(';')[0];
  server.auth.expiresAt='2020-01-01T00:00:00Z';
  const restored=await server.fetch('https://staging.splitbook.test/api/auth/get-session',{headers:{Cookie:cookie}});
  expect(parseSession(await restored.json())?.expiresAt.getTime()).toBe(Date.parse('2020-01-01T00:00:00Z'));
});

it('aborts a held reply after the server took the sign-in without undoing its session', async () => {
  const server=fakeSplitbook();
  const held=server.hold('POST','/api/auth/demo-persona/sign-in',{abortable:true});
  const abort=new AbortController();
  const pending=server.fetch('http://local/api/auth/demo-persona/sign-in',{method:'POST',body:'{"personaId":"alex"}',signal:abort.signal});
  await held.arrived;
  const rejected=expect(pending).rejects.toThrow('Network request failed');
  abort.abort();await rejected;
  expect(server.auth.sessions.size).toBe(1);
  held.release();
});
