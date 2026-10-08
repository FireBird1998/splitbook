import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { FetchResponse, MobileSnapshot } from './types';

// #222: a Group's Activity on declarative queries: one query of up to 5 pages per Group that
// slides past them, with Load newer, its saved copies on the persister, and the display freshness
// rules every other view has. An event's detail reads the Group's query (#219) and the record's
// (#220). These checks drive the controller's public commands, as the app does, and look only at
// the requests sent, the snapshot and the records on this device. Freshness runs on TanStack's
// clock, Date.now, which moves with vitest's fake Date.

const alex = { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test' };
/** A Household: its Activity is read after its Group (owner decision, 2026-10-06). */
const mapleId = 'b00000000000000000000001';
/** A Trip: its Activity is read beside its Group, and shown once the Group answers. */
const cabinId = 'b00000000000000000000002';
const dinnerId = 'c00000000000000000000001';
const tagId = 'c00000000000000000000009';
const iso = '2026-09-15T06:30:00.000Z';
const start = Date.parse(iso);
const maplePath = `/api/groups/${mapleId}`;
const cabinPath = `/api/groups/${cabinId}`;
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
const json = (body: unknown, status = 200) => Response.json(body, { status });
const hex = (prefix: string, index: number) => `${prefix}${String(index).padStart(23, '0')}`;
/** The path of a page of a Group's Activity, as Android has always sent it. */
const activityPath = (page: number, path = maplePath) => `${path}/activity?page=${page}&limit=20`;
const pageOf = (path: string) => Number(new URL(path, 'http://local').searchParams.get('page'));
/** The Maple House event that is about Dinner, on its second page. */
const dinnerEventId = hex('e', 30);

type Event = {
  _id: string;
  group: string;
  actor: { _id: string; name: string };
  type: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};
/** A fictional event of a Group, numbered newest first; the oldest created the Group. */
const eventOf = (groupId: string, index: number, total: number): Event => ({
  _id: hex(groupId === mapleId ? 'e' : 'f', index),
  group: groupId,
  actor: { _id: alex.id, name: alex.name },
  type: index === total ? 'group_created' : 'expense_added',
  createdAt: new Date(start - index * 60_000).toISOString(),
  metadata:
    index === total
      ? { description: `${groupId === mapleId ? 'Maple' : 'Cabin'} created` }
      : {
          description:
            groupId === mapleId && index === 30
              ? 'Dinner'
              : `${groupId === mapleId ? 'Maple' : 'Cabin'} event ${index}`,
          amount: 10,
          currency: 'INR',
          ...(groupId === mapleId && index === 30 ? { expenseId: dinnerId } : {}),
        },
});

/** A fictional backend for Alex and Sam, and device stores that outlive a controller. */
function fixture() {
  const server = {
    /** Each Group's Activity, newest first: Maple House has 7 pages, Cabin Weekend 2. */
    events: {
      [mapleId]: Array.from({ length: 130 }, (_, index) => eventOf(mapleId, index + 1, 130)),
      [cabinId]: Array.from({ length: 30 }, (_, index) => eventOf(cabinId, index + 1, 30)),
    } as Record<string, Event[]>,
    dinner: { description: 'Dinner', revision: 1 },
    /** Groups that refuse Alex and Sam (403), and are left out of the list. */
    revoked: new Set<string>(),
    /** Groups whose own read refuses Alex (403), while their other reads still answer. */
    groupRefused: new Set<string>(),
    offline: false,
    /** A page of Maple House's Activity that answers 500 instead. */
    failPage: 0,
    /** Paths that answer 500 instead. */
    failing: new Set<string>(),
    created: 0,
    /** What a Group's own read answers that differs from the Groups list, such as its Theme. */
    groupAnswers: {} as Record<string, Record<string, unknown>>,
  };
  let cookie: string | null = null,
    owner: string | null = null,
    cleanup = false;
  const rows = new Map<string, unknown>(),
    disk = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    attempts = new Map<string, unknown>();
  /** What the saved-copy databases can't do: remove a row. */
  const device = { failRemoval: false };
  const writes: { path: string; arrive: () => void; released: Promise<void> }[] = [];
  /** Reads of rows held part-way, as on a slow disk, by path. */
  const loads: typeof writes = [];
  const pause = async (path: string) => {
    const index = writes.findIndex((step) => step.path === path);
    if (index < 0) return;
    const [step] = writes.splice(index, 1);
    step.arrive();
    await step.released;
  };
  const calls: { method: string; path: string; account: string }[] = [];
  const held: {
    path: string;
    arrive: () => void;
    answer: Promise<void>;
    lost: boolean;
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
    load: async (account: string, key: string) => {
      const index = loads.findIndex((step) => step.path === key);
      if (index >= 0) {
        const [step] = loads.splice(index, 1);
        step.arrive();
        await step.released;
      }
      return structuredClone(rows.get(account + key) ?? null);
    },
    keys: async (account: string) =>
      [...rows.keys()]
        .filter((key) => key.startsWith(account))
        .map((key) => key.slice(account.length)),
    save: async (account: string, key: string, value: unknown) => {
      await pause(key);
      rows.set(account + key, structuredClone(value));
    },
    remove: async (account: string, key: string) => {
      if (device.failRemoval) throw new Error('The device storage is full');
      rows.delete(account + key);
    },
  };
  const signedIn = (init: RequestInit) =>
    String((init.headers as Record<string, string>).Cookie ?? '').includes('sam.') ? sam : alex;
  /** A page of a Group's Activity; with `expenseId`, an Expense's history. */
  const activityPage = (groupId: string, page: number, expenseId?: string | null) => {
    const all = (server.events[groupId] ?? []).filter(
      (event) => !expenseId || event.metadata.expenseId === expenseId,
    );
    return {
      status: 200,
      data: {
        activities: all.slice((page - 1) * 20, page * 20),
        pagination: { page, limit: 20, total: all.length, totalPages: Math.ceil(all.length / 20) },
      },
    };
  };
  /** A new event at the top of a Group's Activity, as the server records a change. */
  const record = (groupId: string, type: string, metadata: Record<string, unknown>) => {
    const events = server.events[groupId];
    events.unshift({
      _id: hex('a', 900 + events.length),
      group: groupId,
      actor: { _id: alex.id, name: alex.name },
      type,
      createdAt: new Date(start + events.length * 1000).toISOString(),
      metadata,
    });
  };
  const dinner = () => ({
    _id: dinnerId,
    group: mapleId,
    revision: server.dinner.revision,
    description: server.dinner.description,
    amount: 10,
    amountMinor: 1000,
    moneyVersion: 1,
    currency: 'INR',
    paidBy: [{ user: person(alex), amount: 10, amountMinor: 1000 }],
    splitBetween: [{ user: person(alex), amount: 10, amountMinor: 1000 }],
    splitMethod: 'equal',
    date: '2026-09-10T06:30:00.000Z',
    createdAt: iso,
    updatedAt: iso,
    category: 'food',
    tagId,
    tag: 'Groceries',
    notes: '',
    isDeleted: false,
    editHistory: [],
  });
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
    if (path === '/api/groups')
      return json({
        status: 200,
        data: [maple, cabin].filter(({ _id }) => !server.revoked.has(_id)),
      });
    if (path === '/api/user/balances')
      return json({
        status: 200,
        data: { buckets: [{ currency: 'INR', youOwe: 0, youAreOwed: 0 }] },
      });
    const id = /^\/api\/groups\/([a-f\d]{24})/.exec(path)?.[1];
    const group = [maple, cabin].find(({ _id }) => _id === id);
    if (!id || !group) return json({}, 404);
    if (server.revoked.has(id)) return json({}, 403);
    if (path === `/api/groups/${id}`)
      return server.groupRefused.has(id)
        ? json({}, 403)
        : json({ status: 200, data: { ...group, ...server.groupAnswers[id] } });
    if (path.startsWith(`/api/groups/${id}/activity?`)) {
      const page = pageOf(path);
      if ((id === mapleId && page === server.failPage) || server.failing.has(path))
        return json({}, 500);
      return json(
        activityPage(id, page, new URL(path, 'http://local').searchParams.get('expenseId')),
      );
    }
    if (path === `/api/groups/${id}/expenses/${dinnerId}` && method === 'GET')
      return json({ status: 200, data: dinner() });
    if (path === `/api/groups/${id}/expenses/${dinnerId}` && method === 'PATCH') {
      const changes = JSON.parse(String(init.body)) as { description?: string };
      server.dinner.revision += 1;
      if (changes.description) server.dinner.description = changes.description;
      record(mapleId, 'expense_edited', {
        expenseId: dinnerId,
        description: server.dinner.description,
        amount: 10,
        currency: 'INR',
      });
      return json({ status: 200, data: dinner() });
    }
    if (path.startsWith(`/api/groups/${id}/expenses?`))
      return json({
        status: 200,
        data: {
          expenses: id === mapleId ? [dinner()] : [],
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
    if (path === `/api/groups/${id}/expenses` && method === 'POST') {
      server.created += 1;
      const sent = JSON.parse(String(init.body)) as { description: string };
      record(id, 'expense_added', { description: sent.description, amount: 12, currency: 'INR' });
      return json({ status: 201, data: { _id: hex('d', server.created), group: id } }, 201);
    }
    if (path === `/api/groups/${id}/balances`)
      return json({
        status: 200,
        data: { byCurrency: [{ currency: 'INR', balances: [], debts: [] }] },
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
        newSubmissionKey: () =>
          `activity-queries-attempt-${String(server.created + 1).padStart(4, '0')}`,
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
          stores: [savedQueries, records(drafts), records(attempts), untrustedCopies],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname + new URL(url).search;
          const method = init.method ?? 'GET';
          calls.push({ method, path, account: signedIn(init).id });
          if (server.offline) throw new TypeError('Network request failed');
          const index = held.findIndex((request) =>
            request.exact ? path === request.path : path.startsWith(request.path),
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
  /** A request, as these checks name it. */
  const label = (path: string) => {
    const base = path.split('?')[0];
    if (path.includes('/activity?') && path.includes('expenseId='))
      return `history p${pageOf(path)}`;
    if (path.startsWith(`${maplePath}/activity?`)) return `activity p${pageOf(path)}`;
    if (path.startsWith(`${cabinPath}/activity?`)) return `cabin activity p${pageOf(path)}`;
    if (path === maplePath) return 'group';
    if (path === cabinPath) return 'cabin';
    if (base === `${maplePath}/expenses/${dinnerId}`) return 'record';
    if (base === `${maplePath}/expenses`) return 'expenses';
    if (base === `${maplePath}/balances`) return 'balances';
    return path;
  };
  return {
    create,
    server,
    device,
    rows,
    disk,
    calls,
    untrusted: () => untrusted.value,
    activityPage,
    /** Every GET since `from`, in order. */
    gets: (from = 0) =>
      calls
        .slice(from)
        .filter((call) => call.method === 'GET')
        .map(({ path }) => label(path)),
    /** Every read of a Group's Activity since `from`, in order. */
    activityGets: (from = 0) =>
      calls
        .slice(from)
        .filter((call) => call.method === 'GET' && /\/activity\?page=/.test(call.path))
        .map(({ path }) => label(path)),
    /** The next request whose path starts with `path` is answered at once; its reply on release. */
    hold(path: string, { lost = false, exact = false } = {}) {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const answer = new Promise<void>((resolve) => {
        release = resolve;
      });
      held.push({ path, arrive, answer, lost, exact });
      return { reached, release };
    },
    /** The next read of this path's row waits until released. */
    holdLoad(path: string) {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      loads.push({ path, arrive, released });
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
    /** This account's persister rows whose path starts with `prefix`, in path order. */
    savedRows: (prefix: string, account = alex.id) =>
      [...rows]
        .filter(([key]) => key.startsWith(account + prefix))
        .map(([key, value]) => ({ path: key.slice(account.length), ...(value as object) }))
        .sort((a, b) => a.path.localeCompare(b.path)) as {
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
/** The events Activity lists, by what each says. */
const listed = (state: MobileSnapshot) =>
  state.activity.events.map((event) => String(event.metadata.description));
/** Maple House's events `from` to `to`, newest first, as Activity lists them. */
const mapleEvents = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => {
    const number = from + index;
    return number === 130 ? 'Maple created' : number === 30 ? 'Dinner' : `Maple event ${number}`;
  });
/** Every snapshot published from now on. */
function published(controller: ReturnType<ReturnType<typeof fixture>['create']>) {
  const shown: MobileSnapshot[] = [];
  controller.subscribe(() => shown.push(controller.getSnapshot()));
  return shown;
}

/** Alex has Maple House open on Activity, with `pages` pages of its events loaded. */
async function onActivity(f: ReturnType<typeof fixture>, pages: number) {
  const controller = f.create();
  await controller.signIn('alex');
  await controller.openActivity(mapleId);
  for (let page = 2; page <= pages; page += 1) await controller.loadMoreActivity();
  await settle();
  return controller;
}
/** Alex edits Dinner's description and the server confirms it; back on Expenses. */
async function editDinner(
  controller: ReturnType<ReturnType<typeof fixture>['create']>,
  description = 'Lake dinner',
) {
  await controller.openExpense(mapleId, dinnerId);
  await controller.editExpense();
  await controller.updateExpenseDraft({ description });
  await controller.saveExpense();
  expect(controller.getSnapshot()).toMatchObject({
    screen: 'group',
    destination: 'expenses',
    expense: { status: 'saved' },
  });
}

describe('Activity reuses reads verified inside the window (#181, M1-6)', () => {
  it('reads nothing on a foreground inside the window, and the loaded pages after it', async () => {
    const f = fixture();
    const controller = await onActivity(f, 2);
    let sent = f.calls.length;
    await controller.refresh('foreground');
    await settle();
    expect(f.gets(sent)).toEqual([]);
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 40));
    later(31_000);
    sent = f.calls.length;
    await controller.refresh('foreground');
    await settle();
    // Through TanStack's focus event, the only foreground trigger: every page loaded (M1-3).
    expect(f.gets(sent)).toEqual(['activity p1', 'activity p2']);
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 40));
  });

  it('lists Activity from its newest page when the Group opens again while an older page is read', async () => {
    const f = fixture();
    const controller = await onActivity(f, 2);
    const older = f.hold(activityPath(3));
    const loading = controller.loadMoreActivity();
    await older.reached;
    await controller.back();
    const opening = controller.openActivity(mapleId);
    older.release();
    await Promise.all([loading, opening]);
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({
      firstPage: 1,
      pagination: { page: 1 },
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 20));
  });

  it('reads nothing of the Group or its Activity when it is opened again from Home inside the window', async () => {
    const f = fixture();
    const controller = await onActivity(f, 1);
    await controller.back();
    await settle();
    const sent = f.calls.length;
    await controller.openActivity(mapleId);
    await settle();
    expect(f.gets(sent)).toEqual([]);
    expect(controller.getSnapshot().activity).toMatchObject({ groupId: mapleId, status: 'ready' });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 20));
  });

  // A Group opened anew is a new open, never a return to it: it lists Activity from its newest
  // page, as its Months do (#219) and as #215 says, while a return keeps every page loaded (M1-3).
  it('lists Activity from its newest page when the Group is opened again inside the window, reading nothing', async () => {
    const f = fixture();
    const controller = await onActivity(f, 2);
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 40));
    await controller.back();
    await settle();
    later(10_000);
    let sent = f.calls.length;
    await controller.openActivity(mapleId);
    await settle();
    expect(f.gets(sent)).toEqual([]);
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      firstPage: 1,
      pagination: { page: 1 },
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 20));
    // Load older reads page 2 again.
    sent = f.calls.length;
    await controller.loadMoreActivity();
    expect(f.gets(sent)).toEqual(['activity p2']);
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 40));
  });

  it('reads nothing on a reconnect inside the window, and every loaded page after it', async () => {
    const f = fixture();
    const controller = await onActivity(f, 2);
    let sent = f.calls.length;
    f.connect(false);
    await settle();
    f.connect(true);
    await settle();
    expect(f.gets(sent)).toEqual([]);
    later(31_000);
    sent = f.calls.length;
    f.connect(false);
    await settle();
    f.connect(true);
    await settle();
    // Through TanStack's online event (M1-4): every page loaded, in order (M1-3).
    expect(f.gets(sent)).toEqual(['activity p1', 'activity p2']);
    expect(controller.getSnapshot().activity).toMatchObject({ status: 'ready', restored: false });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 40));
  });

  it('checks the session before each page it reads again, on a reconnect after a read failed offline', async () => {
    const f = fixture();
    const controller = await onActivity(f, 2);
    f.connect(false);
    await settle();
    await controller.refresh('pull');
    await settle();
    expect(controller.getSnapshot().offline.active).toBe(true);
    const sent = f.calls.length;
    f.connect(true);
    await settle();
    await settle();
    // Each read after one failed offline checks the session first, as an Expense's history does
    // (#356).
    expect(f.gets(sent)).toEqual([
      '/api/auth/get-session',
      'activity p1',
      '/api/auth/get-session',
      'activity p2',
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      activity: { status: 'ready', restored: false },
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 40));
  });

  it('reads nothing switching back from Expenses inside the window, and every loaded page after it', async () => {
    const f = fixture();
    const controller = await onActivity(f, 2);
    await controller.selectDestination('expenses');
    await settle();
    let sent = f.calls.length;
    await controller.selectDestination('activity');
    await settle();
    expect(f.gets(sent)).toEqual([]);
    await controller.selectDestination('expenses');
    await settle();
    later(31_000);
    sent = f.calls.length;
    await controller.selectDestination('activity');
    await settle();
    expect(f.gets(sent)).toEqual(['activity p1', 'activity p2']);
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 40));
  });

  it('says when its events were read: the oldest page in its window, never fresher', async () => {
    const f = fixture();
    const controller = await onActivity(f, 1);
    later(10_000);
    await controller.loadMoreActivity();
    expect(controller.getSnapshot().activity).toMatchObject({
      refreshedAt: start,
      restored: false,
    });
    later(10_000);
    await controller.refresh('pull');
    expect(controller.getSnapshot().activity.refreshedAt).toBe(start + 20_000);
  });
});

describe('a refresh reads the loaded pages again (M1-3)', () => {
  it('reads both of 2 loaded pages again, keeping the events on screen as refreshing until it lands', async () => {
    const f = fixture();
    const controller = await onActivity(f, 2);
    const sent = f.calls.length;
    const first = f.hold(activityPath(1));
    const refreshing = controller.refresh('pull');
    await first.reached;
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'loading',
      pagination: { page: 2 },
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 40));
    first.release();
    await refreshing;
    await settle();
    expect(f.gets(sent)).toEqual(['activity p1', 'activity p2']);
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      pagination: { page: 2 },
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 40));
  });

  it('keeps events de-duplicated by id across pages, as events are added above them', async () => {
    const f = fixture();
    const controller = await onActivity(f, 1);
    // An event recorded elsewhere moves page 1's last event onto page 2.
    f.server.events[mapleId].unshift({
      ...f.server.events[mapleId][0],
      _id: hex('a', 1),
      metadata: { description: 'Recorded elsewhere' },
    });
    await controller.loadMoreActivity();
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 39));
    expect(new Set(controller.getSnapshot().activity.events.map(({ _id }) => _id)).size).toBe(39);
  });
});

describe('the 5-page window and Load newer (M7-2, #215)', () => {
  it('slides past 5 pages: Load older reads page 6, the list holds pages 2 to 6, and Load newer is offered', async () => {
    const f = fixture();
    const controller = await onActivity(f, 5);
    expect(controller.getSnapshot().activity).toMatchObject({
      firstPage: 1,
      pagination: { page: 5 },
    });
    const sent = f.calls.length;
    await controller.loadMoreActivity();
    expect(f.gets(sent)).toEqual(['activity p6']);
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      firstPage: 2,
      pagination: { page: 6, totalPages: 7 },
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(21, 120));
  });

  it('Load newer reads page 1, the list holds pages 1 to 5 again, and Load newer goes away', async () => {
    const f = fixture();
    const controller = await onActivity(f, 6);
    const sent = f.calls.length;
    await controller.loadNewerActivity();
    expect(f.gets(sent)).toEqual(['activity p1']);
    expect(controller.getSnapshot().activity).toMatchObject({
      firstPage: 1,
      newerStatus: 'idle',
      pagination: { page: 5 },
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 100));
    // Nothing before page 1.
    await controller.loadNewerActivity();
    expect(f.gets(sent)).toEqual(['activity p1']);
  });

  it('says Load newer is loading while it reads, and keeps the events with an error when it fails', async () => {
    const f = fixture();
    const controller = await onActivity(f, 6);
    const newer = f.hold(activityPath(1));
    const loading = controller.loadNewerActivity();
    await newer.reached;
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      newerStatus: 'loading',
      firstPage: 2,
    });
    newer.release();
    await loading;
    // Back to pages 2 to 6, and page 1 fails.
    await controller.loadMoreActivity();
    f.server.failPage = 1;
    await controller.loadNewerActivity();
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      newerStatus: 'error',
      firstPage: 2,
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(21, 120));
  });

  it('reaches the Group’s first event through the sliding window', async () => {
    const f = fixture();
    const controller = await onActivity(f, 5);
    await controller.loadMoreActivity();
    await controller.loadMoreActivity();
    expect(controller.getSnapshot().activity).toMatchObject({
      firstPage: 3,
      pagination: { page: 7, totalPages: 7 },
    });
    const shown = listed(controller.getSnapshot());
    expect(shown).toHaveLength(90);
    expect(shown.at(-1)).toBe('Maple created');
    // That is the last page: nothing more is read.
    const sent = f.calls.length;
    await controller.loadMoreActivity();
    expect(f.gets(sent)).toEqual([]);
  });

  it('shows the oldest verification time among the pages in its window, after Load newer too', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openActivity(mapleId);
    // Each page is read a second after the one before it.
    for (let page = 2; page <= 6; page += 1) {
      later(1_000);
      await controller.loadMoreActivity();
    }
    // Pages 2 to 6: page 2 was read at start + 1 s.
    expect(controller.getSnapshot().activity.refreshedAt).toBe(start + 1_000);
    later(1_000);
    await controller.loadNewerActivity();
    // Page 1, read now, never makes pages 2 to 5 look fresh.
    expect(controller.getSnapshot().activity.refreshedAt).toBe(start + 1_000);
  });

  it('never shows a page that fell back to its saved copy as fresh', async () => {
    const f = fixture();
    const first = await onActivity(f, 2);
    first.dispose();
    later(60_000);
    const controller = f.create();
    await controller.restore();
    await controller.openActivity(mapleId);
    expect(controller.getSnapshot().activity).toMatchObject({
      refreshedAt: start + 60_000,
      restored: false,
    });
    // Offline, page 2 answers with the copy this device saved a minute ago.
    f.server.offline = true;
    await controller.loadMoreActivity();
    expect(controller.getSnapshot().activity).toMatchObject({
      refreshedAt: start,
      restored: true,
      pagination: { page: 2 },
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 40));
  });
});

describe('saved copies on the persister (M3-1, AMEND-2)', () => {
  it('saves each page as its own row, in the wire JSON, with its own time; the older store keeps none', async () => {
    const f = fixture();
    const controller = await onActivity(f, 1);
    later(5_000);
    await controller.loadMoreActivity();
    await settle();
    expect(f.savedRows(`${maplePath}/activity?page=`)).toMatchObject([
      { path: activityPath(1), refreshedAt: start, value: f.activityPage(mapleId, 1) },
      { path: activityPath(2), refreshedAt: start + 5_000, value: f.activityPage(mapleId, 2) },
    ]);
    expect([...f.disk.keys()].filter((key) => key.includes('/activity?'))).toEqual([]);
  });

  it('shows this account’s saved copy at once after a restart, with its time, and reads it again', async () => {
    const f = fixture();
    const first = await onActivity(f, 1);
    first.dispose();
    later(60_000);
    const controller = f.create();
    await controller.restore();
    const group = f.hold(maplePath, { exact: true });
    const opening = controller.openActivity(mapleId);
    await group.reached;
    await settle();
    // Saved a minute ago, never as fresh: "Saved", while it is read again.
    expect(controller.getSnapshot().activity).toMatchObject({
      groupId: mapleId,
      status: 'loading',
      refreshedAt: start,
      restored: true,
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 20));
    group.release();
    await opening;
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      refreshedAt: start + 60_000,
      restored: false,
    });
  });

  it('never shows the saved copy once a read has answered, even a failed one, before the copy was read', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    await first.openActivity(cabinId);
    await settle();
    first.dispose();
    later(60_000);
    const controller = f.create();
    await controller.restore();
    // This device reads its saved copy slowly; the server fails the page read beside the Group
    // before that copy is read.
    const loading = f.holdLoad(activityPath(1, cabinPath));
    f.server.failing.add(activityPath(1, cabinPath));
    const sent = f.calls.length;
    const opening = controller.openActivity(cabinId);
    await loading.reached;
    await settle();
    expect(f.activityGets(sent)).toEqual(['cabin activity p1']);
    loading.release();
    await opening;
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({
      groupId: cabinId,
      status: 'error',
      events: [],
      pagination: null,
    });
  });

  it('restarts offline on the saved copy with its original time, never fresh: a foreground reads it again at once', async () => {
    const f = fixture();
    const first = await onActivity(f, 1);
    first.dispose();
    later(60_000);
    f.server.offline = true;
    const controller = f.create();
    await controller.restore();
    await controller.openActivity(mapleId);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true, refreshedAt: start },
      activity: { status: 'ready', refreshedAt: start, restored: true },
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 20));
    f.server.offline = false;
    const sent = f.calls.length;
    await controller.refresh('foreground');
    await settle();
    // The session is checked first, as after any read that failed offline (#356).
    expect(f.gets(sent)).toEqual(['/api/auth/get-session', 'activity p1']);
    expect(controller.getSnapshot().activity).toMatchObject({
      refreshedAt: start + 60_000,
      restored: false,
    });
  });
});

describe('a save made while the window has slid (#215)', () => {
  it('shows Activity from its newest page again, with the change on top and no Load newer', async () => {
    const f = fixture();
    const controller = await onActivity(f, 6);
    expect(controller.getSnapshot().activity.firstPage).toBe(2);
    await controller.openActivityEvent(dinnerEventId, { scrollY: 900 });
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: { status: 'detail' },
    });
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Lake dinner' });
    await controller.saveExpense();
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', destination: 'expenses' });
    const sent = f.calls.length;
    await controller.selectDestination('activity');
    await settle();
    expect(f.gets(sent)).toEqual(['activity p1']);
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      firstPage: 1,
      pagination: { page: 1 },
    });
    expect(listed(controller.getSnapshot())[0]).toBe('Lake dinner');
  });
});

describe('after a write (M2-2)', () => {
  it('reads Activity and the Expense’s history again before either shows, after a confirmed change', async () => {
    const f = fixture();
    const controller = await onActivity(f, 1);
    await controller.openExpense(mapleId, dinnerId);
    expect(controller.getSnapshot().expense.history.events).toHaveLength(1);
    await controller.back();
    await editDinner(controller);
    const shown = published(controller);
    let sent = f.calls.length;
    await controller.selectDestination('activity');
    await settle();
    expect(f.gets(sent)).toEqual(['activity p1']);
    expect(listed(controller.getSnapshot())[0]).toBe('Lake dinner');
    // No snapshot on Activity listed an event from before the change.
    for (const state of shown.filter(
      (at) => at.screen === 'group' && at.destination === 'activity',
    ))
      expect(listed(state).slice(0, 1)).not.toEqual(['Maple event 1']);
    sent = f.calls.length;
    shown.length = 0;
    await controller.openExpense(mapleId, dinnerId);
    await settle();
    expect(f.gets(sent)).toEqual(['group', 'record', 'history p1']);
    expect(controller.getSnapshot().expense.history.events).toHaveLength(2);
    // Its history never showed without the change either.
    for (const state of shown.filter(({ screen }) => screen === 'expense'))
      if (state.expense.history.events.length) expect(state.expense.history.events).toHaveLength(2);
  });

  it('reads only Activity’s newest page after a confirmed create, with an older page loaded before it', async () => {
    const f = fixture();
    const controller = await onActivity(f, 2);
    await controller.selectDestination('expenses');
    await controller.openExpense(mapleId);
    await controller.updateExpenseDraft({ description: 'Fresh groceries', amount: '12', tagId });
    await controller.saveExpense();
    expect(controller.getSnapshot().screen).toBe('group');
    const sent = f.calls.length;
    await controller.selectDestination('activity');
    await settle();
    expect(f.gets(sent)).toEqual(['activity p1']);
    expect(listed(controller.getSnapshot())).toEqual(['Fresh groceries', ...mapleEvents(1, 19)]);
  });

  it.each(['confirmed', 'unconfirmed'] as const)(
    'removes Activity’s saved copies after a %s write',
    async (outcome) => {
      const f = fixture();
      const controller = await onActivity(f, 2);
      expect(f.savedRows(`${maplePath}/activity?page=`)).toHaveLength(2);
      await controller.openExpense(mapleId);
      await controller.updateExpenseDraft({ description: 'Fresh groceries', amount: '12', tagId });
      const write = f.hold(`${maplePath}/expenses`, {
        lost: outcome === 'unconfirmed',
        exact: true,
      });
      const saving = controller.saveExpense();
      await write.reached;
      write.release();
      await saving;
      await settle();
      expect(controller.getSnapshot().auth.status).toBe('authenticated');
      expect(f.savedRows(`${maplePath}/activity?page=`)).toEqual([]);
    },
  );

  it('never shows an Activity copy it could not remove after a write, and keeps the member signed in', async () => {
    const f = fixture();
    const controller = await onActivity(f, 1);
    f.device.failRemoval = true;
    await editDinner(controller);
    await settle();
    expect(f.savedRows(`${maplePath}/activity?page=`)).toHaveLength(1);
    f.server.offline = true;
    await controller.selectDestination('activity');
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      activity: { status: 'error', events: [] },
    });
  });
});

describe('sessions and access (#173 gates)', () => {
  it('shows nothing of the previous account after a switch, with a read in flight and a row being written', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const writing = f.holdWrite(activityPath(1));
    // A read settles once its answer is saved here: opening waits for that write.
    const opening = controller.openActivity(mapleId);
    await writing.reached;
    const reading = f.hold(activityPath(2));
    const more = controller.loadMoreActivity();
    await reading.reached;
    const switching = controller.signIn('sam');
    await settle();
    writing.release();
    reading.release();
    await Promise.all([switching, more, opening]);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { user: { id: sam.id } },
      activity: { groupId: null, events: [] },
    });
    expect([...f.rows.keys()].some((key) => key.startsWith(alex.id))).toBe(false);
  });

  it('clears Activity to denied when access is lost, with its rows, and a late answer brings none of it back', async () => {
    const f = fixture();
    const controller = await onActivity(f, 2);
    expect(f.savedRows(`${maplePath}/activity?page=`)).toHaveLength(2);
    later(31_000);
    const late = f.hold(activityPath(2));
    const refreshing = controller.refresh('pull');
    await late.reached;
    // Access is lost while page 2 is on its way: the Group's next read is refused.
    f.server.revoked.add(mapleId);
    await controller.openGroup(mapleId, false);
    late.release();
    await refreshing;
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      detail: { status: 'denied', data: null },
      activity: { status: 'denied', events: [] },
    });
    expect(f.savedRows(maplePath)).toEqual([]);
  });

  it('never shows or saves an answer that arrives after sign-out', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const late = f.hold(activityPath(1));
    const opening = controller.openActivity(mapleId);
    await late.reached;
    await controller.signOut();
    late.release();
    await opening;
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'signed-out' },
      activity: { events: [] },
    });
    expect(f.rows.size).toBe(0);
  });

  it('never shows or saves an Activity answer that a confirmed change made obsolete', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    // Activity is read before the change; its answer is still on its way when it is confirmed.
    const late = f.hold(activityPath(1));
    const opening = controller.selectDestination('activity');
    await late.reached;
    await controller.selectDestination('expenses');
    await editDinner(controller);
    late.release();
    await opening;
    await settle();
    expect(f.savedRows(`${maplePath}/activity?page=`)).toEqual([]);
    const sent = f.calls.length;
    await controller.selectDestination('activity');
    await settle();
    expect(f.gets(sent)).toEqual(['activity p1']);
    expect(listed(controller.getSnapshot())[0]).toBe('Lake dinner');
  });

  it('removes a row still being written when its Group is lost, once it lands', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const writing = f.holdWrite(activityPath(1));
    const opening = controller.openActivity(mapleId);
    await writing.reached;
    f.server.revoked.add(mapleId);
    await controller.refresh();
    writing.release();
    await opening;
    await settle();
    expect(f.savedRows(maplePath)).toEqual([]);
    expect(controller.getSnapshot().activity).toMatchObject({ status: 'denied', events: [] });
  });
});

describe('a Group and its Activity read together (owner decision, 2026-10-06)', () => {
  it('reads a Trip’s Activity beside its Group, and shows it only once the Group answers', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    const sent = f.calls.length;
    const group = f.hold(cabinPath, { exact: true });
    const opening = controller.openActivity(cabinId);
    await group.reached;
    await settle();
    expect(f.gets(sent)).toEqual(['cabin', 'cabin activity p1']);
    // Read, but not shown before the Group's check.
    expect(controller.getSnapshot().activity.events).toEqual([]);
    group.release();
    await opening;
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({ groupId: cabinId, status: 'ready' });
    expect(controller.getSnapshot().activity.events).toHaveLength(20);
    expect(f.gets(sent)).toEqual(['cabin', 'cabin activity p1']);
  });

  it('drops the Activity read beside a Group that refuses the member', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    f.server.groupRefused.add(cabinId);
    await controller.openActivity(cabinId);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      detail: { status: 'denied', data: null },
      activity: { status: 'denied', events: [] },
    });
    expect(f.savedRows(cabinPath)).toEqual([]);
  });

  it('keeps a Household’s Activity after its Group read', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    const sent = f.calls.length;
    const group = f.hold(maplePath, { exact: true });
    const opening = controller.openActivity(mapleId);
    await group.reached;
    await settle();
    expect(f.gets(sent)).toEqual(['group']);
    group.release();
    await opening;
    expect(f.gets(sent)).toEqual(['group', 'activity p1']);
  });
});

describe('the loading-state audit (#280)', () => {
  it('holds no event from before this device’s own change when Activity can’t be read offline (item 1)', async () => {
    const f = fixture();
    const controller = await onActivity(f, 1);
    await controller.selectDestination('expenses');
    await editDinner(controller);
    f.server.offline = true;
    await controller.selectDestination('activity');
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'error',
      events: [],
      pagination: null,
    });
    expect(controller.getSnapshot().activity.restored).not.toBe(true);
  });

  it('says what failed when SplitBook answers with nothing shown, offline too, and “not saved” only when it can’t be reached', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    f.server.offline = true;
    await controller.refresh('pull');
    await controller.selectDestination('activity');
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true },
      activity: { status: 'error', events: [], unsaved: true },
    });
    // SplitBook answers again, with a 500, before the app has seen it reachable.
    await controller.selectDestination('expenses');
    f.server.offline = false;
    f.server.failPage = 1;
    await controller.selectDestination('activity');
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true },
      activity: {
        status: 'error',
        events: [],
        unsaved: false,
        message: 'The server could not complete this request. Please try again.',
      },
    });
  });
});

// The money-safety review of 90f5c21 (#222): saved copies a change or a loss left behind, a
// preview whose read fails, older pages offline, and what the cues wait for.
describe('saved copies and cues after review (#222)', () => {
  /** Activity's page rows on this device. */
  const pageRows = (f: ReturnType<typeof fixture>) => f.savedRows(`${maplePath}/activity?page=`);

  it('removes Activity’s pre-change copies at the next start when a change couldn’t remove them (M2-2, #212)', async () => {
    const f = fixture();
    const controller = await onActivity(f, 2);
    expect(pageRows(f)).toHaveLength(2);
    f.device.failRemoval = true;
    await controller.selectDestination('expenses');
    await editDinner(controller);
    await settle();
    // Still on this device, never shown in this session.
    expect(pageRows(f)).toHaveLength(2);
    controller.dispose();
    f.device.failRemoval = false;
    later(60_000);
    f.server.offline = true;
    const restarted = f.create();
    await restarted.restore();
    await settle();
    expect(pageRows(f)).toEqual([]);
    await restarted.openActivity(mapleId);
    await settle();
    expect(restarted.getSnapshot().activity).toMatchObject({
      status: 'error',
      events: [],
      pagination: null,
    });
    expect(restarted.getSnapshot().activity.restored).not.toBe(true);
  });

  it('removes a lost Group’s row that landed late and couldn’t be removed, at the next start (#323)', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const writing = f.holdWrite(activityPath(1));
    const opening = controller.openActivity(mapleId);
    await writing.reached;
    f.server.revoked.add(mapleId);
    await controller.refresh();
    f.device.failRemoval = true;
    writing.release();
    await opening;
    await settle();
    expect(f.savedRows(maplePath)).toHaveLength(1);
    controller.dispose();
    f.device.failRemoval = false;
    f.server.offline = true;
    const restarted = f.create();
    await restarted.restore();
    await settle();
    expect(f.savedRows(maplePath)).toEqual([]);
  });

  it('says a refresh failed when the read after a restored copy fails, keeping what A missing event means', async () => {
    const f = fixture();
    const first = await onActivity(f, 1);
    first.dispose();
    later(60_000);
    const controller = f.create();
    await controller.restore();
    await settle();
    f.server.failing.add(activityPath(1));
    await controller.openActivity(mapleId);
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'error',
      message:
        'Could not refresh Activity. Previously loaded events may be stale. A missing event does not mean the ledger change failed.',
      restored: true,
    });
  });

  it('never fills an older page offline from a copy whose total differs from the first page’s', async () => {
    const f = fixture();
    const first = await onActivity(f, 2);
    // Others record 5 events; this phone reads only the newest page again later.
    for (let n = 0; n < 5; n += 1)
      f.server.events[mapleId].unshift({
        ...f.server.events[mapleId][0],
        _id: hex('b', 500 + n),
        metadata: { description: `Others ${n}`, amount: 1, currency: 'INR' },
      });
    await first.selectDestination('expenses');
    later(120_000);
    await first.back();
    await first.openActivity(mapleId);
    await settle();
    first.dispose();
    later(60_000);
    f.server.offline = true;
    const controller = f.create();
    await controller.restore();
    await controller.openActivity(mapleId);
    await controller.loadMoreActivity();
    await settle();
    // Page 2 was saved when there were 5 fewer events: events 16 to 20 would go missing.
    expect(controller.getSnapshot().activity).toMatchObject({
      moreStatus: 'error',
      pagination: { page: 1 },
    });
    expect(listed(controller.getSnapshot())).toEqual([
      'Others 4',
      'Others 3',
      'Others 2',
      'Others 1',
      'Others 0',
      ...mapleEvents(1, 15),
    ]);
  });

  it('never saves a page row queued behind a slow write once a change is confirmed', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const writing = f.holdWrite(activityPath(1));
    void controller.openActivity(mapleId);
    await writing.reached;
    // Page 2's row waits behind page 1's on the saved-copy queue.
    void controller.loadMoreActivity();
    await settle();
    await controller.selectDestination('expenses');
    await editDinner(controller);
    writing.release();
    await settle();
    expect(pageRows(f)).toEqual([]);
  });

  it('never shows a row still untrusted after a restart while its Group is read', async () => {
    const f = fixture();
    const first = await onActivity(f, 1);
    f.device.failRemoval = true;
    await first.selectDestination('expenses');
    await editDinner(first);
    await settle();
    first.dispose();
    later(60_000);
    const controller = f.create();
    await controller.restore();
    await settle();
    const group = f.hold(maplePath, { exact: true });
    const shown = published(controller);
    const opening = controller.openActivity(mapleId);
    await group.reached;
    await settle();
    for (const state of shown.filter((at) => at.screen === 'group'))
      expect(listed(state)).not.toContain('Maple event 1');
    group.release();
    await opening;
  });

  it('ends a pull when its read lands, though its saved copy is still being written', async () => {
    const f = fixture();
    const controller = await onActivity(f, 1);
    later(31_000);
    const writing = f.holdWrite(activityPath(1));
    let pulled = false;
    const pulling = controller.refresh('pull').then(() => (pulled = true));
    await writing.reached;
    await settle();
    expect(pulled).toBe(true);
    expect(controller.getSnapshot().pull).toBeNull();
    writing.release();
    await pulling;
  });

  it('reads a Group’s Activity again after it, when the Group turns out to be a Household', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    // Home lists Cabin Weekend as a Trip; it has since become a Household.
    f.server.groupAnswers[cabinId] = { category: 'home' };
    const sent = f.calls.length;
    await controller.openActivity(cabinId);
    await settle();
    expect(f.gets(sent)).toEqual(['cabin', 'cabin activity p1', 'cabin activity p1']);
  });

  it('keeps no event from before this device’s own change while Activity isn’t shown', async () => {
    const f = fixture();
    const controller = await onActivity(f, 1);
    await controller.selectDestination('expenses');
    await editDinner(controller);
    expect(controller.getSnapshot().activity.events).toEqual([]);
  });

  it('says both what stays on screen and what a missing event means, offline with no copy left', async () => {
    const f = fixture();
    const controller = await onActivity(f, 1);
    f.rows.delete(alex.id + activityPath(1));
    f.server.offline = true;
    await controller.refresh('pull');
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'error',
      message:
        'Couldn’t refresh this Group’s activity, and this phone no longer keeps a copy of it. A missing event does not mean the ledger change failed.',
    });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 20));
  });
});

// The final checks of 9ec19e4 (#222): a refresh's page that falls back to another total, a Trip
// that turns out to be a Household, and a Trip's saved copy after an online restart.
describe('final checks (#222)', () => {
  /** Alex opened Cabin Weekend's Activity once; the app starts again, online, a minute later. */
  async function restartedOnCabin(f: ReturnType<typeof fixture>) {
    const first = f.create();
    await first.signIn('alex');
    await first.openActivity(cabinId);
    await settle();
    first.dispose();
    later(60_000);
    const controller = f.create();
    await controller.restore();
    await settle();
    return controller;
  }

  it('ends a refresh’s list where a page falls back to a copy that counted another total', async () => {
    const f = fixture();
    const controller = await onActivity(f, 2);
    // Others add 5 events; page 2's request is then lost, and its saved copy counted 130.
    for (let n = 0; n < 5; n += 1)
      f.server.events[mapleId].unshift({
        ...f.server.events[mapleId][0],
        _id: hex('b', 500 + n),
        metadata: { description: `Others ${n}`, amount: 1, currency: 'INR' },
      });
    later(31_000);
    const lost = f.hold(activityPath(2), { lost: true });
    const pulling = controller.refresh('pull');
    await lost.reached;
    lost.release();
    await pulling;
    await settle();
    // Never 40 events with 16 to 20 silently missing: the list ends after event 15.
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      moreStatus: 'error',
    });
    expect(listed(controller.getSnapshot())).toEqual([
      'Others 4',
      'Others 3',
      'Others 2',
      'Others 1',
      'Others 0',
      ...mapleEvents(1, 15),
    ]);
  });

  it('shows nothing it read beside a Group that turned out to be a Household until it is read again after it', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    // Listed as a Trip, so Activity is read beside the Group; the Group's read says Household.
    f.server.groupAnswers[cabinId] = { category: 'home' };
    const sent = f.calls.length;
    const group = f.hold(cabinPath, { exact: true });
    const shown = published(controller);
    const opening = controller.openActivity(cabinId);
    await group.reached;
    await settle();
    // The Group's read adds a due recurring Expense and its event.
    f.server.events[cabinId].unshift({
      ...f.server.events[cabinId][0],
      _id: hex('d', 777),
      metadata: { description: 'Recurring rent', amount: 5, currency: 'INR', recurring: true },
    });
    const again = f.hold(activityPath(1, cabinPath));
    group.release();
    await again.reached;
    await settle();
    // Checked and a Household: the placeholder holds, as on a Household's first open.
    expect(controller.getSnapshot()).toMatchObject({
      detail: { data: { category: 'home' } },
      activity: { groupId: cabinId, status: 'loading', events: [], pagination: null },
    });
    again.release();
    await opening;
    await settle();
    expect(listed(controller.getSnapshot())[0]).toBe('Recurring rent');
    expect(controller.getSnapshot().activity).toMatchObject({ status: 'ready', restored: false });
    // No snapshot listed the events read before the Group's.
    for (const state of shown)
      if (state.activity.events.length) expect(listed(state)[0]).toBe('Recurring rent');
    expect(f.gets(sent)).toEqual(['cabin', 'cabin activity p1', 'cabin activity p1']);
  });

  it('reads a Household’s Activity again after its Group when the member comes back to it, having switched away while the Group was read', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    f.server.groupAnswers[cabinId] = { category: 'home' };
    const group = f.hold(cabinPath, { exact: true });
    const opening = controller.openActivity(cabinId);
    await group.reached;
    await settle();
    // Read beside the Group; the member is on Expenses by the time the Group answers.
    const switching = controller.selectDestination('expenses');
    f.server.events[cabinId].unshift({
      ...f.server.events[cabinId][0],
      _id: hex('d', 777),
      metadata: { description: 'Recurring rent', amount: 5, currency: 'INR', recurring: true },
    });
    group.release();
    await Promise.all([opening, switching]);
    await settle();
    const sent = f.calls.length;
    await controller.selectDestination('activity');
    await settle();
    // Inside the window, yet read again: what was read beside the Group may lack that event.
    expect(f.activityGets(sent)).toEqual(['cabin activity p1']);
    expect(listed(controller.getSnapshot())[0]).toBe('Recurring rent');
  });

  it('shows a Trip’s saved copy at once after an online restart, until its Group’s check passes', async () => {
    const f = fixture();
    const controller = await restartedOnCabin(f);
    const group = f.hold(cabinPath, { exact: true });
    const page = f.hold(activityPath(1, cabinPath));
    const opening = controller.openActivity(cabinId);
    await group.reached;
    await page.reached;
    await settle();
    // Both reads are under way: this phone's copy shows with its own time (M3-1).
    expect(controller.getSnapshot().activity).toMatchObject({
      groupId: cabinId,
      status: 'loading',
      restored: true,
      refreshedAt: start,
    });
    expect(controller.getSnapshot().activity.events).toHaveLength(20);
    // Activity answers first: the copy stays until the Group's check passes, never a placeholder.
    page.release();
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({ restored: true, refreshedAt: start });
    expect(controller.getSnapshot().activity.events).toHaveLength(20);
    group.release();
    await opening;
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      restored: false,
      refreshedAt: start + 60_000,
    });
    expect(controller.getSnapshot().activity.events).toHaveLength(20);
  });

  it('never shows the saved copy once a read of this open answered, though a pull is under way when it is read', async () => {
    const f = fixture();
    const controller = await restartedOnCabin(f);
    // This device reads its copy slowly; the read beside the Group fails before it is read.
    const loading = f.holdLoad(activityPath(1, cabinPath));
    f.server.failing.add(activityPath(1, cabinPath));
    const opening = controller.openActivity(cabinId);
    await loading.reached;
    await settle();
    // A pull reads again, and is still under way when the copy has been read.
    f.server.failing.delete(activityPath(1, cabinPath));
    const page = f.hold(activityPath(1, cabinPath));
    const pulling = controller.refresh('pull');
    await page.reached;
    loading.release();
    await settle();
    expect(controller.getSnapshot().activity.events).toEqual([]);
    page.release();
    await Promise.all([opening, pulling]);
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({ status: 'ready', restored: false });
    expect(controller.getSnapshot().activity.events).toHaveLength(20);
  });

  it('drops a Trip’s saved copy shown at once when its Group then refuses the member', async () => {
    const f = fixture();
    const controller = await restartedOnCabin(f);
    f.server.groupRefused.add(cabinId);
    const group = f.hold(cabinPath, { exact: true });
    const page = f.hold(activityPath(1, cabinPath));
    const opening = controller.openActivity(cabinId);
    await group.reached;
    await page.reached;
    await settle();
    expect(controller.getSnapshot().activity.events).toHaveLength(20);
    // The Group refuses: the copy goes with its rows, and the page's late answer brings nothing.
    group.release();
    await settle();
    const dropped = {
      detail: { status: 'denied', data: null },
      activity: { status: 'denied', events: [] },
    };
    expect(controller.getSnapshot()).toMatchObject(dropped);
    expect(f.savedRows(cabinPath)).toEqual([]);
    page.release();
    await opening;
    await settle();
    expect(controller.getSnapshot()).toMatchObject(dropped);
    expect(f.savedRows(cabinPath)).toEqual([]);
  });
});

// The device check of 99f96d6 (#222): this phone's copy after a cold restart in the usual
// order, and the page controls when a re-read fails at the list end.
describe('device check (#222)', () => {
  /** Alex opened Maple House's Activity once; the app starts again, online, a minute later. */
  async function restartedOnMaple(f: ReturnType<typeof fixture>) {
    const first = f.create();
    await first.signIn('alex');
    await first.openActivity(mapleId);
    await settle();
    first.dispose();
    later(60_000);
    const controller = f.create();
    await controller.restore();
    await settle();
    return controller;
  }
  /** The first snapshot published on Activity. */
  const onArrival = (shown: MobileSnapshot[]) =>
    shown.find((state) => state.screen === 'group' && state.destination === 'activity')!;

  it('shows this phone’s copy from the first frame of a switch to Activity once the Group was read, after a cold restart (A7)', async () => {
    const f = fixture();
    const controller = await restartedOnMaple(f);
    await controller.openGroup(mapleId);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      destination: 'expenses',
      detail: { status: 'ready' },
    });
    const page = f.hold(activityPath(1));
    const shown = published(controller);
    const switching = controller.selectDestination('activity');
    expect(onArrival(shown).activity).toMatchObject({ restored: true, refreshedAt: start });
    expect(onArrival(shown).activity.events).toHaveLength(20);
    await page.reached;
    await settle();
    // Read, and not answered yet: still this phone's copy.
    expect(controller.getSnapshot().activity).toMatchObject({ status: 'loading', restored: true });
    expect(controller.getSnapshot().activity.events).toHaveLength(20);
    page.release();
    await switching;
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      restored: false,
      refreshedAt: start + 60_000,
    });
  });

  it('shows it from the first frame of a switch made while the Group is still read (A7s)', async () => {
    const f = fixture();
    const controller = await restartedOnMaple(f);
    const group = f.hold(maplePath, { exact: true });
    const opening = controller.openGroup(mapleId);
    await group.reached;
    await settle();
    const shown = published(controller);
    const switching = controller.selectDestination('activity');
    expect(onArrival(shown).activity).toMatchObject({ restored: true, refreshedAt: start });
    expect(onArrival(shown).activity.events).toHaveLength(20);
    await settle();
    expect(controller.getSnapshot().activity.events).toHaveLength(20);
    group.release();
    await Promise.all([opening, switching]);
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({ status: 'ready', restored: false });
  });

  it('holds the placeholder, never a blank, on a switch to Activity while the Group is read with nothing saved', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    const group = f.hold(maplePath, { exact: true });
    const opening = controller.openGroup(mapleId);
    await group.reached;
    await settle();
    void controller.selectDestination('activity');
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({
      groupId: mapleId,
      status: 'loading',
      events: [],
      pagination: null,
    });
    group.release();
    await opening;
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({ status: 'ready' });
    expect(listed(controller.getSnapshot())).toEqual(mapleEvents(1, 20));
  });

  // A15: a foreground past the window with SplitBook out of reach, the member at the list's end.
  it('keeps the list and its Load older when a foreground re-read fails offline at the list end (A15)', async () => {
    const f = fixture();
    const controller = await onActivity(f, 5);
    later(34_000);
    f.server.offline = true;
    const shown = published(controller);
    const sent = f.calls.length;
    await controller.refresh('foreground');
    await settle();
    // Page 1 fails; every later page is this phone's copy, behind a session check that fails too.
    expect(f.gets(sent)).toEqual([
      'activity p1',
      '/api/auth/get-session',
      '/api/auth/get-session',
      '/api/auth/get-session',
      '/api/auth/get-session',
    ]);
    // Every page loaded stays listed, with the pages after it to load: Load older stays.
    for (const state of shown) {
      expect(listed(state)).toEqual(mapleEvents(1, 100));
      expect(state.activity.pagination).toMatchObject({ page: 5, totalPages: 7 });
    }
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true },
      activity: { status: 'ready', moreStatus: 'idle', restored: true },
    });
  });

  // A5-slow: a pull whose pages time out one after another.
  it('keeps the list and its Load older through a re-read whose pages fail part-way (A5)', async () => {
    const f = fixture();
    const controller = await onActivity(f, 5);
    later(31_000);
    const shown = published(controller);
    // Page 1 answers; page 2's request is lost, as at a timeout; the rest are read after it.
    const lost = f.hold(activityPath(2), { lost: true });
    const pulling = controller.refresh('pull');
    await lost.reached;
    await settle();
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'loading',
      pagination: { page: 5, totalPages: 7 },
    });
    lost.release();
    await pulling;
    await settle();
    for (const state of shown) {
      expect(listed(state)).toEqual(mapleEvents(1, 100));
      expect(state.activity.pagination).toMatchObject({ page: 5, totalPages: 7 });
    }
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      moreStatus: 'idle',
    });
  });
});
