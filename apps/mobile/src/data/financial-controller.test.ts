import { describe, expect, it, vi } from 'vitest';
import { getLocalMonthIsoRange } from '@splitbook/shared/date';
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
  const clock = { now: new Date(2026, 8, 27, 12).getTime() };
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
    },
    {
      now: () => clock.now,
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
  return { controller, calls, clock };
}

/** Hold matching requests until released, to observe the screen mid-refresh. */
function gate() {
  const waiting: { path: string; release: (response: FetchResponse) => void }[] = [];
  const arrivals: (() => void)[] = [];
  return {
    hold(path: string) {
      return new Promise<FetchResponse>((release) => {
        waiting.push({ path, release });
        arrivals.splice(0).forEach((notify) => notify());
      });
    },
    async next(match: string) {
      for (;;) {
        const index = waiting.findIndex((entry) => entry.path.includes(match));
        if (index >= 0) return waiting.splice(index, 1)[0];
        await new Promise<void>((resolve) => arrivals.push(resolve));
      }
    },
  };
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
    const outdated = {
      ...balances,
      data: {
        ...balances.data,
        byCurrency: [
          { ...balances.data.byCurrency[0], balances: [{ user: person, balance: -99 }] },
        ],
      },
    };
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
    const verified = controller.getSnapshot().financial;
    hold = true;
    const oldBalance = controller.refreshBalances();
    await balanceDispatched;
    const expenses = controller.refreshExpenses();
    await expensesDispatched;
    releaseBalance(json(outdated));
    await oldBalance;
    // The pre-materialization response is discarded; previous figures stay, marked unverified.
    expect(controller.getSnapshot().financial.balances).toMatchObject({
      status: 'loading',
      data: verified.balances.data,
      stale: true,
      refreshedAt: verified.balances.refreshedAt,
    });
    releaseExpenses(json({}, 503));
    await expenses;
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      status: 'error',
      data: verified.expenses.data,
      summary: verified.expenses.summary,
      refreshedAt: verified.expenses.refreshedAt,
    });
    expect(controller.getSnapshot().financial.balances).toMatchObject({
      status: 'error',
      data: verified.balances.data,
      stale: true,
      refreshedAt: verified.balances.refreshedAt,
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
    // Retained for the return to Home, but no longer presented as current.
    expect(controller.getSnapshot().home).toMatchObject({
      stale: true,
      data: [{ youOwe: 0 }],
    });
    await controller.back();
    expect(controller.getSnapshot().home).toMatchObject({
      status: 'ready',
      stale: false,
      data: [{ youOwe: 30 }],
    });
    owe = 40;
    await controller.refresh();
    expect(controller.getSnapshot().home.data?.[0].youOwe).toBe(40);
    failHome = true;
    await controller.refreshHome();
    expect(controller.getSnapshot().home).toMatchObject({
      status: 'error',
      data: [{ youOwe: 40 }],
    });
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
      byGroup: {},
      message: null,
      refreshedAt: new Date(2026, 8, 27, 12).getTime(),
      stale: false,
    });
  });
});

describe('stable financial refresh', () => {
  const later = (clock: { now: number }) => (clock.now += 60_000);
  const secondExpense = { ...expense, _id: 'b00000000000000000000002', description: 'Rent' };

  it('keeps the same Group readable during a background refresh, then publishes verified figures in order', async () => {
    const held = gate();
    let holding = false;
    const { controller, calls, clock } = setup((path) =>
      holding && (path.includes('/expenses?') || path.endsWith(`/${groupId}/balances`))
        ? held.hold(path)
        : undefined,
    );
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const before = controller.getSnapshot();
    const verifiedAt = before.financial.balances.refreshedAt;
    expect(verifiedAt).toBe(clock.now);
    expect(before.financial.expenses.refreshedAt).toBe(clock.now);
    later(clock);
    holding = true;
    calls.length = 0;
    const refresh = controller.refresh();

    const expenseRead = await held.next('/expenses?');
    let screen = controller.getSnapshot();
    expect(screen.pull).toBeNull();
    expect(screen.detail).toMatchObject({ id: groupId, data: before.detail.data });
    expect(screen.financial.expenses).toMatchObject({
      status: 'loading',
      data: before.financial.expenses.data,
      summary: before.financial.expenses.summary,
      refreshedAt: verifiedAt,
    });
    // Expense reads can materialize recurring entries: prior Balances are shown as updating.
    expect(screen.financial.balances).toMatchObject({
      status: 'loading',
      data: before.financial.balances.data,
      stale: true,
      refreshedAt: verifiedAt,
    });
    expect(calls.some((path) => path.endsWith(`/${groupId}/balances`))).toBe(false);

    expenseRead.release(json(expensePage([expense, secondExpense])));
    const balanceRead = await held.next('/balances');
    screen = controller.getSnapshot();
    expect(screen.financial.expenses).toMatchObject({
      status: 'ready',
      refreshedAt: clock.now,
    });
    expect(screen.financial.expenses.data.map((row) => row.id)).toEqual([
      expense._id,
      secondExpense._id,
    ]);
    expect(screen.financial.balances).toMatchObject({ status: 'loading', stale: true });

    balanceRead.release(json(balances));
    await refresh;
    expect(controller.getSnapshot().financial.balances).toMatchObject({
      status: 'ready',
      stale: false,
      refreshedAt: clock.now,
    });
  });

  it('shows the native pull indicator only while a pull runs, never for a retry', async () => {
    const held = gate();
    let holding = false;
    const { controller } = setup((path) =>
      holding && path.includes('/expenses?') ? held.hold(path) : undefined,
    );
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().pull).toBeNull();
    holding = true;

    // A Retry button uses the default quiet feedback.
    const quiet = controller.refresh();
    const quietRead = await held.next('/expenses?');
    expect(controller.getSnapshot().pull).toBeNull();
    quietRead.release(json(expensePage()));
    await quiet;

    const pull = controller.refresh('pull');
    expect(controller.getSnapshot().pull).toBe(`group:${groupId}:expenses`);
    const read = await held.next('/expenses?');
    expect(controller.getSnapshot()).toMatchObject({
      pull: `group:${groupId}:expenses`,
      financial: { expenses: { status: 'loading', data: [{ id: expense._id }] } },
    });
    read.release(json(expensePage()));
    await pull;
    expect(controller.getSnapshot().pull).toBeNull();
  });

  it('keeps Home figures and Groups with their original time when a background refresh fails', async () => {
    let failing = false;
    // A 500, a server fault: an uncoded 503 now counts as can't reach the server (#231).
    const { controller, clock } = setup((path) =>
      failing && path === '/api/user/balances' ? json({}, 500) : undefined,
    );
    await controller.signIn('sam');
    const verifiedAt = clock.now;
    const before = controller.getSnapshot();
    later(clock);
    failing = true;
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      pull: null,
      groups: { status: 'ready', data: before.groups.data },
      home: {
        status: 'error',
        data: before.home.data,
        refreshedAt: verifiedAt,
        message: 'The server could not complete this request. Please try again.',
      },
    });
    failing = false;
    await controller.refresh('pull');
    expect(controller.getSnapshot().home).toMatchObject({
      status: 'ready',
      refreshedAt: clock.now,
    });
  });

  it('keeps unverified Balances with their original time when the Expense refresh fails', async () => {
    let failing = false;
    const { controller, clock } = setup((path) =>
      failing && path.includes('/expenses?') ? json({}, 503) : undefined,
    );
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const before = controller.getSnapshot().financial;
    later(clock);
    failing = true;
    await controller.refresh();
    expect(controller.getSnapshot().financial).toMatchObject({
      expenses: {
        status: 'error',
        data: before.expenses.data,
        summary: before.expenses.summary,
        refreshedAt: before.expenses.refreshedAt,
      },
      balances: {
        status: 'error',
        data: before.balances.data,
        stale: true,
        refreshedAt: before.balances.refreshedAt,
        message: 'Could not update balances. Please try again.',
      },
    });
  });

  it('never labels the previous Month’s Expenses with a new Month while keeping all-time Balances', async () => {
    const held = gate();
    let holding = false;
    const { controller } = setup((path) =>
      holding && path.includes('/expenses?') ? held.hold(path) : undefined,
    );
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const before = controller.getSnapshot().financial;
    expect(before.month).toBe('2026-09');
    holding = true;
    const selecting = controller.selectMonth('2026-08');
    const read = await held.next('/expenses?');
    expect(controller.getSnapshot().financial).toMatchObject({
      month: '2026-08',
      expenses: { status: 'loading', data: [], summary: null, refreshedAt: null },
      balances: { status: 'loading', data: before.balances.data, stale: true },
    });
    read.release(json(expensePage([])));
    await selecting;
    expect(controller.getSnapshot().financial).toMatchObject({
      month: '2026-08',
      expenses: { status: 'ready', data: [] },
      balances: { status: 'ready', data: before.balances.data, stale: false },
    });
  });

  it('opens another Group without showing the previous Group’s figures', async () => {
    const otherId = 'a00000000000000000000011';
    const held = gate();
    const { controller } = setup((path) =>
      path.startsWith(`/api/groups/${otherId}`) ? held.hold(path) : undefined,
    );
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const opening = controller.openGroup(otherId);
    const read = await held.next(`/api/groups/${otherId}`);
    expect(controller.getSnapshot()).toMatchObject({
      detail: { id: otherId, data: null, status: 'loading' },
      financial: {
        groupId: otherId,
        expenses: { status: 'idle', data: [], summary: null },
        balances: { data: null },
      },
    });
    read.release(json({}, 404));
    await opening;
  });

  it('removes retained Group figures immediately when a refresh is denied', async () => {
    const held = gate();
    let holding = false;
    const { controller } = setup((path) =>
      holding && path === `/api/groups/${groupId}` ? held.hold(path) : undefined,
    );
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    holding = true;
    const refresh = controller.refresh();
    const read = await held.next(`/api/groups/${groupId}`);
    expect(controller.getSnapshot().financial.expenses.data).toHaveLength(1);
    read.release(json({}, 403));
    await refresh;
    expect(controller.getSnapshot()).toMatchObject({
      detail: { status: 'denied', data: null },
      groups: { data: [] },
      home: { data: null },
      financial: { groupId: null, expenses: { data: [], summary: null }, balances: { data: null } },
    });
  });

  it('shares one Expense read between overlapping refreshes and applies it once', async () => {
    const held = gate();
    let holding = false;
    const { controller, calls } = setup((path) =>
      holding && path.includes('/expenses?') ? held.hold(path) : undefined,
    );
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    holding = true;
    const before = calls.length;
    const first = controller.refresh();
    const read = await held.next('/expenses?');
    const second = controller.refresh('pull');
    // Let the pull reach the same Expense read before that read answers.
    await new Promise((resolve) => setTimeout(resolve, 0));
    read.release(json(expensePage([secondExpense])));
    await Promise.all([first, second]);
    expect(calls.slice(before).filter((path) => path.includes('/expenses?'))).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({
      pull: null,
      financial: {
        expenses: { status: 'ready', data: [{ id: secondExpense._id }] },
        balances: { status: 'ready', stale: false },
      },
    });
  });

  it('keeps the newest Month when an older Group refresh finishes later, never mislabelling Expenses', async () => {
    const august = { ...expense, _id: 'b00000000000000000000003', description: 'August rent' };
    const held = gate();
    let holding = false;
    const { controller } = setup((path) => {
      if (holding && path === `/api/groups/${groupId}`) return held.hold(path);
      if (!path.includes('/expenses?')) return;
      const from = new URL(path, 'http://local').searchParams.get('dateFrom');
      return json(
        expensePage(from === getLocalMonthIsoRange('2026-08').dateFrom ? [august] : [expense]),
      );
    });
    const monthOf = { [expense.description]: '2026-09', [august.description]: '2026-08' };
    const mislabelled: string[] = [];
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    controller.subscribe(() => {
      const { financial, screen } = controller.getSnapshot();
      if (screen !== 'group') return;
      for (const row of financial.expenses.data)
        if (monthOf[row.description] !== financial.month)
          mislabelled.push(`${row.description} under ${financial.month}`);
    });
    expect(controller.getSnapshot().financial.month).toBe('2026-09');

    holding = true;
    const refresh = controller.refresh();
    const olderGroupRead = await held.next(`/api/groups/${groupId}`);
    await controller.selectMonth('2026-08');
    expect(controller.getSnapshot().financial).toMatchObject({
      month: '2026-08',
      expenses: { status: 'ready', data: [{ description: 'August rent' }] },
    });

    olderGroupRead.release(json({ data: group, status: 200 }));
    await refresh;
    expect(controller.getSnapshot().financial).toMatchObject({
      month: '2026-08',
      expenses: { status: 'ready', data: [{ description: 'August rent' }] },
      balances: { status: 'ready', stale: false },
    });
    expect(mislabelled).toEqual([]);
  });

  it('keeps Group figures with their original time when the Group read fails', async () => {
    let failing = false;
    // A 500, a server fault: an uncoded 503 now counts as can't reach the server (#231).
    const { controller, clock } = setup((path) =>
      failing && path === `/api/groups/${groupId}` ? json({}, 500) : undefined,
    );
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const verifiedAt = clock.now;
    const before = controller.getSnapshot();
    expect(before.detail.refreshedAt).toBe(verifiedAt);
    later(clock);
    failing = true;
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      detail: {
        status: 'error',
        data: before.detail.data,
        refreshedAt: verifiedAt,
        message: 'The server could not complete this request. Please try again.',
      },
      financial: before.financial,
    });
    failing = false;
    await controller.refresh('pull');
    expect(controller.getSnapshot().detail).toMatchObject({
      status: 'ready',
      refreshedAt: clock.now,
    });
  });

  it('drops retained figures on sign-out and ignores the refresh that was in flight', async () => {
    const held = gate();
    let holding = false;
    const { controller } = setup((path) =>
      holding && path.includes('/expenses?') ? held.hold(path) : undefined,
    );
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    holding = true;
    const refresh = controller.refresh('pull');
    const read = await held.next('/expenses?');
    await controller.signOut();
    read.release(json(expensePage([secondExpense])));
    await refresh;
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'signed-out' },
      pull: null,
      home: { data: null },
      financial: { groupId: null, expenses: { data: [] }, balances: { data: null } },
    });
  });

  it('keeps loaded Expenses while the next page loads and marks only the footer busy', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...expense,
      _id: `b${String(index + 1).padStart(23, '0')}`,
    }));
    const held = gate();
    const { controller } = setup((path) => {
      if (!path.includes('/expenses?')) return;
      const page = Number(new URL(path, 'http://local').searchParams.get('page'));
      return page === 2 ? held.hold(path) : json(expensePage(rows.slice(0, 20), 1, 21));
    });
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const more = controller.loadMoreExpenses();
    const read = await held.next('page=2');
    expect(controller.getSnapshot()).toMatchObject({
      pull: null,
      financial: { expenses: { status: 'ready', moreStatus: 'loading' } },
    });
    expect(controller.getSnapshot().financial.expenses.data).toHaveLength(20);
    read.release(json(expensePage(rows.slice(20), 2, 21)));
    await more;
    expect(controller.getSnapshot().financial.expenses.data).toHaveLength(21);
  });
});
