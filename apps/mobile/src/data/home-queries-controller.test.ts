import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { FetchResponse, MobileSnapshot } from './types';

// #217: the Groups list and Home on declarative queries, their saved copies on the new
// persister, the foreground and reconnect through TanStack's focus and online events, and
// Balances and Home following every read of a Group. These checks drive the controller's public
// commands, as the app does, and look only at the requests sent, the snapshot and the records on
// this device. Freshness runs on TanStack's clock, Date.now, which moves with vitest's fake Date.

const alex = {
  id: 'a00000000000000000000001',
  name: 'Alex',
  email: 'alex@example.test',
  image: null,
};
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test', image: null };
const mapleId = 'b00000000000000000000001';
const cabinId = 'b00000000000000000000002';
const expenseId = 'd00000000000000000000001';
const tagId = 'c00000000000000000000001';
const iso = '2026-09-15T06:30:00.000Z';
const start = Date.parse(iso);
const person = (user: typeof alex) => ({ _id: user.id, name: user.name, image: null });
const groupOf = (_id: string, name: string, category: string) => ({
  _id,
  createdBy: alex.id,
  name,
  category,
  defaultCurrency: 'INR',
  members: [alex, sam].map((user) => ({
    user: { ...person(user), email: user.email },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Rent', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
const maple = groupOf(mapleId, 'Maple House', 'trip');
const cabin = groupOf(cabinId, 'Cabin Weekend', 'trip');
const zedId = 'b00000000000000000000003';
const zed = groupOf(zedId, 'Zed Club', 'trip');
const listPath = '/api/groups';
const homePath = '/api/user/balances';
const maplePath = `/api/groups/${mapleId}`;
const json = (body: unknown, status = 200) => Response.json(body, { status });
const rent = {
  _id: expenseId,
  group: mapleId,
  revision: 1,
  description: 'Rent',
  amount: 10,
  amountMinor: 1000,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: person(alex), amount: 10, amountMinor: 1000 }],
  splitBetween: [{ user: person(alex), amount: 10, amountMinor: 1000 }],
  splitMethod: 'equal',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'housing',
  tagId,
  tag: 'Rent',
  notes: '',
  isDeleted: false,
  editHistory: [],
};

/** A fictional backend for Alex and Sam, and device stores that outlive a controller. */
function fixture() {
  const server = {
    /** The Groups the list holds. */
    listed: [maple, cabin],
    /** Groups that refuse Alex and Sam (403), and are left out of the list. */
    revoked: new Set<string>(),
    /** What Alex owes, on Home and in Maple House; Sam owes 50 on Home. */
    owe: 30,
    offline: false,
    /** Every request answers 401: the session has ended on the server. */
    expired: false,
    /** A status Maple House's own GET answers with, instead of the Group. */
    failGroup: 0,
    /** A status Create Group answers with, instead of the new Group. */
    refuseCreate: 0,
    /** Home's figures name the Groups they were worked out over, as SplitBook's server does. */
    groupFigures: true,
    /** A status the Groups list answers with, instead of the list. */
    failList: 0,
  };
  let cookie: string | null = null,
    owner: string | null = null,
    cleanup = false;
  /** The persister's rows, by account and path; and the older saved-copy store's, the same way. */
  const rows = new Map<string, unknown>(),
    disk = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    attempts = new Map<string, unknown>();
  /**
   * What the saved-copy databases can't do: remove copies, save a row, keep listed Groups, or
   * read a row.
   */
  const device = { failRemoval: false, failSave: false, failRetain: false, failLoad: false };
  /** Paths whose next load of a row fails, once. */
  const failOnce = new Set<string>();
  /** Loads, writes and removals of rows held part-way, as on a slow disk, by path. */
  const writes: { path: string; arrive: () => void; released: Promise<void> }[] = [],
    removals: typeof writes = [],
    loads: typeof writes = [];
  /** Waits while the next step of this kind for `path` is held. */
  const pause = async (steps: typeof writes, path: string) => {
    const index = steps.findIndex((step) => step.path === path);
    if (index < 0) return;
    const [step] = steps.splice(index, 1);
    step.arrive();
    await step.released;
  };
  /** Every request sent, answered or not. */
  const calls: { method: string; path: string; account: string }[] = [];
  /** Requests held until released, by path. */
  const held: {
    path: string;
    arrive: () => void;
    answer: Promise<void>;
    lost: boolean;
    late: boolean;
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
  });
  /** Saved copies this device couldn't remove, recorded outside their stores. */
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
    load: async (account: string, key: string) => {
      if (device.failLoad || failOnce.delete(key))
        throw new Error('The device storage can’t be read');
      await pause(loads, key);
      return structuredClone(rows.get(account + key) ?? null);
    },
    save: async (account: string, key: string, value: unknown) => {
      if (device.failSave) throw new Error('The device storage is full');
      await pause(writes, key);
      rows.set(account + key, structuredClone(value));
    },
    remove: async (account: string, key: string) => {
      if (device.failRemoval) throw new Error('The device storage is full');
      await pause(removals, key);
      rows.delete(account + key);
    },
    list: async (account: string) =>
      [...rows]
        .filter(([key]) => key.startsWith(account))
        .map(([key, value]) => ({
          groupId: key.slice(account.length),
          value: structuredClone(value),
        })),
  };
  const readCache = {
    ...records(disk),
    invalidateGroup: async (account: string, id: string) => {
      for (const key of [...disk.keys()])
        if (key.startsWith(`${account}/api/groups/${id}`)) disk.delete(key);
    },
    invalidateLedger: async (account: string, id: string) => {
      if (device.failRemoval) throw new Error('The device storage is full');
      for (const key of [...disk.keys()])
        if (key.startsWith(`${account}/api/groups/${id}/`)) disk.delete(key);
    },
    retainGroups: async (account: string, ids: string[]) => {
      if (device.failRetain) throw new Error('The device storage is full');
      for (const key of [...disk.keys()]) {
        const id = /^\/api\/groups\/([a-f\d]{24})/.exec(key.slice(account.length))?.[1];
        if (key.startsWith(account) && id && !ids.includes(id)) disk.delete(key);
      }
    },
  };
  const signedIn = (init: RequestInit) =>
    String((init.headers as Record<string, string>).Cookie ?? '').includes('sam.') ? sam : alex;
  const listed = () => server.listed.filter(({ _id }) => !server.revoked.has(_id));
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
    if (server.expired) return json({}, 401);
    const user = signedIn(init);
    if (path.endsWith('/get-session'))
      return json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path === listPath && method === 'POST') {
      if (server.refuseCreate) return json({}, server.refuseCreate);
      // Alex creates Zed Club, as its admin; the list holds it from now on.
      server.listed = [...server.listed, zed];
      const admin = zed.members.map((member) => ({ ...member, role: 'admin' }));
      return json({ status: 201, data: { ...zed, members: admin } }, 201);
    }
    if (path === listPath)
      return server.failList ? json({}, server.failList) : json({ status: 200, data: listed() });
    if (path === homePath)
      return json({
        status: 200,
        data: {
          buckets: [{ currency: 'INR', youOwe: user === sam ? 50 : server.owe, youAreOwed: 0 }],
          ...(server.groupFigures
            ? { groups: listed().map(({ _id }) => ({ groupId: _id, balances: [] })) }
            : {}),
        },
      });
    const id = /^\/api\/groups\/([a-f\d]{24})/.exec(path)?.[1];
    const group = [maple, cabin, zed].find(({ _id }) => _id === id);
    if (!id || !group) return json({}, 404);
    if (server.revoked.has(id)) return json({}, 403);
    if (path === `/api/groups/${id}`)
      return id === mapleId && server.failGroup
        ? json({}, server.failGroup)
        : json({ status: 200, data: group });
    if (path.startsWith(`/api/groups/${id}/expenses?`))
      return json({
        status: 200,
        data: {
          expenses: [{ ...rent, group: id }],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          summary: {
            count: 1,
            totalsByCurrency: [{ currency: 'INR', totalAmount: 10 }],
            userOwes: 0,
            userGetsBack: 0,
            byMember: [],
          },
        },
      });
    if (path === `/api/groups/${id}/expenses/${expenseId}`)
      return json({ status: 200, data: { ...rent, group: id } });
    if (path.startsWith(`/api/groups/${id}/activity?`))
      return json({
        status: 200,
        data: { activities: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      });
    if (path === `/api/groups/${id}/expenses` && method === 'POST') {
      server.owe += 1;
      return json({ status: 201, data: { _id: 'd00000000000000000000009', group: id } }, 201);
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
        newSubmissionKey: () => 'home-queries-attempt-0001',
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
          // As NetInfo does, a new listener hears the connection as it is now.
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
        expenseDrafts: {
          ...records(drafts),
          list: async (account) =>
            [...drafts]
              .filter(([key]) => key.startsWith(account))
              .map(([key, value]) => ({
                groupId: key.slice(account.length),
                value: structuredClone(value),
              })),
        },
        settlementAttempts: records(attempts),
        groupCreations: {
          load: async (account) => structuredClone(attempts.get(`creation:${account}`) ?? null),
          save: async (account, value) => {
            attempts.set(`creation:${account}`, structuredClone(value));
          },
          remove: async (account) => {
            attempts.delete(`creation:${account}`);
          },
          clear: async () => undefined,
        },
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
          const index = held.findIndex((request) => path === request.path);
          if (index >= 0) {
            // The server answers as it is when the request arrives, unless it answers `late`, as it
            // is on release; the reply comes on release.
            const [request] = held.splice(index, 1),
              reply = request.late ? null : respond(path, init);
            request.arrive();
            return request.answer.then(() => {
              if (request.lost) throw new TypeError('Network request failed');
              return reply ?? respond(path, init);
            });
          }
          return respond(path, init);
        },
      },
    );
  const identity = { value: null as unknown },
    untrusted = { value: null as unknown };
  const holdRow = (held: typeof writes, path: string) => {
    let arrive!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    held.push({ path, arrive, released });
    return { reached, release };
  };
  return {
    create,
    server,
    device,
    rows,
    disk,
    drafts,
    calls,
    /** The record of saved copies this device couldn't remove, kept outside their stores. */
    untrusted: () => untrusted.value,
    /** GET requests sent for exactly this path since `from`. */
    reads: (path: string, from = 0) =>
      calls.slice(from).filter((call) => call.method === 'GET' && call.path === path).length,
    /**
     * The next request for exactly this path is answered by the server at once, and its reply
     * arrives when released: late, or `lost` on the way, as when the connection drops. A `late`
     * one is answered by the server as it is on release.
     */
    hold(path: string, { lost = false, late = false } = {}) {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const answer = new Promise<void>((resolve) => {
        release = resolve;
      });
      held.push({ path, arrive, answer, lost, late });
      return { reached, release };
    },
    /** The next write of this path's row waits until released. */
    holdWrite: (path: string) => holdRow(writes, path),
    /** The next removal of this path's row waits until released. */
    holdRemoval: (path: string) => holdRow(removals, path),
    /** The next load of this path's row waits until released. */
    holdLoad: (path: string) => holdRow(loads, path),
    /** The next load of this path's row fails, as a read of the device's storage can. */
    failLoadOnce: (path: string) => void failOnce.add(path),
    /** NetInfo reports the device's connection. */
    connect(isConnected: boolean) {
      server.offline = !isConnected;
      connection.forEach((listener) => listener({ isConnected }));
    },
    /** This account's row for `path`, if this device has one. */
    row: (path: string, account = alex.id) =>
      (rows.get(account + path) as { refreshedAt: number; value: unknown } | undefined) ?? null,
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
/** Every snapshot published from now on. */
function record(controller: {
  subscribe(listener: () => void): () => void;
  getSnapshot(): MobileSnapshot;
}) {
  const published: MobileSnapshot[] = [];
  controller.subscribe(() => published.push(controller.getSnapshot()));
  return published;
}
const names = (state: MobileSnapshot) => state.groups.data.map(({ name }) => name);
const owes = (state: MobileSnapshot) => state.home.data?.map(({ youOwe }) => youOwe) ?? null;

describe('the Groups list and Home on the persister (#217, M3-1)', () => {
  it('saves the Groups list and Home as one row each, in the wire JSON, with their verification time', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    expect([...f.rows.keys()].sort()).toEqual([`${alex.id}${listPath}`, `${alex.id}${homePath}`]);
    expect(f.row(listPath)).toEqual({
      version: 1,
      accountId: alex.id,
      path: listPath,
      groupId: null,
      refreshedAt: start,
      value: { status: 200, data: [maple, cabin] },
    });
    expect(f.row(homePath)).toEqual({
      version: 1,
      accountId: alex.id,
      path: homePath,
      groupId: null,
      refreshedAt: start,
      value: {
        status: 200,
        data: {
          buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }],
          groups: [
            { groupId: mapleId, balances: [] },
            { groupId: cabinId, balances: [] },
          ],
        },
      },
    });
    // The older store keeps neither.
    expect(
      [...f.disk.keys()].filter((key) => key.endsWith(listPath) || key.endsWith(homePath)),
    ).toEqual([]);

    // An Expense saved later is no row: no store ever holds a write, or its key.
    await controller.openGroup(mapleId);
    await controller.openExpense(mapleId);
    await controller.updateExpenseDraft({ description: 'Groceries', amount: '12', tagId });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('saved');
    await controller.back();
    await settle();
    // Maple House's own view has its rows too since #219: its Group, its Month's first page of
    // Expenses and its Balances.
    const paths = [...f.rows.keys()].map((key) => key.slice(alex.id.length).split('?')[0]);
    expect(paths.sort()).toEqual(
      [listPath, maplePath, `${maplePath}/balances`, `${maplePath}/expenses`, homePath].sort(),
    );
    expect(JSON.stringify([...f.rows.values()])).not.toContain('home-queries-attempt-0001');
    expect(JSON.stringify([...f.rows.values()])).not.toContain('Groceries');
  });

  it('shows the saved Groups and Home after an offline restart with their original times, never as fresh, and reads them again on reconnect', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    await settle();
    first.dispose();
    // Well inside the 30-second window.
    later(5_000);
    f.connect(false);
    const restarted = f.create();
    await restarted.restore();
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      screen: 'groups',
      groups: { status: 'ready', data: [{ name: 'Maple House' }, { name: 'Cabin Weekend' }] },
      home: { status: 'ready', data: [{ youOwe: 30 }], refreshedAt: start },
      offline: { active: true, refreshedAt: start },
    });

    // Reconnecting reads both again, though they were verified seconds ago: a saved copy is
    // never fresh.
    f.server.owe = 31;
    const sent = f.calls.length;
    f.connect(true);
    await settle();
    expect(f.reads(listPath, sent)).toBe(1);
    expect(f.reads(homePath, sent)).toBe(1);
    expect(f.calls.slice(sent).every((call) => call.method === 'GET')).toBe(true);
    expect(restarted.getSnapshot()).toMatchObject({
      groups: { status: 'ready' },
      home: { status: 'ready', data: [{ youOwe: 31 }], refreshedAt: start + 5_000 },
      offline: { active: false, refreshedAt: null },
    });
  });

  it('reads again on reconnect only the queries Home shows, only past their stale time, and sends no write', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    // Maple House is read too, then left: its queries stay, inactive.
    await controller.openGroup(mapleId);
    await controller.back();
    await settle();

    // Within the window, a reconnect reads nothing.
    let sent = f.calls.length;
    f.connect(false);
    f.connect(true);
    await settle();
    expect(f.calls.slice(sent)).toEqual([]);

    // Past it, only Home's two queries, which Home shows, read again.
    later(31_000);
    sent = f.calls.length;
    f.connect(false);
    f.connect(true);
    await settle();
    expect(f.calls.slice(sent).map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${listPath}`,
      `GET ${homePath}`,
    ]);

    // On a Group, nothing Home shows is active, so a reconnect reads nothing of it; the Group's own
    // view reads again, since #219 (M1-4).
    await controller.openGroup(mapleId);
    later(31_000);
    sent = f.calls.length;
    f.connect(false);
    f.connect(true);
    await settle();
    expect(
      f.calls.slice(sent).map(({ method, path }) => `${method} ${path.split('?')[0]}`),
    ).toEqual([`GET ${maplePath}`, `GET ${maplePath}/expenses`, `GET ${maplePath}/balances`]);
  });

  it('reads nothing on return to the foreground within the window, and after it only what Home shows', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await controller.back();
    let sent = f.calls.length;
    await controller.refresh('foreground');
    expect(f.calls.slice(sent)).toEqual([]);

    later(31_000);
    sent = f.calls.length;
    await controller.refresh('foreground');
    expect(f.calls.slice(sent).map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${listPath}`,
      `GET ${homePath}`,
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      automatic: null,
      groups: { status: 'ready' },
      home: { status: 'ready', refreshedAt: start + 31_000 },
    });
  });

  it('checks the session once on reconnect after an offline restart, then reads Home', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    await settle();
    first.dispose();
    f.connect(false);
    const restarted = f.create();
    await restarted.restore();
    const sent = f.calls.length;
    f.connect(true);
    await settle();
    // Both of Home's reads wait for the same check.
    expect(f.calls.slice(sent).map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /api/auth/get-session',
      `GET ${listPath}`,
      `GET ${homePath}`,
    ]);
  });

  it('still reads again on reconnect once an older controller is disposed', async () => {
    const f = fixture();
    const older = f.create();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    older.dispose();
    later(31_000);
    const sent = f.calls.length;
    f.connect(false);
    f.connect(true);
    await settle();
    expect(f.calls.slice(sent).map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${listPath}`,
      `GET ${homePath}`,
    ]);
  });

  it.each([
    ['Home’s figures', homePath],
    ['the Groups list', listPath],
  ])(
    'counts a saved copy of %s it can’t read as not saved, offline, and keeps the member signed in',
    async (_, path) => {
      const f = fixture();
      const first = f.create();
      await first.signIn('alex');
      await settle();
      first.dispose();
      // The row is whole, but what it holds isn't what SplitBook sends.
      (f.rows.get(alex.id + path) as { value: unknown }).value = { status: 200, data: { a: 1 } };
      f.connect(false);
      const restarted = f.create();
      await restarted.restore();
      await settle();
      // Home's own words for what this phone has no copy of (#332).
      const notSaved = (message: string) => ({ status: 'error', message });
      expect(restarted.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: alex.id } },
        screen: 'groups',
        ...(path === homePath
          ? {
              groups: {
                status: 'ready',
                data: [{ name: 'Maple House' }, { name: 'Cabin Weekend' }],
              },
              home: {
                ...notSaved('Your balances aren’t saved on this phone. Connect to load them.'),
                data: null,
              },
            }
          : {
              groups: {
                ...notSaved('Your Groups aren’t saved on this phone. Connect to load them.'),
                data: [],
              },
              home: { status: 'ready', data: [{ youOwe: 30 }] },
            }),
      });
    },
  );
});

describe('sessions and late answers (#173 gates)', () => {
  it('shows nothing of the previous account after a switch, with a read in flight and a saved copy being written', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    later(31_000);
    // Alex pulls: the list answers and its row is still being written; Home's figures are still
    // on their way.
    const writing = f.holdWrite(listPath);
    const figures = f.hold(homePath);
    const pulling = controller.refresh('pull');
    await Promise.all([writing.reached, figures.reached]);
    const published = record(controller);

    f.server.listed = [cabin];
    const switching = controller.signIn('sam');
    await settle();
    writing.release();
    figures.release();
    await Promise.all([switching, pulling]);
    await settle();

    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: sam.id } },
      groups: { status: 'ready', data: [{ name: 'Cabin Weekend' }] },
    });
    // Once the switch began, nothing of Alex's was shown, and none of it is on this device.
    const switched = published.findIndex((state) => state.auth.user?.id !== alex.id);
    expect(
      published
        .slice(switched)
        .some((state) => names(state).includes('Maple House') || state.auth.user?.id === alex.id),
    ).toBe(false);
    expect([...f.rows.keys()].some((key) => key.startsWith(alex.id))).toBe(false);
    expect([...f.rows.keys()].sort()).toEqual([`${sam.id}${listPath}`, `${sam.id}${homePath}`]);
  });

  it.each([
    ['sign-out', 'signs out'],
    ['an account switch', 'switches'],
    ['a confirmed change', 'changes'],
  ] as const)('never shows or saves Home figures that answer after %s', async (_, what) => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await settle();
    // Home's figures are read again (Retry), and answer late with the figures before the change.
    const late = f.hold(homePath);
    const reading = controller.refreshHome();
    await late.reached;
    const published = record(controller);
    if (what === 'signs out') await controller.signOut();
    if (what === 'switches') await controller.signIn('sam');
    if (what === 'changes') {
      await controller.openExpense(mapleId);
      await controller.updateExpenseDraft({ description: 'Groceries', amount: '12', tagId });
      await controller.saveExpense();
      expect(controller.getSnapshot().expense.status).toBe('saved');
    }
    // The late reply carries what Alex owed before: 30.
    late.release();
    await reading;
    await settle();

    if (what === 'changes') {
      // The figures read after the change are kept, on screen and on this device.
      expect(owes(controller.getSnapshot())).toEqual([31]);
      expect(f.row(homePath)).toMatchObject({ value: { data: { buckets: [{ youOwe: 31 }] } } });
    } else {
      expect(f.row(homePath)).toBeNull();
      expect(
        published.some((state) => owes(state)?.[0] === 30 && state.auth.user?.id !== alex.id),
      ).toBe(false);
    }
    if (what === 'signs out')
      expect(controller.getSnapshot()).toMatchObject({
        auth: { status: 'signed-out' },
        home: { data: null },
      });
  });

  it.each([['sign-out'], ['an account switch']] as const)(
    'never lets a saved copy still being written at %s land',
    async (moment) => {
      const f = fixture();
      const controller = f.create();
      // Alex's list is answered and being written, slowly, when the session ends.
      const writing = f.holdWrite(listPath);
      const signingIn = controller.signIn('alex');
      await writing.reached;
      const ending = moment === 'sign-out' ? controller.signOut() : controller.signIn('sam');
      await settle();
      writing.release();
      await Promise.all([signingIn, ending]);
      await settle();
      expect([...f.rows.keys()].some((key) => key.startsWith(alex.id))).toBe(false);
    },
  );

  it('keeps this account’s saved copies after a 401, and drops one still waiting to be written', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    later(31_000);
    // A pull: the list's row is still being written, and Home's waits behind it. Home's figures
    // are read beside the list (#333), so their answer is held until then.
    f.server.owe = 31;
    const writing = f.holdWrite(listPath);
    const figures = f.hold(homePath);
    const pulling = controller.refresh('pull');
    await writing.reached;
    figures.release();
    await pulling;
    // The session ends on the server: the next read gets a 401.
    f.server.expired = true;
    await controller.refreshHome();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'signed-out' },
      groups: { data: [] },
    });
    writing.release();
    await settle();
    // Nothing is purged, and Home's figures from before the 401 stay as they were saved.
    expect(f.row(listPath)).not.toBeNull();
    expect(f.row(homePath)).toMatchObject({
      refreshedAt: start,
      value: { data: { buckets: [{ youOwe: 30 }] } },
    });

    // Alex signs back in: the saved list shows while it is read again.
    f.server.expired = false;
    const list = f.hold(listPath);
    const signingIn = controller.signIn('alex');
    await list.reached;
    await settle();
    expect(names(controller.getSnapshot())).toEqual(['Maple House', 'Cabin Weekend']);
    list.release();
    await signingIn;
  });
});

describe('losing access and leaving the list (#217)', () => {
  it('takes a lost Group off Home at once while Home shows, clears its figures, and its saved copies are gone', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    // Retry reads Maple House again, which refuses Alex now; Alex goes Home before that answer.
    f.server.revoked.add(mapleId);
    const group = f.hold(maplePath);
    const retrying = controller.refresh();
    await group.reached;
    await controller.back();
    await settle();
    expect(names(controller.getSnapshot())).toEqual(['Maple House', 'Cabin Weekend']);
    expect(f.rows.has(`${alex.id}${maplePath}`)).toBe(true);
    const published = record(controller);
    // Home's two queries are being read again when Maple House refuses Alex.
    const list = f.hold(listPath);
    const figures = f.hold(homePath);
    group.release();
    await Promise.all([list.reached, figures.reached]);
    await settle();
    // At once, on Home: the Group is gone and Home's figures are cleared.
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      groups: { data: [{ name: 'Cabin Weekend' }] },
      home: { data: null },
    });
    expect([...f.disk.keys(), ...f.rows.keys()].some((key) => key.includes(mapleId))).toBe(false);
    expect(f.row(listPath)).toBeNull();
    expect(f.row(homePath)).toBeNull();
    list.release();
    figures.release();
    await retrying;
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      groups: { status: 'ready', data: [{ name: 'Cabin Weekend' }] },
      home: { status: 'ready', data: [{ youOwe: 30 }] },
    });
    expect(published.slice(1).some((state) => names(state).includes('Maple House'))).toBe(false);
    expect(f.row(listPath)).toMatchObject({ value: { data: [{ name: 'Cabin Weekend' }] } });
  });

  it('removes a Group the list leaves out from memory and from both stores', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(cabinId);
    await controller.back();
    await settle();
    expect([...f.disk.keys(), ...f.rows.keys()].some((key) => key.includes(cabinId))).toBe(true);
    // Cabin Weekend leaves the list (the member left it on the web).
    f.server.listed = [maple];
    const sent = f.calls.length;
    await controller.refresh('pull');
    await settle();
    expect(names(controller.getSnapshot())).toEqual(['Maple House']);
    expect([...f.disk.keys(), ...f.rows.keys()].some((key) => key.includes(cabinId))).toBe(false);
    expect(f.row(listPath)).toMatchObject({ value: { data: [{ name: 'Maple House' }] } });
    // Its reads went with it: opening it reads it again, though it was read seconds ago.
    await controller.openGroup(cabinId);
    expect(f.reads(`/api/groups/${cabinId}`, sent)).toBe(1);
  });

  it('changes nothing with a Groups list that answers after a newer one', async () => {
    const f = fixture();
    f.server.listed = [maple, zed];
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    later(31_000);
    // Back in the foreground, the list is read; its answer, Maple House and Zed Club, is late.
    const stale = f.hold(listPath);
    const foregrounding = controller.refresh('foreground');
    await stale.reached;
    // Meanwhile Zed Club refuses Alex, and Alex joins Cabin Weekend: the list read after that
    // holds it, and Alex opens it.
    f.server.revoked.add(zedId);
    f.server.listed = [maple, zed, cabin];
    await controller.openGroup(zedId);
    await controller.back();
    await settle();
    expect(names(controller.getSnapshot())).toEqual(['Maple House', 'Cabin Weekend']);
    await controller.openGroup(cabinId);
    await controller.back();
    await settle();
    const saved = [...f.disk.keys(), ...f.rows.keys()].filter((key) => key.includes(cabinId));
    expect(saved.length).toBeGreaterThan(0);
    const sent = f.calls.length;
    stale.release();
    await foregrounding;
    await settle();
    // The older list is no answer: Cabin Weekend keeps its saved copies and its reads.
    expect(names(controller.getSnapshot())).toEqual(['Maple House', 'Cabin Weekend']);
    expect([...f.disk.keys(), ...f.rows.keys()].filter((key) => key.includes(cabinId))).toEqual(
      saved,
    );
    expect(f.row(listPath)).toMatchObject({
      value: { data: [{ name: 'Maple House' }, { name: 'Cabin Weekend' }] },
    });
    expect(f.row(homePath)).not.toBeNull();
    await controller.openGroup(cabinId);
    expect(f.reads(`/api/groups/${cabinId}`, sent)).toBe(0);
  });

  it('never shows a lost Group’s saved copies it couldn’t remove, after an offline restart too, and removes them once it can', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await settle();
    expect(f.row(listPath)).toMatchObject({ value: { data: [{ name: 'Maple House' }, {}] } });
    // Alex loses Maple House, and this device can't remove its saved copies.
    f.device.failRemoval = true;
    f.server.revoked.add(mapleId);
    await controller.refresh();
    await settle();
    expect(controller.getSnapshot().auth.status).toBe('authenticated');
    expect(names(controller.getSnapshot())).toEqual(['Cabin Weekend']);
    expect(f.row(listPath)).toMatchObject({ value: { data: [{ name: 'Maple House' }, {}] } });
    controller.dispose();

    // The app restarts offline, and still can't remove them: none of it shows.
    f.connect(false);
    let restarted = f.create();
    let published = record(restarted);
    await restarted.restore();
    await settle();
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      groups: { status: 'error', data: [] },
      home: { status: 'error', data: null },
    });
    expect(published.some((state) => names(state).includes('Maple House'))).toBe(false);
    expect(published.some((state) => owes(state) !== null)).toBe(false);
    restarted.dispose();

    // Once it can, the next start removes them before anything reads them.
    f.device.failRemoval = false;
    restarted = f.create();
    published = record(restarted);
    await restarted.restore();
    await settle();
    expect(f.row(listPath)).toBeNull();
    expect(f.row(homePath)).toBeNull();
    expect([...f.disk.keys(), ...f.rows.keys()].some((key) => key.includes(mapleId))).toBe(false);
    expect(published.some((state) => names(state).includes('Maple House'))).toBe(false);
    expect(restarted.getSnapshot().auth.status).toBe('authenticated');
  });
});

describe('a lost Group never returns from the saved Groups list (#323)', () => {
  type Fixture = ReturnType<typeof fixture>;
  type Controller = ReturnType<Fixture['create']>;
  // Home's own words for a list this phone has no copy of (#332).
  const notSaved = 'Your Groups aren’t saved on this phone. Connect to load them.';
  const notSavedHere = 'Could not save this view for offline use. Online data is still available.';
  const withMaple = (state: MobileSnapshot) => names(state).includes('Maple House');
  /** Maple House anywhere: in the list, or its Group, Expenses or Balances. */
  const showsMaple = (state: MobileSnapshot) =>
    withMaple(state) ||
    (state.detail.id === mapleId && state.detail.data !== null) ||
    (state.financial.groupId === mapleId &&
      (state.financial.expenses.data.length > 0 || state.financial.balances.data !== null));
  /** The saved-copy databases become read-only, or writable again. */
  const readOnly = (f: Fixture, on: boolean) =>
    Object.assign(f.device, { failRemoval: on, failSave: on, failRetain: on });

  /** Alex's list and Home are saved here, with Maple House, whose own copies are saved too. */
  async function savedWithMaple(f: Fixture) {
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await controller.back();
    await settle();
    expect(JSON.stringify(f.row(listPath))).toContain('Maple House');
    expect([...f.disk.keys(), ...f.rows.keys()].some((key) => key.includes(mapleId))).toBe(true);
    return controller;
  }
  /** Alex loses Maple House, and the list is read online: it leaves the screen. */
  async function loseMaple(f: Fixture, controller: Controller) {
    later(31_000);
    f.server.revoked.add(mapleId);
    await controller.refresh('pull');
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      groups: { status: 'ready' },
    });
    expect(withMaple(controller.getSnapshot())).toBe(false);
  }
  /** The session ends with a 401, which keeps this device's data; meanwhile Alex loses Maple. */
  async function loseMapleSignedOut(f: Fixture, controller: Controller) {
    later(31_000);
    f.server.expired = true;
    await controller.refreshHome();
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    f.server.expired = false;
    f.server.revoked.add(mapleId);
  }
  /** Force-stop, then a cold start without a connection: every snapshot it publishes. */
  async function restartOffline(f: Fixture, controller: Controller) {
    controller.dispose();
    f.connect(false);
    const restarted = f.create();
    const published = record(restarted);
    await restarted.restore();
    await settle();
    return { restarted, published };
  }

  it.each(['still failing', 'working again'] as const)(
    'never lists a lost Group whose removal failed after an offline restart with storage %s, and withholds Home’s figures',
    async (storage) => {
      const f = fixture();
      const controller = await savedWithMaple(f);
      readOnly(f, true);
      await loseMaple(f, controller);
      expect(controller.getSnapshot().offline.message).toBe(notSavedHere);
      // The older list, with Maple House, is still on this device.
      expect(JSON.stringify(f.row(listPath))).toContain('Maple House');

      readOnly(f, storage === 'still failing');
      const { restarted, published } = await restartOffline(f, controller);
      expect(restarted.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: alex.id } },
        groups: { status: 'error', message: notSaved, data: [] },
        home: { status: 'error', data: null },
      });
      expect(published.some(withMaple)).toBe(false);
      expect(published.some((state) => owes(state) !== null)).toBe(false);
    },
  );

  it('never lists a lost Group from the older saved list when the new list can’t be saved', async () => {
    const f = fixture();
    const controller = await savedWithMaple(f);
    f.device.failSave = true;
    await loseMaple(f, controller);
    expect(controller.getSnapshot().offline.message).toBe(notSavedHere);

    // Offline, in this session and after a restart, the list never falls back to the older one.
    f.connect(false);
    const published = record(controller);
    await controller.refresh('pull');
    await settle();
    const { restarted, published: after } = await restartOffline(f, controller);
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      groups: { status: 'error', message: notSaved, data: [] },
    });
    expect([...published, ...after].some(withMaple)).toBe(false);
  });

  it.each([
    ['its save fails', ['failSave']],
    ['its save and the trim to the listed Groups fail', ['failSave', 'failRetain']],
  ] as const)(
    'keeps the older saved list, with its own time, when a list that lost nothing can’t be saved: %s',
    async (_, failing) => {
      const f = fixture();
      const controller = f.create();
      await controller.signIn('alex');
      await settle();
      later(31_000);
      for (const write of failing) f.device[write] = true;
      f.server.listed = [maple, cabin, zed];
      await controller.refresh('pull');
      await settle();
      expect(controller.getSnapshot()).toMatchObject({
        groups: { status: 'ready', data: [{}, {}, { name: 'Zed Club' }] },
        offline: { message: notSavedHere },
      });

      const { restarted } = await restartOffline(f, controller);
      // Never as current: offline, with the time it was saved.
      expect(restarted.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: alex.id } },
        groups: { status: 'ready', data: [{ name: 'Maple House' }, { name: 'Cabin Weekend' }] },
        offline: { active: true, refreshedAt: start },
      });
    },
  );

  it('deletes the untrusted list row at the next start where storage works, before anything reads it, then clears its record', async () => {
    const f = fixture();
    const controller = await savedWithMaple(f);
    readOnly(f, true);
    await loseMaple(f, controller);
    // A start while storage still fails deletes nothing, and keeps the record.
    const failing = await restartOffline(f, controller);
    expect(JSON.stringify(f.row(listPath))).toContain('Maple House');
    expect(f.untrusted()).toMatchObject({
      accountId: alex.id,
      scopes: { groups: start + 31_000, home: start + 31_000 },
    });

    readOnly(f, false);
    const { restarted, published } = await restartOffline(f, failing.restarted);
    expect(f.row(listPath)).toBeNull();
    expect(f.row(homePath)).toBeNull();
    expect([...f.disk.keys(), ...f.rows.keys()].some((key) => key.includes(mapleId))).toBe(false);
    expect(f.untrusted()).toBeNull();
    expect([...failing.published, ...published].some(withMaple)).toBe(false);

    // Connected again, the list read is saved and shown again offline.
    f.connect(true);
    await settle();
    expect(names(restarted.getSnapshot())).toEqual(['Cabin Weekend']);
    expect(f.row(listPath)).toMatchObject({ value: { data: [{ name: 'Cabin Weekend' }] } });
    expect(f.untrusted()).toBeNull();
  });

  it('never signs the member out for a failed write, and keeps drafts and unconfirmed saves as they were', async () => {
    const f = fixture();
    f.server.listed = [maple, cabin, zed];
    const controller = await savedWithMaple(f);
    const home = async () => {
      while (controller.getSnapshot().screen !== 'groups') await controller.back();
    };
    // A draft in Zed Club, and an Expense in Cabin Weekend whose answer was lost.
    await controller.openGroup(zedId);
    await controller.openExpense(zedId);
    await controller.updateExpenseDraft({ description: 'Club dues', amount: '5', tagId });
    await home();
    await controller.openGroup(cabinId);
    await controller.openExpense(cabinId);
    await controller.updateExpenseDraft({ description: 'Firewood', amount: '12', tagId });
    const lost = f.hold(`/api/groups/${cabinId}/expenses`, { lost: true });
    const saving = controller.saveExpense();
    await lost.reached;
    lost.release();
    await saving;
    expect(controller.getSnapshot().expense.status).toBe('uncertain');
    await home();
    await settle();
    const drafts = structuredClone([...f.drafts]);
    expect(drafts).toHaveLength(2);

    const published = record(controller);
    readOnly(f, true);
    await loseMaple(f, controller);
    const failing = await restartOffline(f, controller);
    readOnly(f, false);
    failing.restarted.dispose();
    f.connect(true);
    const online = f.create();
    const last = record(online);
    await online.restore();
    await settle();

    expect(f.calls.filter((call) => call.path.endsWith('/sign-out'))).toEqual([]);
    expect(
      [...published, ...failing.published, ...last].some(
        (state) => state.auth.status === 'signed-out',
      ),
    ).toBe(false);
    expect([...f.drafts]).toEqual(drafts);
    expect(online.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      groups: { data: [{ name: 'Cabin Weekend' }, { name: 'Zed Club' }] },
      drafts: [
        { groupName: 'Cabin Weekend', description: 'Firewood', unconfirmed: true },
        { groupName: 'Zed Club', description: 'Club dues', unconfirmed: false },
      ],
    });
  });

  it('never writes an older list still waiting when a list loses a Group, though the new list can’t be saved', async () => {
    const f = fixture();
    const controller = await savedWithMaple(f);
    later(31_000);
    // A pull: Home's figures are being written, slowly, and the next pull's list, which still
    // holds Maple House, waits behind them.
    const figures = f.holdWrite(homePath);
    await controller.refresh('pull');
    await figures.reached;
    await controller.refresh('pull');
    // Alex loses Maple House. The list that leaves it out removes the saved list, then Home's
    // figures; while that removal runs, the figures land and the queue moves on.
    f.server.revoked.add(mapleId);
    const removal = f.holdRemoval(homePath);
    const pulling = controller.refresh('pull');
    await removal.reached;
    figures.release();
    await settle();
    f.device.failSave = true;
    removal.release();
    await pulling;
    await settle();
    expect(names(controller.getSnapshot())).toEqual(['Cabin Weekend']);

    const { published } = await restartOffline(f, controller);
    expect(published.some(withMaple)).toBe(false);
    expect(JSON.stringify(f.row(listPath))).not.toContain('Maple House');
  });

  it.each(['still failing', 'working again'] as const)(
    'never shows a Group lost while its list was off screen, once a sign-in’s list beat the saved one, after an offline restart with storage %s',
    async (storage) => {
      const f = fixture();
      const controller = await savedWithMaple(f);
      await loseMapleSignedOut(f, controller);
      readOnly(f, true);
      // Alex signs in again: the list answers before this device has read its saved list.
      const load = f.holdLoad(listPath);
      const signingIn = controller.signIn('alex');
      await load.reached;
      await settle();
      load.release();
      await signingIn;
      await settle();
      expect(controller.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: alex.id } },
        groups: { status: 'ready', data: [{ name: 'Cabin Weekend' }] },
      });

      readOnly(f, storage === 'still failing');
      const { restarted, published } = await restartOffline(f, controller);
      await restarted.openGroup(mapleId);
      await settle();
      // Neither the list nor Maple House, its Expenses or its Balances, from any saved copy.
      expect(published.some(showsMaple)).toBe(false);
      expect(restarted.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: alex.id } },
        detail: { id: mapleId, status: 'error', data: null },
      });
      if (storage === 'working again') {
        expect(f.row(listPath)).toBeNull();
        expect([...f.disk.keys(), ...f.rows.keys()].some((key) => key.includes(mapleId))).toBe(
          false,
        );
        expect(f.untrusted()).toBeNull();
      }
    },
  );

  it('never shows a Group lost while its list was off screen when this device can’t read its saved list then', async () => {
    const f = fixture();
    const controller = await savedWithMaple(f);
    await loseMapleSignedOut(f, controller);
    // Alex signs in again while this device can neither read its saved list nor save the new one.
    Object.assign(f.device, { failLoad: true, failSave: true });
    await controller.signIn('alex');
    await settle();
    expect(names(controller.getSnapshot())).toEqual(['Cabin Weekend']);

    f.device.failLoad = false;
    const { restarted, published } = await restartOffline(f, controller);
    await restarted.openGroup(mapleId);
    await settle();
    expect(published.some(showsMaple)).toBe(false);
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      groups: { status: 'error', message: notSaved, data: [] },
      detail: { id: mapleId, status: 'error', data: null },
    });
  });

  it('never shows a Group lost while its list was off screen when this device can neither read nor remove its saved list then', async () => {
    const f = fixture();
    const controller = await savedWithMaple(f);
    await loseMapleSignedOut(f, controller);
    Object.assign(f.device, { failLoad: true, failRemoval: true, failSave: true });
    await controller.signIn('alex');
    await settle();
    expect(names(controller.getSnapshot())).toEqual(['Cabin Weekend']);

    // Reads work again: a start while removals and saves still fail, then one where they work.
    f.device.failLoad = false;
    const failing = await restartOffline(f, controller);
    Object.assign(f.device, { failRemoval: false, failSave: false });
    const working = await restartOffline(f, failing.restarted);
    expect([...failing.published, ...working.published].some(withMaple)).toBe(false);
    expect(f.row(listPath)).toBeNull();
    expect(f.untrusted()).toBeNull();
  });

  it.each(['before', 'after'] as const)(
    'shows the saved list during a sign-in’s list read only until it answers: this device reads it %s the answer',
    async (order) => {
      const f = fixture();
      const controller = await savedWithMaple(f);
      await loseMapleSignedOut(f, controller);
      const load = f.holdLoad(listPath);
      const answer = f.hold(listPath);
      const signingIn = controller.signIn('alex');
      await Promise.all([load.reached, answer.reached]);
      if (order === 'before') {
        // While the list is still being read, the saved list stands in for it, as on main.
        load.release();
        await settle();
        expect(controller.getSnapshot().groups).toMatchObject({
          status: 'loading',
          data: [{ name: 'Maple House' }, { name: 'Cabin Weekend' }],
        });
        answer.release();
      } else {
        // Once the answer has arrived, the saved list read after it never shows.
        answer.release();
        await settle();
        const published = record(controller);
        load.release();
        await signingIn;
        await settle();
        expect(published.some(withMaple)).toBe(false);
      }
      await signingIn;
      await settle();
      expect(names(controller.getSnapshot())).toEqual(['Cabin Weekend']);
    },
  );

  it('never lists a lost Group from a saved list dated after this device’s clock, once the clock passes it', async () => {
    const f = fixture();
    const controller = await savedWithMaple(f);
    await loseMapleSignedOut(f, controller);
    // The device clock moves back before Alex signs in again, and the new list can't be saved.
    vi.setSystemTime(start - 60_000);
    f.device.failSave = true;
    await controller.signIn('alex');
    await settle();
    expect(names(controller.getSnapshot())).toEqual(['Cabin Weekend']);

    vi.setSystemTime(start + 60_000);
    const { published } = await restartOffline(f, controller);
    expect(published.some(withMaple)).toBe(false);
  });

  // Every combination of the trim's device writes failing: the older store's trim to the listed
  // Groups, a removal of a saved copy, and a save of a row; after a restart with storage still
  // failing or working again.
  const writes = ['failRetain', 'failRemoval', 'failSave'] as const;
  const failures = Array.from({ length: 2 ** writes.length }, (_, mask) =>
    writes.filter((_, bit) => mask & (2 ** bit)),
  );
  it.each(
    failures.flatMap((failing) =>
      (['still failing', 'working again'] as const).map(
        (storage) => [failing.join(' and ') || 'nothing', storage, failing] as const,
      ),
    ),
  )(
    'with %s, a lost Group never shows from a saved copy, offline or after a restart with storage %s',
    async (_, storage, failing) => {
      const f = fixture();
      const controller = await savedWithMaple(f);
      for (const write of failing) f.device[write] = true;
      await loseMaple(f, controller);
      const lostAt = Date.now();
      f.connect(false);
      const published = record(controller);
      await controller.refresh('pull');
      await settle();
      if (storage === 'working again') readOnly(f, false);
      const { restarted, published: after } = await restartOffline(f, controller);

      const shown = [...published, ...after];
      expect(shown.some(withMaple)).toBe(false);
      // Home's figures from before the loss never show either.
      expect(shown.some((state) => state.home.data && state.home.refreshedAt! < lostAt)).toBe(
        false,
      );
      expect(restarted.getSnapshot().auth).toMatchObject({
        status: 'authenticated',
        user: { id: alex.id },
      });
      expect(f.calls.some((call) => call.path.endsWith('/sign-out'))).toBe(false);
      // Once a start could remove copies, no saved copy of Maple House is left: not even the list.
      if (storage === 'working again' || !failing.includes('failRemoval')) {
        expect(JSON.stringify(f.row(listPath))).not.toContain('Maple House');
        expect([...f.disk.keys(), ...f.rows.keys()].some((key) => key.includes(mapleId))).toBe(
          false,
        );
        expect(f.untrusted()).toBeNull();
      }
    },
  );
});

describe('after a write (M2-2)', () => {
  /** Alex has Maple House open with an Expense ready to save, Home's figures saved here. */
  async function readyToSave(f: ReturnType<typeof fixture>) {
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await controller.back();
    await controller.openGroup(mapleId);
    await settle();
    expect(f.row(homePath)).toMatchObject({
      value: { data: { buckets: [{ youOwe: 30 }] } },
    });
    await controller.openExpense(mapleId);
    await controller.updateExpenseDraft({
      description: 'Groceries',
      amount: '12',
      tagId,
    });
    return controller;
  }

  it('removes Home’s figures and their saved copy after a write whose answer was lost, and reads them again when Home shows', async () => {
    const f = fixture();
    const controller = await readyToSave(f);
    // The save reaches the server, but its answer is lost on the way back.
    const lost = f.hold(`/api/groups/${mapleId}/expenses`, { lost: true });
    const saving = controller.saveExpense();
    await lost.reached;
    lost.release();
    await saving;
    expect(controller.getSnapshot().expense.status).toBe('uncertain');
    await settle();
    expect(f.row(homePath)).toBeNull();
    // Home isn't on screen, so nothing read it again: it reads them when it shows.
    const sent = f.calls.length;
    while (controller.getSnapshot().screen !== 'groups') await controller.back();
    expect(f.reads(homePath, sent)).toBe(1);
    expect(controller.getSnapshot().home).toMatchObject({
      status: 'ready',
      data: [{ youOwe: 31 }],
    });
  });

  it('never shows Home figures it could not remove after a write, and keeps the member signed in', async () => {
    const f = fixture();
    const controller = await readyToSave(f);
    f.device.failRemoval = true;
    const lost = f.hold(`/api/groups/${mapleId}/expenses`, { lost: true });
    const saving = controller.saveExpense();
    await lost.reached;
    lost.release();
    await saving;
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      expense: { status: 'uncertain' },
    });
    // The figures from before the save are still on this device, but offline they never stand
    // in for a read again: Home keeps the figures it read, and says it couldn't refresh them and
    // has no copy of them, with no saved time (#332).
    expect(f.row(homePath)).toMatchObject({
      value: { data: { buckets: [{ youOwe: 30 }] } },
    });
    f.server.offline = true;
    while (controller.getSnapshot().screen !== 'groups') await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated' },
      home: {
        status: 'error',
        data: [{ youOwe: 30 }],
        message: 'Couldn’t refresh your balances, and this phone no longer keeps a copy of them.',
        restored: false,
      },
      offline: { active: true, refreshedAt: null },
    });
  });

  it('never holds a confirmed save behind a saved copy being written, and that copy goes once it lands', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await controller.back();
    await settle();
    later(31_000);
    // A pull: Home's figures are read again, and their row is being written, slowly.
    const writing = f.holdWrite(homePath);
    await controller.refresh('pull');
    await writing.reached;
    await controller.openGroup(mapleId);
    await controller.openExpense(mapleId);
    await controller.updateExpenseDraft({ description: 'Groceries', amount: '12', tagId });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('saved');
    expect(f.row(homePath)).toBeNull();
    // The figures from before the save land, and go; those read after it are written next.
    const next = f.holdWrite(homePath);
    writing.release();
    await next.reached;
    expect(f.row(homePath)).toBeNull();
    next.release();
    await settle();
    expect(f.row(homePath)).toMatchObject({ value: { data: { buckets: [{ youOwe: 31 }] } } });
  });
});

describe('Home after Create Group (#283)', () => {
  it('reads the Groups list again once the new Group has opened, and Home’s figures on Back', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Zed Club', category: 'home' });
    let sent = f.calls.length;
    await controller.createGroup();
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', detail: { id: zedId } });
    expect(f.calls.slice(sent).map(({ method, path }) => `${method} ${path}`)).toEqual([
      `POST ${listPath}`,
      `GET /api/groups/${zedId}`,
      `GET /api/groups/${zedId}/expenses?page=1&limit=20&includeMemberBreakdown=1`,
      `GET /api/groups/${zedId}/balances`,
      // The create changed the Groups list: it's read again after the Group's own reads, as
      // after a join, so the saved list holds the new Group (#283).
      `GET ${listPath}`,
    ]);
    // Back reads Home's figures, which the create also made obsolete; the list was just read.
    sent = f.calls.length;
    await controller.back();
    expect(f.calls.slice(sent).map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${homePath}`,
    ]);
    expect(names(controller.getSnapshot())).toEqual(['Maple House', 'Cabin Weekend', 'Zed Club']);
  });

  it('lists a Group created this session after an offline restart, from the saved list with its own time, and opens it from its saved copies', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    await settle();
    // Ten seconds on, Alex creates Zed Club, the server confirms it, and Alex stays on it.
    later(10_000);
    first.startCreate();
    first.updateCreation({ name: 'Zed Club' });
    await first.createGroup();
    expect(first.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', id: zedId },
    });
    await settle();
    // The saved list is the one read after the create, with the time it was verified then.
    expect(f.row(listPath)).toMatchObject({
      refreshedAt: start + 10_000,
      value: { status: 200, data: [{ _id: mapleId }, { _id: cabinId }, { _id: zedId }] },
    });
    first.dispose();

    later(5_000);
    f.connect(false);
    const restarted = f.create();
    const published = record(restarted);
    await restarted.restore();
    // The saved Home shown while the session is checked lists it too.
    const checking = published.find(
      (state) => state.auth.status === 'restoring' && state.auth.user !== null,
    );
    expect(checking && names(checking)).toEqual(['Maple House', 'Cabin Weekend', 'Zed Club']);
    // Offline, Home lists it with the others from the saved list. The list is restored before
    // Home's figures, so Home first shows the list's own saved time alone, offline: not now's.
    const listed = published.find(
      (state) => state.auth.status === 'authenticated' && state.groups.status === 'ready',
    );
    expect(listed).toMatchObject({
      screen: 'groups',
      offline: { active: true, refreshedAt: start + 10_000 },
    });
    expect(listed && names(listed)).toEqual(['Maple House', 'Cabin Weekend', 'Zed Club']);
    // Then Home's time is the older of its two saved copies, its figures' from the sign-in.
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      screen: 'groups',
      groups: { status: 'ready' },
      offline: { active: true, refreshedAt: start },
    });
    expect(names(restarted.getSnapshot())).toEqual(['Maple House', 'Cabin Weekend', 'Zed Club']);

    // It opens from the copies saved when it opened after the create.
    await restarted.openGroup(zedId);
    expect(restarted.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', id: zedId, data: { name: 'Zed Club' } },
      financial: { groupId: zedId, expenses: { data: [{ description: 'Rent' }] } },
      offline: { active: true },
    });

    // The saved list is never current: back on Home and reconnected, it's read again, though it
    // was verified five seconds ago, well inside the 30-second window.
    await restarted.back();
    const sent = f.calls.length;
    f.connect(true);
    await settle();
    expect(f.reads(listPath, sent)).toBe(1);
    expect(restarted.getSnapshot()).toMatchObject({
      screen: 'groups',
      groups: { status: 'ready' },
      offline: { active: false, refreshedAt: null },
    });
    expect(names(restarted.getSnapshot())).toEqual(['Maple House', 'Cabin Weekend', 'Zed Club']);
  });

  it('reads the list once when Alex goes back to Home while the new Group is still being read', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Zed Club' });
    const balances = f.hold(`/api/groups/${zedId}/balances`);
    const sent = f.calls.length;
    const creating = controller.createGroup();
    await balances.reached;
    // Home reads the list the create made obsolete; the create's own read reuses that answer.
    await controller.back();
    balances.release();
    await creating;
    await settle();
    expect(f.reads(listPath, sent)).toBe(1);
    expect(controller.getSnapshot().screen).toBe('groups');
    expect(names(controller.getSnapshot())).toEqual(['Maple House', 'Cabin Weekend', 'Zed Club']);
    expect(f.row(listPath)).toMatchObject({
      value: { data: [{ _id: mapleId }, { _id: cabinId }, { _id: zedId }] },
    });
  });

  it('reads the list from the server when Home’s read during the new Group’s reads answered with the saved copy', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    controller.startCreate();
    controller.updateCreation({ name: 'Zed Club' });
    const balances = f.hold(`/api/groups/${zedId}/balances`);
    const sent = f.calls.length;
    const creating = controller.createGroup();
    await balances.reached;
    // Back on Home, its list read loses its reply: the list saved before the create stands in.
    const lost = f.hold(listPath, { lost: true });
    const back = controller.back();
    await lost.reached;
    lost.release();
    await back;
    expect(controller.getSnapshot()).toMatchObject({ screen: 'groups', offline: { active: true } });
    expect(names(controller.getSnapshot())).toEqual(['Maple House', 'Cabin Weekend']);
    // The create's own list read never keeps a saved copy: it reads the server, which lists it.
    balances.release();
    await creating;
    await settle();
    expect(f.reads(listPath, sent)).toBe(2);
    expect(names(controller.getSnapshot())).toEqual(['Maple House', 'Cabin Weekend', 'Zed Club']);
    expect(f.row(listPath)).toMatchObject({
      value: { data: [{ _id: mapleId }, { _id: cabinId }, { _id: zedId }] },
    });
  });

  it('reads and saves nothing more when the server refuses the create', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    const saved = structuredClone([...f.rows, ...f.disk]);
    f.server.refuseCreate = 422;
    controller.startCreate();
    controller.updateCreation({ name: 'Zed Club' });
    const sent = f.calls.length;
    await controller.createGroup();
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'create',
      creation: { status: 'error', message: 'Check the Group information and try again.' },
    });
    expect(f.calls.slice(sent).map(({ method, path }) => `${method} ${path}`)).toEqual([
      `POST ${listPath}`,
    ]);
    expect([...f.rows, ...f.disk]).toEqual(saved);
  });
});

describe('Balances and Home follow every read of a Group (M1-5, AMEND-1)', () => {
  /**
   * Alex has Maple House open within the window, and an Expense open whose save or delete starts
   * by checking the Group. Home's figures are read just before, so only that check can make them
   * out of date.
   */
  async function onAnExpense(f: ReturnType<typeof fixture>, existing: boolean) {
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await controller.back();
    await controller.openGroup(mapleId);
    await controller.openExpense(mapleId, existing ? expenseId : undefined);
    await controller.refreshHome();
    return controller;
  }
  /** Back to the Group, then Home: whether each read Balances, then Home's figures, again. */
  async function readAgain(
    f: ReturnType<typeof fixture>,
    controller: ReturnType<ReturnType<typeof fixture>['create']>,
  ) {
    f.server.failGroup = 0;
    let sent = f.calls.length;
    while (controller.getSnapshot().screen !== 'group') await controller.back();
    const balances = f.reads(`${maplePath}/balances`, sent);
    sent = f.calls.length;
    await controller.back();
    return { balances, home: f.reads(homePath, sent) };
  }

  it('no longer reuses them after a new Expense’s save checks the Group, whatever it answers', async () => {
    const f = fixture();
    const controller = await onAnExpense(f, false);
    await controller.updateExpenseDraft({
      description: 'Groceries',
      amount: '12',
      tagId,
    });
    f.server.failGroup = 500;
    const sent = f.calls.length;
    await controller.saveExpense();
    // Only the check was sent: the save stopped at its failure.
    expect(f.calls.slice(sent).map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${maplePath}`,
    ]);
    expect(await readAgain(f, controller)).toEqual({ balances: 1, home: 1 });
  });

  it('no longer reuses them after a delete checks the Group, whatever it answers', async () => {
    const f = fixture();
    const controller = await onAnExpense(f, true);
    controller.reviewExpenseDeletion();
    expect(controller.getSnapshot().expense.status).toBe('delete-review');
    f.server.failGroup = 500;
    const sent = f.calls.length;
    await controller.deleteExpense();
    expect(f.calls.slice(sent).map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${maplePath}`,
    ]);
    expect(await readAgain(f, controller)).toEqual({ balances: 1, home: 1 });
  });

  it('no longer reuses them after Record payment checks the Group', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await controller.back();
    // Home's figures are verified 10 s after the Group, and the view shows the Group 20 s after
    // it. Record comes past the window for the Group only, so the sheet reads it (#333).
    later(10_000);
    await controller.refreshHome();
    later(10_000);
    await controller.openGroup(mapleId, true, 'balances');
    later(11_000);
    let sent = f.calls.length;
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    expect(f.calls.slice(sent).map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${maplePath}`,
      `GET ${maplePath}/balances`,
    ]);
    // The Group's Balances are not read again: the sheet read them after its check of the
    // Group, and they stand verified as the view's (#219).
    sent = f.calls.length;
    await controller.closeSettlement();
    expect(f.reads(`${maplePath}/balances`, sent)).toBe(0);
    // Within the window, Home's figures are read again.
    sent = f.calls.length;
    await controller.back();
    expect(f.reads(homePath, sent)).toBe(1);
  });
});

describe('Home reads its Groups and its figures together (#333)', () => {
  /** What Home says when this phone keeps no copy of its figures (#332). */
  const balancesNotOnPhone = 'Your balances aren’t saved on this phone. Connect to load them.';
  /** Requests sent since `from`, as `METHOD /path`. */
  const sentSince = (f: ReturnType<typeof fixture>, from: number) =>
    f.calls.slice(from).map(({ method, path }) => `${method} ${path}`);

  it.each(['sign-in', 'start-up'] as const)(
    'sends the list and the figures together at %s, once each, and says “Saved” only of a saved copy',
    async (when) => {
      const f = fixture();
      f.server.groupFigures = true;
      let controller = f.create();
      if (when === 'start-up') {
        await controller.signIn('alex');
        await settle();
        controller.dispose();
        later(60_000);
        controller = f.create();
      }
      const sent = f.calls.length;
      const list = f.hold(listPath),
        figures = f.hold(homePath);
      const opening = when === 'sign-in' ? controller.signIn('alex') : controller.restore();
      await list.reached;
      await settle();
      // Both are on their way before either answers.
      expect(f.reads(listPath, sent)).toBe(1);
      expect(f.reads(homePath, sent)).toBe(1);
      expect(controller.getSnapshot()).toMatchObject(
        when === 'sign-in'
          ? { groups: { status: 'loading', data: [] }, home: { data: null } }
          : {
              groups: { status: 'loading', restored: true, data: [{}, {}] },
              home: { status: 'loading', restored: true, refreshedAt: start },
            },
      );

      if (when === 'start-up') {
        // The figures answer first: they are verified now, while the saved list is read again.
        figures.release();
        await settle();
        expect(controller.getSnapshot()).toMatchObject({
          groups: { status: 'loading', restored: true },
          home: { status: 'ready', restored: false, refreshedAt: Date.now() },
        });
        list.release();
      } else {
        // The session's first list answers first, while the figures are still read: they stand.
        list.release();
        await settle();
        expect(controller.getSnapshot()).toMatchObject({
          groups: { status: 'ready', restored: false },
          home: { status: 'loading', data: null },
        });
        figures.release();
      }
      await opening;
      await settle();
      expect(controller.getSnapshot()).toMatchObject({
        groups: { status: 'ready', restored: false, data: [{}, { name: 'Cabin Weekend' }] },
        home: { status: 'ready', restored: false, data: [{ youOwe: 30 }] },
      });
      // Figures that name only listed Groups stand: nothing is read twice.
      expect(f.reads(listPath, sent)).toBe(1);
      expect(f.reads(homePath, sent)).toBe(1);
      expect(f.row(listPath)).toMatchObject({ refreshedAt: Date.now() });
      expect(f.row(homePath)).toMatchObject({ refreshedAt: Date.now() });
    },
  );

  it('reads the list beside the figures on Retry over a saved list after an offline start, and clears offline once both answer', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    await settle();
    first.dispose();
    // This phone keeps the list, but not Home's figures.
    f.rows.delete(alex.id + homePath);
    f.connect(false);
    const controller = f.create();
    await controller.restore();
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      groups: { restored: true, data: [{}, {}] },
      home: { status: 'error', data: null, message: balancesNotOnPhone },
      offline: { active: true },
    });
    // SplitBook can be reached again, with no reconnect event, as when a proxy comes back.
    f.server.offline = false;
    const sent = f.calls.length;
    await controller.refreshHome();
    await settle();
    expect(sentSince(f, sent)).toEqual([
      'GET /api/auth/get-session',
      `GET ${listPath}`,
      `GET ${homePath}`,
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      groups: { status: 'ready', restored: false, data: [{}, {}] },
      home: { status: 'ready', restored: false, message: null, data: [{ youOwe: 30 }] },
      offline: { active: false },
    });
  });

  it('reads this phone’s saved figures beside its saved list when a list lands, so the check adds no wait before the list shows', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    later(31_000);
    const savedList = f.holdLoad(listPath),
      savedFigures = f.holdLoad(homePath);
    let both = false;
    void Promise.all([savedList.reached, savedFigures.reached]).then(() => (both = true));
    const pulling = controller.refresh('pull');
    await savedList.reached;
    await settle();
    // Both rows are being read before either answers.
    expect(both).toBe(true);
    savedList.release();
    savedFigures.release();
    await pulling;
    expect(controller.getSnapshot().groups).toMatchObject({ status: 'ready' });
  });

  it('reads the list beside the figures on Retry when the list’s last read failed', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    later(31_000);
    // A pull: the list answers with a server error, the figures with a failure of their own.
    f.server.failList = 500;
    f.server.expired = false;
    const figures = f.hold(homePath, { lost: true });
    const pulling = controller.refresh('pull');
    await figures.reached;
    figures.release();
    await pulling;
    await settle();
    expect(controller.getSnapshot().groups).toMatchObject({ status: 'error', data: [{}, {}] });
    f.server.failList = 0;
    const sent = f.calls.length;
    await controller.refreshHome();
    await settle();
    expect(sentSince(f, sent).filter((call) => !call.includes('get-session'))).toEqual([
      `GET ${listPath}`,
      `GET ${homePath}`,
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      groups: { status: 'ready', message: null, data: [{}, {}] },
      home: { status: 'ready', message: null, data: [{ youOwe: 30 }] },
      offline: { active: false },
    });
  });

  it('sends the list and the figures together on a pull, and Retry on the figures reads only them', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    later(31_000);
    let sent = f.calls.length;
    const list = f.hold(listPath),
      figures = f.hold(homePath);
    const pulling = controller.refresh('pull');
    await list.reached;
    await settle();
    expect(sentSince(f, sent)).toEqual([`GET ${listPath}`, `GET ${homePath}`]);
    list.release();
    figures.release();
    await pulling;
    expect(sentSince(f, sent)).toEqual([`GET ${listPath}`, `GET ${homePath}`]);
    expect(controller.getSnapshot()).toMatchObject({
      groups: { status: 'ready' },
      home: { status: 'ready', refreshedAt: start + 31_000 },
    });

    sent = f.calls.length;
    await controller.refreshHome();
    expect(sentSince(f, sent)).toEqual([`GET ${homePath}`]);
  });

  it.each(['before', 'after'] as const)(
    'reads the figures again, once, when they name a Group the list beside them leaves out, landing %s it',
    async (order) => {
      const f = fixture();
      f.server.groupFigures = true;
      const controller = f.create();
      const published = record(controller);
      // The figures are worked out while Alex is still in Maple House, the list once Alex has
      // lost it.
      const list = f.hold(listPath, { late: true }),
        figures = f.hold(homePath);
      const signingIn = controller.signIn('alex');
      await list.reached;
      await settle();
      expect(f.reads(homePath)).toBe(1);
      await figures.reached;
      f.server.revoked.add(mapleId);
      f.server.owe = 20;
      if (order === 'before') {
        figures.release();
        await settle();
        list.release();
      } else {
        list.release();
        await settle();
        figures.release();
      }
      await signingIn;
      await settle();
      expect(f.reads(listPath)).toBe(1);
      expect(f.reads(homePath)).toBe(2);
      expect(controller.getSnapshot()).toMatchObject({
        groups: { status: 'ready', data: [{ name: 'Cabin Weekend' }] },
        home: { status: 'ready', data: [{ youOwe: 20 }] },
      });
      // Figures that cover the lost Group never stand beside the list that left it out.
      expect(
        published.some(
          (state) =>
            state.groups.status === 'ready' &&
            state.home.status === 'ready' &&
            owes(state)?.[0] !== 20,
        ),
      ).toBe(false);
      expect(f.row(homePath)).toMatchObject({ value: { data: { buckets: [{ youOwe: 20 }] } } });
    },
  );

  it('removes figures that cover a lost Group from this phone too, so a lost read again or an offline start never shows them', async () => {
    const f = fixture();
    const controller = f.create();
    const published = record(controller);
    // The figures are worked out while Alex is still in Maple House, the list once Alex has
    // lost it.
    const list = f.hold(listPath, { late: true }),
      figures = f.hold(homePath);
    const signingIn = controller.signIn('alex');
    await list.reached;
    await figures.reached;
    f.server.revoked.add(mapleId);
    // The figures land first, and are saved here.
    figures.release();
    await settle();
    expect(f.row(homePath)).toMatchObject({ value: { data: { buckets: [{ youOwe: 30 }] } } });
    // The list leaves Maple House out; the figures' read again never answers.
    const again = f.hold(homePath, { lost: true });
    const landed = published.length;
    list.release();
    await again.reached;
    again.release();
    await signingIn;
    await settle();
    expect(f.reads(homePath)).toBe(2);
    expect(f.row(homePath)).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      groups: { status: 'ready', data: [{ name: 'Cabin Weekend' }] },
      home: { status: 'error', data: null, restored: false },
    });
    expect(published.slice(landed).some((state) => owes(state) !== null)).toBe(false);

    // Started again offline, Home shows the list it saved, and no figures from before.
    controller.dispose();
    f.connect(false);
    const restarted = f.create();
    const after = record(restarted);
    await restarted.restore();
    await settle();
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      groups: { data: [{ name: 'Cabin Weekend' }] },
      home: { data: null },
    });
    expect(after.some((state) => owes(state) !== null)).toBe(false);
  });

  it('removes figures that cover a lost Group whose row was still being written when the list landed', async () => {
    const f = fixture();
    const controller = f.create();
    const list = f.hold(listPath, { late: true }),
      figures = f.hold(homePath);
    const signingIn = controller.signIn('alex');
    await list.reached;
    await figures.reached;
    f.server.revoked.add(mapleId);
    // The figures, worked out while Alex was in Maple House, land first; their row is still
    // being written when the list lands without Maple House.
    const writing = f.holdWrite(homePath);
    figures.release();
    await writing.reached;
    const again = f.hold(homePath, { lost: true });
    list.release();
    await again.reached;
    // The list has landed, and checked this phone's saved figures, before the row is written.
    await vi.waitFor(() => expect(controller.getSnapshot().groups.status).toBe('ready'));
    await settle();
    expect(f.row(homePath)).toBeNull();
    writing.release();
    again.release();
    await signingIn;
    await settle();
    expect(f.row(homePath)).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      groups: { status: 'ready', data: [{ name: 'Cabin Weekend' }] },
      home: { status: 'error', data: null, message: balancesNotOnPhone },
    });

    controller.dispose();
    f.connect(false);
    const restarted = f.create();
    const after = record(restarted);
    await restarted.restore();
    await settle();
    expect(restarted.getSnapshot()).toMatchObject({
      groups: { data: [{ name: 'Cabin Weekend' }] },
      home: { status: 'error', data: null, message: balancesNotOnPhone },
      offline: { active: true },
    });
    expect(after.some((state) => owes(state) !== null)).toBe(false);
  });

  it.each(['still failing', 'working again'] as const)(
    'never shows figures that cover a lost Group when this phone can’t remove them, after an offline restart with storage %s',
    async (storage) => {
      const f = fixture();
      const controller = f.create();
      const list = f.hold(listPath, { late: true }),
        figures = f.hold(homePath);
      const signingIn = controller.signIn('alex');
      await list.reached;
      await figures.reached;
      f.server.revoked.add(mapleId);
      // The figures, worked out while Alex was in Maple House, land first and are saved here.
      figures.release();
      await settle();
      expect(f.row(homePath)).toMatchObject({ value: { data: { buckets: [{ youOwe: 30 }] } } });
      // The list leaves Maple House out; this phone can't remove the figures' row, and their
      // read again never answers.
      later(1_000);
      f.device.failRemoval = true;
      const again = f.hold(homePath, { lost: true });
      list.release();
      await again.reached;
      again.release();
      await signingIn;
      await settle();
      expect(f.row(homePath)).toMatchObject({ value: { data: { buckets: [{ youOwe: 30 }] } } });
      expect(controller.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: alex.id } },
        home: { data: null },
      });

      controller.dispose();
      if (storage === 'working again') f.device.failRemoval = false;
      f.connect(false);
      const restarted = f.create();
      const after = record(restarted);
      await restarted.restore();
      await settle();
      expect(restarted.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: alex.id } },
        groups: { data: [{ name: 'Cabin Weekend' }] },
        home: { data: null },
      });
      expect(after.some((state) => owes(state) !== null)).toBe(false);
      // Once this phone can, the row goes before anything reads it.
      if (storage === 'working again') expect(f.row(homePath)).toBeNull();
    },
  );

  it.each(['no saved list', 'a saved list that never named Maple House'] as const)(
    'never brings back saved figures that name a Group the list leaves out, when their read fails, after a sign-in with %s and an offline restart',
    async (saved) => {
      const f = fixture();
      const first = f.create();
      await first.signIn('alex');
      await settle();
      first.dispose();
      later(60_000);
      // This phone's saved figures name Maple House; its saved list doesn't, or there is none.
      if (saved === 'no saved list') f.rows.delete(alex.id + listPath);
      else (f.rows.get(alex.id + listPath) as { value: { data: unknown[] } }).value.data = [cabin];
      expect(f.row(homePath)).toMatchObject({
        value: { data: { groups: [{ groupId: mapleId }, {}] } },
      });
      // Alex has lost Maple House.
      f.server.revoked.add(mapleId);
      const controller = f.create();
      const published = record(controller);
      const list = f.hold(listPath),
        figures = f.hold(homePath, { lost: true });
      const signingIn = controller.signIn('alex');
      await list.reached;
      await figures.reached;
      // The list lands without Maple House; then the figures' reply is lost.
      const landed = published.length;
      list.release();
      await settle();
      figures.release();
      await signingIn;
      await settle();
      // Home says it has no balances to show, offline, and offers Retry (its error state).
      expect(controller.getSnapshot()).toMatchObject({
        groups: { status: 'ready', data: [{ name: 'Cabin Weekend' }] },
        home: { status: 'error', data: null, message: balancesNotOnPhone },
        offline: { active: true },
      });
      expect(f.row(listPath)).toMatchObject({ value: { data: [{ name: 'Cabin Weekend' }] } });
      expect(published.slice(landed).some((state) => owes(state) !== null)).toBe(false);

      // Started again offline: the saved list, and no figures from before.
      controller.dispose();
      f.connect(false);
      const restarted = f.create();
      const after = record(restarted);
      await restarted.restore();
      await settle();
      expect(restarted.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: alex.id } },
        groups: { data: [{ name: 'Cabin Weekend' }] },
        home: { status: 'error', data: null, message: balancesNotOnPhone },
        offline: { active: true },
      });
      expect(after.some((state) => owes(state) !== null)).toBe(false);
    },
  );

  it.each([
    ['the Home row can’t be read while the list is checked', 'unreadable'],
    ['the saved figures don’t say which Groups they cover', 'unnamed'],
  ] as const)(
    'never brings back saved figures that may cover a Group the list leaves out when %s, after a lost read and an offline restart',
    async (_, how) => {
      const f = fixture();
      if (how === 'unnamed') f.server.groupFigures = false;
      const first = f.create();
      await first.signIn('alex');
      await settle();
      first.dispose();
      later(60_000);
      f.server.groupFigures = true;
      // This phone's saved list never named Maple House; its saved figures cover it.
      (f.rows.get(alex.id + listPath) as { value: { data: unknown[] } }).value.data = [cabin];
      f.server.revoked.add(mapleId);
      const controller = f.create();
      const published = record(controller);
      const list = f.hold(listPath),
        figures = f.hold(homePath, { lost: true });
      // Unnamed: their restore is slow, and lands once the list has.
      const restoring = how === 'unnamed' ? f.holdLoad(homePath) : null;
      const signingIn = controller.signIn('alex');
      await list.reached;
      await figures.reached;
      if (restoring) await restoring.reached;
      else await settle();
      // Unreadable: the list's check of the saved figures can't read them.
      if (how === 'unreadable') f.failLoadOnce(homePath);
      const landed = published.length;
      list.release();
      await settle();
      restoring?.release();
      await settle();
      figures.release();
      await signingIn;
      await settle();
      expect(controller.getSnapshot()).toMatchObject({
        groups: { status: 'ready', data: [{ name: 'Cabin Weekend' }] },
        home: { status: 'error', data: null, message: balancesNotOnPhone },
        offline: { active: true },
      });
      expect(published.slice(landed).some((state) => owes(state) !== null)).toBe(false);
      expect(f.row(homePath)).toBeNull();

      controller.dispose();
      f.connect(false);
      const restarted = f.create();
      const after = record(restarted);
      await restarted.restore();
      await settle();
      expect(restarted.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: alex.id } },
        groups: { data: [{ name: 'Cabin Weekend' }] },
        home: { status: 'error', data: null, message: balancesNotOnPhone },
        offline: { active: true },
      });
      expect(after.some((state) => owes(state) !== null)).toBe(false);
    },
  );

  it.each([
    'no saved list',
    'a saved list that never named Maple House',
    'saved figures that don’t say which Groups they cover',
  ] as const)(
    'reads Home’s figures again when the list leaves out a Group the saved copy they fell back to may cover, with %s',
    async (saved) => {
      const f = fixture();
      if (saved === 'saved figures that don’t say which Groups they cover')
        f.server.groupFigures = false;
      const first = f.create();
      await first.signIn('alex');
      await settle();
      first.dispose();
      later(60_000);
      f.server.groupFigures = true;
      if (saved !== 'a saved list that never named Maple House') f.rows.delete(alex.id + listPath);
      else (f.rows.get(alex.id + listPath) as { value: { data: unknown[] } }).value.data = [cabin];
      f.server.revoked.add(mapleId);
      f.server.owe = 20;
      const controller = f.create();
      const published = record(controller);
      const sent = f.calls.length;
      const list = f.hold(listPath),
        figures = f.hold(homePath, { lost: true });
      const signingIn = controller.signIn('alex');
      await list.reached;
      await figures.reached;
      await settle();
      // The figures' reply is lost first: Home shows this phone's copy, saved, offline.
      figures.release();
      await settle();
      expect(controller.getSnapshot()).toMatchObject({
        home: { status: 'ready', restored: true, data: [{ youOwe: 30 }] },
        offline: { active: true },
      });
      // The list lands without Maple House: Home reads its figures again, from SplitBook.
      const landed = published.length;
      list.release();
      await signingIn;
      await settle();
      expect(f.reads(homePath, sent)).toBe(2);
      expect(controller.getSnapshot()).toMatchObject({
        groups: { status: 'ready', data: [{ name: 'Cabin Weekend' }] },
        home: { status: 'ready', restored: false, message: null, data: [{ youOwe: 20 }] },
        offline: { active: false },
      });
      expect(published.slice(landed).some((state) => owes(state)?.[0] === 30)).toBe(false);
    },
  );

  it.each(['a restart', 'a sign-in without the saved list'] as const)(
    'takes this phone’s saved figures that name a Group the list leaves out off Home, and off this phone, once the list lands, after %s',
    async (when) => {
      const f = fixture();
      const first = f.create();
      await first.signIn('alex');
      await settle();
      first.dispose();
      later(60_000);
      // Alex loses Maple House; this phone's saved figures still name it.
      f.server.revoked.add(mapleId);
      f.server.owe = 20;
      if (when !== 'a restart') f.rows.delete(alex.id + listPath);
      const controller = f.create();
      const published = record(controller);
      const list = f.hold(listPath),
        figures = f.hold(homePath);
      const opening = when === 'a restart' ? controller.restore() : controller.signIn('alex');
      await list.reached;
      await figures.reached;
      await settle();
      // While both are read, the saved figures show, saved.
      expect(controller.getSnapshot().home).toMatchObject({
        restored: true,
        data: [{ youOwe: 30 }],
      });
      const landed = published.length;
      list.release();
      await settle();
      expect(controller.getSnapshot()).toMatchObject({
        groups: { status: 'ready', data: [{ name: 'Cabin Weekend' }] },
        home: { data: null },
      });
      // Their row goes too, so no fallback or offline start shows them again (#323).
      expect(f.row(homePath)).toBeNull();
      figures.release();
      await opening;
      await settle();
      expect(controller.getSnapshot().home).toMatchObject({
        status: 'ready',
        restored: false,
        data: [{ youOwe: 20 }],
      });
      expect(published.slice(landed).some((state) => owes(state)?.[0] === 30)).toBe(false);
    },
  );

  it.each(['before', 'after'] as const)(
    'reads figures that don’t say which Groups they cover again, once, landing %s the list beside them',
    async (order) => {
      const f = fixture();
      f.server.groupFigures = false;
      const controller = f.create();
      const list = f.hold(listPath),
        figures = f.hold(homePath);
      const signingIn = controller.signIn('alex');
      await list.reached;
      await figures.reached;
      if (order === 'before') {
        figures.release();
        await settle();
        list.release();
      } else {
        list.release();
        await settle();
        figures.release();
      }
      await signingIn;
      await settle();
      // They may cover a Group the list leaves out: read again after it, they stand.
      expect(f.reads(listPath)).toBe(1);
      expect(f.reads(homePath)).toBe(2);
      expect(controller.getSnapshot()).toMatchObject({
        groups: { status: 'ready', data: [{}, {}] },
        home: { status: 'ready', data: [{ youOwe: 30 }] },
      });
    },
  );

  describe('the payment sheet reuses only a Group its view verified from SplitBook', () => {
    const sheetReads = [`GET ${maplePath}`, `GET ${maplePath}/balances`];

    it('reads the Group, then the Balances, over the view’s saved copy of the Group', async () => {
      const f = fixture();
      const controller = f.create();
      await controller.signIn('alex');
      await controller.openGroup(mapleId, true, 'balances');
      later(5_000);
      // A pull on the view: the Group's reply is lost, so its saved copy, from 5 s ago, stands
      // in for it.
      const group = f.hold(maplePath, { lost: true });
      const pulling = controller.refresh('pull');
      await group.reached;
      group.release();
      await pulling;
      expect(controller.getSnapshot()).toMatchObject({
        detail: { id: mapleId, refreshedAt: start },
        offline: { active: true },
      });
      // Home's figures are read again from SplitBook, which clears offline.
      await controller.back();
      await controller.refreshHome();
      expect(controller.getSnapshot().offline.active).toBe(false);
      const sent = f.calls.length;
      await controller.openSettlements(mapleId);
      expect(sentSince(f, sent)).toEqual(sheetReads);
      expect(controller.getSnapshot().settlement).toMatchObject({ status: 'ready' });
    });

    it('reads the Group, then the Balances, while the app is offline', async () => {
      const f = fixture();
      const controller = f.create();
      await controller.signIn('alex');
      await controller.openGroup(mapleId, true, 'balances');
      await controller.back();
      // Home's pull can't reach SplitBook, though the Group the view read is still recent.
      f.server.offline = true;
      await controller.refresh('pull');
      expect(controller.getSnapshot().offline.active).toBe(true);
      f.server.offline = false;
      const sent = f.calls.length;
      await controller.openSettlements(mapleId);
      expect(sentSince(f, sent)).toEqual(sheetReads);
      expect(controller.getSnapshot().settlement).toMatchObject({ status: 'ready' });
    });

    it('reads the Group, then the Balances, while the view reads the Group again', async () => {
      const f = fixture();
      const controller = f.create();
      await controller.signIn('alex');
      await controller.openGroup(mapleId, true, 'balances');
      // A pull reads the Group again; its answer is late.
      const group = f.hold(maplePath);
      const pulling = controller.refresh('pull');
      await group.reached;
      // Its Expenses are read beside it; its Balances wait for it.
      await settle();
      const sent = f.calls.length;
      await controller.openRecordPayment(alex.id, sam.id, 'INR');
      expect(sentSince(f, sent)).toEqual(sheetReads);
      expect(controller.getSnapshot().settlement).toMatchObject({ status: 'editing' });
      group.release();
      await pulling;
    });
  });

  it('reads Home’s figures again after the payment sheet saw newer Balances, and only then', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId, true, 'balances');
    // Home's figures are read again after the view's read of the Group (AMEND-1).
    await controller.back();
    await controller.openGroup(mapleId, true, 'balances');
    // The sheet checks the Group its view verified within 30 s, reading only the Balances, the
    // same as the view's: nothing makes Home's figures out of date.
    let sent = f.calls.length;
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    await controller.closeSettlement();
    expect(f.reads(`${maplePath}/balances`, sent)).toBe(1);
    sent = f.calls.length;
    await controller.back();
    expect(f.reads(homePath, sent)).toBe(0);

    // A change elsewhere: the sheet sees newer Balances, so on closing it the view's Balances,
    // and then Home's figures, are read again.
    await controller.openGroup(mapleId, true, 'balances');
    f.server.owe = 45;
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    sent = f.calls.length;
    await controller.closeSettlement();
    expect(f.reads(`${maplePath}/balances`, sent)).toBe(1);
    sent = f.calls.length;
    await controller.back();
    expect(f.reads(homePath, sent)).toBe(1);
    expect(controller.getSnapshot().home).toMatchObject({
      status: 'ready',
      data: [{ youOwe: 45 }],
    });
  });

  it('reads the figures again only once when the list beside them is the older one', async () => {
    const f = fixture();
    f.server.groupFigures = true;
    const controller = f.create();
    // The list is worked out before Alex joins Zed Club, the figures after it.
    const list = f.hold(listPath),
      figures = f.hold(homePath, { late: true });
    const signingIn = controller.signIn('alex');
    await list.reached;
    await settle();
    expect(f.reads(homePath)).toBe(1);
    await figures.reached;
    f.server.listed = [maple, cabin, zed];
    list.release();
    await settle();
    // The figures are read again after the list; a third read would mean they never stand.
    const again = f.hold(homePath),
      third = f.hold(homePath);
    figures.release();
    await again.reached;
    again.release();
    await signingIn;
    await settle();
    // Read again after the list, the figures still name Zed Club: they stand.
    expect(f.reads(listPath)).toBe(1);
    expect(f.reads(homePath)).toBe(2);
    third.release();
    expect(controller.getSnapshot()).toMatchObject({
      groups: { status: 'ready', data: [{}, {}] },
      home: { status: 'ready', data: [{ youOwe: 30 }] },
    });
  });
});
