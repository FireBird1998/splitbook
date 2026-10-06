import { describe, expect, it } from 'vitest';
import { getLocalMonthIsoRange } from '@splitbook/shared/date';
import { createMobileController } from './mobile-controller';
import type { ExpenseDraft } from './expense-draft';
import type { FetchResponse, MobileFetch } from './types';
import { savedQueriesIn } from '../test-utils/saved-queries';

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
const rentTagId = 'a00000000000000000000021';
const utilitiesTagId = 'a00000000000000000000022';
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
  tags: [
    { _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso },
    { _id: rentTagId, name: 'Rent', isArchived: false, createdAt: iso },
    { _id: utilitiesTagId, name: 'Utilities', isArchived: false, createdAt: iso },
  ],
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
 * and an edit or a delete must carry the current revision, which each one it applies bumps once.
 * With `savedCopies`, the app keeps saved copies on the device and can restart offline.
 */
function ledger({ savedCopies = false }: { savedCopies?: boolean } = {}) {
  const requests: { method: string; path: string; key: string | null; body: string }[] = [];
  const records = new Map<string, Record<string, unknown>>();
  const created = new Map<string, string>();
  const drafts = new Map<string, unknown>();
  /** Saved copies on the device, by account and path. */
  const copies = new Map<string, unknown>();
  let identity: unknown = null;
  let offline = false;
  let savesFirst: ((record: Record<string, unknown>) => void) | null = null;
  /** What the ledger answered each edit and delete it received, delivered or not. */
  const answers: string[] = [];
  let cookie: string | null = null;
  let account: string | null = null;
  let cleanup = false;
  let loseResponses = 0;
  let writeFault: 'request' | 'reply' | 'resend' | null = null;
  let failPage: number | null = null;
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

  /** An edit as the ledger applies it, by `editor`, at the next revision. */
  const applyEdit = (
    record: Record<string, unknown>,
    patch: Record<string, unknown>,
    editor: string,
  ) => {
    const changes = Object.fromEntries(
      Object.entries(patch).map(([field, value]) => [field, { old: record[field], new: value }]),
    );
    Object.assign(record, patch, {
      // Money is kept in minor units too, as the ledger keeps it.
      ...('amount' in patch ? { amountMinor: Math.round(Number(patch.amount) * 100) } : {}),
      ...('paidBy' in patch ? { paidBy: minor(patch.paidBy) } : {}),
      ...('splitBetween' in patch ? { splitBetween: minor(patch.splitBetween) } : {}),
      // A Tag's name follows its identity.
      ...('tagId' in patch
        ? { tag: groups[0].tags.find((row) => row._id === patch.tagId)?.name ?? record.tag }
        : {}),
      revision: Number(record.revision) + 1,
      editHistory: [
        ...(record.editHistory as unknown[]),
        { editedBy: person(editor), editedAt: iso, changes },
      ],
    });
  };

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
      const page = Number(url.searchParams.get('page'));
      if (page === failPage) {
        failPage = null;
        return json({ status: 500 }, 500);
      }
      // Newest first, 20 to a page, like the ledger.
      const rows = [...records.values()]
        .filter(
          (row) =>
            row.group === target._id &&
            !row.isDeleted &&
            (month === 'all' || String(row.date) >= getLocalMonthIsoRange(month).dateFrom) &&
            (month === 'all' || String(row.date) <= getLocalMonthIsoRange(month).dateTo),
        )
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return json({
        status: 200,
        data: {
          expenses: rows.slice((page - 1) * 20, page * 20).map(populated),
          pagination: {
            page,
            limit: 20,
            total: rows.length,
            totalPages: Math.ceil(rows.length / 20),
          },
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
      if (new Headers(init.headers).get('X-Splitbook-Revision') !== String(record.revision))
        return json({ code: 'STALE_REVISION', status: 409 }, 409);
      applyEdit(record, JSON.parse(String(init.body)), people[0].id);
      if (loseResponses > 0) {
        loseResponses -= 1;
        throw new Error('The response was lost after the server committed the edit');
      }
    }
    if (method === 'DELETE') {
      if (new Headers(init.headers).get('X-Splitbook-Revision') !== String(record.revision))
        return json({ code: 'STALE_REVISION', status: 409 }, 409);
      // A soft delete: the record stays readable, marked deleted.
      if (!record.isDeleted)
        Object.assign(record, {
          isDeleted: true,
          deletedAt: iso,
          revision: Number(record.revision) + 1,
        });
      return json({ status: 200, data: { message: 'Expense deleted', revision: record.revision } });
    }
    return json({ status: 200, data: populated(record) });
  };

  /** An edit or a delete, as the ledger answers it, noted whether or not the answer arrives. */
  const answer = async (method: string, path: string, init: RequestInit) => {
    const response = await respond(method, path, init);
    answers.push(`${method} ${response.status}`);
    return response;
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
    if (offline) throw new TypeError('Network request failed');
    const held = holds.find((hold) => hold.match(method, pathname + search));
    if (held) {
      holds.splice(holds.indexOf(held), 1);
      await held.wait;
    }
    const differ = method === 'PATCH' ? savesFirst : null;
    if (differ) {
      // Sam saves the same change first, but for what `differ` changes.
      savesFirst = null;
      const record = records.get(pathname.split('/').pop()!)!;
      applyEdit(record, JSON.parse(String(init.body)), people[1].id);
      differ(record);
    }
    if (method !== 'PATCH' && method !== 'DELETE') return respond(method, pathname + search, init);
    const fault = writeFault;
    writeFault = null;
    if (fault === 'request') throw new Error('The connection dropped before the request arrived');
    const first = await answer(method, pathname + search, init);
    if (fault === 'reply') throw new Error('The connection dropped the answer');
    // Android's OkHttp sends the identical request again when a pooled connection drops its
    // answer. The ledger applies the first; only the second's answer reaches the app.
    if (fault === 'resend') return answer(method, pathname + search, init);
    return first;
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
        ...(savedCopies
          ? {
              offlineIdentity: {
                load: async () => structuredClone(identity),
                save: async (value: unknown) => {
                  identity = structuredClone(value);
                },
                clear: async () => {
                  identity = null;
                },
              },
              savedQueries: savedQueriesIn(copies),
              readCache: {
                load: async (account: string, path: string) =>
                  structuredClone(copies.get(account + path) ?? null),
                save: async (account: string, path: string, value: unknown) => {
                  copies.set(account + path, structuredClone(value));
                },
                clear: async () => copies.clear(),
                invalidateGroup: async (account: string, id: string) => {
                  for (const key of [...copies.keys()])
                    if (
                      key.startsWith(`${account}/api/groups/${id}`) ||
                      key === `${account}/api/groups` ||
                      key === `${account}/api/user/balances`
                    )
                      copies.delete(key);
                },
                invalidateLedger: async (account: string, id: string) => {
                  for (const key of [...copies.keys()])
                    if (
                      key.startsWith(`${account}/api/groups/${id}/`) ||
                      key.startsWith(`${account}/api/groups/${id}?`) ||
                      key === `${account}/api/user/balances`
                    )
                      copies.delete(key);
                },
                retainGroups: async () => undefined,
              },
            }
          : {}),
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
          stores: [{ clear: async () => drafts.clear() }, { clear: async () => copies.clear() }],
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
    /** Adds fictional Expenses on the given days of a Month, returning their identities. */
    seed: (month: string, days: number[]) =>
      days.map((day, index) => {
        const id = `c${String(index).padStart(23, '0')}`;
        store(
          id,
          {
            description: `Seeded ${month}-${String(day).padStart(2, '0')} #${index + 1}`,
            amount: 3,
            currency: 'INR',
            category: 'food',
            date: new Date(
              Number(month.slice(0, 4)),
              Number(month.slice(5)) - 1,
              day,
              12,
            ).toISOString(),
            paidBy: [{ user: people[0].id, amount: 3 }],
            splitBetween: people.map(({ id: user }) => ({ user, amount: 1 })),
            splitMethod: 'equal',
            tagId,
            notes: '',
          },
          householdId,
        );
        return id;
      }),
    /** The next read of this Expense page fails with a server error. */
    failNextPage: (page: number) => {
      failPage = page;
    },
    pagesRead: () =>
      requests
        .filter((request) => request.method === 'GET' && /\/expenses\?/.test(request.path))
        .map((request) => Number(new URL(request.path, 'http://local').searchParams.get('page'))),
    loseNextResponse: () => {
      loseResponses += 1;
    },
    answers,
    copies,
    /** Every later request fails as a lost connection does. */
    goOffline: () => {
      offline = true;
    },
    /**
     * When Alex's next edit arrives, Sam has just saved the same change, but for what `differ`
     * changes, at the next revision: Alex's edit is refused as stale.
     */
    anotherMemberSavesFirst: (differ: (record: Record<string, unknown>) => void) => {
      savesFirst = differ;
    },
    /**
     * The next edit or delete never arrives (`request`), arrives but its answer is lost
     * (`reply`), or is sent twice by the transport with only the second answer arriving
     * (`resend`). The app calls fetch once either way.
     */
    faultNextWrite: (fault: 'request' | 'reply' | 'resend') => {
      writeFault = fault;
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
      pages: 1,
      destination: 'expenses',
      activityPages: 1,
    });
    await controller.back();
    expect(controller.getSnapshot().financial.month).toBe('2026-07');
  });

  it('Back returns to the Group destination the Expense opened from', async () => {
    const { controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.selectDestination('balances');
    await controller.openExpense(householdId, undefined, { scrollY: 80 });
    expect(controller.getSnapshot().expense.returnTo).toMatchObject({ destination: 'balances' });
    await fillNewExpense(controller);
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      restoreScroll: { y: 80 },
      financial: { balances: { status: 'ready' } },
    });
  });

  it('a confirmed save returns to Expenses, where it shows, whichever destination it began on', async () => {
    const { controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.selectDestination('balances');
    await controller.openExpense(householdId);
    await fillNewExpense(controller, { date: '2026-09-10' });
    await controller.saveExpense();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'expenses',
      snackbar: { message: 'Expense saved · Weekly groceries' },
    });
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

describe('Returning to an Expense beyond the first page', () => {
  // 25 August Expenses: the oldest is the last row of page 2.
  async function secondPage() {
    const server = ledger();
    server.seed(
      '2026-08',
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
    const { controller } = await signedIn(server);
    await controller.openGroup(householdId);
    await controller.selectMonth('2026-08');
    await controller.loadMoreExpenses();
    const rows = controller.getSnapshot().financial.expenses.data;
    expect(rows).toHaveLength(25);
    return { server, controller, last: rows[24] };
  }

  it('Back reads every page it left, so the opened Expense is still listed', async () => {
    const { server, controller, last } = await secondPage();
    await controller.openExpense(householdId, last.id, { scrollY: 2200 });
    const reads = server.pagesRead().length;
    await controller.back();

    const { financial, restoreScroll } = controller.getSnapshot();
    expect(restoreScroll).toMatchObject({ y: 2200 });
    expect(financial.expenses.data).toHaveLength(25);
    expect(financial.expenses.data.map((row) => row.id)).toContain(last.id);
    expect(financial.expenses.pagination?.page).toBe(2);
    expect(server.pagesRead().slice(reads)).toEqual([1, 2]);

    // A refresh reads the pages loaded again too (#219, M1-3), not only the first page.
    await controller.refresh('pull');
    expect(server.pagesRead().slice(reads + 2)).toEqual([1, 2]);
  });

  it('reads the same pages again after an edit or a new Expense is saved', async () => {
    const { server, controller, last } = await secondPage();
    await controller.openExpense(householdId, last.id, { scrollY: 2200 });
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Seeded, corrected' });
    let reads = server.pagesRead().length;
    await controller.saveExpense();
    let shown = controller.getSnapshot();
    expect(shown.snackbar?.message).toBe('Expense updated · Seeded, corrected');
    expect(shown.restoreScroll).toMatchObject({ y: 2200 });
    expect(shown.financial.expenses.data).toHaveLength(25);
    expect(shown.financial.expenses.data.find((row) => row.id === last.id)?.description).toBe(
      'Seeded, corrected',
    );
    expect(server.pagesRead().slice(reads)).toEqual([1, 2]);

    await controller.openExpense(householdId, undefined, { scrollY: 2150 });
    await fillNewExpense(controller, { date: '2026-08-02' });
    reads = server.pagesRead().length;
    await controller.saveExpense();
    shown = controller.getSnapshot();
    expect(shown.snackbar).toMatchObject({
      message: 'Expense saved · Weekly groceries',
      viewMonth: null,
    });
    expect(shown.restoreScroll).toMatchObject({ y: 2150 });
    expect(shown.financial.expenses.data).toHaveLength(26);
    expect(server.pagesRead().slice(reads)).toEqual([1, 2]);
  });

  it('keeps the range when a foreground refresh supersedes the return read', async () => {
    const { server, controller, last } = await secondPage();
    await controller.openExpense(householdId, last.id, { scrollY: 2200 });
    const pageTwo = server.hold('GET', /\/expenses\?page=2&/);
    const returning = controller.back();
    await pageTwo.reached;
    const refreshing = controller.refresh('foreground');
    pageTwo.release();
    await Promise.all([returning, refreshing]);

    const { financial, restoreScroll } = controller.getSnapshot();
    expect(restoreScroll).toMatchObject({ y: 2200 });
    expect(financial.expenses.status).toBe('ready');
    expect(financial.expenses.data).toHaveLength(25);
    expect(financial.expenses.data.map((row) => row.id)).toContain(last.id);
  });

  it('keeps the range when a foreground refresh supersedes the read after a save', async () => {
    const { server, controller, last } = await secondPage();
    await controller.openExpense(householdId, last.id, { scrollY: 2200 });
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Seeded, corrected' });
    const pageTwo = server.hold('GET', /\/expenses\?page=2&/);
    const saving = controller.saveExpense();
    await pageTwo.reached;
    const refreshing = controller.refresh('foreground');
    pageTwo.release();
    await Promise.all([saving, refreshing]);

    const { financial, snackbar } = controller.getSnapshot();
    expect(snackbar?.message).toBe('Expense updated · Seeded, corrected');
    expect(financial.expenses.data).toHaveLength(25);
    expect(financial.expenses.data.find((row) => row.id === last.id)?.description).toBe(
      'Seeded, corrected',
    );
  });

  it('drops the range when the member changes Month before it is shown', async () => {
    const { server, controller, last } = await secondPage();
    await controller.openExpense(householdId, last.id, { scrollY: 2200 });
    const pageTwo = server.hold('GET', /\/expenses\?page=2&/);
    const returning = controller.back();
    await pageTwo.reached;
    const choosing = controller.selectMonth('2026-07');
    pageTwo.release();
    await Promise.all([returning, choosing]);
    expect(controller.getSnapshot().financial.month).toBe('2026-07');

    // August's first page alone, read again or reused; the return's second page is not read.
    const reads = server.pagesRead().length;
    await controller.selectMonth('2026-08');
    expect(server.pagesRead().slice(reads)).not.toContain(2);
    expect(controller.getSnapshot().financial.expenses.data).toHaveLength(20);
  });

  it('keeps the pages it read and offers Load more when a later page fails', async () => {
    const { server, controller, last } = await secondPage();
    await controller.openExpense(householdId, last.id, { scrollY: 2200 });
    server.failNextPage(2);
    await controller.back();
    const { expenses, balances } = controller.getSnapshot().financial;
    expect(expenses).toMatchObject({ status: 'ready', moreStatus: 'error' });
    expect(expenses.data).toHaveLength(20);
    expect(balances.status).toBe('ready');

    await controller.loadMoreExpenses();
    expect(controller.getSnapshot().financial.expenses.data.map((row) => row.id)).toContain(
      last.id,
    );
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
    // Another Expense opens read-only beside the draft, and offers to resume it.
    await restarted.openExpense(householdId, expenseId);
    expect(restarted.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { original: { _id: expenseId } },
      groupDraft: { description: 'Market run' },
      message: null,
    });

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

describe('An edit or delete whose answer was lost (#232)', () => {
  const recordPath = new RegExp(`/expenses/${expenseId}$`);
  const sent = (server: ReturnType<typeof ledger>) =>
    server.writes().map(({ method, path }) => `${method} ${path}`);
  const ledgerWrite = (method: string) =>
    `${method} /api/groups/${householdId}/expenses/${expenseId}`;
  /** Alex edits the amount to 45 and splits it with Sam only. */
  const editMoney = async (controller: ReturnType<typeof createMobileController>) => {
    await controller.openGroup(householdId);
    await controller.openExpense(householdId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({
      amount: '45',
      participantIds: [people[0].id, people[1].id],
    });
  };

  it.each(['reply', 'resend'] as const)(
    'confirms the member’s own edit after a lost answer (%s), from one PATCH and one edit',
    async (fault) => {
      const server = ledger();
      const { controller } = await signedIn(server);
      await controller.openGroup(householdId);
      await controller.selectMonth('2026-08');
      await controller.openExpense(householdId, expenseId, { scrollY: 75 });
      await controller.editExpense();
      await controller.updateExpenseDraft({ description: 'Electricity bill' });
      server.faultNextWrite(fault);
      await controller.saveExpense();

      // The app sent it once. A resend reached the ledger twice; it applied the first only.
      expect(sent(server)).toEqual([ledgerWrite('PATCH')]);
      expect(server.answers).toEqual(
        fault === 'resend' ? ['PATCH 200', 'PATCH 409'] : ['PATCH 200'],
      );
      expect(server.records.get(expenseId)).toMatchObject({
        description: 'Electricity bill',
        revision: 1,
        editHistory: [expect.anything()],
      });
      // Finished as if the answer had arrived: nothing is left to check or send.
      expect(server.drafts.size).toBe(0);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'group',
        financial: { month: '2026-08' },
        restoreScroll: { y: 75 },
        expense: { status: 'saved', mutation: null, draft: null, message: 'Expense updated.' },
        snackbar: { message: 'Expense updated · Electricity bill', viewMonth: null },
      });
      // The Group's Expenses were read again and show the change.
      expect(
        controller.getSnapshot().financial.expenses.data.map((row) => row.description),
      ).toEqual(['Electricity bill']);
    },
  );

  it.each(['reply', 'resend'] as const)(
    'confirms the member’s own delete after a lost answer (%s), from one DELETE',
    async (fault) => {
      const server = ledger();
      const { controller } = await signedIn(server);
      await controller.openGroup(householdId);
      await controller.selectMonth('2026-08');
      await controller.openExpense(householdId, expenseId);
      controller.reviewExpenseDeletion();
      server.faultNextWrite(fault);
      await controller.deleteExpense();

      expect(sent(server)).toEqual([ledgerWrite('DELETE')]);
      expect(server.answers).toEqual(
        fault === 'resend' ? ['DELETE 200', 'DELETE 409'] : ['DELETE 200'],
      );
      expect(server.records.get(expenseId)).toMatchObject({ isDeleted: true, revision: 1 });
      expect(server.drafts.size).toBe(0);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'group',
        financial: { month: '2026-08' },
        expense: { status: 'saved', mutation: null, draft: null, message: 'Expense deleted.' },
        snackbar: { message: 'Expense deleted · Electricity' },
      });
      expect(controller.getSnapshot().financial.expenses.data).toEqual([]);
    },
  );

  it('confirms a lost answer to an edit of the amount and the split when the saved values match', async () => {
    const server = ledger();
    const { controller } = await signedIn(server);
    await editMoney(controller);
    server.faultNextWrite('reply');
    await controller.saveExpense();

    expect(sent(server)).toEqual([ledgerWrite('PATCH')]);
    expect(JSON.parse(server.writes()[0].body)).toMatchObject({
      amount: 45,
      paidBy: [{ user: people[0].id, amount: 45 }],
      splitBetween: [
        { user: people[0].id, amount: 22.5 },
        { user: people[1].id, amount: 22.5 },
      ],
    });
    expect(server.records.get(expenseId)).toMatchObject({ amountMinor: 4500, revision: 1 });
    expect(server.drafts.size).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      expense: { status: 'saved', mutation: null, message: 'Expense updated.' },
      snackbar: { message: 'Expense updated · Electricity' },
    });
  });

  const [alexId, samId, priyaId] = people.map(({ id }) => id);
  /** Allocation rows as the ledger keeps them, in minor units too. */
  const rows = (...entries: [string, number][]) =>
    entries.map(([user, amount]) => ({ user, amount, amountMinor: Math.round(amount * 100) }));
  /** 45, split equally between Alex and Sam: 22.50 each. */
  const twoWays: Partial<ExpenseDraft> = { amount: '45', participantIds: [alexId, samId] };
  /**
   * Alex's edit, and what Sam's save at the next revision changed differently. Each differs in
   * that one field alone, so only the comparison of that field can refuse it.
   */
  const differences: [string, Partial<ExpenseDraft>, (saved: Record<string, unknown>) => void][] = [
    ['date', { date: '2026-08-22' }, (saved) => void (saved.date = '2026-08-23T06:30:00.000Z')],
    [
      'Tag',
      { tagId: rentTagId },
      (saved) => void Object.assign(saved, { tagId: utilitiesTagId, tag: 'Utilities' }),
    ],
    ['category', { category: 'food' }, (saved) => void (saved.category = 'travel')],
    [
      'amount',
      twoWays,
      (saved) =>
        void Object.assign(saved, {
          amount: 50,
          amountMinor: 5000,
          paidBy: rows([alexId, 50]),
          splitBetween: rows([alexId, 25], [samId, 25]),
        }),
    ],
    [
      'split',
      twoWays,
      (saved) => void (saved.splitBetween = rows([alexId, 15], [samId, 15], [priyaId, 15])),
    ],
    [
      'person in the split, for the same share',
      twoWays,
      (saved) => void (saved.splitBetween = rows([alexId, 22.5], [priyaId, 22.5])),
    ],
    ['payer, for the same amount', twoWays, (saved) => void (saved.paidBy = rows([samId, 45]))],
    [
      'share for each person',
      { ...twoWays, splitMethod: 'unequal', splitValues: { [alexId]: '20', [samId]: '25' } },
      (saved) => void (saved.splitBetween = rows([alexId, 25], [samId, 20])),
    ],
    [
      'set of people, with one more at nothing',
      { ...twoWays, splitMethod: 'unequal', splitValues: { [alexId]: '22.5', [samId]: '22.5' } },
      (saved) => void (saved.splitBetween = rows([alexId, 22.5], [samId, 22.5], [priyaId, 0])),
    ],
    [
      'percentages, for the same shares',
      { ...twoWays, splitMethod: 'percentage', splitValues: { [alexId]: '40', [samId]: '60' } },
      (saved) =>
        void (saved.splitBetween = [
          { ...rows([alexId, 18])[0], percentage: 40.01 },
          { ...rows([samId, 27])[0], percentage: 59.99 },
        ]),
    ],
    [
      'shares, for the same amounts',
      { ...twoWays, splitMethod: 'shares', splitValues: { [alexId]: '1', [samId]: '2' } },
      (saved) =>
        void (saved.splitBetween = [
          { ...rows([alexId, 15])[0], shares: 2 },
          { ...rows([samId, 30])[0], shares: 4 },
        ]),
    ],
    ['currency', twoWays, (saved) => void (saved.currency = 'USD')],
    ['split method', twoWays, (saved) => void (saved.splitMethod = 'unequal')],
  ];
  /** Alex makes `edit`; Sam saved first at revision 0 + 1, and Alex's refused answer is lost. */
  const metFirst = async (
    edit: Partial<ExpenseDraft>,
    differ: (saved: Record<string, unknown>) => void,
  ) => {
    const server = ledger();
    const { controller } = await signedIn(server);
    await controller.openGroup(householdId);
    await controller.openExpense(householdId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft(edit);
    server.anotherMemberSavesFirst(differ);
    server.faultNextWrite('reply');
    await controller.saveExpense();
    expect(sent(server)).toEqual([ledgerWrite('PATCH')]);
    expect(server.answers).toEqual(['PATCH 409']);
    return { server, controller };
  };

  it.each(differences)(
    'confirms when another member saved the very same change at the next revision (%s)',
    async (_field, edit) => {
      const { server, controller } = await metFirst(edit, () => undefined);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'group',
        expense: { status: 'saved', mutation: null, message: 'Expense updated.' },
      });
      expect(server.drafts.size).toBe(0);
    },
  );

  it.each(differences)(
    'keeps a conflict when another member saved a different %s at the next revision',
    async (_field, edit, differ) => {
      const { server, controller } = await metFirst(edit, differ);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'expense',
        expense: {
          status: 'conflict',
          latest: { revision: 1 },
          mutation: { kind: 'edit', revision: 0 },
          message: expect.stringContaining('Compare your version with the saved one'),
        },
      });
      expect([...server.drafts.values()]).toEqual([
        expect.objectContaining({
          mutation: expect.objectContaining({ kind: 'edit', revision: 0 }),
        }),
      ]);
    },
  );

  it('keeps today’s blocked state when the next revision holds the change but reads deleted', async () => {
    const { server, controller } = await metFirst(
      { description: 'Electricity bill' },
      (saved) => void Object.assign(saved, { isDeleted: true, deletedAt: iso }),
    );
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'blocked',
      latest: { revision: 1, isDeleted: true, description: 'Electricity bill' },
      mutation: { kind: 'edit', revision: 0 },
      message: expect.stringContaining('This Expense has been deleted'),
    });
    expect(server.drafts.size).toBe(1);
  });

  it('confirms a Tag change by the Tag’s identity, whatever the Tag is called by the check', async () => {
    const server = ledger();
    const { controller } = await signedIn(server);
    await controller.openGroup(householdId);
    await controller.openExpense(householdId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ tagId: rentTagId });
    server.faultNextWrite('reply');
    const check = server.hold('GET', recordPath);
    const saving = controller.saveExpense();
    await check.reached;
    // The Tag is renamed before the check reads the Expense; the Expense keeps the same Tag.
    server.records.get(expenseId)!.tag = 'Rent and maintenance';
    check.release();
    await saving;

    expect(sent(server)).toEqual([ledgerWrite('PATCH')]);
    expect(server.records.get(expenseId)).toMatchObject({ tagId: rentTagId, revision: 1 });
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      expense: { status: 'saved', message: 'Expense updated.' },
    });
    expect(server.drafts.size).toBe(0);
  });

  it.each([
    ['nothing', '{}'],
    [
      'a field the app never sends',
      JSON.stringify({ description: 'Electricity bill', receiptUrl: 'https://example.test/r.png' }),
    ],
    ['only isDeleted', '{"isDeleted":false}'],
    ['only predefinedItem', '{"predefinedItem":null}'],
    ['part of the money', '{"amount":45}'],
    ['a Tag’s name without its identity', '{"tag":"Groceries"}'],
    ['a __proto__ key', '{"description":"Electricity bill","__proto__":{"amount":1}}'],
  ])(
    'keeps a conflict when the stored edit carries %s, even at the next revision',
    async (_carried, body) => {
      const server = ledger();
      const { controller } = await signedIn(server);
      await controller.openGroup(householdId);
      await controller.openExpense(householdId, expenseId);
      await controller.editExpense();
      await controller.updateExpenseDraft({ description: 'Electricity bill' });
      server.faultNextWrite('request');
      await controller.saveExpense();
      controller.dispose();
      // The edit never arrived. The device holds it with this body instead, as a damaged
      // record or another version of the app could...
      const [[slot, stored]] = [...server.drafts] as [string, { mutation: object }][];
      server.drafts.set(slot, { ...stored, mutation: { ...stored.mutation, body } });
      // ...and Sam's save at the next revision holds every value that body names.
      Object.assign(server.records.get(expenseId)!, {
        description: 'Electricity bill',
        amount: 45,
        amountMinor: 4500,
        paidBy: rows([alexId, 45]),
        splitBetween: rows([alexId, 15], [samId, 15], [priyaId, 15]),
        revision: 1,
      });

      const restarted = server.create();
      await restarted.restore();
      await restarted.openExpense(householdId, expenseId);
      restarted.resumeExpenseDraft();
      await restarted.reconcileExpense();
      expect(sent(server)).toEqual([ledgerWrite('PATCH')]);
      expect(restarted.getSnapshot().expense).toMatchObject({
        status: 'conflict',
        latest: { revision: 1 },
        mutation: { kind: 'edit', revision: 0, body },
      });
      expect(server.drafts.size).toBe(1);
    },
  );

  it('removes the Group’s older saved copies when a check after a restart confirms the edit', async () => {
    const server = ledger({ savedCopies: true });
    /** Saved copies of the Group's ledger that still show the Expense from before the edit. */
    const olderCopies = () =>
      [...server.copies]
        .filter(
          ([key, value]) =>
            key.includes(`/api/groups/${householdId}/`) &&
            JSON.stringify(value).includes('"description":"Electricity"'),
        )
        .map(([key]) => key);
    const { controller } = await signedIn(server);
    await controller.openGroup(householdId);
    await controller.selectMonth('2026-08');
    await controller.openExpense(householdId, expenseId);
    expect(olderCopies()).not.toEqual([]);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Electricity bill' });
    const patch = server.hold('PATCH', recordPath);
    const saving = controller.saveExpense();
    await patch.reached;
    // The app closes; the ledger then commits the edit, and its answer reaches no one.
    controller.dispose();
    patch.release();
    await saving;
    expect(server.answers).toEqual(['PATCH 200']);

    const restarted = server.create();
    await restarted.restore();
    await restarted.openExpense(householdId, expenseId);
    restarted.resumeExpenseDraft();
    await restarted.reconcileExpense();
    expect(restarted.getSnapshot().expense).toMatchObject({
      status: 'saved',
      message: 'Expense updated.',
    });
    expect(sent(server)).toEqual([ledgerWrite('PATCH')]);
    // No saved copy from before the edit is kept...
    expect(olderCopies()).toEqual([]);

    // ...so the app, restarted offline, shows none.
    restarted.dispose();
    server.goOffline();
    const offline = server.create();
    await offline.restore();
    await offline.openGroup(householdId);
    await offline.selectMonth('2026-08');
    expect(offline.getSnapshot().offline.active).toBe(true);
    expect(
      offline.getSnapshot().financial.expenses.data.map((row) => row.description),
    ).not.toContain('Electricity');
  });

  it('keeps a conflict when the saved Expense is more than one revision on, even holding what was sent', async () => {
    const server = ledger();
    const { controller } = await signedIn(server);
    await controller.openGroup(householdId);
    await controller.openExpense(householdId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Electricity bill' });
    server.faultNextWrite('reply');
    const check = server.hold('GET', recordPath);
    const saving = controller.saveExpense();
    await check.reached;
    // Sam saves a note before the check reads the Expense: revision 0 + 2.
    Object.assign(server.records.get(expenseId)!, { notes: 'Meter read on the 20th', revision: 2 });
    check.release();
    await saving;

    expect(sent(server)).toEqual([ledgerWrite('PATCH')]);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'conflict',
      latest: { revision: 2, description: 'Electricity bill' },
      mutation: { kind: 'edit', revision: 0 },
    });
    expect(server.drafts.size).toBe(1);
  });

  it('keeps a delete for review when the Expense still exists', async () => {
    const server = ledger();
    const { controller } = await signedIn(server);
    await controller.openGroup(householdId);
    await controller.openExpense(householdId, expenseId);
    controller.reviewExpenseDeletion();
    server.faultNextWrite('request');
    await controller.deleteExpense();

    expect(sent(server)).toEqual([ledgerWrite('DELETE')]);
    expect(server.answers).toEqual([]);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'conflict',
      latest: { isDeleted: false, revision: 0 },
      mutation: { kind: 'delete', revision: 0 },
    });
    expect(server.drafts.size).toBe(1);
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
