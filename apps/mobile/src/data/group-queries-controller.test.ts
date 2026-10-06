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
    offline: false,
    /** A page of September that answers 500 instead. */
    failPage: 0,
    created: 0,
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
  const calls: { method: string; path: string; account: string }[] = [];
  const held: { path: string; arrive: () => void; answer: Promise<void>; lost: boolean }[] = [];
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
    if (path === `/api/groups/${id}`) return json({ status: 200, data: group });
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
    if (path === `/api/groups/${id}/balances`)
      return json({
        status: 200,
        data: {
          byCurrency: [
            {
              currency: 'INR',
              balances: [],
              debts: [{ from: person(alex), to: person(sam), amount: server.owe }],
            },
          ],
        },
      });
    if (path === `/api/groups/${id}/settlements` && method === 'POST') {
      server.owe -= 5;
      return json({ status: 201, data: {} }, 201);
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
          calls.push({ method: init.method ?? 'GET', path, account: signedIn(init).id });
          if (server.offline) throw new TypeError('Network request failed');
          const index = held.findIndex((request) => path.startsWith(request.path));
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
    hold(path: string, { lost = false } = {}) {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const answer = new Promise<void>((resolve) => {
        release = resolve;
      });
      held.push({ path, arrive, answer, lost });
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
