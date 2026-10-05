import { describe, expect, it, vi } from 'vitest';
import { getLocalMonthIsoRange } from '@splitbook/shared/date';
import { createMobileController } from './mobile-controller';
import { createFinancialReadStore } from './read-cache-storage';
import type { FinancialReadStore } from './offline-cache';
import type { FetchResponse } from './types';

// #191: a member's own confirmed or unconfirmed change leaves no saved copy older than it.

// This device's SQLite records, kept in memory. The real saved-copy store runs on top of them.
const device = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  /** The next write of an environment's saved copies is held part-way, as on a slow disk. */
  stall: null as null | { environment: string; arrive: () => void; released: Promise<void> },
}));
vi.mock('./account-record-storage', () => ({
  createAccountGroupRecordStore: (environment: string, kind: string) => {
    const key = (accountId: string, id: string) => `${environment}|${kind}|${accountId}|${id}`;
    return {
      load: async (accountId: string, id: string) =>
        structuredClone(device.records.get(key(accountId, id)) ?? null),
      save: async (accountId: string, id: string, value: unknown) => {
        const stall = device.stall;
        if (kind === 'cache' && stall?.environment === environment) {
          device.stall = null;
          stall.arrive();
          await stall.released;
        }
        device.records.set(key(accountId, id), structuredClone(value));
      },
      remove: async (accountId: string, id: string) => {
        device.records.delete(key(accountId, id));
      },
      clear: async () => {
        for (const stored of [...device.records.keys()])
          if (stored.startsWith(`${environment}|${kind}|`)) device.records.delete(stored);
      },
    };
  },
}));

// Fictional people and Groups only.
const alex = { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test' };
const mapleId = 'b00000000000000000000001';
const cabinId = 'b00000000000000000000002';
const dinnerId = 'd00000000000000000000001';
const tagId = 'c00000000000000000000001';
const iso = '2026-09-15T06:30:00.000Z';
const person = (user: typeof alex) => ({ _id: user.id, name: user.name, image: null });
const groupOf = (id: string, name: string, category: string) => ({
  _id: id,
  createdBy: alex.id,
  name,
  category,
  defaultCurrency: 'INR',
  members: [alex, sam].map((user) => ({
    user: { ...person(user), email: user.email },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Food', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
/** A Household with Months, where every change in these tests happens. */
const maple = groupOf(mapleId, 'Maple House', 'home');
/** A Trip nobody changes. */
const cabin = groupOf(cabinId, 'Cabin Weekend', 'trip');
const json = (body: unknown, status = 200) => Response.json(body, { status });
const notSaved = 'This view was not saved on this device. Connect to load it.';

/** The Month an Expense page is for (null without one), and its page. */
const pageOf = (path: string) => {
  const params = new URL(path, 'http://local').searchParams;
  const month = ['2026-08', '2026-09'].find(
    (key) => getLocalMonthIsoRange(key).dateFrom === params.get('dateFrom'),
  );
  return { month: month ?? null, page: Number(params.get('page')) };
};

/**
 * A fictional backend whose ledger version for Maple House rises with every accepted change,
 * and this device's stores, which survive a restart.
 */
function fixture() {
  const clock = { now: Date.parse(iso) };
  const server = {
    offline: false,
    /** A change reaches the server, but its answer is lost. */
    loseWrites: false,
    /** This device can't remove saved copies. */
    failInvalidation: false,
    ledger: 0,
    dinner: { description: 'Dinner', revision: 3, isDeleted: false },
  };
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null,
    cleanup = false,
    keys = 0;
  const calls: { method: string; path: string }[] = [];
  const memory = (map = new Map<string, unknown>()) => ({
    load: async (account: string, key: string) => structuredClone(map.get(account + key) ?? null),
    save: async (account: string, key: string, value: unknown) => {
      map.set(account + key, structuredClone(value));
    },
    remove: async (account: string, key: string) => {
      map.delete(account + key);
    },
    clear: async () => {
      map.clear();
    },
  });
  const drafts = memory(),
    attempts = memory();
  const environment = `http://localhost:4138/${Math.random()}`;
  const store = createFinancialReadStore(environment);
  const readCache: FinancialReadStore = {
    ...store,
    invalidateLedger: (accountId, groupId) =>
      server.failInvalidation
        ? Promise.reject(new Error('The device storage is full'))
        : store.invalidateLedger(accountId, groupId),
  };
  const offlineIdentity = {
    load: async () => structuredClone(identity),
    save: async (value: unknown) => {
      identity = structuredClone(value);
    },
    clear: async () => {
      identity = null;
    },
  };

  const dinner = () => ({
    _id: dinnerId,
    group: mapleId,
    revision: server.dinner.revision,
    description: server.dinner.description,
    amount: 12,
    amountMinor: 1200,
    moneyVersion: 1,
    currency: 'INR',
    paidBy: [{ user: person(alex), amount: 12, amountMinor: 1200 }],
    splitBetween: [alex, sam].map((user) => ({ user: person(user), amount: 6, amountMinor: 600 })),
    splitMethod: 'equal',
    date: '2026-08-20T12:00:00.000Z',
    createdAt: iso,
    updatedAt: iso,
    category: 'food',
    tag: 'Food',
    tagId,
    notes: '',
    isDeleted: server.dinner.isDeleted,
    editHistory: [],
  });
  const row = (id: string, groupId: string, description: string) => ({
    ...dinner(),
    _id: id,
    group: groupId,
    description,
  });
  const page = (rows: unknown[], number: number, totalPages: number) =>
    json({
      status: 200,
      data: {
        expenses: rows,
        pagination: { page: number, limit: 20, total: rows.length, totalPages },
        summary: {
          count: rows.length,
          totalsByCurrency: [{ currency: 'INR', totalAmount: 12 * rows.length }],
          userOwes: 0,
          userGetsBack: 0,
          byMember: [],
        },
      },
    });
  const events = (rows: { id: string; description: string; expenseId?: string }[]) =>
    json({
      status: 200,
      data: {
        activities: rows.map(({ id, description, expenseId }) => ({
          _id: id,
          group: mapleId,
          actor: { _id: alex.id, name: 'Alex' },
          type: 'expense_updated',
          createdAt: iso,
          metadata: { description, ...(expenseId ? { expenseId } : {}) },
        })),
        pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 },
      },
    });
  const balances = (from: typeof alex, to: typeof alex, amount: number) =>
    json({
      status: 200,
      data: {
        byCurrency: [
          {
            currency: 'INR',
            balances: [],
            debts: [{ from: person(from), to: person(to), amount }],
          },
        ],
      },
    });

  const respond = (path: string, init: RequestInit): FetchResponse => {
    const method = init.method ?? 'GET';
    const maplePath = `/api/groups/${mapleId}`;
    const dinnerPath = `${maplePath}/expenses/${dinnerId}`;
    if (path.endsWith('/sign-in'))
      return new Response(JSON.stringify({ user: alex }), {
        headers: { 'Set-Cookie': 'better-auth.session_token=alex.signature; Path=/; HttpOnly' },
      });
    if (path.endsWith('/get-session'))
      return json({
        user: alex,
        session: { userId: alex.id, expiresAt: '2030-01-01T00:00:00.000Z' },
      });
    if (path.endsWith('/sign-out')) return json({ success: true });
    if (path === '/api/groups') return json({ status: 200, data: [maple, cabin] });
    if (path === '/api/user/balances')
      return json({
        status: 200,
        data: { buckets: [{ currency: 'INR', youOwe: 30 + server.ledger, youAreOwed: 12 }] },
      });
    if (path === maplePath) return json({ status: 200, data: maple });
    if (path === `/api/groups/${cabinId}`) return json({ status: 200, data: cabin });
    if (path.startsWith(`${maplePath}/expenses?`)) {
      const { month, page: number } = pageOf(path);
      // August holds the Dinner; September has two pages.
      if (month === '2026-08') return page(server.dinner.isDeleted ? [] : [dinner()], 1, 1);
      return page(
        [
          row(
            `d0000000000000000000000${number + 1}`,
            mapleId,
            `${number === 1 ? 'September rent' : 'September groceries'} · ledger ${server.ledger}`,
          ),
        ],
        number,
        2,
      );
    }
    if (path.startsWith(`/api/groups/${cabinId}/expenses?`))
      return page([row('d00000000000000000000009', cabinId, 'Cabin firewood')], 1, 1);
    if (path === dinnerPath && method === 'GET') return json({ status: 200, data: dinner() });
    if (path === dinnerPath && (method === 'PATCH' || method === 'DELETE')) {
      server.ledger += 1;
      server.dinner.revision += 1;
      if (method === 'PATCH') {
        const changes = JSON.parse(String(init.body)) as { description?: string };
        if (changes.description) server.dinner.description = changes.description;
      } else server.dinner.isDeleted = true;
      if (server.loseWrites) throw new Error('Lost response');
      return method === 'PATCH'
        ? json({ status: 200, data: dinner() })
        : json({ status: 200, data: { revision: server.dinner.revision, message: 'Deleted' } });
    }
    if (path.startsWith(`${maplePath}/activity?`)) {
      const expenseId = new URL(path, 'http://local').searchParams.get('expenseId');
      return expenseId
        ? events([
            {
              id: 'e00000000000000000000002',
              description: `${server.dinner.description} · ledger ${server.ledger}`,
              expenseId,
            },
          ])
        : events([{ id: 'e00000000000000000000001', description: `ledger ${server.ledger}` }]);
    }
    if (path === `${maplePath}/balances`) return balances(alex, sam, 30 + server.ledger);
    if (path === `/api/groups/${cabinId}/balances`) return balances(sam, alex, 12);
    if (path === `${maplePath}/settlements` && method === 'POST') {
      server.ledger += 1;
      if (server.loseWrites) throw new Error('Lost response');
      const body = JSON.parse(String(init.body));
      const people = { [alex.id]: alex, [sam.id]: sam };
      return json(
        {
          status: 201,
          data: {
            _id: 'f00000000000000000000001',
            group: mapleId,
            paidBy: person(people[body.paidBy]),
            paidTo: person(people[body.paidTo]),
            createdBy: person(alex),
            amount: body.amount,
            amountMinor: Math.round(body.amount * 100),
            moneyVersion: 1,
            currency: body.currency,
            note: body.note ?? '',
            createdAt: iso,
            updatedAt: iso,
          },
        },
        201,
      );
    }
    if (path === `${maplePath}/settlements`) return json({ status: 200, data: [] });
    return json({}, 404);
  };

  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4138',
        authOrigin: 'http://localhost:4138',
        developmentPersonaEnabled: true,
      },
      {
        now: () => clock.now,
        newSubmissionKey: () => `attempt-${String(++keys).padStart(4, '0')}`,
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        readCache,
        offlineIdentity,
        expenseDrafts: drafts,
        settlementAttempts: attempts,
        accountLocal: {
          owner: {
            load: async () => owner,
            save: async (value) => {
              owner = value;
            },
            clear: async () => {
              owner = null;
            },
          },
          cleanupMarker: {
            load: async () => cleanup,
            mark: async () => {
              cleanup = true;
            },
            clear: async () => {
              cleanup = false;
            },
          },
          stores: [readCache, offlineIdentity, drafts, attempts],
        },
        fetch: async (url, init) => {
          if (server.offline) throw new Error('Offline');
          const path = new URL(url).pathname + new URL(url).search;
          const method = init.method ?? 'GET';
          calls.push({ method, path });
          // Every answer takes a moment to arrive.
          clock.now += 1;
          const response = respond(path, init);
          // The server has answered; a held answer is still on its way back.
          const held = holds.findIndex((entry) => entry.match(path, method));
          if (held >= 0) {
            const [entry] = holds.splice(held, 1);
            entry.arrive();
            await entry.released;
          }
          return response;
        },
      },
    );

  const holds: {
    match: (path: string, method: string) => boolean;
    arrive: () => void;
    released: Promise<void>;
  }[] = [];
  /** Holds the server's answer to the next matching request on its way back, until released. */
  const hold = (match: (path: string, method: string) => boolean) => {
    let arrive!: () => void, release!: () => void;
    const arrived = new Promise<void>((resolve) => (arrive = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    holds.push({ match, arrive, released });
    return { arrived, release };
  };
  /** Holds the next write of this device's saved copies part-way, until released. */
  const stallSave = () => {
    let arrive!: () => void, release!: () => void;
    const arrived = new Promise<void>((resolve) => (arrive = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    device.stall = { environment, arrive, released };
    return { arrived, release };
  };

  /** This device's saved copies for Alex, by path. */
  const saved = () =>
    (
      device.records.get(`${environment}|cache|${alex.id}|reads`) as
        | { entries: Record<string, { refreshedAt: number; value: unknown }> }
        | undefined
    )?.entries ?? {};
  /** What this device keeps for a Group: each saved copy by the view it belongs to. */
  const savedOf = (groupId: string) =>
    Object.fromEntries(
      Object.entries(saved())
        .filter(([path]) => path.startsWith(`/api/groups/${groupId}`))
        .map(([path, copy]) => {
          const [base, query] = path.slice(`/api/groups/${groupId}`.length).split('?');
          const { month, page: number } = pageOf(path);
          const view =
            base === ''
              ? 'Group'
              : base === '/expenses'
                ? `Expenses${month ? ` ${month}` : ''} page ${number}`
                : base === '/balances'
                  ? 'Balances'
                  : base === `/expenses/${dinnerId}`
                    ? 'Dinner'
                    : base === '/activity' && query.includes('expenseId')
                      ? 'Dinner history'
                      : base === '/activity'
                        ? 'Activity'
                        : path;
          return [view, copy];
        }),
    );
  return { create, clock, server, calls, saved, savedOf, hold, stallSave };
}
type Fixture = ReturnType<typeof fixture>;
type Controller = ReturnType<Fixture['create']>;

/**
 * Alex visits everything this device saves for offline use: Home, both Groups, both of Maple
 * House's Months with September's second page, its Activity, and the Dinner with its history.
 */
async function visitEverything(f: Fixture) {
  const controller = f.create();
  await controller.signIn('alex');
  await controller.openGroup(cabinId);
  await controller.back();
  await controller.openGroup(mapleId);
  await controller.loadMoreExpenses();
  await controller.selectMonth('2026-08');
  await controller.openActivity(mapleId);
  await controller.back();
  await controller.openExpense(mapleId, dinnerId);
  expect(controller.getSnapshot().expense).toMatchObject({
    status: 'detail',
    history: { status: 'ready' },
  });
  await controller.back();
  await controller.back();
  expect(controller.getSnapshot().screen).toBe('groups');
  expect(Object.keys(f.savedOf(mapleId)).sort()).toEqual([
    'Activity',
    'Balances',
    'Dinner',
    'Dinner history',
    'Expenses 2026-08 page 1',
    'Expenses 2026-09 page 1',
    'Expenses 2026-09 page 2',
    'Group',
  ]);
  return controller;
}

/** Offline, every view of Maple House this device may have saved, as the member sees it. */
async function readOffline(controller: Controller) {
  const snapshot = () => controller.getSnapshot();
  while (snapshot().screen !== 'groups') await controller.back();
  await controller.refreshHome();
  const home = snapshot().home;
  await controller.openGroup(mapleId);
  const september = snapshot().financial;
  await controller.loadMoreExpenses();
  const secondPage = snapshot().financial.expenses;
  await controller.selectMonth('2026-08');
  const august = snapshot().financial.expenses;
  await controller.openActivity(mapleId);
  const activity = snapshot().activity;
  await controller.back();
  await controller.openExpense(mapleId, dinnerId);
  const record = snapshot().expense;
  await controller.back();
  return {
    groups: snapshot().groups.data.map((group) => group.name),
    home: home.data?.map((bucket) => bucket.youOwe) ?? home.message,
    group: september.groupId,
    september: september.expenses.data.map((expense) => expense.description),
    secondPage:
      secondPage.moreStatus === 'error'
        ? secondPage.moreMessage
        : secondPage.data.map((expense) => expense.description),
    august:
      august.status === 'error'
        ? august.message
        : august.data.map((expense) => expense.description),
    balances:
      september.balances.status === 'error'
        ? september.balances.message
        : september.balances.data?.flatMap((bucket) => bucket.debts.map((debt) => debt.amount)),
    activity:
      activity.status === 'error'
        ? activity.message
        : activity.events.map((event) => event.metadata.description),
    record:
      record.status === 'detail'
        ? `${record.draft?.description}${record.draft?.original?.isDeleted ? ' (deleted)' : ''}`
        : record.message,
  };
}

/** Lets answers and storage steps already under way go as far as they can. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** The same, after the app restarts without a connection. */
async function restartOffline(f: Fixture, controller: Controller) {
  controller.dispose();
  f.server.offline = true;
  const restarted = f.create();
  await restarted.restore();
  expect(restarted.getSnapshot()).toMatchObject({
    auth: { status: 'authenticated', user: { id: alex.id } },
    offline: { active: true },
  });
  return readOffline(restarted);
}

describe('saved copies are never older than a confirmed change (#191)', () => {
  it('after a confirmed edit, offline shows the edited Expense or says a view was not saved, and leaves other Groups as they were', async () => {
    const f = fixture();
    const controller = await visitEverything(f);
    const cabinCopies = f.savedOf(cabinId);
    await controller.openExpense(mapleId, dinnerId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Lake dinner' });
    await controller.saveExpense();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      expense: { status: 'saved' },
    });
    expect(f.server.ledger).toBe(1);

    // Only what was read again after the edit is saved for Maple House; Cabin Weekend is untouched.
    expect(Object.keys(f.savedOf(mapleId)).sort()).toEqual([
      'Balances',
      'Expenses 2026-09 page 1',
      'Group',
    ]);
    expect(f.savedOf(cabinId)).toEqual(cabinCopies);
    expect(Object.keys(f.saved())).toContain('/api/groups');

    const edited = {
      groups: ['Maple House', 'Cabin Weekend'],
      home: [31],
      group: mapleId,
      september: ['September rent · ledger 1'],
      secondPage: notSaved,
      august: notSaved,
      balances: [31],
      activity: notSaved,
      record: notSaved,
    };
    f.server.offline = true;
    expect(await readOffline(controller)).toEqual(edited);
    expect(await restartOffline(f, controller)).toEqual(edited);
  });

  it('after a confirmed deletion, offline the Expense is in no saved Month or page', async () => {
    const f = fixture();
    const controller = await visitEverything(f);
    await controller.openExpense(mapleId, dinnerId);
    controller.reviewExpenseDeletion();
    await controller.deleteExpense();
    expect(controller.getSnapshot().expense.status).toBe('saved');
    expect(f.server.dinner.isDeleted).toBe(true);

    const deleted = {
      groups: ['Maple House', 'Cabin Weekend'],
      home: [31],
      group: mapleId,
      september: ['September rent · ledger 1'],
      secondPage: notSaved,
      august: notSaved,
      balances: [31],
      activity: notSaved,
      record: notSaved,
    };
    f.server.offline = true;
    expect(await readOffline(controller)).toEqual(deleted);
    expect(await restartOffline(f, controller)).toEqual(deleted);
  });

  it('after a confirmed payment, offline Activity, Balances, Home and Expenses are never older than it', async () => {
    const f = fixture();
    const controller = await visitEverything(f);
    await controller.openGroup(mapleId, true, 'balances');
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    await controller.recordSettlement();
    expect(controller.getSnapshot().snackbar?.message).toBe('Payment recorded');
    expect(f.server.ledger).toBe(1);

    const paid = {
      groups: ['Maple House', 'Cabin Weekend'],
      home: [31],
      group: mapleId,
      september: ['September rent · ledger 1'],
      secondPage: notSaved,
      august: notSaved,
      balances: [31],
      activity: notSaved,
      record: notSaved,
    };
    f.server.offline = true;
    expect(await readOffline(controller)).toEqual(paid);
    expect(await restartOffline(f, controller)).toEqual(paid);
  });

  it('after a payment whose answer was lost, a restart offline shows nothing saved before it', async () => {
    const f = fixture();
    const controller = await visitEverything(f);
    const cabinCopies = f.savedOf(cabinId);
    await controller.openGroup(mapleId, true, 'balances');
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    f.server.loseWrites = true;
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement.status).toBe('uncertain');
    // It reached the server: Maple House changed.
    expect(f.server.ledger).toBe(1);
    // Nothing was read again after it, so nothing of Maple House's ledger is kept.
    expect(Object.keys(f.savedOf(mapleId))).toEqual(['Group']);
    expect(f.savedOf(cabinId)).toEqual(cabinCopies);

    expect(await restartOffline(f, controller)).toEqual({
      groups: ['Maple House', 'Cabin Weekend'],
      home: notSaved,
      group: mapleId,
      september: [],
      secondPage: [],
      august: notSaved,
      balances: notSaved,
      activity: notSaved,
      record: notSaved,
    });
  });

  it('never shows a saved copy this device could not remove after a change, and keeps the member signed in', async () => {
    const f = fixture();
    const controller = await visitEverything(f);
    const cabinCopies = f.savedOf(cabinId);
    f.server.failInvalidation = true;
    await controller.openExpense(mapleId, dinnerId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Lake dinner' });
    await controller.saveExpense();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      screen: 'group',
      expense: { status: 'saved' },
    });
    expect(f.calls.filter((call) => call.path.endsWith('/sign-out'))).toEqual([]);
    // The older copies are still on this device, but this session no longer trusts them.
    expect(Object.keys(f.savedOf(mapleId))).toContain('Expenses 2026-08 page 1');
    expect(f.savedOf(cabinId)).toEqual(cabinCopies);

    f.server.offline = true;
    expect(await readOffline(controller)).toEqual({
      groups: ['Maple House', 'Cabin Weekend'],
      home: [31],
      group: mapleId,
      september: ['September rent · ledger 1'],
      secondPage: notSaved,
      august: notSaved,
      balances: [31],
      activity: notSaved,
      record: notSaved,
    });
    expect(controller.getSnapshot().auth.status).toBe('authenticated');
  });

  it('saves nothing that a read still in flight across a confirmed edit brings back from before it', async () => {
    const f = fixture();
    const controller = await visitEverything(f);
    await controller.openGroup(mapleId);
    // Activity is read before the edit; its answer is still on its way when the edit is confirmed.
    const activity = f.hold((path) => path.startsWith(`/api/groups/${mapleId}/activity?page=`));
    const reading = controller.openActivity(mapleId);
    await activity.arrived;
    await controller.openExpense(mapleId, dinnerId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Lake dinner' });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('saved');
    expect(f.server.ledger).toBe(1);
    activity.release();
    await reading;

    expect(Object.keys(f.savedOf(mapleId)).sort()).toEqual([
      'Balances',
      'Expenses 2026-09 page 1',
      'Group',
    ]);
    f.server.offline = true;
    expect((await readOffline(controller)).activity).toBe(notSaved);
  });

  it('removes a copy from before an edit that was still being written when the edit was confirmed', async () => {
    const f = fixture();
    const controller = await visitEverything(f);
    await controller.openGroup(mapleId);
    const activity = f.hold((path) => path.startsWith(`/api/groups/${mapleId}/activity?page=`));
    const reading = controller.openActivity(mapleId);
    await activity.arrived;
    await controller.openExpense(mapleId, dinnerId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Lake dinner' });
    const edit = f.hold((_, method) => method === 'PATCH');
    const saving = controller.saveExpense();
    await edit.arrived;
    expect(f.server.ledger).toBe(1);
    // Activity's answer from before the edit lands while the edit's answer is on its way, and
    // this device is still writing it when the edit is confirmed.
    const write = f.stallSave();
    activity.release();
    await write.arrived;
    edit.release();
    await settle();
    write.release();
    await Promise.all([saving, reading]);
    expect(controller.getSnapshot().expense.status).toBe('saved');

    expect(Object.keys(f.savedOf(mapleId)).sort()).toEqual([
      'Balances',
      'Expenses 2026-09 page 1',
      'Group',
    ]);
    f.server.offline = true;
    expect((await readOffline(controller)).activity).toBe(notSaved);
  });
});
