import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { FetchResponse } from './types';

// #220: an Expense record and its history on declarative queries: the record's Group, the record
// and its changes as one query of up to 5 pages, with their saved copies on the persister. These
// checks drive the controller's public commands, as the app does, and look only at the requests
// sent, the snapshot and the records on this device. Freshness runs on TanStack's clock,
// Date.now, which moves with vitest's fake Date. Fictional people and Groups only.

const alex = { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test' };
const mapleId = 'b00000000000000000000001';
const billId = 'c00000000000000000000001';
const dinnerId = 'c00000000000000000000002';
const tagId = 'f00000000000000000000001';
const iso = '2026-09-15T06:30:00.000Z';
const start = Date.parse(iso);
const person = (user: typeof alex) => ({ _id: user.id, name: user.name, image: null });
const maple = {
  _id: mapleId,
  createdBy: alex.id,
  name: 'Maple House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  members: [alex, sam].map((user) => ({
    user: { ...person(user), email: user.email },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Utilities', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const maplePath = `/api/groups/${mapleId}`;
/** A second Group of Alex's, with one Expense and an Activity event about it. */
const cabinId = 'b00000000000000000000002';
const fareId = 'c00000000000000000000003';
const cabin = { ...maple, _id: cabinId, name: 'Cabin Weekend', category: 'trip' };
const cabinPath = `/api/groups/${cabinId}`;
const recordPath = (id: string) => `${maplePath}/expenses/${id}`;
const historyPath = (id: string, page: number) =>
  `${maplePath}/activity?expenseId=${id}&page=${page}&limit=20`;
const json = (body: unknown, status = 200) => Response.json(body, { status });
const hex = (prefix: string, index: number) => `${prefix}${String(index).padStart(23, '0')}`;
const record = (id: string, description: string, revision = 1) => ({
  _id: id,
  group: mapleId,
  revision,
  description,
  amount: 30,
  amountMinor: 3000,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: person(sam), amount: 30, amountMinor: 3000 }],
  splitBetween: [
    { user: person(alex), amount: 15, amountMinor: 1500 },
    { user: person(sam), amount: 15, amountMinor: 1500 },
  ],
  splitMethod: 'equal',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'other',
  tagId,
  tag: 'Utilities',
  notes: '',
  isDeleted: false,
  createdBy: person(sam),
  editHistory: [],
});
/** One Expense's changes, newest first: `count` of them, the oldest the one that added it. */
const changesOf = (id: string, prefix: string, count: number, description: string) =>
  Array.from({ length: count }, (_, index) => ({
    _id: hex(prefix, index + 1),
    group: mapleId,
    actor: person(index % 2 ? alex : sam),
    createdAt: new Date(Date.parse('2026-09-14T10:00:00.000Z') - index * 60_000).toISOString(),
    type: index === count - 1 ? 'expense_added' : 'expense_updated',
    metadata: {
      expenseId: id,
      description,
      changes: { notes: { old: `Note ${index + 1}`, new: `Note ${index}` } },
    },
  }));

/** A fictional backend for Alex and Sam, and device stores that outlive a controller. */
function fixture() {
  const server = {
    records: new Map<string, ReturnType<typeof record>>([
      [billId, record(billId, 'Electricity bill')],
      [dinnerId, record(dinnerId, 'Sunday dinner')],
    ]),
    /** Each Expense's changes, newest first: the bill has 7 pages of them, the dinner one. */
    changes: new Map<string, unknown[]>([
      [billId, changesOf(billId, 'd', 130, 'Electricity bill')],
      [dinnerId, changesOf(dinnerId, 'e', 3, 'Sunday dinner')],
    ]),
    /** Maple House refuses Alex (403 on every path of it), or is gone (404). */
    group: 200,
    /** Expenses that are gone (404 on their own path only). */
    gone: new Set<string>(),
    /** A page of the bill's changes that answers 500 instead. */
    failPage: 0,
    /** The bill's record answers 500 instead: a server fault, not a refusal. */
    failRecord: false,
    offline: false,
    /** An edit or deletion is recorded, but its reply never arrives: the connection drops. */
    loseWrites: false,
    /** Groups the Groups list leaves out, as it does archived Groups; they still answer. */
    archived: new Set<string>(),
    /** Maple House's answer no longer lists Alex, though its other reads still answer. */
    left: false,
    /** Expenses created so far. */
    created: 0,
  };
  let cookie: string | null = null,
    owner: string | null = null,
    cleanup = false;
  /** The persister's rows, by account and path; the older saved-copy store's, the same way. */
  const rows = new Map<string, unknown>(),
    disk = new Map<string, unknown>(),
    drafts = new Map<string, unknown>();
  /** What the saved-copy database can't do: remove a row. */
  const device = { failRemoval: false };
  const writes: { path: string; arrive: () => void; released: Promise<void> }[] = [];
  const pause = async (path: string) => {
    const index = writes.findIndex((step) => step.path === path);
    if (index < 0) return;
    const [step] = writes.splice(index, 1);
    step.arrive();
    await step.released;
  };
  const calls: { method: string; path: string }[] = [];
  const held: { path: string; arrive: () => void; answer: Promise<void>; exact: boolean }[] = [];
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
    // Sam belongs to no Group here.
    const mine = user.id === alex.id;
    if (path === '/api/groups')
      return json({
        status: 200,
        data: mine
          ? [maple, cabin].filter(
              ({ _id }) => !server.archived.has(_id) && (_id !== mapleId || server.group === 200),
            )
          : [],
      });
    if (path === '/api/user/balances') return json({ status: 200, data: { buckets: [] } });
    if (path.startsWith(cabinPath)) return mine ? cabinAnswer(path) : json({}, 403);
    if (!path.startsWith(maplePath)) return json({}, 404);
    if (user.id !== alex.id) return json({}, 403);
    if (server.group !== 200) return json({}, server.group);
    if (path === maplePath)
      return json({
        status: 200,
        data: server.left
          ? { ...maple, members: maple.members.filter(({ user }) => user._id !== alex.id) }
          : maple,
      });
    if (path === `${maplePath}/expenses` && method === 'POST') {
      server.created += 1;
      const id = hex('c', 900 + server.created);
      server.records.set(id, record(id, 'Fresh groceries'));
      return json({ status: 201, data: { _id: id, group: mapleId } }, 201);
    }
    const id = /\/expenses\/([a-f\d]{24})$/.exec(path)?.[1];
    if (id) {
      const current = server.records.get(id);
      if (!current || server.gone.has(id)) return json({}, 404);
      if (id === billId && server.failRecord && method === 'GET') return json({}, 500);
      if (method === 'PATCH' || method === 'DELETE') {
        const revision = (init.headers as Record<string, string>)['X-Splitbook-Revision'];
        if (revision !== String(current.revision))
          return json({ error: 'Changed', code: 'STALE_REVISION', status: 409 }, 409);
        const sent = method === 'PATCH' ? JSON.parse(String(init.body)) : {};
        server.records.set(id, {
          ...current,
          ...(sent.notes !== undefined ? { notes: sent.notes } : {}),
          revision: current.revision + 1,
          isDeleted: method === 'DELETE',
        });
      }
      return json({ status: 200, data: server.records.get(id) });
    }
    if (path.startsWith(`${maplePath}/activity?`)) {
      const query = new URL(path, 'http://local').searchParams;
      const page = Number(query.get('page'));
      if (query.get('expenseId') === billId && page === server.failPage) return json({}, 500);
      const all = server.changes.get(query.get('expenseId') ?? '') ?? [];
      return json({
        status: 200,
        data: {
          activities: all.slice((page - 1) * 20, page * 20),
          pagination: {
            page,
            limit: 20,
            total: all.length,
            totalPages: Math.ceil(all.length / 20),
          },
        },
      });
    }
    if (path.startsWith(`${maplePath}/expenses?`))
      return json({
        status: 200,
        data: {
          expenses: [...server.records.values()],
          pagination: { page: 1, limit: 20, total: server.records.size, totalPages: 1 },
          summary: {
            count: server.records.size,
            totalsByCurrency: [],
            userOwes: 0,
            userGetsBack: 0,
            byMember: [],
          },
        },
      });
    if (path === `${maplePath}/balances`)
      return json({
        status: 200,
        data: { byCurrency: [{ currency: 'INR', balances: [], debts: [] }] },
      });
    return json({}, 404);
  };
  /** Cabin Weekend: its one Expense, and an Activity event about it. */
  const cabinAnswer = (path: string): FetchResponse => {
    if (path === cabinPath) return json({ status: 200, data: cabin });
    if (path === `${cabinPath}/expenses/${fareId}`)
      return json({ status: 200, data: { ...record(fareId, 'Ferry'), group: cabinId } });
    if (path.startsWith(`${cabinPath}/activity?`))
      return json({
        status: 200,
        data: {
          activities: [
            {
              _id: hex('f', 1),
              group: cabinId,
              actor: person(sam),
              createdAt: iso,
              type: 'expense_added',
              metadata: { expenseId: fareId, description: 'Ferry', amount: 30, currency: 'INR' },
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
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
        newSubmissionKey: () =>
          `expense-record-queries-${String(server.created + 1).padStart(4, '0')}`,
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
          stores: [savedQueries, readCache, records(drafts), untrustedCopies],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname + new URL(url).search;
          const method = init.method ?? 'GET';
          calls.push({ method, path });
          if (server.offline) throw new TypeError('Network request failed');
          const index = held.findIndex((request) =>
            request.exact ? path === request.path : path.startsWith(request.path),
          );
          const reply = respond(path, init);
          // The write is recorded, then the connection drops before its reply, and stays down.
          if (method !== 'GET' && server.loseWrites) {
            server.offline = true;
            throw new TypeError('Network request failed');
          }
          if (index < 0) return reply;
          // The server answers as it is when the request arrives; the reply comes on release.
          const [request] = held.splice(index, 1);
          request.arrive();
          return request.answer.then(() => reply);
        },
      },
    );
  return {
    create,
    server,
    device,
    rows,
    disk,
    drafts,
    untrusted: () => untrusted.value,
    calls,
    /** Every GET of Maple House since `from`, in order, named for what it reads. */
    gets: (from = 0) =>
      calls
        .slice(from)
        .filter((call) => call.method === 'GET')
        .map(({ path }) => {
          if (path === maplePath) return 'group';
          if (path.startsWith(`${maplePath}/expenses/`))
            return `record ${path.endsWith(billId) ? 'bill' : 'dinner'}`;
          if (path.startsWith(`${maplePath}/activity?`)) {
            const query = new URL(path, 'http://local').searchParams;
            return `history ${query.get('expenseId') === billId ? 'bill' : 'dinner'} p${query.get('page')}`;
          }
          return path;
        }),
    /** The writes sent since `from`. */
    writes: (from = 0) => calls.slice(from).filter((call) => call.method !== 'GET'),
    /** The next request whose path starts with `path` is answered at once; its reply on release. */
    hold(path: string, { exact = false } = {}) {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const answer = new Promise<void>((resolve) => {
        release = resolve;
      });
      held.push({ path, arrive, answer, exact });
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
type Fixture = ReturnType<typeof fixture>;
type Controller = ReturnType<Fixture['create']>;

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
const billChanges = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => hex('d', from + index));
const shownChanges = (controller: Controller) =>
  controller.getSnapshot().expense.history.events.map(({ _id }) => _id);

async function signedIn(f: Fixture) {
  const controller = f.create();
  await controller.signIn('alex');
  return controller;
}
/** Alex has the bill open with `pages` pages of its changes loaded. */
async function withPages(f: Fixture, pages: number) {
  const controller = await signedIn(f);
  await controller.openExpense(mapleId, billId);
  for (let page = 2; page <= pages; page += 1) await controller.loadOlderExpenseHistory();
  return controller;
}

describe('an Expense record on declarative queries (#220, M1-1)', () => {
  it('reads the record beside its Group, and shows it once the Group’s check passes, then its changes', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    const from = f.calls.length;
    const group = f.hold(maplePath, { exact: true });
    const opening = controller.openExpense(mapleId, billId);
    await group.reached;
    await settle();
    // Sent together (owner decision, 2026-10-06), but nothing shows before the Group's check.
    expect(f.gets(from)).toEqual(['group', 'record bill']);
    expect(controller.getSnapshot().expense).toMatchObject({ status: 'loading', draft: null });
    group.release();
    await opening;
    expect(f.gets(from)).toEqual(['group', 'record bill', 'history bill p1']);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { original: { _id: billId, revision: 1 } },
      history: { expenseId: billId, status: 'ready', pagination: { page: 1, totalPages: 7 } },
    });
  });

  it('drops the record read beside a Group that refuses the member, with one request more than before', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await settle();
    const from = f.calls.length;
    f.server.group = 403;
    await controller.openExpense(mapleId, billId);
    await settle();
    // The record was already on its way: the one extra request the owner accepted.
    expect(f.gets(from)).toEqual(['group', 'record bill']);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: {
        status: 'blocked',
        draft: null,
        message: 'You no longer have access to this group.',
        history: { status: 'idle', events: [] },
      },
    });
    expect(f.savedRows(maplePath)).toEqual([]);
  });
});

describe('drafts come first (M6-1)', () => {
  it('updates a record shown read-only when it is read again on reconnecting', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    f.server.records.set(billId, record(billId, 'Electricity bill (August)', 2));
    later(31_000);
    f.connect(false);
    f.connect(true);
    await settle();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: {
        description: 'Electricity bill (August)',
        original: { revision: 2, description: 'Electricity bill (August)' },
      },
    });
  });

  it('never replaces a draft being edited, or the one stored, when the record is read again', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Meter read on the 20th' });
    const stored = structuredClone(f.drafts.get(`${alex.id}${mapleId}`));
    f.server.records.set(billId, record(billId, 'Electricity bill (August)', 2));
    later(31_000);
    const from = f.calls.length;
    f.connect(false);
    f.connect(true);
    await settle();
    await controller.refresh();
    expect(f.gets(from)).toContain('record bill');
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'editing',
      draft: {
        description: 'Electricity bill',
        notes: 'Meter read on the 20th',
        original: { revision: 1 },
      },
    });
    expect(f.drafts.get(`${alex.id}${mapleId}`)).toEqual(stored);
  });

  it('never changes an unconfirmed save when the record is read again, and sends nothing again', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Meter read on the 20th' });
    f.server.loseWrites = true;
    await controller.saveExpense();
    f.server.loseWrites = false;
    f.server.offline = false;
    const unconfirmed = controller.getSnapshot().expense;
    expect(unconfirmed).toMatchObject({ status: 'uncertain', mutation: { revision: 1 } });
    const stored = structuredClone(f.drafts.get(`${alex.id}${mapleId}`));
    later(31_000);
    const from = f.calls.length;
    f.connect(false);
    f.connect(true);
    await settle();
    await controller.refresh();
    expect(f.writes(from)).toEqual([]);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'uncertain',
      mutation: unconfirmed.mutation,
      draft: { notes: 'Meter read on the 20th', original: { revision: 1 } },
    });
    expect(f.drafts.get(`${alex.id}${mapleId}`)).toEqual(stored);
  });

  it('shows the version read meanwhile once a delete review over the record is cancelled', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    controller.reviewExpenseDeletion();
    f.server.records.set(billId, record(billId, 'Electricity bill (August)', 2));
    await controller.refresh();
    // The review keeps the version it was shown: Delete would send its revision.
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'delete-review',
      draft: { original: { revision: 1 } },
    });
    controller.cancelExpenseDeletion();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: {
        description: 'Electricity bill (August)',
        original: { revision: 2 },
      },
    });
  });
});

describe('reconnecting and the foreground (M1-4, M1-6)', () => {
  it('reads the record and its changes again on reconnecting after they opened offline, and the notice clears', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    await controller.back();
    await settle();
    const savedAt = Date.now();
    later(60_000);
    f.connect(false);
    await controller.openExpense(mapleId, billId);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true, refreshedAt: savedAt },
      expense: { status: 'detail', history: { status: 'ready' } },
    });
    f.server.records.set(billId, record(billId, 'Electricity bill (August)', 2));
    const from = f.calls.length;
    f.connect(true);
    await settle();
    expect(f.gets(from)).toEqual(
      expect.arrayContaining(['group', 'record bill', 'history bill p1']),
    );
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      expense: { status: 'detail', draft: { original: { revision: 2 } } },
    });
  });

  it.each([
    [403, 'You no longer have access to this group.'],
    [404, 'This group is no longer available.'],
  ] as const)(
    'withdraws the record when its Group answers %i on reconnecting',
    async (status, message) => {
      const f = fixture();
      const controller = await signedIn(f);
      await controller.openExpense(mapleId, billId);
      later(60_000);
      f.connect(false);
      f.server.group = status;
      f.connect(true);
      await settle();
      expect(controller.getSnapshot().expense).toMatchObject({
        status: 'blocked',
        draft: null,
        message,
        history: { status: 'idle', events: [] },
      });
      expect(f.savedRows(maplePath)).toEqual([]);
    },
  );

  it('reads the Group again on the foreground only past its stale time, through TanStack’s focus event, and never the record', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    let from = f.calls.length;
    later(10_000);
    await controller.refresh('foreground');
    expect(f.gets(from)).toEqual(['/api/auth/get-session']);
    from = f.calls.length;
    later(31_000);
    await controller.refresh('foreground');
    expect(f.gets(from)).toEqual(['/api/auth/get-session', 'group']);
  });
});

describe('its changes: one query of up to 5 pages (M1-3, M7-2)', () => {
  it('reads both loaded pages again on a refresh, keeping the changes shown, marked as refreshing', async () => {
    const f = fixture();
    const controller = await withPages(f, 2);
    expect(shownChanges(controller)).toEqual(billChanges(1, 40));
    const from = f.calls.length;
    const first = f.hold(historyPath(billId, 1), { exact: true });
    const refreshing = controller.refreshExpenseHistory();
    await first.reached;
    await settle();
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'loading',
      pagination: { page: 2 },
    });
    expect(shownChanges(controller)).toEqual(billChanges(1, 40));
    first.release();
    await refreshing;
    expect(f.gets(from)).toEqual(['history bill p1', 'history bill p2']);
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
      pagination: { page: 2 },
    });
    expect(shownChanges(controller)).toEqual(billChanges(1, 40));
  });

  it('slides past 5 pages: Load older reads page 6, the history holds pages 2 to 6, and Load newer appears', async () => {
    const f = fixture();
    const controller = await withPages(f, 5);
    expect(controller.getSnapshot().expense.history).toMatchObject({ firstPage: 1 });
    expect(shownChanges(controller)).toEqual(billChanges(1, 100));
    const from = f.calls.length;
    await controller.loadOlderExpenseHistory();
    expect(f.gets(from)).toEqual(['history bill p6']);
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
      firstPage: 2,
      pagination: { page: 6, totalPages: 7 },
    });
    expect(shownChanges(controller)).toEqual(billChanges(21, 120));
  });

  it('Load newer reads page 1, the history holds pages 1 to 5 again, and Load newer goes away', async () => {
    const f = fixture();
    const controller = await withPages(f, 6);
    const from = f.calls.length;
    await controller.loadNewerExpenseHistory();
    expect(f.gets(from)).toEqual(['history bill p1']);
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
      firstPage: 1,
      pagination: { page: 5 },
    });
    expect(shownChanges(controller)).toEqual(billChanges(1, 100));
    // At page 1 there is nothing newer to read.
    await controller.loadNewerExpenseHistory();
    expect(f.gets(from)).toEqual(['history bill p1']);
  });

  it('says Load newer is loading while it reads, and keeps the changes with an error when it fails', async () => {
    const f = fixture();
    const controller = await withPages(f, 6);
    f.server.failPage = 1;
    const newer = f.hold(historyPath(billId, 1), { exact: true });
    const loading = controller.loadNewerExpenseHistory();
    await newer.reached;
    await settle();
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
      newerStatus: 'loading',
      firstPage: 2,
    });
    newer.release();
    await loading;
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
      newerStatus: 'error',
      firstPage: 2,
    });
    expect(shownChanges(controller)).toEqual(billChanges(21, 120));
    // Trying again reads page 1, in its place.
    f.server.failPage = 0;
    await controller.loadNewerExpenseHistory();
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
      newerStatus: 'idle',
      firstPage: 1,
    });
  });

  it('shows the oldest verification time among the pages in its window, after Load newer too', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    const first = Date.now();
    await controller.openExpense(mapleId, billId);
    for (let page = 2; page <= 5; page += 1) {
      later(1_000);
      await controller.loadOlderExpenseHistory();
    }
    expect(controller.getSnapshot().expense.history.refreshedAt).toBe(first);
    later(1_000);
    await controller.loadOlderExpenseHistory();
    // Page 1 has dropped: page 2, read a second later, is now the oldest.
    expect(controller.getSnapshot().expense.history.refreshedAt).toBe(first + 1_000);
    later(1_000);
    await controller.loadNewerExpenseHistory();
    // Page 1 read just now never makes the older pages look fresh.
    expect(controller.getSnapshot().expense.history).toMatchObject({
      firstPage: 1,
      refreshedAt: first + 1_000,
    });
  });

  it('keeps changes de-duplicated by id across pages', async () => {
    const f = fixture();
    const controller = await withPages(f, 1);
    // A change added above shifts the bill's first change from page 1 onto page 2.
    const changes = f.server.changes.get(billId)!;
    f.server.changes.set(billId, [{ ...(changes[0] as object), _id: hex('d', 999) }, ...changes]);
    await controller.loadOlderExpenseHistory();
    const shown = shownChanges(controller);
    // Page 2 now starts with the first page's last change: it's listed once.
    expect(shown).toEqual(billChanges(1, 39));
  });
});

describe('saved copies on the persister (M3-1)', () => {
  it('saves the record and each page of its changes one row per query, in the wire JSON, with each page’s time, never in the older store', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    const first = Date.now();
    await controller.openExpense(mapleId, billId);
    later(1_000);
    await controller.loadOlderExpenseHistory();
    await settle();
    expect(f.savedRows(recordPath(billId))).toEqual([
      expect.objectContaining({
        path: recordPath(billId),
        refreshedAt: first,
        value: { status: 200, data: record(billId, 'Electricity bill') },
      }),
    ]);
    expect(f.savedRows(`${maplePath}/activity?expenseId=${billId}`)).toEqual([
      expect.objectContaining({ path: historyPath(billId, 1), refreshedAt: first }),
      expect.objectContaining({ path: historyPath(billId, 2), refreshedAt: first + 1_000 }),
    ]);
    expect(
      [...f.disk.keys()].filter((key) => key.includes('/expenses/') || key.includes('/activity?')),
    ).toEqual([]);
  });

  it('shows them after an offline restart with their original times, never as fresh, and reads them again on reconnect', async () => {
    const f = fixture();
    const first = await signedIn(f);
    const savedAt = Date.now();
    await first.openExpense(mapleId, billId);
    await settle();
    first.dispose();
    later(5_000);
    f.server.offline = true;
    const restarted = f.create();
    await restarted.restore();
    await restarted.openExpense(mapleId, billId);
    expect(restarted.getSnapshot()).toMatchObject({
      offline: { active: true, refreshedAt: savedAt },
      expense: {
        status: 'detail',
        draft: { original: { _id: billId } },
        history: { status: 'ready', refreshedAt: savedAt },
      },
    });
    expect(shownChanges(restarted)).toEqual(billChanges(1, 20));
    const from = f.calls.length;
    f.connect(true);
    await settle();
    expect(f.gets(from)).toEqual(
      expect.arrayContaining(['group', 'record bill', 'history bill p1']),
    );
    expect(restarted.getSnapshot()).toMatchObject({
      offline: { active: false },
      expense: { history: { refreshedAt: Date.now() } },
    });
  });
});

describe('after a write (M2-2)', () => {
  it.each(['confirmed', 'unconfirmed'] as const)(
    'removes the Group’s record and history rows after an %s edit',
    async (outcome) => {
      const f = fixture();
      const controller = await signedIn(f);
      await controller.openExpense(mapleId, dinnerId);
      await controller.back();
      await controller.openExpense(mapleId, billId);
      await settle();
      expect(f.savedRows(recordPath(dinnerId))).toHaveLength(1);
      await controller.editExpense();
      await controller.updateExpenseDraft({ notes: 'Meter read on the 20th' });
      f.server.loseWrites = outcome === 'unconfirmed';
      await controller.saveExpense();
      f.server.loseWrites = false;
      f.server.offline = false;
      expect(controller.getSnapshot().expense.status).toBe(
        outcome === 'confirmed' ? 'saved' : 'uncertain',
      );
      await settle();
      expect(f.savedRows(`${maplePath}/expenses/`)).toEqual([]);
      expect(f.savedRows(`${maplePath}/activity?`)).toEqual([]);
      expect(controller.getSnapshot().auth.status).toBe('authenticated');
    },
  );

  it('never shows a record copy it could not remove after an edit, and keeps the member signed in', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, dinnerId);
    await controller.back();
    await controller.openExpense(mapleId, billId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Meter read on the 20th' });
    f.device.failRemoval = true;
    await controller.saveExpense();
    await settle();
    expect(controller.getSnapshot().auth).toMatchObject({ status: 'authenticated' });
    // The dinner's copy from before the edit is still here, but never stands in for a read.
    f.server.offline = true;
    await controller.openExpense(mapleId, dinnerId);
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated' },
      expense: {
        status: 'blocked',
        draft: null,
        message: 'This view was not saved on this device. Connect to load it.',
      },
    });
  });
});

describe('sessions and access for the record (#173 gates)', () => {
  it('shows nothing of the previous account after a switch, with a read in flight and a row being written', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    const writing = f.holdWrite(recordPath(billId));
    const reading = f.hold(historyPath(billId, 2), { exact: true });
    await controller.openExpense(mapleId, billId);
    const older = controller.loadOlderExpenseHistory();
    await Promise.all([writing.reached, reading.reached]);
    const switching = controller.signIn('sam');
    await settle();
    writing.release();
    reading.release();
    await Promise.all([switching, older]);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { user: { id: sam.id } },
      screen: 'groups',
    });
    expect(controller.getSnapshot().expense.history.events).toEqual([]);
    expect([...f.rows.keys()].some((key) => key.startsWith(alex.id))).toBe(false);
  });

  it('removes a lost Group’s record and changes from memory and this device, and a late answer brings none of it back', async () => {
    const f = fixture();
    const controller = await withPages(f, 2);
    await settle();
    expect(f.savedRows(`${maplePath}/activity?`)).toHaveLength(2);
    const late = f.hold(historyPath(billId, 1), { exact: true });
    const refreshing = controller.refreshExpenseHistory();
    await late.reached;
    // Access is lost while the changes are on their way: the next read is refused.
    f.server.group = 403;
    await controller.refresh();
    late.release();
    await refreshing;
    await settle();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'blocked',
      draft: null,
      history: { events: [] },
    });
    expect(f.savedRows(maplePath)).toEqual([]);
  });

  it('never shows or saves a record that answers after sign-out', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    const late = f.hold(recordPath(billId), { exact: true });
    const opening = controller.openExpense(mapleId, billId);
    await late.reached;
    await controller.signOut();
    late.release();
    await opening;
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'signed-out' },
      expense: { draft: null },
    });
    expect(f.rows.size).toBe(0);
  });

  it('shows nothing of a record that answers after the member left it, or opened another', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    const late = f.hold(recordPath(billId), { exact: true });
    const opening = controller.openExpense(mapleId, billId);
    await late.reached;
    await controller.back();
    await controller.openExpense(mapleId, dinnerId);
    late.release();
    await opening;
    await settle();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { original: { _id: dinnerId } },
      history: { expenseId: dinnerId },
    });
  });

  it('removes a row still being written when its Group is lost, once it lands', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    const writing = f.holdWrite(historyPath(billId, 1));
    await controller.openExpense(mapleId, billId);
    await writing.reached;
    f.server.group = 403;
    await controller.refresh();
    writing.release();
    await settle();
    expect(f.savedRows(maplePath)).toEqual([]);
    expect(controller.getSnapshot().expense).toMatchObject({ status: 'blocked', draft: null });
  });
});

// The loading-state audit's items for the Expense record (2026-10-07, owner approved).
describe('opening an Expense: what is already known shows at once (loading-state audit)', () => {
  it('shows the record this device saved at once, before its Group answers, and refreshes it in place', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    const savedAt = Date.now();
    await controller.openExpense(mapleId, billId);
    await controller.back();
    await settle();
    f.server.records.set(billId, record(billId, 'Electricity bill (August)', 2));
    later(60_000);
    const group = f.hold(maplePath, { exact: true });
    const opening = controller.openExpense(mapleId, billId);
    await group.reached;
    await settle();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { original: { revision: 1, description: 'Electricity bill' } },
      known: { refreshedAt: savedAt, refreshing: true },
    });
    group.release();
    await opening;
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { original: { revision: 2, description: 'Electricity bill (August)' } },
      known: null,
    });
  });

  it('reopens an Expense this device never saved on Try again, once connected (#280 item 3)', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    f.server.offline = true;
    await controller.openExpense(mapleId, dinnerId);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true },
      expense: {
        status: 'blocked',
        draft: null,
        message: 'This view was not saved on this device. Connect to load it.',
      },
    });
    f.server.offline = false;
    await controller.refresh('retry');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      offline: { active: false },
      expense: { status: 'detail', draft: { original: { _id: dinnerId } } },
    });
  });
});
// Found in review: what a read that fails, or a member who moves on, leaves behind.
describe('reads that fail, and a member who moves on, while the record opens', () => {
  it('says its changes couldn’t be read again when a reopened record’s first page fails', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    await controller.back();
    f.server.failPage = 1;
    await controller.openExpense(mapleId, billId);
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'error',
      message: 'Couldn’t load this Expense’s changes.',
    });
    f.server.failPage = 0;
    await controller.refreshExpenseHistory();
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
    });
  });

  it('says older changes couldn’t be read each time they fail, with the changes kept', async () => {
    const f = fixture();
    const controller = await withPages(f, 2);
    f.server.failPage = 2;
    await controller.refreshExpenseHistory();
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
      moreStatus: 'error',
    });
    await controller.loadOlderExpenseHistory();
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
      moreStatus: 'error',
    });
    expect(shownChanges(controller)).toEqual(billChanges(1, 20));
  });

  it('reads the changes of a record shown from this device, after the member went on to delete it', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    await controller.back();
    later(60_000);
    const group = f.hold(maplePath, { exact: true });
    const opening = controller.openExpense(mapleId, billId);
    await group.reached;
    await settle();
    controller.reviewExpenseDeletion();
    const from = f.calls.length;
    group.release();
    await opening;
    await settle();
    expect(f.gets(from)).toEqual(['history bill p1']);
    controller.cancelExpenseDeletion();
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
    });
  });

  it('keeps a record shown from this device, with when it was saved, when reading it fails, and reads it once', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    const savedAt = Date.now();
    await controller.openExpense(mapleId, billId);
    await controller.back();
    later(60_000);
    f.server.failRecord = true;
    const from = f.calls.length;
    await controller.openExpense(mapleId, billId);
    await settle();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { original: { revision: 1 } },
      known: { refreshedAt: savedAt, refreshing: false },
      message: 'The server could not complete this request. Please try again.',
      history: { status: 'ready' },
    });
    expect(f.gets(from).filter((read) => read === 'record bill')).toHaveLength(1);
  });

  it('never shows a record this device knew once its Group can’t be checked', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    await controller.back();
    later(60_000);
    f.server.group = 500;
    await controller.openExpense(mapleId, billId);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'blocked',
      draft: null,
    });
  });

  it('reads the first page of changes again when the record opens anew while an older page loads', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    const older = f.hold(historyPath(billId, 2), { exact: true });
    const loading = controller.loadOlderExpenseHistory();
    await older.reached;
    await controller.back();
    const from = f.calls.length;
    await controller.openExpense(mapleId, billId);
    older.release();
    await loading;
    await settle();
    expect(f.gets(from)).toContain('history bill p1');
    expect(controller.getSnapshot().expense.history).toMatchObject({
      status: 'ready',
      pagination: { page: 1 },
    });
    expect(shownChanges(controller)).toEqual(billChanges(1, 20));
  });
});

// The money-safety review of #220 (2026-10-07): an open that fails never overwrites a save in
// flight, no row is saved for a Group lost or left out of the list, and an Expense gone stays gone.
describe('a save in flight while the record’s open fails (D6)', () => {
  /**
   * Alex opens the bill again a minute later, beside a new Expense drafted in its Group with
   * `draft`; its Group's check, held, will answer `status`.
   */
  async function reopened(f: Fixture, { draft = false, status = 500 } = {}) {
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    await controller.back();
    if (draft) {
      await controller.openExpense(mapleId);
      await controller.updateExpenseDraft({ description: 'Fresh groceries', amount: '30', tagId });
      await controller.back();
    }
    await settle();
    later(60_000);
    f.server.group = status;
    const check = f.hold(maplePath, { exact: true });
    const opening = controller.openExpense(mapleId, billId);
    await check.reached;
    await settle();
    f.server.group = 200;
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { original: { _id: billId } },
      known: { refreshing: true },
      groupDraft: draft ? { description: 'Fresh groceries' } : null,
    });
    return { controller, check, opening };
  }

  it('keeps a delete being sent from the record this device knew, and sends it once', async () => {
    const f = fixture();
    const { controller, check, opening } = await reopened(f);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      known: { refreshing: true },
    });
    controller.reviewExpenseDeletion();
    const from = f.calls.length;
    const sent = f.hold(recordPath(billId), { exact: true });
    const deleting = controller.deleteExpense();
    await sent.reached;
    check.release();
    await opening;
    // The open's failure lands while the DELETE is on its way: the save is untouched.
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'saving',
      mutation: { kind: 'delete', revision: 1 },
      message: null,
    });
    controller.resumeExpenseDraft();
    expect(controller.getSnapshot().expense.status).toBe('saving');
    sent.release();
    await deleting;
    await settle();
    expect(f.writes(from)).toEqual([{ method: 'DELETE', path: recordPath(billId) }]);
    expect(f.server.records.get(billId)).toMatchObject({ revision: 2, isDeleted: true });
    expect(controller.getSnapshot().screen).toBe('group');
  });

  it('keeps a delete whose own check is still on its way, and sends nothing else meanwhile', async () => {
    const f = fixture();
    const { controller, check, opening } = await reopened(f);
    controller.reviewExpenseDeletion();
    const from = f.calls.length;
    const deleteCheck = f.hold(maplePath, { exact: true });
    const deleting = controller.deleteExpense();
    await deleteCheck.reached;
    check.release();
    await opening;
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'saving',
      mutation: null,
      message: null,
    });
    // Nothing offers Resume, an edit or another save while the delete runs.
    controller.resumeExpenseDraft();
    await controller.updateExpenseDraft({ notes: 'Meter read on the 20th' });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('saving');
    deleteCheck.release();
    await deleting;
    await settle();
    expect(f.writes(from)).toEqual([{ method: 'DELETE', path: recordPath(billId) }]);
    expect(f.server.records.get(billId)).toMatchObject({ revision: 2, isDeleted: true });
  });

  it('keeps a new Expense being saved from the Group’s draft, and records it once', async () => {
    const f = fixture();
    const { controller, check, opening } = await reopened(f, { draft: true });
    controller.resumeExpenseDraft();
    const from = f.calls.length;
    const post = f.hold(`${maplePath}/expenses`, { exact: true });
    const saving = controller.saveExpense();
    await post.reached;
    check.release();
    await opening;
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'saving',
      draft: { description: 'Fresh groceries' },
      message: null,
    });
    post.release();
    await saving;
    await settle();
    expect(f.writes(from)).toEqual([{ method: 'POST', path: `${maplePath}/expenses` }]);
    expect(f.server.created).toBe(1);
    expect(controller.getSnapshot().screen).toBe('group');
  });

  it('keeps the Group’s draft resumed while the record’s open completes, and reads none of the record’s changes', async () => {
    const f = fixture();
    const { controller, check, opening } = await reopened(f, { draft: true, status: 200 });
    controller.resumeExpenseDraft();
    const from = f.calls.length;
    check.release();
    await opening;
    await settle();
    expect(f.gets(from)).toEqual([]);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'editing',
      draft: { description: 'Fresh groceries' },
      context: { group: { id: mapleId } },
    });
  });

  it('keeps an edit begun from the record this device knew, and says why it couldn’t be read', async () => {
    const f = fixture();
    const { controller, check, opening } = await reopened(f);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Meter read on the 20th' });
    check.release();
    await opening;
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'editing',
      draft: { notes: 'Meter read on the 20th', original: { revision: 1 } },
      message: 'The server could not complete this request. Please try again.',
    });
  });

  it('leaves an edit being saved alone when a read on reconnecting finds the Expense gone', async () => {
    const f = fixture();
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    later(31_000);
    // The Expense was deleted elsewhere: the reconnect's read, then the PATCH, answer 404.
    f.server.gone.add(billId);
    const reread = f.hold(recordPath(billId), { exact: true });
    f.connect(false);
    f.connect(true);
    await reread.reached;
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Meter read on the 20th' });
    const sent = f.hold(recordPath(billId), { exact: true });
    const saving = controller.saveExpense();
    await sent.reached;
    reread.release();
    await settle();
    // Its form keeps the Group's details, as an edit does.
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'saving',
      draft: { notes: 'Meter read on the 20th' },
      mutation: { kind: 'edit', revision: 1 },
      context: { group: { id: mapleId } },
    });
    // The save meets the 404 itself, and keeps the member's draft.
    sent.release();
    await saving;
    expect(controller.getSnapshot().expense).toMatchObject({
      draft: { notes: 'Meter read on the 20th' },
      message:
        'This Expense is unavailable or you no longer have access. Your draft is kept; saving is disabled.',
    });
  });
});

describe('rows saved only while their Group is kept here', () => {
  it('never writes a page row queued behind one being written when the Group is lost', async () => {
    const f = fixture();
    const controller = await withPages(f, 2);
    await settle();
    const writing = f.holdWrite(historyPath(billId, 1));
    const refreshing = controller.refreshExpenseHistory();
    await writing.reached;
    // Page 2's row waits behind page 1's, which lands after the loss's removal.
    f.server.group = 403;
    await controller.refresh();
    writing.release();
    await refreshing;
    await settle();
    expect(f.savedRows(maplePath)).toEqual([]);
  });

  it('saves nothing of an Expense in a Group the Groups list leaves out, as it does archived ones', async () => {
    const f = fixture();
    f.server.archived.add(mapleId);
    const controller = await signedIn(f);
    await controller.openExpense(mapleId, billId);
    await controller.loadOlderExpenseHistory();
    await settle();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      history: { status: 'ready', pagination: { page: 2 } },
    });
    expect(f.savedRows(maplePath)).toEqual([]);
  });
});
