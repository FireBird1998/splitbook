import { describe, expect, it, vi } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { FetchResponse } from './types';

const user = {
  id: 'a00000000000000000000002',
  name: 'Sam Chen',
  email: 'sam@example.test',
  image: null,
};
const groupId = 'a00000000000000000000010';
const iso = '2026-09-27T10:00:00.000Z';
const group = {
  _id: groupId,
  createdBy: user.id,
  name: 'Shared Home',
  category: 'home',
  defaultCurrency: 'INR',
  members: [
    {
      user: { _id: user.id, name: user.name, email: user.email, image: null },
      role: 'member',
      joinedAt: iso,
    },
  ],
  createdAt: iso,
  updatedAt: iso,
};
const json = (body: unknown, status = 200) => Response.json(body, { status });
const person = { _id: user.id, name: user.name, image: null };
const expense = {
  _id: 'b00000000000000000000001',
  group: groupId,
  description: 'Groceries',
  currency: 'INR',
  amount: 10,
  amountMinor: 1000,
  moneyVersion: 1,
  category: 'food',
  tag: 'Shared',
  tagId: 'c00000000000000000000001',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  paidBy: [{ user: person, amount: 10, amountMinor: 1000 }],
  splitBetween: [{ user: person, amount: 10, amountMinor: 1000 }],
  splitMethod: 'equal',
};
const expensePage = (rows = [expense], page = 1, total = rows.length) => ({
  data: {
    expenses: rows,
    pagination: { page, limit: 20, total, totalPages: Math.ceil(total / 20) },
    summary: {
      count: total,
      totalAmount: 10,
      totalsByCurrency: [{ currency: 'INR', totalAmount: 10 }],
      userOwes: 0,
      userGetsBack: 0,
      byMember: [{ user: person, paid: 10, share: 10, net: 0 }],
    },
  },
  status: 200,
});
const balances = {
  data: {
    currency: 'INR',
    balances: [],
    debts: [],
    byCurrency: [
      {
        currency: 'INR',
        balances: [{ user: person, balance: -30 }],
        debts: [
          { from: person, to: { _id: 'a00000000000000000000001', name: 'Alex' }, amount: 30 },
        ],
      },
    ],
    hasMixedCurrencies: false,
  },
  status: 200,
};

function setup(
  intercept: (
    path: string,
    init: RequestInit,
  ) => FetchResponse | Promise<FetchResponse> | undefined = () => undefined,
) {
  let cookie: string | null = null;
  const calls: string[] = [];
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
    },
    {
      now: () => new Date(2026, 8, 27, 12).getTime(),
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      fetch: async (url, init) => {
        const path = new URL(url).pathname + new URL(url).search;
        calls.push(path);
        const intercepted = intercept(path, init);
        if (intercepted) return intercepted;
        if (path.endsWith('/sign-in'))
          return new Response(JSON.stringify({ user }), {
            status: 200,
            headers: { 'Set-Cookie': 'better-auth.session_token=test.signature; Path=/; HttpOnly' },
          });
        if (path.endsWith('/get-session'))
          return json({
            user,
            session: { userId: user.id, expiresAt: '2030-01-01T00:00:00.000Z' },
          });
        if (path.endsWith('/sign-out')) return json({ success: true });
        if (path === '/api/groups') return json({ data: [group], status: 200 });
        if (path === `/api/groups/${groupId}`) return json({ data: group, status: 200 });
        if (path === '/api/user/balances') return json({ data: { buckets: [] }, status: 200 });
        if (path.startsWith(`/api/groups/${groupId}/expenses?`)) return json(expensePage());
        if (path === `/api/groups/${groupId}/balances`) return json(balances);
        return json({}, 404);
      },
    },
  );
  return { controller, calls };
}

describe('native financial views', () => {
  it('purges financial state on expiry and ignores a Home response from the retired session', async () => {
    let held = false;
    let expired = false;
    let release!: (response: FetchResponse) => void;
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { controller } = setup((path) => {
      if (held && path === '/api/user/balances') {
        started();
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      if (expired && path.includes('/expenses?')) return json({}, 401);
    });
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    held = true;
    const home = controller.refreshHome();
    await dispatched;
    expired = true;
    await controller.refreshExpenses();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'signed-out' },
      home: { data: null },
      financial: { expenses: { data: [] }, balances: { data: null } },
    });
    release(
      json({ data: { buckets: [{ currency: 'INR', youOwe: 999, youAreOwed: 999 }] }, status: 200 }),
    );
    await home;
    expect(controller.getSnapshot().home.data).toBeNull();
  });

  it('keeps an authorized legacy Expense readable when a former participant no longer populates', async () => {
    const page = expensePage();
    const { controller } = setup((path) =>
      path.includes('/expenses?')
        ? json({
            ...page,
            data: {
              ...page.data,
              expenses: [
                {
                  ...expense,
                  moneyVersion: undefined,
                  amountMinor: undefined,
                  paidBy: [{ user: null, amount: 10 }],
                  splitBetween: [{ user: user.id, amount: 10 }],
                },
              ],
            },
          })
        : undefined,
    );
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      status: 'ready',
      data: [
        {
          amountMinor: 1000,
          paidBy: [{ user: { id: null, name: 'Former member' }, amount: 10, amountMinor: 1000 }],
          splitBetween: [{ user: { id: user.id, name: 'Former member' } }],
        },
      ],
    });
  });

  it.each([{ amountMinor: 999 }, { moneyVersion: 2 }, { currency: 'JPY', amount: 10.5 }])(
    'rejects inconsistent currency precision or canonical Expense money %j',
    async (mutation) => {
      const { controller } = setup((path) =>
        path.includes('/expenses?') ? json(expensePage([{ ...expense, ...mutation }])) : undefined,
      );
      await controller.signIn('sam');
      await controller.openGroup(groupId);
      expect(controller.getSnapshot().auth.status).toBe('authenticated');
      expect(controller.getSnapshot().financial.expenses).toMatchObject({
        status: 'error',
        data: [],
        summary: null,
      });
    },
  );

  it('clears a previous Month immediately and cannot append its delayed page into an empty Month', async () => {
    let release!: (response: FetchResponse) => void;
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    let empty = false;
    const { controller } = setup((path) => {
      if (!path.includes('/expenses?')) return;
      if (new URL(path, 'http://local').searchParams.get('page') === '2') {
        started();
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      if (empty)
        return json({
          data: {
            expenses: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
            summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
          },
          status: 200,
        });
      return json(expensePage([expense], 1, 21));
    });
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const oldPage = controller.loadMoreExpenses();
    await dispatched;
    empty = true;
    const month = controller.selectMonth('2025-01');
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      status: 'loading',
      data: [],
      summary: null,
      pagination: null,
    });
    await month;
    release(json(expensePage([{ ...expense, _id: 'b00000000000000000000002' }], 2, 21)));
    await oldPage;
    expect(controller.getSnapshot().financial).toMatchObject({
      month: '2025-01',
      expenses: { status: 'ready', data: [], summary: { count: 0, totalsByCurrency: [] } },
    });
    expect(controller.getSnapshot().financial.balances.data?.[0].balances[0].balance).toBe(-30);
  });

  it('retires running-balance reads started before a new expense materialization', async () => {
    let hold = false;
    let releaseBalance!: (response: FetchResponse) => void;
    let releaseExpenses!: (response: FetchResponse) => void;
    let balanceStarted!: () => void;
    let expensesStarted!: () => void;
    const balanceDispatched = new Promise<void>((resolve) => {
      balanceStarted = resolve;
    });
    const expensesDispatched = new Promise<void>((resolve) => {
      expensesStarted = resolve;
    });
    const { controller } = setup((path) => {
      if (!hold) return;
      if (path.endsWith('/balances') && path.includes('/groups/')) {
        balanceStarted();
        return new Promise((resolve) => {
          releaseBalance = resolve;
        });
      }
      if (path.includes('/expenses?')) {
        expensesStarted();
        return new Promise((resolve) => {
          releaseExpenses = resolve;
        });
      }
    });
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    hold = true;
    const oldBalance = controller.refreshBalances();
    await balanceDispatched;
    const expenses = controller.refreshExpenses();
    await expensesDispatched;
    releaseBalance(json(balances));
    await oldBalance;
    expect(controller.getSnapshot().financial.balances).toMatchObject({
      status: 'loading',
      data: null,
    });
    releaseExpenses(json({}, 503));
    await expenses;
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      status: 'error',
      data: [],
      summary: null,
    });
    expect(controller.getSnapshot().financial.balances).toMatchObject({
      status: 'error',
      data: null,
    });
  });

  it('invalidates Home during expense materialization and refreshes Home on returning or foreground refresh', async () => {
    let owe = 0;
    let failHome = false;
    const { controller } = setup((path) => {
      if (path.includes('/expenses?')) {
        owe = 30;
        return json(expensePage());
      }
      if (path === '/api/user/balances')
        return failHome
          ? json({}, 503)
          : json({
              data: { buckets: [{ currency: 'INR', youOwe: owe, youAreOwed: 50 }] },
              status: 200,
            });
    });
    await controller.signIn('sam');
    expect(controller.getSnapshot().home.data?.[0].youOwe).toBe(0);
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().home.data).toBeNull();
    await controller.back();
    expect(controller.getSnapshot().home.data?.[0].youOwe).toBe(30);
    owe = 40;
    await controller.refresh();
    expect(controller.getSnapshot().home.data?.[0].youOwe).toBe(40);
    failHome = true;
    await controller.refreshHome();
    expect(controller.getSnapshot().home).toMatchObject({ status: 'error', data: null });
  });

  it('reloads Home after cancelling an invitation opened from a Group', async () => {
    let owe = 0;
    const { controller, calls } = setup((path) => {
      if (path.includes('/expenses?')) owe = 30;
      if (path === '/api/user/balances')
        return json({
          data: { buckets: [{ currency: 'INR', youOwe: owe, youAreOwed: 50 }] },
          status: 200,
        });
    });
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().home.status).toBe('idle');
    await controller.openInvitation('https://wrong-origin.test/invalid');
    await controller.cancelInvitation();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      home: { status: 'ready', data: [{ currency: 'INR', youOwe: 30, youAreOwed: 50 }] },
      detail: { status: 'idle', id: null, data: null },
      financial: {
        groupId: null,
        expenses: { status: 'idle', data: [], summary: null },
        balances: { status: 'idle', data: null },
      },
    });
    expect(calls.filter((path) => path === '/api/user/balances')).toHaveLength(2);
  });

  it.each(['expenses', 'balances'])(
    'drops all protected Group information after a denied %s refresh',
    async (endpoint) => {
      let denied = false;
      const { controller } = setup((path) =>
        denied && path.includes(`/groups/${groupId}/${endpoint}`) ? json({}, 403) : undefined,
      );
      await controller.signIn('sam');
      await controller.openGroup(groupId);
      denied = true;
      if (endpoint === 'expenses') await controller.refreshExpenses();
      else await controller.refreshBalances();
      expect(controller.getSnapshot().detail).toMatchObject({ status: 'denied', data: null });
      expect(controller.getSnapshot().groups.data).toEqual([]);
      expect(controller.getSnapshot().financial).toMatchObject({
        groupId: null,
        expenses: { data: [], summary: null },
        balances: { data: null },
      });
      expect(controller.getSnapshot().home.data).toBeNull();
    },
  );

  it('clears Group finances when leaving and ignores an already dispatched next page', async () => {
    let release!: (value: FetchResponse) => void;
    let started!: () => void;
    const held = new Promise<FetchResponse>((resolve) => {
      release = resolve;
    });
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { controller } = setup((path) => {
      if (!path.includes('/expenses?')) return;
      if (new URL(path, 'http://local').searchParams.get('page') === '2') {
        started();
        return held;
      }
      return json(expensePage([expense], 1, 21));
    });
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const pending = controller.loadMoreExpenses();
    await dispatched;
    controller.back();
    expect(controller.getSnapshot().financial).toMatchObject({
      groupId: null,
      expenses: { data: [], summary: null },
      balances: { data: null },
    });
    release(json(expensePage([{ ...expense, _id: 'b00000000000000000000002' }], 2, 21)));
    await pending;
    expect(controller.getSnapshot().financial.expenses.data).toEqual([]);
    expect(controller.getSnapshot().detail.data).toBeNull();
  });

  it('retries a failed next page without losing the loaded expenses or window summary', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...expense,
      _id: `b${String(index + 1).padStart(23, '0')}`,
    }));
    let failNext = true;
    const { controller, calls } = setup((path) => {
      if (!path.includes('/expenses?')) return;
      const page = Number(new URL(path, 'http://local').searchParams.get('page'));
      if (page === 2 && failNext) return json({}, 503);
      return json(expensePage(page === 1 ? rows.slice(0, 20) : rows.slice(20), page, 21));
    });
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    await controller.loadMoreExpenses();
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      status: 'ready',
      moreStatus: 'error',
      pagination: { page: 1 },
      summary: { count: 21 },
    });
    expect(controller.getSnapshot().financial.expenses.data).toHaveLength(20);
    failNext = false;
    await controller.loadMoreExpenses();
    expect(controller.getSnapshot().financial.expenses.data.map((row) => row.id)).toEqual(
      rows.map((row) => row._id),
    );
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      moreStatus: 'idle',
      pagination: { page: 2 },
    });
    const readCount = calls.length;
    await controller.loadMoreExpenses();
    expect(calls).toHaveLength(readCount);
  });

  it('uses local Month boundaries across DST and preserves the selected Month on refresh', async () => {
    vi.stubEnv('TZ', 'America/New_York');
    try {
      const { controller, calls } = setup();
      await controller.signIn('sam');
      await controller.openGroup(groupId);
      expect(controller.getSnapshot().financial.month).toBe('2026-09');
      await controller.selectMonth('2026-03');
      const query = new URL(
        calls.filter((path) => path.includes('/expenses?')).at(-1)!,
        'http://local',
      ).searchParams;
      expect(query.get('dateFrom')).toBe('2026-03-01T05:00:00.000Z');
      expect(query.get('dateTo')).toBe('2026-04-01T03:59:59.999Z');
      expect(query.get('quickFilter')).toBeNull();
      expect(query.get('includeMemberBreakdown')).toBe('1');
      await controller.refresh();
      expect(controller.getSnapshot().financial.month).toBe('2026-03');
      expect(controller.getSnapshot().financial.balances.data?.[0].balances[0].balance).toBe(-30);
      await controller.selectMonth(null);
      const allTime = new URL(
        calls.filter((path) => path.includes('/expenses?')).at(-1)!,
        'http://local',
      ).searchParams;
      expect(allTime.has('dateFrom')).toBe(false);
      expect(allTime.has('dateTo')).toBe(false);
      expect(
        calls
          .filter((path) => path.includes('/groups/') && path.includes('/balances'))
          .every((path) => !path.includes('?')),
      ).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('loads Group expense money and dates before reading authoritative running balances', async () => {
    const { controller, calls } = setup();
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const state = controller.getSnapshot().financial;
    expect(state.groupId).toBe(groupId);
    expect(state.expenses.status).toBe('ready');
    expect(state.expenses.data[0]).toMatchObject({
      id: expense._id,
      amount: 10,
      amountMinor: 1000,
      date: new Date(iso),
      tagId: expense.tagId,
      paidBy: [{ user: { id: user.id, name: 'Sam Chen' }, amount: 10 }],
    });
    expect(state.balances.data?.[0]).toMatchObject({
      currency: 'INR',
      balances: [{ balance: -30 }],
      debts: [{ amount: 30 }],
    });
    expect(calls.findIndex((path) => path.includes('/expenses?'))).toBeLessThan(
      calls.findIndex((path) => path.endsWith('/balances') && path.includes('/groups/')),
    );
  });

  it('shows separate server owe and receivable amounts for every Home currency', async () => {
    const { controller } = setup((path) =>
      path === '/api/user/balances'
        ? json({
            data: {
              buckets: [
                { currency: 'INR', youOwe: 30, youAreOwed: 50, net: 20 },
                { currency: 'EUR', youOwe: 12.34, youAreOwed: 5.67, net: -6.67 },
              ],
            },
            status: 200,
          })
        : undefined,
    );
    await controller.signIn('sam');
    expect(controller.getSnapshot().home).toEqual({
      status: 'ready',
      data: [
        { currency: 'INR', youOwe: 30, youAreOwed: 50 },
        { currency: 'EUR', youOwe: 12.34, youAreOwed: 5.67 },
      ],
      message: null,
    });
  });
});
