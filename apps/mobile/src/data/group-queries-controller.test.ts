import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusManager } from '@tanstack/query-core';
import { getLocalMonthIsoRange } from '@splitbook/shared/date';
import { createMobileController } from './mobile-controller';
import type { FetchResponse, MobileSnapshot } from './types';

// #219: a Group's own view on declarative queries: the Group, its Expenses for the chosen Month
// as one query of up to 5 pages, and its Balances, with their saved copies on the persister.
// These checks drive the controller's public commands, as the app does, and look only at the
// requests sent, the snapshot and the records on this device. Freshness runs on TanStack's
// clock, Date.now, which moves with vitest's fake Date.

const alex = { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test' };
const mapleId = 'b00000000000000000000001';
const cabinId = 'b00000000000000000000002';
const tagId = 'c00000000000000000000001';
const iso = '2026-09-15T06:30:00.000Z';
const start = Date.parse(iso);
const person = (user: typeof alex) => ({ _id: user.id, name: user.name, image: null });
const groupOf = (_id: string, name: string, category: string) => ({
  _id,
  createdBy: alex.id,
  name,
  description: '',
  category,
  defaultCurrency: 'INR',
  members: [alex, sam].map((user) => ({
    user: { ...person(user), email: user.email },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
const maple = groupOf(mapleId, 'Maple House', 'home');
const cabin = groupOf(cabinId, 'Cabin Weekend', 'trip');
const listPath = '/api/groups';
const homePath = '/api/user/balances';
const maplePath = `/api/groups/${mapleId}`;
const balancesPath = `${maplePath}/balances`;
const json = (body: unknown, status = 200) => Response.json(body, { status });
const monthOf = (path: string) => {
  const from = new URL(path, 'http://local').searchParams.get('dateFrom');
  return ['2026-08', '2026-09'].find((month) => getLocalMonthIsoRange(month).dateFrom === from);
};
const pageOf = (path: string) => Number(new URL(path, 'http://local').searchParams.get('page'));
const hex = (prefix: string, index: number) => `${prefix}${String(index).padStart(23, '0')}`;
/** A fictional Expense of Maple House, newest first by `index`, in `month`. */
const expenseRow = (month: string, index: number, description = `${month} expense ${index}`) => ({
  _id: hex(month === '2026-09' ? 'd' : 'e', index),
  group: mapleId,
  revision: 1,
  description,
  amount: 10,
  amountMinor: 1000,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: person(alex), amount: 10, amountMinor: 1000 }],
  splitBetween: [{ user: person(alex), amount: 10, amountMinor: 1000 }],
  splitMethod: 'equal',
  date: `${month}-10T06:30:00.000Z`,
  createdAt: iso,
  updatedAt: iso,
  category: 'food',
  tagId,
  tag: 'Groceries',
  notes: '',
  isDeleted: false,
  editHistory: [],
});

/** A fictional backend for Alex and Sam, and device stores that outlive a controller. */
function fixture() {
  const server = {
    /** Maple House's Expenses by Month, newest first: September has 7 pages, August 2. */
    rows: {
      '2026-09': Array.from({ length: 130 }, (_, index) => expenseRow('2026-09', index + 1)),
      '2026-08': Array.from({ length: 21 }, (_, index) => expenseRow('2026-08', index + 1)),
    } as Record<string, ReturnType<typeof expenseRow>[]>,
    /** What Alex owes in Maple House, and on Home. */
    owe: 30,
    /** Groups that refuse Alex and Sam (403), and are left out of the list. */
    revoked: new Set<string>(),
    /** Groups whose answer no longer lists Alex, though their other reads still answer. */
    left: new Set<string>(),
    offline: false,
    /** A page of September that answers 500 instead. */
    failPage: 0,
    /** The Group, or its Balances, answers 500: a server fault, not a refusal. */
    failGroup: false,
    failBalances: false,
    created: 0,
    /** How long each GET takes to answer, in ms of the fake clock; 0 answers at once. */
    delay: 0,
  };
  let cookie: string | null = null,
    owner: string | null = null,
    cleanup = false;
  /** The persister's rows, by account and path; the older saved-copy store's, the same way. */
  const rows = new Map<string, unknown>(),
    disk = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    attempts = new Map<string, unknown>();
  /** What the saved-copy databases can't do. */
  const device = { failRemoval: false };
  /** Writes of rows held part-way, as on a slow disk, by path. */
  const writes: { path: string; arrive: () => void; released: Promise<void> }[] = [];
  const pause = async (path: string) => {
    const index = writes.findIndex((step) => step.path === path);
    if (index < 0) return;
    const [step] = writes.splice(index, 1);
    step.arrive();
    await step.released;
  };
  const calls: { method: string; path: string; account: string; at: number }[] = [];
  const held: {
    path: string;
    arrive: () => void;
    answer: Promise<void>;
    lost: boolean;
    /** Holds only a request sent after the next write. */
    afterWrite: boolean;
    /** Holds only a request for exactly `path`. */
    exact: boolean;
  }[] = [];
  const connection = new Set<(state: { isConnected: boolean | null }) => void>();
  const records = (map: Map<string, unknown>) => ({
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
    list: async (account: string) =>
      [...map]
        .filter(([key]) => key.startsWith(account))
        .map(([key, value]) => ({
          groupId: key.slice(account.length),
          value: structuredClone(value),
        })),
  });
  const untrusted = { value: null as unknown },
    identity = { value: null as unknown };
  const untrustedCopies = {
    load: async () => structuredClone(untrusted.value),
    save: async (value: unknown) => {
      untrusted.value = structuredClone(value);
    },
    clear: async () => {
      untrusted.value = null;
    },
  };
  const savedQueries = {
    ...records(rows),
    save: async (account: string, key: string, value: unknown) => {
      await pause(key);
      rows.set(account + key, structuredClone(value));
    },
    remove: async (account: string, key: string) => {
      if (device.failRemoval) throw new Error('The device storage is full');
      rows.delete(account + key);
    },
  };
  const readCache = {
    ...records(disk),
    invalidateGroup: async (account: string, id: string) => {
      if (device.failRemoval) throw new Error('The device storage is full');
      for (const key of [...disk.keys()])
        if (key.startsWith(`${account}/api/groups/${id}`)) disk.delete(key);
    },
    invalidateLedger: async (account: string, id: string) => {
      if (device.failRemoval) throw new Error('The device storage is full');
      for (const key of [...disk.keys()])
        if (key.startsWith(`${account}/api/groups/${id}/`)) disk.delete(key);
    },
    retainGroups: async (account: string, ids: string[]) => {
      for (const key of [...disk.keys()]) {
        const id = /^\/api\/groups\/([a-f\d]{24})/.exec(key.slice(account.length))?.[1];
        if (key.startsWith(account) && id && !ids.includes(id)) disk.delete(key);
      }
    },
  };
  const signedIn = (init: RequestInit) =>
    String((init.headers as Record<string, string>).Cookie ?? '').includes('sam.') ? sam : alex;
  const page = (month: string, number: number) => {
    const all = server.rows[month] ?? [];
    return {
      status: 200,
      data: {
        expenses: all.slice((number - 1) * 20, number * 20),
        pagination: {
          page: number,
          limit: 20,
          total: all.length,
          totalPages: Math.ceil(all.length / 20),
        },
        summary: {
          count: all.length,
          totalsByCurrency: [{ currency: 'INR', totalAmount: all.length * 10 }],
          userOwes: 0,
          userGetsBack: 0,
          byMember: [],
        },
      },
    };
  };
  const respond = (path: string, init: RequestInit): FetchResponse => {
    const method = init.method ?? 'GET';
    if (path.endsWith('/sign-in')) {
      const persona = String(init.body).includes('sam') ? 'sam' : 'alex';
      return new Response(JSON.stringify({ user: persona === 'sam' ? sam : alex }), {
        headers: {
          'Set-Cookie': `better-auth.session_token=${persona}.signature; Path=/; HttpOnly`,
        },
      });
    }
    if (path.endsWith('/sign-out')) return json({ success: true });
    const user = signedIn(init);
    if (path.endsWith('/get-session'))
      return json({
        user: { ...user, image: null },
        session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' },
      });
    const listed = [maple, cabin].filter(({ _id }) => !server.revoked.has(_id));
    if (path === listPath) return json({ status: 200, data: listed });
    if (path === homePath)
      return json({
        status: 200,
        data: { buckets: [{ currency: 'INR', youOwe: server.owe, youAreOwed: 0 }] },
      });
    const id = /^\/api\/groups\/([a-f\d]{24})/.exec(path)?.[1];
    const group = [maple, cabin].find(({ _id }) => _id === id);
    if (!id || !group) return json({}, 404);
    if (server.revoked.has(id)) return json({}, 403);
    if (path === `/api/groups/${id}` && server.failGroup) return json({}, 500);
    if (path === `/api/groups/${id}`)
      return json({
        status: 200,
        data: server.left.has(id)
          ? { ...group, members: group.members.filter(({ user }) => user._id !== alex.id) }
          : group,
      });
    if (path.startsWith(`/api/groups/${id}/expenses?`)) {
      const number = pageOf(path);
      if (id === mapleId && monthOf(path) === '2026-09' && number === server.failPage)
        return json({}, 500);
      return json(page(id === mapleId ? (monthOf(path) ?? 'none') : 'none', number));
    }
    if (path === `/api/groups/${id}/expenses` && method === 'POST') {
      // The newest Expense of September, at the top of its first page.
      server.created += 1;
      const created = expenseRow('2026-09', 900 + server.created, 'Fresh groceries');
      server.rows['2026-09'] = [created, ...server.rows['2026-09']];
      server.owe += 1;
      return json({ status: 201, data: { _id: created._id, group: id } }, 201);
    }
    if (path === `/api/groups/${id}/balances` && server.failBalances) return json({}, 500);
    if (path === `/api/groups/${id}/balances`)
      return json({
        status: 200,
        data: {
          byCurrency: [
            {
              currency: 'INR',
              balances: [],
              debts: server.owe
                ? [{ from: person(alex), to: person(sam), amount: server.owe }]
                : [],
            },
          ],
        },
      });
    if (path === `/api/groups/${id}/settlements` && method === 'POST') {
      // The payment as recorded, echoing what was sent.
      const sent = JSON.parse(String(init.body)) as { amount: number; currency: string };
      server.owe -= sent.amount;
      const people = [alex, sam].map((user) => ({ ...person(user), email: user.email }));
      return json(
        {
          status: 201,
          data: {
            _id: hex('f', 1),
            group: id,
            paidBy: people[0],
            paidTo: people[1],
            createdBy: people[0],
            amount: sent.amount,
            amountMinor: Math.round(sent.amount * 100),
            moneyVersion: 1,
            currency: sent.currency,
            note: '',
            createdAt: iso,
            updatedAt: iso,
          },
        },
        201,
      );
    }
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
        newSubmissionKey: () =>
          `group-queries-attempt-${String(server.created + 1).padStart(4, '0')}`,
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        savedQueries,
        readCache,
        netInfo: {
          addEventListener: (listener) => {
            connection.add(listener);
            listener({ isConnected: !server.offline });
            return () => connection.delete(listener);
          },
        },
        offlineIdentity: {
          load: async () => structuredClone(identity.value),
          save: async (value) => {
            identity.value = structuredClone(value);
          },
          clear: async () => {
            identity.value = null;
          },
        },
        expenseDrafts: records(drafts),
        settlementAttempts: records(attempts),
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
          untrustedCopies,
          stores: [savedQueries, readCache, records(drafts), records(attempts), untrustedCopies],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname + new URL(url).search;
          const method = init.method ?? 'GET';
          calls.push({ method, path, account: signedIn(init).id, at: Date.now() });
          if (server.offline) throw new TypeError('Network request failed');
          if (server.delay && method === 'GET')
            await new Promise((resolve) => setTimeout(resolve, server.delay));
          if (method !== 'GET') held.forEach((request) => (request.afterWrite = false));
          const index = held.findIndex(
            (request) =>
              !request.afterWrite &&
              (request.exact ? path === request.path : path.startsWith(request.path)),
          );
          if (index >= 0) {
            // The server answers as it is when the request arrives; the reply comes on release.
            const [request] = held.splice(index, 1),
              reply = respond(path, init);
            request.arrive();
            return request.answer.then(() => {
              if (request.lost) throw new TypeError('Network request failed');
              return reply;
            });
          }
          return respond(path, init);
        },
      },
    );
  return {
    create,
    server,
    device,
    rows,
    disk,
    calls,
    untrusted: () => untrusted.value,
    /** Every GET since `from`, as `/path` with its September or August page, in order. */
    gets: (from = 0) =>
      calls
        .slice(from)
        .filter((call) => call.method === 'GET')
        .map(({ path }) =>
          path.includes('/expenses?')
            ? `expenses ${monthOf(path) ?? 'all'} p${pageOf(path)}`
            : path === maplePath
              ? 'group'
              : path === balancesPath
                ? 'balances'
                : path,
        ),
    /** The next request whose path starts with `path` is answered at once; its reply on release. */
    hold(path: string, { lost = false, afterWrite = false, exact = false } = {}) {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const answer = new Promise<void>((resolve) => {
        release = resolve;
      });
      held.push({ path, arrive, answer, lost, afterWrite, exact });
      return { reached, release };
    },
    /** The next write of this path's row waits until released. */
    holdWrite(path: string) {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      writes.push({ path, arrive, released });
      return { reached, release };
    },
    connect(isConnected: boolean) {
      server.offline = !isConnected;
      connection.forEach((listener) => listener({ isConnected }));
    },
    /** This account's persister rows whose path starts with `prefix`. */
    savedRows: (prefix: string, account = alex.id) =>
      [...rows]
        .filter(([key]) => key.startsWith(account + prefix))
        .map(([key, value]) => ({ path: key.slice(account.length), ...(value as object) })) as {
        path: string;
        refreshedAt: number;
        value: unknown;
      }[],
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(start);
});
afterEach(() => {
  vi.useRealTimers();
});

const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
/** Lets every answer and storage step already under way go as far as it can. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const septemberPath = (page: number) =>
  `/api/groups/${mapleId}/expenses?page=${page}&limit=20&includeMemberBreakdown=1`;
/** The Expense rows listed, as `<month> expense <n>`. */
const listed = (state: MobileSnapshot) =>
  state.financial.expenses.data.map((row) => row.description);
const septemberRows = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `2026-09 expense ${from + index}`);

/** Alex has Maple House open on September, with `pages` pages of its Expenses loaded. */
async function withPages(f: ReturnType<typeof fixture>, pages: number) {
  const controller = f.create();
  await controller.signIn('alex');
  await controller.openGroup(mapleId);
  for (let page = 2; page <= pages; page += 1) await controller.loadMoreExpenses();
  return controller;
}

describe('one query of up to 5 pages per Month (#219, M1-3, M7-2)', () => {
  it.each([3, 5])(
    'reads the %i loaded pages again on a refresh, keeping the rows on screen as refreshing until it lands',
    async (pages) => {
      const f = fixture();
      const controller = await withPages(f, pages);
      expect(listed(controller.getSnapshot())).toEqual(septemberRows(1, pages * 20));
      const sent = f.calls.length;
      const last = f.hold(septemberPath(pages));
      const refreshing = controller.refresh('pull');
      await last.reached;
      // The rows loaded before stay listed, marked as being read again.
      expect(controller.getSnapshot().financial.expenses).toMatchObject({ status: 'loading' });
      expect(listed(controller.getSnapshot())).toEqual(septemberRows(1, pages * 20));
      last.release();
      await refreshing;
      expect(f.gets(sent)).toEqual([
        'group',
        ...Array.from({ length: pages }, (_, index) => `expenses 2026-09 p${index + 1}`),
        'balances',
      ]);
      expect(controller.getSnapshot().financial.expenses).toMatchObject({
        status: 'ready',
        pagination: { page: pages },
      });
      expect(listed(controller.getSnapshot())).toEqual(septemberRows(1, pages * 20));
    },
  );

  it('reads the loaded pages again on a foreground after the window, through TanStack’s focus event', async () => {
    const f = fixture();
    const controller = await withPages(f, 3);
    later(31_000);
    const sent = f.calls.length;
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await settle();
    expect(f.gets(sent)).toEqual([
      'group',
      'expenses 2026-09 p1',
      'expenses 2026-09 p2',
      'expenses 2026-09 p3',
      'balances',
    ]);
    expect(listed(controller.getSnapshot())).toEqual(septemberRows(1, 60));
  });

  it('slides past 5 pages: Load more reads page 6, the list holds pages 2 to 6, and Load newer appears', async () => {
    const f = fixture();
    const controller = await withPages(f, 5);
    expect(controller.getSnapshot().financial.expenses).toMatchObject({ firstPage: 1 });
    const sent = f.calls.length;
    await controller.loadMoreExpenses();
    expect(f.gets(sent)).toEqual(['expenses 2026-09 p6', 'balances']);
    expect(listed(controller.getSnapshot())).toEqual(septemberRows(21, 120));
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      status: 'ready',
      firstPage: 2,
      pagination: { page: 6, totalPages: 7 },
      newerStatus: 'idle',
    });
  });

  it('Load newer reads page 1, the list holds pages 1 to 5 again, and Load newer goes away', async () => {
    const f = fixture();
    const controller = await withPages(f, 6);
    const sent = f.calls.length;
    await controller.loadNewerExpenses();
    expect(f.gets(sent)).toEqual(['expenses 2026-09 p1', 'balances']);
    expect(listed(controller.getSnapshot())).toEqual(septemberRows(1, 100));
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      status: 'ready',
      firstPage: 1,
      pagination: { page: 5 },
    });
    // Nothing newer to read: Load newer is a button that's no longer offered.
    const again = f.calls.length;
    await controller.loadNewerExpenses();
    expect(f.calls.length).toBe(again);
  });

  it('says Load newer is loading while it reads, and keeps the rows with an error when it fails', async () => {
    const f = fixture();
    const controller = await withPages(f, 6);
    f.server.failPage = 1;
    const first = f.hold(septemberPath(1));
    const reading = controller.loadNewerExpenses();
    await first.reached;
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      status: 'ready',
      newerStatus: 'loading',
    });
    first.release();
    await reading;
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      status: 'ready',
      firstPage: 2,
      newerStatus: 'error',
      newerMessage: 'The server could not complete this request. Please try again.',
    });
    expect(listed(controller.getSnapshot())).toEqual(septemberRows(21, 120));
    f.server.failPage = 0;
    await controller.loadNewerExpenses();
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      firstPage: 1,
      newerStatus: 'idle',
    });
  });

  it('shows the oldest verification time among the pages in its window, after Load newer too', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    const first = Date.now();
    later(5_000);
    await controller.loadMoreExpenses();
    // Page 2 is newer: the list still shows page 1's time.
    expect(controller.getSnapshot().financial.expenses.refreshedAt).toBe(first);
    for (let page = 3; page <= 6; page += 1) {
      later(1_000);
      await controller.loadMoreExpenses();
    }
    // Page 1 dropped: the oldest page in the window is page 2.
    expect(controller.getSnapshot().financial.expenses.refreshedAt).toBe(first + 5_000);
    later(1_000);
    await controller.loadNewerExpenses();
    // Page 1, read again just now, never makes the older pages look fresh.
    expect(controller.getSnapshot().financial.expenses.refreshedAt).toBe(first + 5_000);
  });

  it('never shows a page that fell back to its saved copy as fresh', async () => {
    const f = fixture();
    const controller = await withPages(f, 2);
    const savedAt = Date.now();
    await settle();
    later(31_000);
    // Page 1 is read again; page 2 can't be: it shows from this device, and the list says when.
    const lost = f.hold(septemberPath(2), { lost: true });
    const pulling = controller.refresh('pull');
    await lost.reached;
    lost.release();
    await pulling;
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true, refreshedAt: savedAt },
      financial: { expenses: { status: 'ready', refreshedAt: savedAt } },
    });
    expect(listed(controller.getSnapshot())).toEqual(septemberRows(1, 40));
  });

  it('keeps rows de-duplicated by id across pages', async () => {
    const f = fixture();
    const controller = await withPages(f, 1);
    // A new Expense on the server pushes the 20th row onto page 2.
    f.server.rows['2026-09'] = [
      expenseRow('2026-09', 999, 'Late groceries'),
      ...f.server.rows['2026-09'],
    ];
    await controller.loadMoreExpenses();
    const ids = controller.getSnapshot().financial.expenses.data.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(39);
  });

  it('returns to the newest page and highlights the saved Expense after a save made while the window has slid', async () => {
    const f = fixture();
    const controller = await withPages(f, 6);
    expect(controller.getSnapshot().financial.expenses.firstPage).toBe(2);
    await controller.openExpense(mapleId, undefined, { scrollY: 4_200 });
    await controller.updateExpenseDraft({
      description: 'Fresh groceries',
      amount: '12',
      tagId,
      date: '2026-09-14',
    });
    const sent = f.calls.length;
    await controller.saveExpense();
    const state = controller.getSnapshot();
    expect(state).toMatchObject({
      screen: 'group',
      destination: 'expenses',
      restoreScroll: { y: 0 },
      snackbar: { message: 'Expense saved · Fresh groceries' },
      financial: { expenses: { status: 'ready', firstPage: 1 } },
    });
    expect(state.financial.expenses.data[0]).toMatchObject({ description: 'Fresh groceries' });
    expect(state.snackbar?.expenseId).toBe(state.financial.expenses.data[0].id);
    expect(f.gets(sent).filter((read) => read.startsWith('expenses'))).toEqual([
      'expenses 2026-09 p1',
    ]);
  });
});

describe('Balances follow every read of the Group or its Expense list (M1-5, AMEND-1)', () => {
  it('keeps the Balances the payment sheet read after its own check of the Group, and reads newer ones again on closing it', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId, true, 'balances');
    later(5_000);
    let sent = f.calls.length;
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    // The sheet's reads are its own: the Balances under it don't read while it shows.
    expect(f.gets(sent)).toEqual(['group', 'balances']);
    sent = f.calls.length;
    await controller.back();
    await settle();
    // The same Balances, read after the sheet's check: verified then, and not read again.
    expect(f.gets(sent)).toEqual([]);
    expect(controller.getSnapshot().financial.balances).toMatchObject({
      status: 'ready',
      stale: false,
      refreshedAt: Date.now(),
    });
    // Newer Balances on the sheet: the view reads them again when it closes.
    f.server.owe = 45;
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    sent = f.calls.length;
    await controller.back();
    await settle();
    expect(f.gets(sent)).toEqual(['balances']);
    expect(controller.getSnapshot().financial.balances).toMatchObject({
      status: 'ready',
      stale: false,
      data: [{ debts: [{ amount: 45 }] }],
    });
  });
});

describe('saved copies on the persister (#219, M3-1)', () => {
  it('saves the Group, each Month’s pages and Balances one row per query, in the wire JSON, with each page’s time', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    const first = Date.now();
    later(1_000);
    await controller.loadMoreExpenses();
    await settle();
    expect(f.savedRows(maplePath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: maplePath, value: { status: 200, data: maple } }),
        expect.objectContaining({ path: balancesPath }),
      ]),
    );
    // A Month's list is saved page by page, each page with its own time.
    expect(f.savedRows(`${maplePath}/expenses?`)).toEqual([
      expect.objectContaining({
        path:
          septemberPath(1) +
          `&dateFrom=${encodeURIComponent(getLocalMonthIsoRange('2026-09').dateFrom)}&dateTo=${encodeURIComponent(getLocalMonthIsoRange('2026-09').dateTo)}`,
        refreshedAt: first,
      }),
      expect.objectContaining({ refreshedAt: first + 1_000 }),
    ]);
    expect(JSON.stringify(f.savedRows(`${maplePath}/expenses?`)[1].value)).toContain(
      '2026-09 expense 21',
    );
    // The older single-document store keeps none of this Group's view.
    expect([...f.disk.keys()].filter((key) => key.includes(maplePath))).toEqual([]);
  });

  it('shows them after an offline restart with their original times, never as fresh, and reads them again on reconnect', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    const savedAt = Date.now();
    await first.openGroup(mapleId);
    await settle();
    first.dispose();
    later(5_000);
    f.server.offline = true;
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(mapleId);
    expect(restarted.getSnapshot()).toMatchObject({
      offline: { active: true, refreshedAt: savedAt },
      detail: { status: 'ready', refreshedAt: savedAt, data: { name: 'Maple House' } },
      financial: {
        month: '2026-09',
        expenses: { status: 'ready', refreshedAt: savedAt },
        balances: { status: 'ready', refreshedAt: savedAt },
      },
    });
    expect(listed(restarted.getSnapshot())).toEqual(septemberRows(1, 20));
    const sent = f.calls.length;
    f.connect(true);
    await settle();
    expect(f.gets(sent)).toEqual(
      expect.arrayContaining(['group', 'expenses 2026-09 p1', 'balances']),
    );
    expect(restarted.getSnapshot()).toMatchObject({
      offline: { active: false },
      financial: { expenses: { refreshedAt: Date.now() }, balances: { refreshedAt: Date.now() } },
    });
  });
});

describe('after a write (M2-2)', () => {
  /** Alex has read September and August of Maple House, and has an Expense ready to save. */
  async function readyToSave(f: ReturnType<typeof fixture>) {
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await controller.selectMonth('2026-08');
    await controller.selectMonth('2026-09');
    await settle();
    expect(f.savedRows(`${maplePath}/expenses?`)).toHaveLength(2);
    await controller.openExpense(mapleId);
    await controller.updateExpenseDraft({ description: 'Fresh groceries', amount: '12', tagId });
    return controller;
  }

  it.each(['confirmed', 'unconfirmed'] as const)(
    'after a %s save, the Group view reads again and another Month’s rows and saved copy are gone',
    async (outcome) => {
      const f = fixture();
      const controller = await readyToSave(f);
      const write = f.hold(`${maplePath}/expenses`, { lost: outcome === 'unconfirmed' });
      const saving = controller.saveExpense();
      await write.reached;
      write.release();
      await saving;
      if (outcome === 'unconfirmed') {
        expect(controller.getSnapshot().expense.status).toBe('uncertain');
        await controller.back();
      }
      await settle();
      expect(controller.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated' },
        screen: 'group',
        financial: {
          month: '2026-09',
          expenses: { status: 'ready' },
          balances: { status: 'ready' },
        },
      });
      expect(listed(controller.getSnapshot())[0]).toBe('Fresh groceries');
      // August's saved copy went with the write; it's read again only when shown.
      expect(
        f.savedRows(`${maplePath}/expenses?`).filter(({ path }) => monthOf(path) === '2026-08'),
      ).toEqual([]);
      const sent = f.calls.length;
      await controller.selectMonth('2026-08');
      expect(f.gets(sent)).toContain('expenses 2026-08 p1');
    },
  );

  it('never shows a saved copy it could not remove after a write, and keeps the member signed in', async () => {
    const f = fixture();
    const controller = await readyToSave(f);
    f.device.failRemoval = true;
    await controller.saveExpense();
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      expense: { status: 'saved' },
    });
    // August's copy from before the save is still on this device, but never stands in for a read.
    f.server.offline = true;
    await controller.selectMonth('2026-08');
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated' },
      financial: {
        month: '2026-08',
        expenses: {
          status: 'error',
          message: 'This view was not saved on this device. Connect to load it.',
        },
      },
    });
  });
});

describe('sessions and access for this view (#173 gates)', () => {
  it('shows nothing of the previous account after a switch, with a read in flight and a row being written', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const writing = f.holdWrite(balancesPath);
    const reading = f.hold(septemberPath(2));
    await controller.openGroup(mapleId);
    const more = controller.loadMoreExpenses();
    await Promise.all([writing.reached, reading.reached]);
    const switching = controller.signIn('sam');
    await settle();
    writing.release();
    reading.release();
    await Promise.all([switching, more]);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { user: { id: sam.id } },
      detail: { id: null, data: null },
      financial: { groupId: null, expenses: { data: [] }, balances: { data: null } },
    });
    expect([...f.rows.keys()].some((key) => key.startsWith(alex.id))).toBe(false);
  });

  it('removes a lost Group’s view from memory and this device, and a late answer brings none of it back', async () => {
    const f = fixture();
    const controller = await withPages(f, 2);
    await settle();
    expect(f.savedRows(maplePath).length).toBeGreaterThan(0);
    later(31_000);
    const late = f.hold(septemberPath(2));
    const refreshing = controller.refresh('pull');
    await late.reached;
    // Access is lost while page 2 is on its way: the next read is refused.
    f.server.revoked.add(mapleId);
    await controller.refreshBalances();
    late.release();
    await refreshing;
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      detail: { status: 'denied', data: null },
      financial: { groupId: null, expenses: { data: [] }, balances: { data: null } },
    });
    expect(controller.getSnapshot().groups.data.map(({ id }) => id)).not.toContain(mapleId);
    expect(f.savedRows(maplePath)).toEqual([]);
  });

  it('never shows or saves an answer that arrives after sign-out', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const late = f.hold(septemberPath(1));
    const opening = controller.openGroup(mapleId);
    await late.reached;
    await controller.signOut();
    late.release();
    await opening;
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'signed-out' },
      financial: { expenses: { data: [] } },
    });
    expect(f.rows.size).toBe(0);
  });

  it('removes a row still being written when its Group is lost, once it lands', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const writing = f.holdWrite(balancesPath);
    await controller.openGroup(mapleId);
    await writing.reached;
    f.server.revoked.add(mapleId);
    await controller.refresh();
    writing.release();
    await settle();
    expect(f.savedRows(maplePath)).toEqual([]);
    expect(controller.getSnapshot().detail).toMatchObject({ status: 'denied', data: null });
  });
});
// The loading-state audit's data-flow items for this view (#219, 2026-10-07), with the owner's
// decided behaviour: a write's success shows when it is confirmed and is never lost; until the
// view's read after it lands, the figures it changed show as updating and Record stays locked;
// when that read fails, the message says so.
describe('a confirmed write in the Group: its message at once, never beside figures shown as current', () => {
  /** The debts Balances show, as amounts. */
  const debts = (state: MobileSnapshot) =>
    (state.financial.balances.data ?? []).flatMap((bucket) =>
      bucket.debts.map(({ amount }) => amount),
    );
  /** The debts Balances offer Record on: none offline, or while a change has them out of date. */
  const recordable = (state: MobileSnapshot) =>
    state.offline.active || state.financial.balances.changed ? [] : debts(state);
  /**
   * The old debt shown as current on the Group's view after the payment (the sheet closed): offered
   * for Record, or not marked as updating.
   */
  const oldDebtAsCurrent = (state: MobileSnapshot) =>
    state.screen === 'group' &&
    debts(state).includes(30) &&
    (recordable(state).includes(30) || !state.financial.balances.stale);
  const failed = ' Balances couldn’t be updated yet — pull to refresh.';

  /** Alex, on Maple House's Balances, opens Record payment for the 30 owed to Sam. */
  async function paying(f: ReturnType<typeof fixture>) {
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId, true, 'balances');
    expect(recordable(controller.getSnapshot())).toEqual([30]);
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    const states: MobileSnapshot[] = [];
    controller.subscribe(() => states.push(controller.getSnapshot()));
    return { controller, states };
  }
  /** Alex has the Expense form open on Maple House, with a new Expense ready to save. */
  async function saving(f: ReturnType<typeof fixture>) {
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await controller.openExpense(mapleId);
    await controller.updateExpenseDraft({
      description: 'Fresh groceries',
      amount: '12',
      tagId,
      date: '2026-09-14',
    });
    const states: MobileSnapshot[] = [];
    controller.subscribe(() => states.push(controller.getSnapshot()));
    return { controller, states };
  }
  /** A saved Expense is highlighted only while its row is in the list. */
  const highlightsMissingRow = (state: MobileSnapshot) =>
    !!state.snackbar?.expenseId &&
    !state.financial.expenses.data.some(({ id }) => id === state.snackbar?.expenseId);

  it('says “Payment recorded” at once, with Balances updating and Record locked until they are read', async () => {
    const f = fixture();
    const { controller, states } = await paying(f);
    // The view's reads after the payment are slow: its Group, which Balances follow, answers late.
    const reread = f.hold(maplePath, { afterWrite: true, exact: true });
    const recording = controller.recordSettlement();
    await reread.reached;
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      snackbar: { message: 'Payment recorded' },
      financial: { balances: { stale: true, changed: true } },
    });
    // The old debt is no longer offered, and Record does nothing.
    expect(recordable(controller.getSnapshot())).toEqual([]);
    const sent = f.calls.length;
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    expect(controller.getSnapshot().screen).toBe('group');
    expect(f.calls.length).toBe(sent);
    reread.release();
    await recording;
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      snackbar: { message: 'Payment recorded' },
      financial: { balances: { status: 'ready', stale: false } },
    });
    expect(controller.getSnapshot().financial.balances.changed).toBeFalsy();
    expect(debts(controller.getSnapshot())).toEqual([]);
    // Over the whole write, no snapshot offered the old debt, or showed it as current.
    const shown = states.filter((state) => state.screen === 'group');
    expect(shown.filter(oldDebtAsCurrent)).toEqual([]);
  });

  it('never loses “Payment recorded” when the member leaves while Balances are read again', async () => {
    const f = fixture();
    const { controller, states } = await paying(f);
    const reread = f.hold(maplePath, { afterWrite: true, exact: true });
    const recording = controller.recordSettlement();
    await reread.reached;
    await settle();
    await controller.back();
    reread.release();
    await recording;
    await settle();
    expect(controller.getSnapshot().screen).toBe('groups');
    expect(
      states.filter((state) => state.snackbar?.message.startsWith('Payment recorded')),
    ).not.toEqual([]);
    expect(states.filter(oldDebtAsCurrent)).toEqual([]);
  });

  it.each([
    ['answers 500', (f: ReturnType<typeof fixture>) => (f.server.failBalances = true)],
    ['is offline', (f: ReturnType<typeof fixture>) => (f.server.offline = true)],
  ])(
    'says Balances couldn’t be updated, and keeps them locked, when their read after a payment %s',
    async (_, fail) => {
      const f = fixture();
      const { controller, states } = await paying(f);
      // The payment is recorded; the reads after it fail.
      const post = f.hold(`${maplePath}/settlements`);
      const recording = controller.recordSettlement();
      await post.reached;
      fail(f);
      post.release();
      await recording;
      await settle();
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'group',
        snackbar: { message: `Payment recorded.${failed}` },
        financial: { balances: { stale: true, changed: true } },
      });
      expect(recordable(controller.getSnapshot())).toEqual([]);
      expect(states.filter(oldDebtAsCurrent)).toEqual([]);
    },
  );

  it('says “Expense saved” at once, with the list being read again, and highlights the row once it is listed', async () => {
    const f = fixture();
    const { controller, states } = await saving(f);
    // The list, read again after the save, is slow to answer.
    const reread = f.hold(septemberPath(1), { afterWrite: true });
    const save = controller.saveExpense();
    await reread.reached;
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'expenses',
      snackbar: { message: 'Expense saved · Fresh groceries' },
      financial: { expenses: { status: 'loading' } },
    });
    expect(controller.getSnapshot().snackbar?.expenseId).toBeUndefined();
    reread.release();
    await save;
    const done = controller.getSnapshot();
    expect(done).toMatchObject({
      snackbar: { message: 'Expense saved · Fresh groceries' },
      financial: { expenses: { status: 'ready' } },
    });
    expect(done.snackbar?.expenseId).toBe(done.financial.expenses.data[0].id);
    expect(listed(done)[0]).toBe('Fresh groceries');
    // While the message showed, the list never looked current without the new row.
    const beside = states.filter(
      (state) =>
        state.snackbar?.message.startsWith('Expense saved') &&
        state.financial.expenses.status === 'ready' &&
        listed(state)[0] !== 'Fresh groceries',
    );
    expect(beside).toEqual([]);
    expect(states.filter(highlightsMissingRow)).toEqual([]);
  });

  it('says the list couldn’t be updated, and highlights no row, when the read after a save is offline', async () => {
    const f = fixture();
    const { controller, states } = await saving(f);
    const post = f.hold(`${maplePath}/expenses`);
    const save = controller.saveExpense();
    await post.reached;
    f.server.offline = true;
    post.release();
    await save;
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: {
        message:
          'Expense saved · Fresh groceries. Expenses couldn’t be updated yet — pull to refresh.',
      },
      financial: { balances: { changed: true } },
    });
    expect(controller.getSnapshot().snackbar?.expenseId).toBeUndefined();
    expect(states.filter(highlightsMissingRow)).toEqual([]);
  });

  it('never shows a Balances copy whose removal failed after a payment, even before the Group answers on a restart', async () => {
    const f = fixture();
    const { controller } = await paying(f);
    // The payment is recorded, its saved copies can't be removed, and the reads after it fail.
    const post = f.hold(`${maplePath}/settlements`);
    const recording = controller.recordSettlement();
    await post.reached;
    f.device.failRemoval = true;
    f.server.offline = true;
    post.release();
    await recording;
    await settle();
    expect(f.savedRows(balancesPath)).not.toEqual([]);
    controller.dispose();
    // The app restarts online, and the Group answers late.
    f.device.failRemoval = false;
    f.server.offline = false;
    const restarted = f.create();
    await restarted.restore();
    const states: MobileSnapshot[] = [];
    restarted.subscribe(() => states.push(restarted.getSnapshot()));
    const group = f.hold(maplePath, { exact: true });
    const opening = restarted.openGroup(mapleId, true, 'balances');
    await group.reached;
    await settle();
    expect(states.filter((state) => debts(state).includes(30))).toEqual([]);
    group.release();
    await opening;
    expect(debts(restarted.getSnapshot())).toEqual([]);
  });
});

// Owner decision 2A (2026-10-07), amending #180's Risk 5: an Expense list the server answers
// proves the member belongs to the Group, so it shows though the Group's own read failed.
describe('a Group read that fails beside Expenses that answer', () => {
  it('shows the Expenses, and Balances after them, with an error on the Group’s details', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    f.server.failGroup = true;
    const sent = f.calls.length;
    await controller.openGroup(mapleId);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: {
        status: 'error',
        id: mapleId,
        message: 'The server could not complete this request. Please try again.',
      },
      financial: {
        month: '2026-09',
        expenses: { status: 'ready' },
        balances: { status: 'ready', data: [{ debts: [{ amount: 30 }] }] },
      },
    });
    expect(listed(controller.getSnapshot())).toEqual(septemberRows(1, 20));
    expect(f.gets(sent)).toEqual(['group', 'expenses 2026-09 p1', 'balances']);
  });

  it('keeps Expenses read from this device’s copy hidden when the Group can’t be read', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    await first.openGroup(mapleId);
    await settle();
    first.dispose();
    // Offline, with no Group copy: the Expenses copy alone proves nothing.
    f.server.offline = true;
    f.rows.delete(alex.id + maplePath);
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(mapleId);
    expect(restarted.getSnapshot().financial.expenses.data).toEqual([]);
  });
});

describe('opening and refreshing a Group read independent things together', () => {
  // Every GET answers `delay` ms after it's sent, on vitest's fake clock, as on a slow network.
  const delay = 1_000;
  /**
   * Runs `step` with the delay on, moving the clock 100 ms at a time until it ends. Returns how
   * long it took and when each GET was sent, in ms from its start.
   */
  async function timed(f: ReturnType<typeof fixture>, step: () => Promise<unknown>) {
    const began = Date.now(),
      from = f.calls.length;
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(began);
    f.server.delay = delay;
    let done = false;
    const running = step().finally(() => {
      done = true;
    });
    while (!done) await vi.advanceTimersByTimeAsync(100);
    await running;
    const ended = Date.now();
    f.server.delay = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ended);
    const labels = f.gets(from);
    return {
      took: ended - began,
      sent: f.calls
        .slice(from)
        .filter((call) => call.method === 'GET')
        .map((call, index) => `${labels[index]} at ${call.at - began}`),
    };
  }

  it('reads the Group and the Month’s Expenses together, then Balances after both', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const opened = await timed(f, () => controller.openGroup(mapleId));
    // Balances follow both: the Group's read and the Expense read can each add due recurring
    // Expenses (M1-5, AMEND-1).
    const together = {
      took: 2 * delay,
      sent: ['group at 0', 'expenses 2026-09 p1 at 0', 'balances at 1000'],
    };
    expect(opened).toEqual(together);
    expect(controller.getSnapshot()).toMatchObject({
      detail: { status: 'ready' },
      financial: {
        expenses: { status: 'ready' },
        balances: { status: 'ready' },
      },
    });
    expect(await timed(f, () => controller.refresh('pull'))).toEqual(together);
  });

  it('never shows or keeps Expenses read beside a Group that then refuses the member', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const states: MobileSnapshot[] = [];
    controller.subscribe(() => states.push(controller.getSnapshot()));
    // Alex has left Maple House: its Group no longer lists Alex, and answers late, after the
    // Month's Expenses, read beside it, have answered.
    f.server.left.add(mapleId);
    const group = f.hold(maplePath, { exact: true });
    const opening = controller.openGroup(mapleId);
    await group.reached;
    await settle();
    group.release();
    await opening;
    await settle();
    expect(controller.getSnapshot().detail).toMatchObject({
      status: 'denied',
      data: null,
    });
    expect(states.filter((state) => state.financial.expenses.data.length > 0)).toEqual([]);
    expect(f.savedRows(maplePath)).toEqual([]);
  });
});
