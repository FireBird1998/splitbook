import { describe, expect, it } from 'vitest';
import { describeExpenseEvents } from './expense-history';
import { createMobileController } from './mobile-controller';
import { savedQueriesIn } from '../test-utils/saved-queries';

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
  // Access withdrawn: the Expense's changes only, or the whole Group.
  let denied: 'history' | 'group' | null = null;
  // Changes can't be reached while the record still can.
  let historyOffline = false;
  // What the server holds now for Expenses a test changes.
  const saved = new Map<string, { record: unknown; events: unknown[] }>();
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
      savedQueries: savedQueriesIn(cache),
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
        if (path === `/api/groups/${groupId}`)
          return denied === 'group'
            ? json({ error: 'Forbidden', status: 403 }, 403)
            : json({ status: 200, data: group });
        const id = path.split('/').pop()!;
        const current = saved.get(id)?.record ?? records[id];
        if (path === `/api/groups/${groupId}/expenses/${id}` && current)
          return json({ status: 200, data: current });
        if (path === `/api/groups/${groupId}/activity`) {
          if (historyOffline) throw new Error('Offline');
          const expenseId = address.searchParams.get('expenseId');
          // Decided as the read arrives: one already under way when access goes still answers.
          const refused = denied !== null;
          await holds.get(expenseId ?? '');
          if (refused) return json({ error: 'Forbidden', status: 403 }, 403);
          if (failing) return json({ error: 'Unavailable', status: 500 }, 500);
          const page = Number(address.searchParams.get('page'));
          const own = saved.get(expenseId ?? '')?.events as typeof events | undefined;
          const matching = (own ?? events).filter(
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
    setDenied: (value: typeof denied) => (denied = value),
    setHistoryOffline: (value: boolean) => (historyOffline = value),
    /** Replaces what the server holds for one Expense. */
    save: (id: string, record: unknown, own: unknown[]) => saved.set(id, { record, events: own }),
    drafts,
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

describe('An Expense record once access to its Group is withdrawn', () => {
  /** The record and its changes are gone; what's left says why. */
  const expectWithdrawn = (controller: ReturnType<typeof setup>['controller']) =>
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'blocked',
      draft: null,
      latest: null,
      context: null,
      message: 'You no longer have access to this group.',
      history: { status: 'idle', events: [], pagination: null },
    });

  it('clears the record when its changes are refused as it opens, and offers nothing to act on', async () => {
    const { controller, setDenied, activityReads } = await signedIn();
    setDenied('history');
    await controller.openExpense(groupId, ids.bill);
    expectWithdrawn(controller);

    await controller.editExpense();
    await controller.loadOlderExpenseHistory();
    await controller.refreshExpenseHistory();
    expect(controller.getSnapshot().expense.status).toBe('blocked');
    expect(activityReads()).toEqual([
      `/api/groups/${groupId}/activity?expenseId=${ids.bill}&page=1&limit=20`,
    ]);
  });

  it('clears the shown changes when reading them again is refused', async () => {
    const { controller, setDenied } = await signedIn();
    await controller.openExpense(groupId, ids.bill);
    expect(controller.getSnapshot().expense.history.events).toHaveLength(20);
    setDenied('history');
    await controller.refreshExpenseHistory();
    expectWithdrawn(controller);
  });

  it('clears the shown changes when older ones are refused', async () => {
    const { controller, setDenied } = await signedIn();
    await controller.openExpense(groupId, ids.bill);
    setDenied('history');
    await controller.loadOlderExpenseHistory();
    expectWithdrawn(controller);
  });

  it('never restores changes from a read that answers after access was withdrawn', async () => {
    const { controller, hold, setDenied } = await signedIn();
    await controller.openExpense(groupId, ids.bill);
    const release = hold(ids.bill);
    const older = controller.loadOlderExpenseHistory();
    // Refreshing finds the Group refused while the older page is still on its way.
    setDenied('group');
    await controller.refresh();
    expectWithdrawn(controller);

    release();
    await older;
    expectWithdrawn(controller);
  });

  it('keeps an edit in progress, on screen and on this device', async () => {
    const { controller, setDenied, drafts } = await signedIn();
    await controller.openExpense(groupId, ids.bill);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Meter read on the 20th' });
    setDenied('group');
    await controller.refresh();
    expect(controller.getSnapshot().expense).toMatchObject({
      draft: { notes: 'Meter read on the 20th', original: { _id: ids.bill } },
      history: { events: [] },
    });
    expect(drafts.get(`${sam.id}:${groupId}`)).toMatchObject({
      draft: { notes: 'Meter read on the 20th' },
    });
  });
});

describe('An Expense record’s changes read before its currency changed', () => {
  it('keeps their amounts in that currency beside the record read since', async () => {
    const { controller, save, setHistoryOffline } = await signedIn();
    const fare = 'b00000000000000000000003';
    const amountAt = '2026-09-25T10:00:00.000Z',
      currencyAt = '2026-09-26T10:00:00.000Z';
    const amountEdit = { amount: { old: 20, new: 30 }, amountMinor: { old: 2000, new: 3000 } };
    const event = (id: string, at: string, changes: Record<string, unknown>) => ({
      _id: id,
      group: groupId,
      actor: person(priya),
      createdAt: at,
      type: 'expense_updated',
      metadata: { expenseId: fare, description: 'Ferry', changes },
    });
    const fareRecord = (currency: string, editHistory: unknown[]) => ({
      ...record(fare, 'Ferry'),
      currency,
      editHistory,
    });
    const edited = (at: string, changes: Record<string, unknown>) => ({
      editedBy: person(priya),
      editedAt: at,
      changes,
    });
    // Read while it was in INR: its amount change is saved on this device.
    save(fare, fareRecord('INR', [edited(amountAt, amountEdit)]), [
      event('e00000000000000000000001', amountAt, amountEdit),
    ]);
    await controller.openExpense(groupId, fare);
    expect(controller.getSnapshot().expense.history.events).toHaveLength(1);
    await controller.back();

    // Since then its currency became EUR; its changes can't be reached, its record can.
    const currencyEdit = { currency: { old: 'INR', new: 'EUR' } };
    save(
      fare,
      fareRecord('EUR', [edited(amountAt, amountEdit), edited(currencyAt, currencyEdit)]),
      [
        event('e00000000000000000000002', currencyAt, currencyEdit),
        event('e00000000000000000000001', amountAt, amountEdit),
      ],
    );
    setHistoryOffline(true);
    await controller.openExpense(groupId, fare);
    const { draft, history } = controller.getSnapshot().expense;
    expect(draft?.original?.currency).toBe('EUR');
    expect(history.events.map((event) => event._id)).toEqual(['e00000000000000000000001']);
    const [amount] = describeExpenseEvents(history.events, draft!.original!)[0].changes;
    expect(amount).toMatchObject({ before: '₹20.00', after: '₹30.00' });
  });
});
