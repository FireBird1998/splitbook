import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';

// Fictional people and Groups only.
const sam = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 'sam@example.test' };
const priya = { id: 'a00000000000000000000003', name: 'Priya Shah', email: 'priya@example.test' };
const groupId = 'a00000000000000000000010';
const ids = { bill: 'b00000000000000000000001', dinner: 'b00000000000000000000002' };
const iso = '2026-09-20T10:00:00.000Z';
const group = {
  _id: groupId,
  createdBy: sam.id,
  name: 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  members: [sam, priya].map((user) => ({
    user: { ...user, _id: user.id, image: null },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [],
  createdAt: iso,
  updatedAt: iso,
};
const person = (user: typeof sam) => ({ _id: user.id, name: user.name, image: null });
const record = (id: string, description: string) => ({
  _id: id,
  group: groupId,
  revision: 21,
  description,
  amount: 30,
  amountMinor: 3000,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: person(priya), amount: 30, amountMinor: 3000 }],
  splitBetween: [
    { user: person(sam), amount: 15, amountMinor: 1500 },
    { user: person(priya), amount: 15, amountMinor: 1500 },
  ],
  splitMethod: 'equal',
  date: iso,
  createdAt: iso,
  updatedAt: '2026-09-27T10:00:00.000Z',
  category: 'other',
  tag: 'General',
  notes: '',
  isDeleted: false,
  editHistory: [],
});
const records: Record<string, unknown> = {
  [ids.bill]: record(ids.bill, 'Electricity bill'),
  [ids.dinner]: record(ids.dinner, 'Dinner'),
};
const eventId = (index: number) => `d${String(index).padStart(23, '0')}`;
// The bill was added, then edited 21 times: two pages of its own changes. The Group's other
// events are interleaved, so only the filter keeps them out.
const events = Array.from({ length: 30 }, (_, index) => {
  const bill = index % 4 !== 3;
  return {
    _id: eventId(index),
    group: groupId,
    actor: person(index % 2 ? sam : priya),
    createdAt: new Date(Date.parse('2026-09-27T10:00:00.000Z') - index * 3_600_000).toISOString(),
    type: index === 29 ? 'expense_added' : 'expense_updated',
    metadata: {
      expenseId: bill ? ids.bill : ids.dinner,
      description: bill ? 'Electricity bill' : 'Dinner',
      changes: { notes: { old: `Note ${index + 1}`, new: `Note ${index}` } },
    },
  };
});
const json = (body: unknown, status = 200) => Response.json(body, { status });

function setup() {
  let cookie: string | null = null;
  let account: string | null = null;
  let offline = false;
  let failing = false;
  // A backend that ignores the filter sends the whole Group's Activity.
  let unfiltered = false;
  const drafts = new Map<string, unknown>();
  const cache = new Map<string, unknown>();
  const holds = new Map<string, Promise<void>>();
  const reads: string[] = [];
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
      expenseDrafts: {
        load: async (accountId, id) => structuredClone(drafts.get(`${accountId}:${id}`) ?? null),
        save: async (accountId, id, value) => {
          drafts.set(`${accountId}:${id}`, structuredClone(value));
        },
        remove: async (accountId, id) => {
          drafts.delete(`${accountId}:${id}`);
        },
        clear: async () => drafts.clear(),
      },
      readCache: {
        retainGroups: async () => undefined,
        invalidateGroup: async () => undefined,
        load: async (accountId, path) => structuredClone(cache.get(accountId + path) ?? null),
        save: async (accountId, path, value) => {
          cache.set(accountId + path, structuredClone(value));
        },
        clear: async () => cache.clear(),
      },
      accountLocal: {
        owner: {
          load: async () => account,
          save: async (value) => {
            account = value;
          },
          clear: async () => {
            account = null;
          },
        },
        cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
        stores: [],
      },
      fetch: async (url, init) => {
        if (offline) throw new Error('Offline');
        const address = new URL(url);
        const path = address.pathname;
        if ((init.method ?? 'GET') === 'GET' && path.startsWith('/api/groups/'))
          reads.push(path + address.search);
        if (path.endsWith('/sign-in'))
          return new Response(JSON.stringify({ user: sam }), {
            headers: { 'Set-Cookie': 'better-auth.session_token=test.signature; Path=/; HttpOnly' },
          });
        if (path.endsWith('/get-session'))
          return json({
            user: sam,
            session: { userId: sam.id, expiresAt: '2030-01-01T00:00:00Z' },
          });
        if (path === '/api/groups') return json({ status: 200, data: [group] });
        if (path === '/api/user/balances') return json({ status: 200, data: { buckets: [] } });
        if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
        const id = path.split('/').pop()!;
        if (path === `/api/groups/${groupId}/expenses/${id}` && records[id])
          return json({ status: 200, data: records[id] });
        if (path === `/api/groups/${groupId}/activity`) {
          const expenseId = address.searchParams.get('expenseId');
          await holds.get(expenseId ?? '');
          if (failing) return json({ error: 'Unavailable', status: 500 }, 500);
          const page = Number(address.searchParams.get('page'));
          const matching = events.filter(
            (event) => unfiltered || !expenseId || event.metadata.expenseId === expenseId,
          );
          return json({
            status: 200,
            data: {
              activities: matching.slice((page - 1) * 20, page * 20),
              pagination: {
                page,
                limit: 20,
                total: matching.length,
                totalPages: Math.ceil(matching.length / 20),
              },
            },
          });
        }
        return json({ error: 'Unavailable', status: 404 }, 404);
      },
    },
  );
  /** Holds an Expense's history reads until the returned function is called. */
  const hold = (expenseId: string) => {
    let release!: () => void;
    holds.set(expenseId, new Promise<void>((resolve) => (release = resolve)));
    return () => {
      holds.delete(expenseId);
      release();
    };
  };
  return {
    controller,
    hold,
    /** Activity reads since the last call. */
    activityReads: () => reads.splice(0).filter((path) => path.includes('/activity')),
    setOffline: (value: boolean) => (offline = value),
    setFailing: (value: boolean) => (failing = value),
    ignoreFilter: () => (unfiltered = true),
  };
}

async function signedIn() {
  const harness = setup();
  await harness.controller.signIn('sam');
  harness.activityReads();
  return harness;
}

/** Lets pending reads settle until `ready` holds. */
async function until(ready: () => boolean) {
  for (let tick = 0; tick < 50 && !ready(); tick++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ready()).toBe(true);
}

const billEvents = events.filter((event) => event.metadata.expenseId === ids.bill);

describe('An Expense record’s history', () => {
  it('shows the record first, then reads its changes through the Expense filter', async () => {
    const { controller, hold, activityReads } = await signedIn();
    const release = hold(ids.bill);
    const opening = controller.openExpense(groupId, ids.bill);
    await until(() => controller.getSnapshot().expense.history.status === 'loading');
    // The record, with its added and last-changed times, doesn't wait for its changes.
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { original: { _id: ids.bill, updatedAt: '2026-09-27T10:00:00.000Z' } },
      history: { expenseId: ids.bill, events: [] },
    });

    release();
    await opening;
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      history: {
        expenseId: ids.bill,
        status: 'ready',
        pagination: { page: 1, total: 23, totalPages: 2 },
        moreStatus: 'idle',
        message: null,
      },
    });
    expect(controller.getSnapshot().expense.history.events.map((event) => event._id)).toEqual(
      billEvents.slice(0, 20).map((event) => event._id),
    );
    expect(activityReads()).toEqual([
      `/api/groups/${groupId}/activity?expenseId=${ids.bill}&page=1&limit=20`,
    ]);
  });

  it('loads older changes on request, and only while there are more', async () => {
    const { controller, activityReads } = await signedIn();
    await controller.openExpense(groupId, ids.bill);
    activityReads();

    await controller.loadOlderExpenseHistory();
    expect(activityReads()).toEqual([
      `/api/groups/${groupId}/activity?expenseId=${ids.bill}&page=2&limit=20`,
    ]);
    const { history } = controller.getSnapshot().expense;
    expect(history).toMatchObject({ status: 'ready', pagination: { page: 2, totalPages: 2 } });
    expect(history.events.map((event) => event._id)).toEqual(billEvents.map((event) => event._id));
    expect(history.events.at(-1)?.type).toBe('expense_added');

    await controller.loadOlderExpenseHistory();
    expect(activityReads()).toEqual([]);
  });

  it('keeps the shown changes when older ones can’t be read, and reads them again on request', async () => {
    const { controller, setFailing, activityReads } = await signedIn();
    await controller.openExpense(groupId, ids.bill);
    setFailing(true);
    await controller.loadOlderExpenseHistory();
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
      moreStatus: 'error',
      pagination: { page: 1 },
    });
    expect(controller.getSnapshot().expense.history.events).toHaveLength(20);

    setFailing(false);
    activityReads();
    await controller.loadOlderExpenseHistory();
    expect(activityReads()).toEqual([
      `/api/groups/${groupId}/activity?expenseId=${ids.bill}&page=2&limit=20`,
    ]);
    expect(controller.getSnapshot().expense.history).toMatchObject({
      moreStatus: 'idle',
      pagination: { page: 2 },
    });
  });

  it('keeps the record when its changes can’t be read; Try again reads them again', async () => {
    const { controller, setFailing } = await signedIn();
    setFailing(true);
    await controller.openExpense(groupId, ids.bill);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      message: null,
      draft: { original: { _id: ids.bill } },
      history: { status: 'error', events: [], message: 'Couldn’t load this Expense’s changes.' },
    });

    setFailing(false);
    await controller.refreshExpenseHistory();
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
      message: null,
      pagination: { page: 1 },
    });
  });

  it('offline, shows changes read before from this device and says when they never were', async () => {
    const { controller, setOffline, setFailing } = await signedIn();
    await controller.openExpense(groupId, ids.bill);
    // The dinner record is read, but its changes are not.
    setFailing(true);
    await controller.openExpense(groupId, ids.dinner);
    setFailing(false);

    setOffline(true);
    await controller.openExpense(groupId, ids.bill);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true },
      expense: {
        status: 'detail',
        history: { expenseId: ids.bill, status: 'ready', pagination: { page: 1 } },
      },
    });
    expect(controller.getSnapshot().expense.history.events).toHaveLength(20);

    await controller.openExpense(groupId, ids.dinner);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { original: { _id: ids.dinner } },
      history: {
        expenseId: ids.dinner,
        status: 'error',
        events: [],
        message: 'This Expense’s changes aren’t saved on this device. Connect to see them.',
      },
    });
  });

  it('refuses a page that includes another Expense’s events', async () => {
    const { controller, ignoreFilter } = await signedIn();
    ignoreFilter();
    await controller.openExpense(groupId, ids.bill);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      history: { status: 'error', events: [] },
    });
  });

  it('never shows one record’s changes on another opened while they load', async () => {
    const { controller, hold } = await signedIn();
    const release = hold(ids.bill);
    const first = controller.openExpense(groupId, ids.bill);
    await until(() => controller.getSnapshot().expense.history.status === 'loading');
    await controller.openExpense(groupId, ids.dinner);
    release();
    await first;
    const { expense } = controller.getSnapshot();
    expect(expense).toMatchObject({
      draft: { original: { _id: ids.dinner } },
      history: { expenseId: ids.dinner, status: 'ready' },
    });
    expect(expense.history.events.every((event) => event.metadata.expenseId === ids.dinner)).toBe(
      true,
    );
  });

  it('reads no changes for a new Expense', async () => {
    const { controller, activityReads } = await signedIn();
    await controller.openExpense(groupId);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'editing',
      history: { status: 'idle' },
    });
    await controller.loadOlderExpenseHistory();
    await controller.refreshExpenseHistory();
    expect(activityReads()).toEqual([]);
  });
});
