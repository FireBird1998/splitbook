import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { FreshSnapshot, Unrouted } from './mobile-controller';
import type { FetchResponse, MobileSnapshot } from './types';

// The route as a member meets it (ADR 0006, M8-2, #216): where Back goes from every screen and
// what holds it, that moving around never writes, that reads never move the member, and that
// the end of a session leaves nothing of where the member was. Driven through the controller's
// commands and snapshot only (M0-1). Fictional people and Groups only.

const alex = {
  id: 'a00000000000000000000001',
  name: 'Alex Rivera',
  email: 'alex@example.test',
  image: null,
};
const sam = {
  id: 'a00000000000000000000002',
  name: 'Sam Chen',
  email: 'sam@example.test',
  image: null,
};
type Person = typeof alex;
const householdId = 'b00000000000000000000001',
  tripId = 'b00000000000000000000002',
  createdId = 'b00000000000000000000003',
  tagId = 'c00000000000000000000001',
  recordId = 'e00000000000000000000001',
  expenseEventId = 'd00000000000000000000001',
  joinEventId = 'd00000000000000000000002',
  code = 'abcdef12',
  link = `http://localhost:4150/join/${code}`;
const iso = '2026-09-28T12:00:00.000Z';

const json = (body: unknown, status = 200, cookie?: string): FetchResponse =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { 'Set-Cookie': `${cookie}; HttpOnly; Path=/; Max-Age=2592000` } : {}),
    },
  });
const person = (user: Person) => ({
  _id: user.id,
  name: user.name,
  email: user.email,
  image: null,
});
const group = (id: string, name: string, category: 'home' | 'trip') => ({
  _id: id,
  name,
  description: '',
  createdBy: alex.id,
  category,
  defaultCurrency: 'INR',
  members: [alex, sam].map((user) => ({ user: person(user), role: 'admin', joinedAt: iso })),
  tags: [{ _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
const groups = [group(householdId, 'Maple House', 'home'), group(tripId, 'Goa trip', 'trip')];
const expense = (id: string, description: string, date: string) => ({
  _id: id,
  group: householdId,
  revision: 0,
  description,
  amount: 30,
  amountMinor: 3000,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: { _id: alex.id, name: alex.name, image: null }, amount: 30, amountMinor: 3000 }],
  splitBetween: [alex, sam].map((user) => ({
    user: { _id: user.id, name: user.name, image: null },
    amount: 15,
    amountMinor: 1500,
  })),
  splitMethod: 'equal',
  date,
  createdAt: iso,
  updatedAt: iso,
  category: 'food',
  tagId,
  tag: 'Groceries',
  notes: '',
  isDeleted: false,
  editHistory: [],
});
// One saved Expense in August, and 25 in September: two pages of that Month.
const ledger = [
  expense(recordId, 'Electricity', '2026-08-20T12:00:00.000Z'),
  ...Array.from({ length: 25 }, (_, index) =>
    expense(
      `e1${String(index).padStart(22, '0')}`,
      `Fictional groceries ${index + 1}`,
      `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    ),
  ),
];
const events = [
  {
    _id: expenseEventId,
    group: householdId,
    type: 'expense_added',
    actor: { _id: alex.id, name: alex.name },
    createdAt: iso,
    metadata: { expenseId: recordId, description: 'Electricity', amount: 30, currency: 'INR' },
  },
  {
    _id: joinEventId,
    group: householdId,
    type: 'member_joined',
    actor: { _id: sam.id, name: sam.name },
    createdAt: iso,
    metadata: { userId: sam.id },
  },
];

interface Hold {
  reached: Promise<void>;
  release: () => void;
}

const googleClient = 'route-test.apps.example';

/** One phone, its storage and a fictional server. `google`: a staging build with Google sign-in. */
function world({ google = false } = {}) {
  const clock = { now: Date.parse(iso) };
  const server = {
    sessions: new Map<string, Person>(),
    /** Groups whose reads are refused (403), as when the member loses access. */
    refused: new Set<string>(),
    /** Groups that are gone (404). */
    gone: new Set<string>(),
    /** Groups whose own read fails with a server error (500). */
    failing: new Set<string>(),
    /** Every Expense page read fails with a server error (500). */
    failExpenses: false,
    /** Every signed-in request is answered 401, as when the session ends on the server. */
    expired: false,
  };
  /** The Google account chooser: who the next one picks, and a hook for when it opens. */
  const chooser: { next: Promise<Person>; opened: () => void } = {
    next: Promise.resolve(alex),
    opened: () => undefined,
  };
  const requests: { method: string; path: string }[] = [];
  const holds: { method: string; match: RegExp; wait: Promise<void>; arrive: () => void }[] = [];
  const device = {
    cookie: null as string | null,
    owner: null as string | null,
    identity: null as unknown,
    cleanup: false,
    pending: null as string | null,
    failDraftWrites: false,
    cache: new Map<string, unknown>(),
    drafts: new Map<string, unknown>(),
    payments: new Map<string, unknown>(),
    creations: new Map<string, unknown>(),
  };
  let keys = 0;

  const respond = (method: string, url: URL, init: RequestInit, cookie: string | null) => {
    const path = url.pathname;
    if (path === '/.well-known/splitbook-mobile.json')
      return json({ environment: 'staging', googleWebClientId: googleClient });
    if (path === '/api/auth/demo-persona/sign-in' || path === '/api/auth/sign-in/social') {
      const user = String(init.body).includes('sam') ? sam : alex;
      const issued = `better-auth.session_token=${user === sam ? 'sam' : 'alex'}-${server.sessions.size + 1}.signature`;
      server.sessions.set(issued, user);
      return json({ user }, 200, issued);
    }
    if (path === '/api/auth/sign-out') return json({ success: true });
    const user = cookie ? server.sessions.get(cookie) : undefined;
    if (!user || server.expired) return json({ error: 'Unauthorized' }, 401);
    if (path === '/api/auth/get-session')
      return json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00.000Z' } });
    if (path === '/api/groups' && method === 'POST')
      return json({ status: 201, data: group(createdId, 'Corner Flat', 'home') }, 201);
    if (path === '/api/groups')
      return json({ status: 200, data: groups.filter(({ _id }) => !server.refused.has(_id)) });
    if (path === '/api/user/balances') return json({ status: 200, data: { buckets: [] } });
    if (path === `/api/join/${code}`)
      return method === 'POST'
        ? json({ status: 200, data: { groupId: tripId } })
        : json({
            status: 200,
            data: { _id: tripId, name: 'Goa trip', category: 'trip', memberCount: 2 },
          });
    const target = groups.find(({ _id }) => path.startsWith(`/api/groups/${_id}`));
    if (!target || server.gone.has(target._id)) return json({ status: 404 }, 404);
    if (server.refused.has(target._id)) return json({ error: 'Forbidden', status: 403 }, 403);
    const base = `/api/groups/${target._id}`;
    if (path === base && server.failing.has(target._id)) return json({ status: 500 }, 500);
    if (path === base) return json({ status: 200, data: target });
    if (path === `${base}/balances`)
      return json({
        status: 200,
        data: {
          byCurrency: [
            {
              currency: 'INR',
              balances: [],
              debts: [{ from: person(alex), to: person(sam), amount: 30 }],
            },
          ],
        },
      });
    if (path === `${base}/leave`)
      return json({ status: 200, data: { message: 'Left group', archived: false } });
    if (path === `${base}/settlements`)
      return json(
        {
          status: 201,
          data: {
            _id: 'f00000000000000000000001',
            group: target._id,
            paidBy: person(alex),
            paidTo: person(sam),
            createdBy: person(alex),
            amount: 30,
            amountMinor: 3000,
            moneyVersion: 1,
            currency: 'INR',
            note: '',
            createdAt: iso,
            updatedAt: iso,
          },
        },
        201,
      );
    if (path === `${base}/activity`) {
      const expenseId = url.searchParams.get('expenseId');
      const shown = events.filter(
        (event) =>
          event.group === target._id && (!expenseId || event.metadata.expenseId === expenseId),
      );
      return json({
        status: 200,
        data: {
          activities: shown,
          pagination: { page: 1, limit: 20, total: shown.length, totalPages: 1 },
        },
      });
    }
    if (path === `${base}/expenses` && method === 'POST')
      return json(
        { status: 201, data: { _id: 'e20000000000000000000001', group: target._id } },
        201,
      );
    if (path === `${base}/expenses` && server.failExpenses) return json({ status: 500 }, 500);
    if (path === `${base}/expenses`) {
      const from = url.searchParams.get('dateFrom'),
        to = url.searchParams.get('dateTo'),
        page = Number(url.searchParams.get('page'));
      const rows = ledger
        .filter(
          (row) =>
            row.group === target._id && (!from || row.date >= from) && (!to || row.date <= to),
        )
        .sort((a, b) => b.date.localeCompare(a.date));
      return json({
        status: 200,
        data: {
          expenses: rows.slice((page - 1) * 20, page * 20),
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
    const record = ledger.find((row) => path === `${base}/expenses/${row._id}`);
    return record ? json({ status: 200, data: record }) : json({ status: 404 }, 404);
  };

  const records = (map: Map<string, unknown>, writable = () => true) => ({
    load: async (account: string, id: string) =>
      structuredClone(map.get(`${account}:${id}`) ?? null),
    save: async (account: string, id: string, value: unknown) => {
      if (!writable()) throw new Error('This device could not store the record.');
      map.set(`${account}:${id}`, structuredClone(value));
    },
    remove: async (account: string, id: string) => {
      map.delete(`${account}:${id}`);
    },
    clear: async () => {
      map.clear();
    },
    list: async (account: string) =>
      [...map]
        .filter(([key]) => key.startsWith(`${account}:`))
        .map(([key, value]) => ({ groupId: key.split(':')[1], value: structuredClone(value) })),
  });

  const origin = google ? 'https://staging.splitbook.test' : 'http://localhost:4150';
  const controller = createMobileController(
    {
      apiBaseUrl: origin,
      authOrigin: origin,
      developmentPersonaEnabled: true,
      ...(google && { googleWebClientId: googleClient }),
    },
    {
      googleSignIn: async () => {
        chooser.opened();
        const user = await chooser.next;
        return { status: 'success', idToken: `${user === sam ? 'sam' : 'alex'}-id`, nonce: 'n' };
      },
      now: () => clock.now,
      newSubmissionKey: () => `route-key-${String(++keys).padStart(4, '0')}`,
      credentials: {
        load: async () => device.cookie,
        save: async (value) => {
          device.cookie = value;
        },
        clear: async () => {
          device.cookie = null;
        },
      },
      pendingInvitation: {
        load: async () => device.pending,
        save: async (value) => {
          device.pending = value;
        },
        clear: async () => {
          device.pending = null;
        },
      },
      offlineIdentity: {
        load: async () => structuredClone(device.identity),
        save: async (value) => {
          device.identity = structuredClone(value);
        },
        clear: async () => {
          device.identity = null;
        },
      },
      readCache: {
        retainGroups: async () => undefined,
        invalidateGroup: async (account, id) => {
          for (const key of device.cache.keys())
            if (key.startsWith(`${account}/api/groups/${id}`)) device.cache.delete(key);
        },
        invalidateLedger: async (account, id) => {
          for (const key of device.cache.keys())
            if (key.startsWith(`${account}/api/groups/${id}/`)) device.cache.delete(key);
        },
        load: async (account, key) => structuredClone(device.cache.get(account + key) ?? null),
        save: async (account, key, value) => {
          device.cache.set(account + key, structuredClone(value));
        },
        clear: async () => {
          device.cache.clear();
        },
      },
      expenseDrafts: records(device.drafts, () => !device.failDraftWrites),
      settlementAttempts: records(device.payments),
      groupCreations: {
        load: async (account) => structuredClone(device.creations.get(account) ?? null),
        save: async (account, value) => {
          device.creations.set(account, structuredClone(value));
        },
        remove: async (account) => {
          device.creations.delete(account);
        },
        clear: async () => {
          device.creations.clear();
        },
      },
      accountLocal: {
        owner: {
          load: async () => device.owner,
          save: async (value) => {
            device.owner = value;
          },
          clear: async () => {
            device.owner = null;
          },
        },
        cleanupMarker: {
          load: async () => device.cleanup,
          mark: async () => {
            device.cleanup = true;
          },
          clear: async () => {
            device.cleanup = false;
          },
        },
        stores: [
          {
            clear: async () => {
              device.cache.clear();
              device.drafts.clear();
              device.payments.clear();
              device.creations.clear();
              device.identity = null;
            },
          },
        ],
      },
      fetch: async (address, init) => {
        const url = new URL(address);
        const method = init.method ?? 'GET';
        requests.push({ method, path: url.pathname + url.search });
        const held = holds.find((hold) => hold.method === method && hold.match.test(url.pathname));
        if (held) {
          holds.splice(holds.indexOf(held), 1);
          held.arrive();
          await held.wait;
        }
        const cookie = new Headers(init.headers).get('Cookie');
        return respond(method, url, init, cookie);
      },
    },
  );

  return {
    controller,
    clock,
    server,
    device,
    requests,
    chooser,
    /** Holds the next matching request until released. */
    hold(method: string, match: RegExp): Hold {
      let arrive!: () => void, release!: () => void;
      const reached = new Promise<void>((resolve) => (arrive = resolve));
      const wait = new Promise<void>((resolve) => (release = resolve));
      holds.push({ method, match, wait, arrive });
      return { reached, release };
    },
    /** What was sent from here on, other than reads. */
    writesSince(from: number) {
      return requests.slice(from).filter(({ method }) => method !== 'GET');
    },
    /** The Expense pages read for the Household from here on. */
    pagesSince(from: number) {
      return requests
        .slice(from)
        .filter(({ path }) => path.startsWith(`/api/groups/${householdId}/expenses?`))
        .map(({ path }) => Number(new URL(path, 'http://local').searchParams.get('page')));
    },
  };
}

type World = ReturnType<typeof world>;
type Controller = World['controller'];

async function signedIn(as: 'alex' | 'sam' = 'alex', options: { google?: boolean } = {}) {
  const w = world(options);
  await w.controller.signIn(as);
  expect(w.controller.getSnapshot().auth.status).toBe('authenticated');
  return w;
}

/** The screen and its parameters, as the snapshot shows them. */
const where = (shown: MobileSnapshot) => ({
  screen: shown.screen,
  destination: shown.destination,
  group: shown.detail.id,
  month: shown.financial.month,
  expense: {
    groupId: shown.expense.groupId,
    requestedExpenseId: shown.expense.requestedExpenseId,
    returnTo: shown.expense.returnTo,
  },
  settlement: shown.settlement.groupId,
  invitation: shown.invitation.code,
  restoreScroll: shown.restoreScroll,
});
/** Where a fresh session starts: Home, with nothing of where anyone was. */
const nowhere = {
  screen: 'groups',
  destination: 'expenses',
  group: null,
  month: null,
  expense: { groupId: null, requestedExpenseId: null, returnTo: null },
  settlement: null,
  invitation: null,
  restoreScroll: null,
};

const fillNewExpense = (controller: Controller) =>
  controller.updateExpenseDraft({ amount: '12.50', description: 'Weekly groceries', tagId });

describe('Back, route by route (#216)', () => {
  it('stays on Home, where Android Back leaves the app', async () => {
    const { controller, requests, writesSince } = await signedIn();
    const sent = requests.length;
    await controller.back();
    expect(where(controller.getSnapshot())).toEqual(nowhere);
    expect(writesSince(sent)).toEqual([]);
  });

  it.each(['expenses', 'balances', 'activity'] as const)(
    'goes Home from a Group on %s, on any Month',
    async (destination) => {
      const { controller } = await signedIn();
      await controller.openGroup(householdId);
      await controller.selectMonth('2026-08');
      await controller.selectDestination(destination);
      await controller.back();
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'groups',
        detail: { id: null, status: 'idle' },
        financial: { groupId: null, month: null },
      });
    },
  );

  it('closes an open Activity event first, and stays on Activity', async () => {
    const { controller } = await signedIn();
    await controller.openActivity(householdId);
    await controller.selectActivity(joinEventId);
    expect(controller.getSnapshot().activity.selected?._id).toBe(joinEventId);
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      detail: { id: householdId },
      activity: { selected: null },
    });
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
  });

  it.each(['expenses', 'balances', 'activity'] as const)(
    'returns from an Expense to the Group on %s, with its Month and scroll',
    async (destination) => {
      const { controller } = await signedIn();
      await controller.openGroup(householdId);
      await controller.selectMonth('2026-08');
      await controller.selectDestination(destination);
      await controller.openExpense(householdId, undefined, { scrollY: 240 });
      await fillNewExpense(controller);
      await controller.back();
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'group',
        destination,
        detail: { id: householdId },
        financial: { groupId: householdId, month: '2026-08' },
        restoreScroll: { groupId: householdId, y: 240 },
      });
    },
  );

  it('returns from an Expense opened from an Activity event to Activity', async () => {
    const { controller } = await signedIn();
    await controller.openActivity(householdId);
    await controller.openActivityEvent(expenseEventId, { scrollY: 120 });
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: { status: 'detail', requestedExpenseId: recordId },
    });
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      restoreScroll: { y: 120 },
    });
  });

  it('returns from an Expense opened from Home to its Group’s Expenses on the current Month', async () => {
    const { controller } = await signedIn();
    await controller.openExpense(householdId);
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'expenses',
      detail: { id: householdId, status: 'ready' },
      financial: { groupId: householdId, month: '2026-09' },
      restoreScroll: null,
    });
  });

  it('cancels an Expense’s delete review first', async () => {
    const { controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId, recordId);
    controller.reviewExpenseDeletion();
    expect(controller.getSnapshot().expense.status).toBe('delete-review');
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: { status: 'detail', requestedExpenseId: recordId },
    });
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { id: householdId },
    });
  });

  it('goes Home from an Expense whose Group refused the member', async () => {
    const { controller, server } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId);
    server.refused.add(householdId);
    await controller.refresh('retry');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      detail: { id: householdId, status: 'denied' },
    });
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
  });

  it('holds while an Expense is saving', async () => {
    const { controller, hold } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId);
    await fillNewExpense(controller);
    const posted = hold('POST', /\/expenses$/);
    const saving = controller.saveExpense();
    await posted.reached;
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: { status: 'saving' },
    });
    posted.release();
    await saving;
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', destination: 'expenses' });
  });

  it('holds while this device could not store the draft', async () => {
    const { controller, device } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId);
    device.failDraftWrites = true;
    await fillNewExpense(controller);
    expect(controller.getSnapshot().expense.persistence).toBe('error');
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('expense');
  });

  it('returns from Members to the Group view it opened from', async () => {
    const { controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.selectMonth('2026-08');
    await controller.selectDestination('activity');
    controller.openMembers({ scrollY: 320 });
    expect(controller.getSnapshot().screen).toBe('members');
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      detail: { id: householdId },
      financial: { month: '2026-08' },
      restoreScroll: { groupId: householdId, y: 320 },
    });
  });

  it('closes the Leave Group sheet first, and holds while leaving', async () => {
    const { controller, hold } = await signedIn();
    await controller.openGroup(householdId);
    controller.openMembers();
    await controller.reviewLeaveGroup();
    expect(controller.getSnapshot().leave.status).toBe('confirm');
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'members',
      leave: { status: 'closed' },
    });

    await controller.reviewLeaveGroup();
    const leaving = hold('POST', /\/leave$/);
    const left = controller.leaveGroup();
    await leaving.reached;
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'members',
      leave: { status: 'leaving' },
    });
    leaving.release();
    await left;
    expect(controller.getSnapshot().screen).toBe('groups');
  });

  it('goes Home from Members once its Group is no longer shown', async () => {
    const { controller, server } = await signedIn();
    await controller.openGroup(householdId);
    controller.openMembers();
    server.refused.add(householdId);
    await controller.refresh('retry');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'members',
      detail: { id: householdId, status: 'denied', data: null },
    });
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
  });

  it('returns from the Record payment sheet to Balances', async () => {
    const { controller } = await signedIn();
    await controller.openGroup(householdId, true, 'balances');
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settlement',
      settlement: { groupId: householdId, status: 'editing' },
    });
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      detail: { id: householdId },
      settlement: { groupId: null },
    });
  });

  it('holds while a payment is being recorded', async () => {
    const { controller, hold } = await signedIn();
    await controller.openGroup(householdId, true, 'balances');
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    const posted = hold('POST', /\/settlements$/);
    const recording = controller.recordSettlement();
    await posted.reached;
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settlement',
      settlement: { status: 'saving' },
    });
    posted.release();
    await recording;
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', destination: 'balances' });
  });

  it('cancels an invitation, and holds while joining', async () => {
    const { controller, hold } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openInvitation(link);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { code, status: 'ready' },
    });
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      detail: { id: null },
      invitation: { code: null, status: 'idle' },
    });

    await controller.openInvitation(link);
    const joining = hold('POST', /^\/api\/join\//);
    const joined = controller.joinInvitation();
    await joining.reached;
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { code, status: 'joining' },
    });
    joining.release();
    await joined;
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', detail: { id: tripId } });
  });

  it('goes Home from New Group, and holds while it is being created', async () => {
    const { controller, hold } = await signedIn();
    controller.startCreate();
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');

    controller.startCreate();
    controller.updateCreation({ name: 'Corner Flat', category: 'home' });
    const posted = hold('POST', /^\/api\/groups$/);
    const creating = controller.createGroup();
    await posted.reached;
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'create',
      creation: { status: 'saving' },
    });
    posted.release();
    await creating;
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', detail: { id: createdId } });
  });

  it('goes Home from Settings, wherever it was opened', async () => {
    const { controller } = await signedIn();
    controller.openSettings();
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
    await controller.openGroup(householdId);
    controller.openSettings();
    expect(controller.getSnapshot().screen).toBe('settings');
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({ screen: 'groups', detail: { id: null } });
  });
});

describe('Moving around never writes (#216)', () => {
  it('sends only reads across every navigation command and every Back', async () => {
    const { controller, requests, writesSince } = await signedIn();
    const sent = requests.length;
    const c = controller;
    await c.back();
    await c.openGroup(householdId);
    await c.selectMonth('2026-08');
    await c.viewSnackbarMonth();
    await c.selectDestination('balances');
    await c.selectDestination('activity');
    await c.selectActivity(joinEventId);
    c.closeActivityDetail();
    await c.selectActivity(joinEventId);
    await c.back();
    await c.openActivityEvent(expenseEventId, { scrollY: 40 });
    c.reviewExpenseDeletion();
    c.cancelExpenseDeletion();
    c.reviewExpenseDeletion();
    await c.back();
    await c.back();
    await c.openExpense(householdId, undefined, { scrollY: 80 });
    await c.closeExpense();
    await c.openExpense(householdId, recordId);
    await c.back();
    c.openMembers({ scrollY: 16 });
    await c.reviewLeaveGroup();
    c.cancelLeaveGroup();
    await c.closeMembers();
    c.openMembers();
    await c.back();
    await c.selectDestination('balances');
    await c.openRecordPayment(alex.id, sam.id, 'INR');
    await c.closeSettlement();
    await c.openSettlements(householdId);
    await c.back();
    c.openSettings();
    await c.back();
    c.startCreate();
    await c.back();
    await c.openInvitation(link);
    await c.cancelInvitation();
    await c.openInvitation(link);
    await c.back();
    await c.openInvitation(link);
    await c.openInvitationGroup();
    await c.openActivity(tripId);
    await c.openGroup(householdId, true, 'balances');
    await c.back();
    await c.checkCreatedGroups();
    await c.back();
    expect(writesSince(sent)).toEqual([]);
    expect(requests.length).toBeGreaterThan(sent);
  });
});

/** Puts the member on a screen; each gives the reads a reason to run. */
const screens: [string, (w: World) => Promise<void>, ((c: Controller) => Promise<unknown>)[]][] = [
  ['Home', async () => undefined, [(c) => c.refreshHome()]],
  [
    'a Household’s Expenses on another Month',
    async ({ controller }) => {
      await controller.openGroup(householdId);
      await controller.selectMonth('2026-08');
    },
    [(c) => c.refreshExpenses(), (c) => c.refreshBalances(), (c) => c.loadMoreExpenses()],
  ],
  [
    'a Group’s Balances',
    async ({ controller }) => {
      await controller.openGroup(tripId, true, 'balances');
    },
    [(c) => c.refreshBalances()],
  ],
  [
    'a Group’s Activity',
    async ({ controller }) => {
      await controller.openActivity(householdId);
    },
    [(c) => c.refreshActivity(), (c) => c.loadMoreActivity()],
  ],
  [
    'a Group just returned to from an Expense',
    async ({ controller }) => {
      await controller.openGroup(householdId);
      await controller.loadMoreExpenses();
      await controller.openExpense(householdId, undefined, { scrollY: 900 });
      await controller.back();
    },
    [(c) => c.refreshExpenses()],
  ],
  [
    'a new Expense',
    async ({ controller }) => {
      await controller.openGroup(householdId);
      await controller.openExpense(householdId, undefined, { scrollY: 60 });
    },
    [],
  ],
  [
    'a saved Expense',
    async ({ controller }) => {
      await controller.openGroup(householdId);
      await controller.openExpense(householdId, recordId);
    },
    [(c) => c.refreshExpenseHistory(), (c) => c.loadOlderExpenseHistory()],
  ],
  [
    'Members',
    async ({ controller }) => {
      await controller.openGroup(householdId, true, 'balances');
      controller.openMembers({ scrollY: 48 });
    },
    [],
  ],
  [
    'the Record payment sheet',
    async ({ controller }) => {
      await controller.openGroup(householdId, true, 'balances');
      await controller.openRecordPayment(alex.id, sam.id, 'INR');
    },
    [(c) => c.refreshBalances()],
  ],
  [
    'an invitation',
    async ({ controller }) => {
      await controller.openInvitation(link);
    },
    [(c) => c.retryInvitation()],
  ],
  ['New Group', async ({ controller }) => controller.startCreate(), []],
  ['Settings', async ({ controller }) => controller.openSettings(), []],
];

describe('Reads never move the member (#216)', () => {
  it.each(screens)(
    'a foreground refresh, a pull and a Retry leave %s where it is',
    async (_, open, retries) => {
      const w = await signedIn();
      await open(w);
      const { controller } = w;
      const shown = where(controller.getSnapshot());
      const sent = w.requests.length;
      const reads: (() => Promise<unknown>)[] = [
        () => controller.refresh('foreground'),
        () => {
          // Past the display freshness window, so the foreground refresh reads again.
          w.clock.now += 60_000;
          return controller.refresh('foreground');
        },
        () => controller.refresh('pull'),
        () => controller.refresh('retry'),
        ...retries.map((retry) => () => retry(controller)),
      ];
      for (const read of reads) {
        await read();
        expect(where(controller.getSnapshot())).toEqual(shown);
      }
      expect(w.requests.length).toBeGreaterThan(sent);
      expect(w.writesSince(sent)).toEqual([]);
    },
  );
});

/** Deep places, each with parameters of its own: a Group, Month, destination, scroll, code. */
const deep: [string, (c: Controller) => Promise<void>][] = [
  [
    'Members opened from Activity on another Month',
    async (c) => {
      await c.openGroup(householdId);
      await c.selectMonth('2026-08');
      await c.selectDestination('activity');
      c.openMembers({ scrollY: 640 });
    },
  ],
  [
    'an Expense opened from Balances',
    async (c) => {
      await c.openGroup(householdId);
      await c.selectMonth('2026-08');
      await c.selectDestination('balances');
      await c.openExpense(householdId, recordId, { scrollY: 480 });
    },
  ],
  [
    'a Group returned to from an Expense',
    async (c) => {
      await c.openGroup(householdId);
      await c.selectMonth('2026-08');
      await c.openExpense(householdId, undefined, { scrollY: 300 });
      await c.back();
    },
  ],
  [
    'the Record payment sheet',
    async (c) => {
      await c.openGroup(householdId, true, 'balances');
      await c.openRecordPayment(alex.id, sam.id, 'INR');
    },
  ],
];

describe('The end of a session leaves nothing of where the member was (#216)', () => {
  it.each(deep)('sign-out from %s', async (_, open) => {
    const { controller } = await signedIn();
    await open(controller);
    await controller.signOut();
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(where(controller.getSnapshot())).toEqual(nowhere);
  });

  it('sign-out from an invitation', async () => {
    const { controller, device } = await signedIn();
    await controller.openInvitation(link);
    await controller.signOut();
    expect(where(controller.getSnapshot())).toEqual(nowhere);
    expect(device.pending).toBeNull();
  });

  it.each(deep)('an account change from %s', async (_, open) => {
    const { controller } = await signedIn();
    await open(controller);
    await controller.signIn('sam');
    expect(controller.getSnapshot().auth.user?.id).toBe(sam.id);
    expect(where(controller.getSnapshot())).toEqual(nowhere);
  });

  it.each(deep)('a session the server ended (401) on %s', async (_, open) => {
    const { controller, server } = await signedIn();
    await open(controller);
    server.expired = true;
    await controller.refresh('retry');
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(where(controller.getSnapshot())).toEqual(nowhere);
  });

  it('the next account’s Members returns to its own view, not the last account’s', async () => {
    const { controller } = await signedIn();
    await deep[0][1](controller);
    await controller.signOut();
    await controller.signIn('sam');
    await controller.openGroup(householdId);
    controller.openMembers();
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'expenses',
      financial: { month: '2026-09' },
      restoreScroll: { groupId: householdId, y: 0 },
    });
  });

  it('the next account reads only the first page, not the pages the last account returned to', async () => {
    const w = await signedIn();
    const { controller } = w;
    await controller.openGroup(householdId);
    await controller.loadMoreExpenses();
    expect(controller.getSnapshot().financial.expenses.pagination?.page).toBe(2);
    await controller.openExpense(householdId, undefined, { scrollY: 900 });
    // The return re-reads both pages; the first is still on its way when the account changes.
    const reread = w.hold('GET', new RegExp(`^/api/groups/${householdId}/expenses$`));
    const returning = controller.back();
    await reread.reached;
    await controller.signIn('sam');
    reread.release();
    await returning;

    const sent = w.requests.length;
    await controller.openGroup(householdId);
    expect(controller.getSnapshot()).toMatchObject({
      auth: { user: { id: sam.id } },
      screen: 'group',
      restoreScroll: null,
      financial: { expenses: { pagination: { page: 1 } } },
    });
    expect(w.pagesSince(sent)).toEqual([1]);
  });
});

/** Every snapshot published while `run` runs. */
async function publishedDuring(controller: Controller, run: () => Promise<unknown>) {
  const published: MobileSnapshot[] = [];
  const stop = controller.subscribe(() => published.push(controller.getSnapshot()));
  await run();
  stop();
  return published;
}

describe('Check Groups (#216)', () => {
  it('on New Group, shows Home in the publish that shows the list loading, as before', async () => {
    const { controller } = await signedIn();
    controller.startCreate();
    const published = await publishedDuring(controller, () => controller.checkCreatedGroups());
    expect(published.map(({ screen, groups }) => `${screen} ${groups.status}`)).toEqual([
      'create ready',
      'groups loading',
      'groups loading',
      'groups ready',
    ]);
  });
});

describe('Back, the rest of its table (#216)', () => {
  it('goes Home from an Expense whose Group is gone (404)', async () => {
    const { controller, server } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId);
    server.gone.add(householdId);
    await controller.refresh('retry');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      detail: { id: householdId, status: 'error', data: null },
    });
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
  });

  it('returns from an Expense to its Group while the Group shows, after its read failed', async () => {
    const { controller, server } = await signedIn();
    await controller.openGroup(householdId);
    server.failing.add(householdId);
    await controller.refresh('pull');
    expect(controller.getSnapshot().detail).toMatchObject({ id: householdId, status: 'error' });
    expect(controller.getSnapshot().detail.data).not.toBeNull();
    await controller.openExpense(householdId, undefined, { scrollY: 70 });
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { id: householdId },
      restoreScroll: { groupId: householdId, y: 70 },
    });
  });

  it('asks no other Group to scroll back to where a return left the first', async () => {
    const { controller } = await signedIn();
    await controller.openGroup(householdId);
    await controller.openExpense(householdId, undefined, { scrollY: 410 });
    await controller.back();
    expect(controller.getSnapshot().restoreScroll).toMatchObject({ y: 410 });
    await controller.openGroup(tripId);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { id: tripId },
      restoreScroll: null,
    });
  });

  it('keeps a return’s pages to read again across the Record payment sheet', async () => {
    const w = await signedIn();
    const { controller, server } = w;
    await controller.openGroup(householdId);
    await controller.loadMoreExpenses();
    await controller.selectDestination('balances');
    await controller.openExpense(householdId, undefined, { scrollY: 900 });
    // The return's read of both pages fails, so they are still to be read again.
    server.failExpenses = true;
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', destination: 'balances' });
    await controller.openRecordPayment(alex.id, sam.id, 'INR');
    expect(controller.getSnapshot().screen).toBe('settlement');
    await controller.back();
    server.failExpenses = false;
    const sent = w.requests.length;
    await controller.refresh('pull');
    expect(w.pagesSince(sent)).toEqual([1, 2]);
  });
});

describe('A session starts and ends on Home, also while its request is on its way (#216)', () => {
  it('a sign-in as another persona', async () => {
    const { controller, hold } = await signedIn();
    await controller.openGroup(householdId);
    controller.openMembers({ scrollY: 30 });
    const posted = hold('POST', /\/demo-persona\/sign-in$/);
    const signing = controller.signIn('sam');
    await posted.reached;
    expect(controller.getSnapshot().auth.status).toBe('signing-in');
    expect(where(controller.getSnapshot())).toEqual(nowhere);
    posted.release();
    await signing;
    expect(controller.getSnapshot().auth.user?.id).toBe(sam.id);
    expect(where(controller.getSnapshot())).toEqual(nowhere);
  });

  it('a sign-out', async () => {
    const { controller, hold } = await signedIn();
    await controller.openGroup(householdId);
    controller.openMembers({ scrollY: 30 });
    const revoking = hold('POST', /\/api\/auth\/sign-out$/);
    const signingOut = controller.signOut();
    await revoking.reached;
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(where(controller.getSnapshot())).toEqual(nowhere);
    revoking.release();
    await signingOut;
    expect(where(controller.getSnapshot())).toEqual(nowhere);
  });

  it('a Google sign-in, while the account chooser is open', async () => {
    const { controller, chooser } = await signedIn('alex', { google: true });
    await controller.openGroup(householdId);
    controller.openMembers({ scrollY: 30 });
    expect(controller.getSnapshot().screen).toBe('members');
    let opened!: () => void, pick!: (user: Person) => void;
    const open = new Promise<void>((resolve) => (opened = resolve));
    chooser.opened = opened;
    chooser.next = new Promise((resolve) => (pick = resolve));
    const signing = controller.signInWithGoogle();
    await open;
    expect(controller.getSnapshot().auth.status).toBe('signing-in');
    expect(where(controller.getSnapshot())).toEqual(nowhere);
    pick(sam);
    await signing;
    expect(controller.getSnapshot().auth.user?.id).toBe(sam.id);
    expect(where(controller.getSnapshot())).toEqual(nowhere);
  });
});

describe('Only the route’s writer changes where the member is (#216)', () => {
  it('publishing refuses a screen, a destination, a scroll and a fresh session', () => {
    // Type checks only: each refusal fails `pnpm typecheck` if the guard ever loosens.
    const published = (shown: MobileSnapshot, fresh: FreshSnapshot): Unrouted[] => [
      // @ts-expect-error The screen comes from the route: navigate().
      { ...shown, screen: 'groups' },
      // @ts-expect-error A Group's destination comes from the route.
      { ...shown, destination: 'balances' },
      // @ts-expect-error The scroll a return asks for comes from the route.
      { ...shown, restoreScroll: null },
      // @ts-expect-error A fresh session goes Home through the writer: cleanHome().
      fresh,
      // Anything else a read shows is published as it is.
      { ...shown, groups: shown.groups },
    ];
    expect(published).toBeTypeOf('function');
  });
});
