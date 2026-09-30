import { describe, expect, it } from 'vitest';
import { getLocalMonthIsoRange } from '@splitbook/shared/date';
import { createMobileController } from './mobile-controller';
import type { FetchResponse, MobileFetch } from './types';

// Fictional people and Groups only.
const people = [
  { id: 'a00000000000000000000001', name: 'Alex' },
  { id: 'a00000000000000000000002', name: 'Sam' },
  { id: 'a00000000000000000000003', name: 'Priya' },
];
const alex = { ...people[0], email: 'person0@example.test', image: null };
const householdId = 'a00000000000000000000010';
const tripId = 'a00000000000000000000011';
const tagId = 'a00000000000000000000020';
const iso = '2026-09-28T10:00:00.000Z';
const group = (id: string, name: string, category: 'home' | 'trip') => ({
  _id: id,
  createdBy: people[0].id,
  name,
  description: '',
  category,
  defaultCurrency: 'INR',
  members: people.map(({ id: userId, name: userName }, index) => ({
    user: { _id: userId, name: userName, email: `person${index}@example.test`, image: null },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
const groups = [group(householdId, 'Maple House', 'home'), group(tripId, 'Goa trip', 'trip')];
const json = (data: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  }) as FetchResponse;
const monthOf = (from: string | null) =>
  ['2026-07', '2026-08', '2026-09', '2026-10'].find(
    (month) => getLocalMonthIsoRange(month).dateFrom === from,
  ) ?? 'all';
const expenseId = 'b00000000000000000000001';

interface Held {
  release: () => void;
  reached: Promise<void>;
}

/**
 * A fictional ledger with the backend's recovery rules: a create commits before its
 * response can be lost, a repeated submission key returns the Expense it already created,
 * and an edit must carry the current revision.
 */
function ledger() {
  const requests: { method: string; path: string; key: string | null; body: string }[] = [];
  const records = new Map<string, Record<string, unknown>>();
  const created = new Map<string, string>();
  const drafts = new Map<string, unknown>();
  let cookie: string | null = null;
  let account: string | null = null;
  let cleanup = false;
  let loseResponses = 0;
  let nextId = 2;
  const holds: { match: (method: string, path: string) => boolean; wait: Promise<void> }[] = [];
  const person = (id: string) => ({
    _id: id,
    name: people.find((row) => row.id === id)?.name,
    image: null,
  });
  const populated = (record: Record<string, unknown>) => ({
    ...record,
    paidBy: (record.paidBy as { user: string }[]).map((row) => ({
      ...row,
      user: person(row.user),
    })),
    splitBetween: (record.splitBetween as { user: string }[]).map((row) => ({
      ...row,
      user: person(row.user),
    })),
  });
  const minor = (rows: unknown) =>
    (rows as { amount: number }[]).map((row) => ({
      ...row,
      amountMinor: Math.round(row.amount * 100),
    }));
  const store = (id: string, body: Record<string, unknown>, groupId: string) =>
    records.set(id, {
      ...body,
      paidBy: minor(body.paidBy),
      splitBetween: minor(body.splitBetween),
      _id: id,
      group: groupId,
      revision: 0,
      amountMinor: Math.round(Number(body.amount) * 100),
      moneyVersion: 1,
      tag: 'Groceries',
      createdAt: iso,
      updatedAt: iso,
      isDeleted: false,
      editHistory: [],
    });
  store(
    expenseId,
    {
      description: 'Electricity',
      amount: 30,
      currency: 'INR',
      category: 'housing',
      date: '2026-08-20T06:30:00.000Z',
      paidBy: [{ user: people[0].id, amount: 30, amountMinor: 3000 }],
      splitBetween: people.map(({ id }) => ({ user: id, amount: 10, amountMinor: 1000 })),
      splitMethod: 'equal',
      tagId,
      notes: '',
    },
    householdId,
  );

  const respond = async (method: string, path: string, init: RequestInit) => {
    const url = new URL(path, 'http://local');
    const route = url.pathname;
    if (route.endsWith('/demo-persona/sign-in'))
      return json({ user: alex }, 200, 'better-auth.session_token=alex.signature; Max-Age=2592000');
    if (route.endsWith('/get-session'))
      return json({
        user: alex,
        session: { userId: people[0].id, expiresAt: '2030-01-01T00:00:00Z' },
      });
    if (route.endsWith('/sign-out')) return json({ success: true });
    if (route === '/api/groups') return json({ data: groups, status: 200 });
    if (route === '/api/user/balances') return json({ data: { buckets: [] }, status: 200 });
    const target = groups.find((row) => route.startsWith(`/api/groups/${row._id}`));
    if (!target) return json({ status: 404 }, 404);
    if (route === `/api/groups/${target._id}`) return json({ data: target, status: 200 });
    if (route.endsWith('/balances'))
      return json({
        data: { currency: 'INR', balances: [], debts: [], byCurrency: [] },
        status: 200,
      });
    if (route.endsWith('/expenses') && method === 'POST') {
      const key = new Headers(init.headers).get('Idempotency-Key')!;
      if (!created.has(key)) {
        const id = `b0000000000000000000000${nextId++}`;
        store(id, JSON.parse(String(init.body)), target._id);
        created.set(key, id);
      }
      if (loseResponses > 0) {
        loseResponses -= 1;
        throw new Error('The response was lost after the server committed the Expense');
      }
      return json({ status: 201, data: { _id: created.get(key), group: target._id } }, 201);
    }
    if (route.endsWith('/expenses')) {
      const month = monthOf(url.searchParams.get('dateFrom'));
      const rows = [...records.values()].filter(
        (row) =>
          row.group === target._id &&
          (month === 'all' || String(row.date) >= getLocalMonthIsoRange(month).dateFrom) &&
          (month === 'all' || String(row.date) <= getLocalMonthIsoRange(month).dateTo),
      );
      return json({
        status: 200,
        data: {
          expenses: rows.map(populated),
          pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 },
          summary: {
            count: rows.length,
            totalsByCurrency: [],
            userOwes: 0,
            userGetsBack: 0,
            byMember: [],
          },
        },
      });
    }
    const record = records.get(route.split('/').pop()!);
    if (!record || record.group !== target._id) return json({ status: 404 }, 404);
    if (method === 'PATCH') {
      if (new Headers(init.headers).get('If-Match') !== String(record.revision))
        return json({ code: 'STALE_REVISION', status: 409 }, 409);
      const patch = JSON.parse(String(init.body));
      const changes = Object.fromEntries(
        Object.entries(patch).map(([field, value]) => [field, { old: record[field], new: value }]),
      );
      Object.assign(record, patch, {
        revision: Number(record.revision) + 1,
        editHistory: [
          ...(record.editHistory as unknown[]),
          { editedBy: person(people[0].id), editedAt: iso, changes },
        ],
      });
      if (loseResponses > 0) {
        loseResponses -= 1;
        throw new Error('The response was lost after the server committed the edit');
      }
    }
    return json({ status: 200, data: populated(record) });
  };

  const fetch: MobileFetch = async (url, init) => {
    const { pathname, search } = new URL(url);
    const method = init.method ?? 'GET';
    requests.push({
      method,
      path: pathname + search,
      key: new Headers(init.headers).get('Idempotency-Key'),
      body: String(init.body ?? ''),
    });
    const held = holds.find((hold) => hold.match(method, pathname));
    if (held) {
      holds.splice(holds.indexOf(held), 1);
      await held.wait;
    }
    return respond(method, pathname + search, init);
  };

  const create = (now = Date.parse(iso)) =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4138',
        authOrigin: 'http://localhost:4138',
        developmentPersonaEnabled: true,
      },
      {
        fetch,
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
          clear: async () => {
            drafts.clear();
          },
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
          cleanupMarker: {
            load: async () => cleanup,
            mark: async () => {
              cleanup = true;
            },
            clear: async () => {
              cleanup = false;
            },
          },
          stores: [{ clear: async () => drafts.clear() }],
        },
        now: () => now,
        newSubmissionKey: () => `native-return-${requests.length}-0001`,
      },
    );

  return {
    create,
    requests,
    records,
    drafts,
    /** Every Expense this ledger holds for the Group, created by any request. */
    expensesIn: (groupId: string) => [...records.values()].filter((row) => row.group === groupId),
    /** Ledger writes only; signing in and out are not financial writes. */
    writes: () =>
      requests.filter(
        (request) => request.method !== 'GET' && request.path.startsWith('/api/groups/'),
      ),
    loseNextResponse: () => {
      loseResponses += 1;
    },
    /** Hold the next matching request until released. */
    hold(method: string, route: RegExp): Held {
      let release!: () => void;
      let arrived!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      holds.push({
        match: (requested, path) => {
          const matched = requested === method && route.test(path);
          if (matched) arrived();
          return matched;
        },
        wait,
      });
      return { release, reached };
    },
    monthsRead: () =>
      requests
        .filter((request) => request.method === 'GET' && /\/expenses\?/.test(request.path))
        .map((request) =>
          monthOf(new URL(request.path, 'http://local').searchParams.get('dateFrom')),
        ),
  };
}

async function signedIn(server = ledger()) {
  const controller = server.create();
  await controller.signIn('alex');
  return { server, controller };
}

async function fillNewExpense(
  controller: ReturnType<typeof createMobileController>,
  patch: Record<string, string> = {},
) {
  await controller.updateExpenseDraft({
    amount: '12.50',
    description: 'Weekly groceries',
    tagId,
    ...patch,
  });
}

describe('Returning from an Expense', () => {
  it('Android Back from a new Expense keeps the draft and restores the Group, Month and scroll', async () => {
    const { server, controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.selectMonth('2026-08');
    await controller.openExpense(householdId, undefined, { scrollY: 640 });
    await fillNewExpense(controller);
    const reads = server.monthsRead().length;

    await controller.back();

    const shown = controller.getSnapshot();
    expect(shown.screen).toBe('group');
    expect(shown.detail.id).toBe(householdId);
    expect(shown.financial.month).toBe('2026-08');
    expect(shown.restoreScroll).toMatchObject({ groupId: householdId, y: 640 });
    // August is shown again; returning never reads another Month (a recent read may be reused).
    expect(
      server
        .monthsRead()
        .slice(reads)
        .every((month) => month === '2026-08'),
    ).toBe(true);
    expect(shown.financial.expenses.data.map((row) => row.description)).toEqual(['Electricity']);
    expect(server.writes()).toEqual([]);
    // The draft stayed on the device: reopening offers it again.
    await controller.openExpense(householdId);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'resume',
      draft: { description: 'Weekly groceries', amount: '12.50' },
    });
  });

  it('returns from an Expense record, and Back first dismisses a delete confirmation', async () => {
    const { controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.selectMonth('2026-08');
    await controller.openExpense(householdId, expenseId, { scrollY: 120 });
    controller.reviewExpenseDeletion();

    await controller.back();
    expect(controller.getSnapshot().screen).toBe('expense');
    expect(controller.getSnapshot().expense.status).toBe('detail');

    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      financial: { month: '2026-08' },
      restoreScroll: { y: 120 },
    });
  });

  it('keeps the origin when the same task reopens after Discard or Retry', async () => {
    const { controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.selectMonth('2026-07');
    await controller.openExpense(householdId, undefined, { scrollY: 300 });
    await fillNewExpense(controller);
    await controller.discardExpenseDraft();
    await controller.openExpense(householdId);
    expect(controller.getSnapshot().expense.returnTo).toEqual({
      groupId: householdId,
      month: '2026-07',
      scrollY: 300,
    });
    await controller.back();
    expect(controller.getSnapshot().financial.month).toBe('2026-07');
  });

  it('falls back to the Group’s Expenses at its default Month after direct entry', async () => {
    const { controller } = await signedIn();
    // Entered from Home, for example from a saved draft, rather than from the Group.
    await controller.openExpense(householdId);
    expect(controller.getSnapshot().expense.returnTo).toBeNull();
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { id: householdId, status: 'ready' },
      financial: { groupId: householdId, month: '2026-09' },
      restoreScroll: null,
    });
  });

  it('never leaves while a save is being sent', async () => {
    const { server, controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId);
    await fillNewExpense(controller);
    const posted = server.hold('POST', /\/expenses$/);
    const saving = controller.saveExpense();
    await posted.reached;
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('expense');
    posted.release();
    await saving;
    expect(controller.getSnapshot().screen).toBe('group');
  });
});

describe('Saving into the same or another Month', () => {
  it('stays on the current Month and confirms a save in that Month', async () => {
    const { server, controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId, undefined, { scrollY: 48 });
    await fillNewExpense(controller, { date: '2026-09-10' });
    await controller.saveExpense();

    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      financial: { month: '2026-09' },
      restoreScroll: { y: 48 },
      snackbar: {
        groupId: householdId,
        message: 'Expense saved · Weekly groceries',
        viewMonth: null,
      },
    });
    expect(controller.getSnapshot().financial.expenses.data.map((row) => row.description)).toEqual([
      'Weekly groceries',
    ]);
    expect(server.expensesIn(householdId)).toHaveLength(2);
  });

  it('offers the other Month without switching, and switches only when chosen', async () => {
    const { server, controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId);
    await fillNewExpense(controller, { date: '2026-08-15' });
    const reads = server.monthsRead().length;
    await controller.saveExpense();

    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      financial: { month: '2026-09' },
      snackbar: { message: 'Expense saved · Weekly groceries', viewMonth: '2026-08' },
    });
    expect(server.monthsRead().slice(reads)).toEqual(['2026-09']);
    expect(controller.getSnapshot().financial.expenses.data).toEqual([]);

    await controller.viewSnackbarMonth();
    expect(controller.getSnapshot().financial.month).toBe('2026-08');
    expect(controller.getSnapshot().snackbar).toBeNull();
    expect(
      controller
        .getSnapshot()
        .financial.expenses.data.map((row) => row.description)
        .sort(),
    ).toEqual(['Electricity', 'Weekly groceries']);
  });

  it('never offers another Month for All time or a Group without a Month lens', async () => {
    const { controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.selectMonth(null);
    await controller.openExpense(householdId);
    await fillNewExpense(controller, { date: '2026-08-15' });
    await controller.saveExpense();
    expect(controller.getSnapshot().snackbar?.viewMonth).toBeNull();
    expect(controller.getSnapshot().financial.month).toBeNull();

    await controller.back();
    await controller.openGroup(tripId);
    await controller.openExpense(tripId);
    await fillNewExpense(controller, { date: '2026-07-01', description: 'Ferry' });
    await controller.saveExpense();
    expect(controller.getSnapshot().snackbar).toMatchObject({
      groupId: tripId,
      message: 'Expense saved · Ferry',
      viewMonth: null,
    });
  });

  it('offers the new Month after an edit moves an Expense, and a Month change ends the offer', async () => {
    const { controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.selectMonth('2026-08');
    await controller.openExpense(householdId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ date: '2026-09-02' });
    await controller.saveExpense();
    expect(controller.getSnapshot()).toMatchObject({
      financial: { month: '2026-08' },
      snackbar: { message: 'Expense updated · Electricity', viewMonth: '2026-09' },
    });
    await controller.selectMonth('2026-07');
    expect(controller.getSnapshot().snackbar).toBeNull();
    expect(controller.getSnapshot().restoreScroll).toBeNull();
  });
});

describe('Draft and save recovery', () => {
  it('resumes an ordinary draft after restart with every entry and no obsolete warning', async () => {
    const server = ledger();
    const { controller } = await signedIn(server);
    await controller.openGroup(householdId);
    await controller.openExpense(householdId);
    const entries = {
      amount: '90.00',
      description: 'Market run',
      date: '2026-09-20',
      multiPayer: true,
      payers: [
        { user: people[0].id, amount: '60.00' },
        { user: people[1].id, amount: '30.00' },
      ],
      splitMethod: 'shares' as const,
      category: 'food',
      notes: 'Bring the receipt',
      tagId,
    };
    await controller.updateExpenseDraft(entries);
    await controller.updateExpenseDraft({
      splitValues: { [people[0].id]: '2', [people[1].id]: '1', [people[2].id]: '1' },
    });

    const restarted = server.create();
    await restarted.restore();
    await restarted.openGroup(householdId);
    // Opening another Expense first shows why the draft blocks it.
    await restarted.openExpense(householdId, expenseId);
    expect(restarted.getSnapshot().expense.status).toBe('resume');
    expect(restarted.getSnapshot().expense.message).toContain('already has an unfinished');

    restarted.resumeExpenseDraft();
    const resumed = restarted.getSnapshot().expense;
    expect(resumed.status).toBe('editing');
    expect(resumed.message).toBeNull();
    expect(resumed.validation.errors).toEqual({});
    expect(resumed.draft).toMatchObject({
      ...entries,
      splitValues: { [people[0].id]: '2', [people[1].id]: '1', [people[2].id]: '1' },
    });
    expect(server.writes()).toEqual([]);
  });

  it('keeps an unconfirmed save distinct and retries only when asked, without a duplicate', async () => {
    const server = ledger();
    const { controller } = await signedIn(server);
    await controller.openGroup(householdId);
    await controller.selectMonth('2026-08');
    await controller.openExpense(householdId, undefined, { scrollY: 200 });
    await fillNewExpense(controller, { date: '2026-08-12' });
    server.loseNextResponse();
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('uncertain');
    expect(server.expensesIn(householdId)).toHaveLength(2);

    // Leaving, reconnecting and returning to the app never send it again.
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      financial: { month: '2026-08' },
    });
    await controller.refresh();
    const restarted = server.create();
    await restarted.restore();
    await restarted.refresh();
    await restarted.openGroup(householdId);
    await restarted.openExpense(householdId);
    expect(restarted.getSnapshot().expense.status).toBe('resume');
    expect(restarted.getSnapshot().expense.attempt).not.toBeNull();
    restarted.resumeExpenseDraft();
    expect(restarted.getSnapshot().expense.status).toBe('uncertain');
    expect(restarted.getSnapshot().expense.message).toContain('may already be saved');
    await restarted.updateExpenseDraft({ amount: '99.00' });
    await restarted.refresh();
    const posts = server.writes();
    expect(posts).toHaveLength(1);

    await restarted.saveExpense();
    const retried = server.writes();
    expect(retried).toHaveLength(2);
    expect(retried[1].key).toBe(retried[0].key);
    expect(retried[1].body).toBe(retried[0].body);
    expect(server.expensesIn(householdId)).toHaveLength(2);
    expect(restarted.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Expense saved · Weekly groceries', viewMonth: '2026-08' },
    });
    // After a restart the origin is unknown, so the Group opens at its default Month.
    expect(restarted.getSnapshot().financial.month).toBe('2026-09');
  });

  it('reconciles a stale edit explicitly and then returns to the originating Month', async () => {
    const server = ledger();
    const { controller } = await signedIn(server);
    await controller.openGroup(householdId);
    await controller.selectMonth('2026-08');
    await controller.openExpense(householdId, expenseId, { scrollY: 75 });
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Electricity bill' });
    // Someone else edits first.
    Object.assign(server.records.get(expenseId)!, { description: 'Power', revision: 1 });

    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('conflict');
    expect(controller.getSnapshot().expense.latest?.description).toBe('Power');
    expect(server.records.get(expenseId)!.description).toBe('Power');

    await controller.reviewLatestExpense();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'editing',
      draft: { description: 'Electricity bill', original: { revision: 1 } },
    });
    await controller.saveExpense();
    const patches = server.writes().filter((request) => request.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(server.records.get(expenseId)!.description).toBe('Electricity bill');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      financial: { month: '2026-08' },
      restoreScroll: { y: 75 },
      snackbar: { message: 'Expense updated · Electricity bill', viewMonth: null },
    });
  });

  it('keeps the origin through “Keep current saved record” after a conflict', async () => {
    const server = ledger();
    const { controller } = await signedIn(server);
    await controller.openGroup(householdId);
    await controller.selectMonth('2026-08');
    await controller.openExpense(householdId, expenseId, { scrollY: 30 });
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Mine' });
    Object.assign(server.records.get(expenseId)!, { description: 'Theirs', revision: 1 });
    await controller.saveExpense();
    await controller.acceptCurrentExpense();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { description: 'Theirs' },
    });
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      financial: { month: '2026-08' },
      restoreScroll: { y: 30 },
    });
  });
});

describe('Late completion', () => {
  it('never navigates or announces after the member left for Home', async () => {
    const { server, controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId);
    await fillNewExpense(controller, { date: '2026-08-12' });
    const posted = server.hold('POST', /\/expenses$/);
    const saving = controller.saveExpense();
    await posted.reached;
    // A warm invitation link replaces the screen while the save is in flight.
    await controller.openInvitation('http://localhost:4138/join/abcdef12');
    await controller.cancelInvitation();
    posted.release();
    await saving;

    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      snackbar: null,
      restoreScroll: null,
    });
    expect(server.expensesIn(householdId)).toHaveLength(2);
    expect(server.drafts.size).toBe(0);
  });

  it('never changes another Group’s view or Month', async () => {
    const { server, controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId);
    await fillNewExpense(controller, { date: '2026-08-12' });
    const posted = server.hold('POST', /\/expenses$/);
    const saving = controller.saveExpense();
    await posted.reached;
    await controller.openInvitation('http://localhost:4138/join/abcdef12');
    await controller.openGroup(tripId);
    posted.release();
    await saving;

    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { id: tripId },
      financial: { groupId: tripId, month: null },
      snackbar: null,
      restoreScroll: null,
    });
    expect(server.expensesIn(householdId)).toHaveLength(2);
  });

  it('never restores the Group, a draft or a snackbar after sign-out', async () => {
    const { server, controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId);
    await fillNewExpense(controller);
    const posted = server.hold('POST', /\/expenses$/);
    const saving = controller.saveExpense();
    await posted.reached;
    await controller.signOut();
    posted.release();
    await saving;

    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'signed-out' },
      screen: 'groups',
      snackbar: null,
      restoreScroll: null,
      expense: { draft: null, returnTo: null },
      financial: { groupId: null },
    });
    expect(server.drafts.size).toBe(0);
  });
});
