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
  };
  let cookie: string | null = null,
    owner: string | null = null,
    cleanup = false;
  /** The persister's rows, by account and path; and the older saved-copy store's, the same way. */
  const rows = new Map<string, unknown>(),
    disk = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    attempts = new Map<string, unknown>();
  const device = { failRemoval: false };
  /** Writes of rows held part-way, as on a slow disk, by path. */
  const writes: { path: string; arrive: () => void; released: Promise<void> }[] = [];
  /** Every request sent, answered or not. */
  const calls: { method: string; path: string; account: string }[] = [];
  /** Requests held until released, by path. */
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
    save: async (account: string, key: string, value: unknown) => {
      const index = writes.findIndex((write) => write.path === key);
      if (index >= 0) {
        const [write] = writes.splice(index, 1);
        write.arrive();
        await write.released;
      }
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
    if (path === listPath) return json({ status: 200, data: listed() });
    if (path === homePath)
      return json({
        status: 200,
        data: {
          buckets: [{ currency: 'INR', youOwe: user === sam ? 50 : server.owe, youAreOwed: 0 }],
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
          const index = held.findIndex((request) => path === request.path);
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
  const identity = { value: null as unknown },
    untrusted = { value: null as unknown };
  return {
    create,
    server,
    device,
    rows,
    disk,
    calls,
    /** GET requests sent for exactly this path since `from`. */
    reads: (path: string, from = 0) =>
      calls.slice(from).filter((call) => call.method === 'GET' && call.path === path).length,
    /**
     * The next request for exactly this path is answered by the server at once, and its reply
     * arrives when released: late, or `lost` on the way, as when the connection drops.
     */
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
      value: { status: 200, data: { buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }] } },
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
    expect([...f.rows.keys()].sort()).toEqual([`${alex.id}${listPath}`, `${alex.id}${homePath}`]);
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

    // On a Group, nothing Home shows is active, so a reconnect reads nothing of it.
    await controller.openGroup(mapleId);
    later(31_000);
    sent = f.calls.length;
    f.connect(false);
    f.connect(true);
    await settle();
    expect(f.calls.slice(sent)).toEqual([]);
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
      const notSaved = {
        status: 'error',
        message: 'This view was not saved on this device. Connect to load it.',
      };
      expect(restarted.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: alex.id } },
        screen: 'groups',
        ...(path === homePath
          ? {
              groups: {
                status: 'ready',
                data: [{ name: 'Maple House' }, { name: 'Cabin Weekend' }],
              },
              home: { ...notSaved, data: null },
            }
          : {
              groups: { ...notSaved, data: [] },
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
    // A pull: the list's row is still being written, and Home's waits behind it.
    f.server.owe = 31;
    const writing = f.holdWrite(listPath);
    await controller.refresh('pull');
    await writing.reached;
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
    expect(f.disk.has(`${alex.id}${maplePath}`)).toBe(true);
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
    expect([...f.disk.keys()].some((key) => key.includes(mapleId))).toBe(false);
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
    expect([...f.disk.keys()].some((key) => key.includes(cabinId))).toBe(true);
    // Cabin Weekend leaves the list (the member left it on the web).
    f.server.listed = [maple];
    const sent = f.calls.length;
    await controller.refresh('pull');
    await settle();
    expect(names(controller.getSnapshot())).toEqual(['Maple House']);
    expect([...f.disk.keys()].some((key) => key.includes(cabinId))).toBe(false);
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
    const saved = [...f.disk.keys()].filter((key) => key.includes(cabinId));
    expect(saved.length).toBeGreaterThan(0);
    const sent = f.calls.length;
    stale.release();
    await foregrounding;
    await settle();
    // The older list is no answer: Cabin Weekend keeps its saved copies and its reads.
    expect(names(controller.getSnapshot())).toEqual(['Maple House', 'Cabin Weekend']);
    expect([...f.disk.keys()].filter((key) => key.includes(cabinId))).toEqual(saved);
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
    expect([...f.disk.keys()].some((key) => key.includes(mapleId))).toBe(false);
    expect(published.some((state) => names(state).includes('Maple House'))).toBe(false);
    expect(restarted.getSnapshot().auth.status).toBe('authenticated');
  });
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
    // in for a read again: Home says they weren't saved here, with no saved time.
    expect(f.row(homePath)).toMatchObject({
      value: { data: { buckets: [{ youOwe: 30 }] } },
    });
    f.server.offline = true;
    while (controller.getSnapshot().screen !== 'groups') await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated' },
      home: {
        status: 'error',
        message: 'This view was not saved on this device. Connect to load it.',
      },
      offline: { active: true, refreshedAt: null },
    });
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
    await controller.openGroup(mapleId, true, 'balances');
    let sent = f.calls.length;
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    expect(f.calls.slice(sent).map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${maplePath}`,
      `GET ${maplePath}/balances`,
    ]);
    await controller.closeSettlement();
    // Within the window, Home's figures and then the Group's Balances are read again.
    sent = f.calls.length;
    await controller.back();
    expect(f.reads(homePath, sent)).toBe(1);
    sent = f.calls.length;
    await controller.openGroup(mapleId, true, 'balances');
    expect(f.reads(`${maplePath}/balances`, sent)).toBe(1);
  });
});
