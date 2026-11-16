import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook, pagesFor } from '../test-utils/fake-splitbook';
import { createPhoneSwitch } from './phone-switch';
import type { FetchResponse, MobileSnapshot } from './types';
import type { WidgetsNative } from './widget-copy';

// #1274: Spending by day's saved monthly read on Android. While the phone's switch is on and Home
// shows, the app reads this Month of the member's own share from the server and keeps the reply
// on the phone as a saved copy (ADR 0006): restored with its own time, never as fresh, removed
// with the account's other copies, and read again after the member's own writes. While the
// switch is off, nothing is read. These checks drive the controller's public commands and look
// only at the requests sent, the snapshot and the rows on this device. Fictional people only.

const alex = {
  id: 'a00000000000000000000001',
  name: 'Alex',
  email: 'alex@example.test',
  image: null,
};
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test', image: null };
const mapleId = 'b00000000000000000000001';
const cabinId = 'b00000000000000000000002';
const zedId = 'b00000000000000000000003';
const expenseId = 'd00000000000000000000001';
const tagId = 'c00000000000000000000001';
const code = 'deadbeef';
const draftId = 'e00000000000000000000001';
const iso = '2026-11-16T06:30:00.000Z';
const start = Date.parse(iso);
/** The phone's zone, as the app reads it: tests run in UTC unless TZ names another (#227). */
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const monthPath = (month: string) =>
  `/api/user/spending/days?month=${month}&tz=${encodeURIComponent(zone)}`;
const november = monthPath('2026-11');
const listPath = '/api/groups';
const homePath = '/api/user/balances';
const person = (user: typeof alex) => ({ _id: user.id, name: user.name, image: null });
const groupOf = (_id: string, name: string) => ({
  _id,
  createdBy: alex.id,
  name,
  category: 'home',
  defaultCurrency: 'INR',
  members: [alex, sam].map((user) => ({
    user: { ...person(user), email: user.email },
    role: 'admin',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Rent', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
const maple = groupOf(mapleId, 'Maple House');
const cabin = groupOf(cabinId, 'Cabin Weekend');
const zed = groupOf(zedId, 'Zed Club');
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

/** A Month's reply: one INR day on the 2nd with the member's share, or nothing. */
const spendingReply = (month: string, shareMinor: number) => ({
  status: 200,
  data: {
    month,
    timeZone: zone,
    currencies: shareMinor
      ? [
          {
            currency: 'INR',
            totalMinor: shareMinor,
            dayCount: 1,
            days: [{ day: `${month}-02`, shareMinor }],
            expenses: [
              {
                _id: expenseId,
                group: { _id: mapleId, name: 'Maple House' },
                description: 'Rent',
                tag: 'Rent',
                paidBy: [{ _id: alex.id, name: 'Alex' }],
                day: `${month}-02`,
                shareMinor,
                amountMinor: shareMinor * 2,
              },
            ],
          },
        ]
      : [],
  },
});

/** A fictional backend for Alex and Sam, the phone's switch, and stores that outlive a controller. */
function fixture(options: { widgets?: WidgetsNative } = {}) {
  const server = {
    /** The Groups the list holds. */
    listed: [maple, cabin],
    /** Alex's share of this Month, in paise; each Expense saved adds ₹1.00. */
    share: 120_000,
    /** Every request answers 401: the session has ended on the server. */
    expired: false,
    /** Groups that refuse Alex (403) though the list still holds them. */
    refused: new Set<string>(),
    /** Groups archived since the list was read: they refuse every read as archived (409). */
    archived: new Set<string>(),
    /** The size this phone's storage reports for each saved Month, for the saved-copy budget. */
    monthBytes: 100,
    /** The Month the server's reply says it is, when not the one asked for. */
    replyMonth: null as string | null,
    /** This phone can't remove saved copies. */
    failRemoval: false,
  };
  const backend = fakeSplitbook();
  backend.world.people.alex = alex;
  backend.world.people.sam = sam;
  backend.world.groups = [maple, cabin, zed];
  for (const user of [alex, sam]) {
    Object.defineProperty(backend.world.groupsByAccount, user.id, { get: () => server.listed });
    Object.defineProperty(backend.world.homeByAccount, user.id, {
      get: () => ({
        buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }],
        groups: server.listed.map(({ _id }) => ({ groupId: _id, balances: [] })),
      }),
    });
  }
  for (const { _id: id } of [maple, cabin, zed])
    Object.assign(
      backend.world.pages,
      pagesFor(`/api/groups/${id}/expenses`, [
        [
          {},
          {
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
        ],
      ]),
    );
  const respond = (path: string, init: RequestInit): FetchResponse | undefined => {
    if (server.expired && !path.endsWith('/sign-in') && !path.endsWith('/sign-out'))
      return json({}, 401);
    if (path.startsWith('/api/auth/')) return undefined;
    const method = init.method ?? 'GET';
    if ((path === listPath && method === 'GET') || path === homePath) return undefined;
    if (path === '/api/user/to-review')
      return json({ status: 200, data: { total: 0, groups: [] } });
    const month = /^\/api\/user\/spending\/days\?month=(\d{4}-\d{2})&tz=/.exec(path)?.[1];
    if (month)
      return json(
        spendingReply(server.replyMonth ?? month, month === '2026-11' ? server.share : 0),
      );
    // Alex joins Zed Club by Sam's invitation.
    if (path === `/api/join/${code}` && method === 'POST') {
      server.listed = [...server.listed, zed];
      return json({ status: 201, data: { groupId: zedId } }, 201);
    }
    if (path === `/api/join/${code}`)
      return json({
        status: 200,
        data: { _id: zedId, name: 'Zed Club', category: 'home', memberCount: 2 },
      });
    const id = /^\/api\/groups\/([a-f\d]{24})/.exec(path)?.[1];
    const group = [maple, cabin, zed].find(({ _id }) => _id === id);
    if (!id || !group) return json({}, 404);
    // A To review item saved as an Expense (ADR 0008): the Month changes as for a new Expense.
    if (path === `/api/groups/${id}/drafts/save` && method === 'POST') {
      server.share += 100;
      return json({
        data: [{ id: draftId, status: 'saved', expenseId: 'd00000000000000000000008' }],
      });
    }
    if (path === `/api/groups/${id}/leave` && method === 'POST') {
      server.listed = server.listed.filter(({ _id }) => _id !== id);
      return json({ data: { message: 'Left group', archived: false }, status: 200 });
    }
    if (server.archived.has(id))
      return json({ status: 409, code: 'GROUP_ARCHIVED', error: 'This Group was archived.' }, 409);
    if (!server.listed.some(({ _id }) => _id === id) || server.refused.has(id))
      return json({}, 403);
    if (path === `/api/groups/${id}`) return json({ status: 200, data: group });
    if (path.startsWith(`/api/groups/${id}/expenses?`)) return undefined;
    if (path === `/api/groups/${id}/expenses/${expenseId}` && method === 'GET')
      return json({ status: 200, data: { ...rent, group: id } });
    if (path.startsWith(`/api/groups/${id}/activity?`))
      return json({
        status: 200,
        data: { activities: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      });
    if (path === `/api/groups/${id}/expenses` && method === 'POST') {
      server.share += 100;
      return json({ status: 201, data: { _id: 'd00000000000000000000009', group: id } }, 201);
    }
    // This fixture's edit doesn't check the revision: it answers with the edited Expense.
    if (path === `/api/groups/${id}/expenses/${expenseId}` && method === 'PATCH') {
      server.share += 100;
      return json({ status: 200, data: { ...rent, group: id, revision: 2 } });
    }
    if (path === `/api/groups/${id}/expenses/${expenseId}` && method === 'DELETE') {
      server.share -= 100;
      return json({ status: 200, data: { _id: expenseId } });
    }
    if (path === `/api/groups/${id}/balances`)
      return json({ status: 200, data: { byCurrency: [] } });
    return json({}, 404);
  };
  backend.reply('*', '*', ({ path, init }) => respond(path, init));
  // The phone's switch: one per phone, outliving every controller, as SecureStore does.
  let stored: string | null = null;
  const spending = createPhoneSwitch(
    {
      load: async () => stored,
      save: async (value) => {
        stored = value;
      },
    },
    'Spending by day',
    false,
  );
  const phone = testPhone(backend, {
    newSubmissionKey: () => 'spending-by-day-attempt-0001',
    parts: {
      pendingInvitation: undefined,
      tagRequests: undefined,
      spendingByDay: spending,
      ...(options.widgets ? { widgets: options.widgets } : {}),
    },
  });
  phone.connect(true);
  const rows = phone.stores.savedQueries.records;
  phone.stores.savedQueries.failPersistently(
    'remove',
    new Error('The device storage is full'),
    () => server.failRemoval,
  );
  // The native adapter measures rows for the saved-copy budget without reading them.
  Object.assign(phone.stores.savedQueries, {
    usage: async (accountId: string) =>
      [...rows.keys()]
        .filter((key) => key.startsWith(accountId))
        .map((key) => {
          const path = key.slice(accountId.length);
          return { path, bytes: path === november ? server.monthBytes : 100, lastUsed: 0 };
        }),
  });
  return {
    server,
    spending,
    rows,
    create: () => phone.open(),
    connect: (isConnected: boolean) => phone.connect(isConnected),
    /** GET requests sent for exactly this path since `from`. */
    reads: (path: string, from = 0) =>
      backend.requests.slice(from).filter((call) => call.method === 'GET' && call.path === path)
        .length,
    get sent() {
      return backend.requests.length;
    },
    /** The next request for exactly this path waits, and is answered when released. */
    hold(path: string) {
      const held = backend.hold('*', path, { at: 'reply' });
      return { reached: held.arrived, release: () => held.release() };
    },
    /** This account's saved row for `path`, if this phone keeps one. */
    row: (path: string, account = alex.id) =>
      (rows.get(account + path) as { refreshedAt: number; value: unknown } | undefined) ?? null,
    /** Every saved Spending by day row on this phone, by account and path. */
    spendingRows: () => [...rows.keys()].filter((key) => key.includes('/api/user/spending/days')),
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
const share = (state: MobileSnapshot) =>
  state.spending.current?.data?.currencies.map(({ currency, totalMinor }) => [
    currency,
    totalMinor,
  ]);
type Controller = ReturnType<ReturnType<typeof fixture>['create']>;
/** Back to Home from wherever the member is. */
async function home(controller: Controller) {
  while (controller.getSnapshot().screen !== 'groups') await controller.back();
  await settle();
}

describe('Spending by day: the saved monthly read (#1274)', () => {
  it('reads nothing for it while the switch is off, on Home, after a pull or in a Group', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    await controller.refresh('pull');
    await controller.openGroup(mapleId);
    await home(controller);
    later(60_000);
    await controller.refreshHome();
    await settle();
    expect(f.reads(november)).toBe(0);
    expect(f.spendingRows()).toEqual([]);
    expect(controller.getSnapshot().spending).toEqual({ enabled: false, current: null });
  });

  it('reads this Month once the switch is on while Home shows, and shows the member’s share as the server sent it', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    await f.spending.select(true);
    await settle();
    expect(f.reads(november)).toBe(1);
    expect(controller.getSnapshot().spending).toEqual({
      enabled: true,
      current: {
        month: '2026-11',
        status: 'ready',
        refreshedAt: start,
        restored: false,
        unsaved: false,
        message: null,
        data: {
          month: '2026-11',
          timeZone: zone,
          currencies: [
            {
              currency: 'INR',
              totalMinor: 120_000,
              dayCount: 1,
              days: [{ day: '2026-11-02', shareMinor: 120_000 }],
              expenses: [
                {
                  _id: expenseId,
                  group: { _id: mapleId, name: 'Maple House' },
                  description: 'Rent',
                  tag: 'Rent',
                  paidBy: [{ _id: alex.id, name: 'Alex' }],
                  day: '2026-11-02',
                  shareMinor: 120_000,
                  amountMinor: 240_000,
                },
              ],
            },
          ],
        },
      },
    });
  });

  it('turned on in Settings, reads only once Home shows again', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    controller.openSettings();
    await f.spending.select(true);
    await settle();
    expect(f.reads(november)).toBe(0);
    await home(controller);
    expect(f.reads(november)).toBe(1);
    expect(share(controller.getSnapshot())).toEqual([['INR', 120_000]]);
  });

  it('a Month with nothing reads as no currencies, never as missing', async () => {
    const f = fixture();
    f.server.share = 0;
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(controller.getSnapshot().spending.current).toMatchObject({
      status: 'ready',
      data: { month: '2026-11', currencies: [] },
    });
  });

  it('turned off, stops reading, leaves Home without it and removes the saved Month from this phone', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(f.row(november)).toMatchObject({ refreshedAt: start });
    await f.spending.select(false);
    await settle();
    expect(controller.getSnapshot().spending).toEqual({ enabled: false, current: null });
    expect(f.spendingRows()).toEqual([]);
    const sent = f.sent;
    later(60_000);
    await controller.refresh('pull');
    await settle();
    expect(f.reads(november, sent)).toBe(0);
  });

  it('saves the Month and shows it after an offline restart with its saved time, never as fresh, then reads it again on reconnect', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(f.row(november)).toMatchObject({
      refreshedAt: start,
      value: { data: { month: '2026-11', currencies: [{ totalMinor: 120_000 }] } },
    });
    first.dispose();
    later(5_000);
    f.connect(false);
    const restarted = f.create();
    await restarted.restore();
    await settle();
    expect(restarted.getSnapshot().spending.current).toMatchObject({
      month: '2026-11',
      status: 'ready',
      refreshedAt: start,
      restored: true,
      unsaved: false,
    });
    expect(share(restarted.getSnapshot())).toEqual([['INR', 120_000]]);

    f.server.share = 130_000;
    const sent = f.sent;
    f.connect(true);
    await settle();
    expect(f.reads(november, sent)).toBeGreaterThan(0);
    expect(f.reads(november, sent)).toBe(f.reads(homePath, sent));
    expect(restarted.getSnapshot().spending.current).toMatchObject({
      status: 'ready',
      refreshedAt: start + 5_000,
      restored: false,
    });
    expect(share(restarted.getSnapshot())).toEqual([['INR', 130_000]]);
  });

  it('says the Month isn’t on this phone yet when it is turned on offline with nothing saved', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    await settle();
    first.dispose();
    f.connect(false);
    const restarted = f.create();
    await restarted.restore();
    await f.spending.select(true);
    await settle();
    expect(restarted.getSnapshot().spending.current).toEqual({
      month: '2026-11',
      status: 'error',
      data: null,
      refreshedAt: null,
      restored: false,
      unsaved: true,
      message: 'Your spending isn’t on this phone yet. Connect to load it.',
    });
  });

  it('leaves no saved Month on this phone after sign-out or a change of account', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(f.spendingRows()).toEqual([`${alex.id}${november}`]);
    await controller.signOut();
    await settle();
    expect(f.spendingRows()).toEqual([]);
    expect(controller.getSnapshot().spending.current).toBeNull();

    // Signed in again, then Sam on the same phone: nothing of Alex's Month stays.
    await controller.signIn('alex');
    await settle();
    expect(f.spendingRows()).toEqual([`${alex.id}${november}`]);
    await controller.signIn('sam');
    await settle();
    expect(f.spendingRows()).toEqual([`${sam.id}${november}`]);
    // The switch belongs to the phone: it stays on for Sam.
    expect(controller.getSnapshot().spending.enabled).toBe(true);
  });

  it('refuses and never saves a reply for another Month than the one asked for', async () => {
    const f = fixture();
    f.server.replyMonth = '2026-10';
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(controller.getSnapshot().spending.current).toMatchObject({
      month: '2026-11',
      status: 'error',
      data: null,
    });
    expect(f.spendingRows()).toEqual([]);
  });

  it('never shows a saved Month it couldn’t remove, and the next start removes it before anything reads it', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(f.row(november)).toMatchObject({ refreshedAt: start });
    // Turned off while this phone can't remove it: the Month stays, untrusted.
    f.server.failRemoval = true;
    await f.spending.select(false);
    await settle();
    expect(f.row(november)).not.toBeNull();
    first.dispose();
    // Storage works again at the next start, which is offline.
    f.server.failRemoval = false;
    f.connect(false);
    const restarted = f.create();
    await restarted.restore();
    await settle();
    expect(f.row(november)).toBeNull();
    await f.spending.select(true);
    await settle();
    expect(restarted.getSnapshot().spending.current).toMatchObject({ unsaved: true, data: null });
  });

  it('keeps the saved Month after a 401, as the account’s other saved copies', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    f.server.expired = true;
    later(60_000);
    await controller.refreshHome();
    await settle();
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(f.row(november)).toMatchObject({ refreshedAt: start });
  });

  it('removes the saved Month when a Groups list leaves out a Group, and reads it again', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(f.row(november)).not.toBeNull();
    // Alex no longer has Cabin Weekend (left, archived or deleted on the web).
    f.server.listed = [maple];
    later(1_000);
    const month = f.hold(november);
    const sent = f.sent;
    await controller.refresh('pull');
    await month.reached;
    await settle();
    expect(f.row(november)).toBeNull();
    month.release();
    await settle();
    // The Month read beside the list is read again after it: nothing of the lost Group stays.
    expect(f.reads(november, sent)).toBe(2);
    expect(f.row(november)).toMatchObject({ refreshedAt: start + 1_000 });
  });
});

describe('Spending by day: saved Months follow the account’s other saved copies (#1274)', () => {
  it('counts each saved Month in the saved-copy budget, which removes it past 20 MB', async () => {
    const f = fixture();
    f.server.monthBytes = 21_000_000;
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(f.reads(november)).toBe(1);
    await vi.waitFor(() => expect(f.row(november)).toBeNull());
    // Home's own rows are kept whatever the budget says.
    expect(f.row(listPath)).not.toBeNull();
    expect(f.row(homePath)).not.toBeNull();
  });

  it('takes the saved Month off this phone when a Group refuses Alex', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(f.row(november)).not.toBeNull();
    await controller.openGroup(mapleId);
    await settle();
    // Maple House refuses Alex now, while the list still holds it: the Month may hold its Expenses.
    f.server.refused.add(mapleId);
    later(31_000);
    await controller.refresh();
    await settle();
    expect(controller.getSnapshot().detail.status).toBe('denied');
    expect(f.row(november)).toBeNull();
  });

  it('takes the saved Month off this phone after a confirmed write, so an offline restart shows nothing older', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    await controller.openGroup(mapleId);
    await controller.openExpense(mapleId);
    await controller.updateExpenseDraft({ description: 'Groceries', amount: '1', tagId });
    // The save is confirmed, and the phone goes offline before Home shows again.
    const save = f.hold(`/api/groups/${mapleId}/expenses`);
    const saving = controller.saveExpense();
    await save.reached;
    f.connect(false);
    save.release();
    await saving;
    await settle();
    expect(f.row(november)).toBeNull();
    controller.dispose();
    const restarted = f.create();
    await restarted.restore();
    await settle();
    expect(restarted.getSnapshot().spending.current).toMatchObject({
      unsaved: true,
      data: null,
    });
  });
});

describe('Spending by day: read again after the member’s own writes (#1274)', () => {
  /**
   * Alex, with the switch on, has Maple House open within the window, and an Expense open whose
   * save or delete checks the Group. Home's figures and this Month are read just before, so only
   * what Alex does next can make them out of date. The Month is read again whenever Home's
   * figures are, as its key is in Home's scope.
   */
  async function onAnExpense(f: ReturnType<typeof fixture>, existing: boolean) {
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    await controller.openGroup(mapleId);
    await controller.back();
    await controller.openGroup(mapleId);
    await controller.openExpense(mapleId, existing ? expenseId : undefined);
    await settle();
    await controller.refreshHome();
    await settle();
    return { controller, sent: f.sent };
  }

  it('reads nothing more when Alex goes back Home without a write', async () => {
    const f = fixture();
    const { controller, sent } = await onAnExpense(f, true);
    await home(controller);
    expect(f.reads(november, sent)).toBe(0);
    expect(f.reads(homePath, sent)).toBe(0);
  });

  it('after a new Expense is saved', async () => {
    const f = fixture();
    const { controller, sent } = await onAnExpense(f, false);
    await controller.updateExpenseDraft({ description: 'Groceries', amount: '1', tagId });
    await controller.saveExpense();
    await home(controller);
    expect(f.reads(november, sent)).toBeGreaterThan(0);
    expect(f.reads(november, sent)).toBe(f.reads(homePath, sent));
    expect(share(controller.getSnapshot())).toEqual([['INR', 120_100]]);
  });

  it('after an Expense is edited', async () => {
    const f = fixture();
    const { controller, sent } = await onAnExpense(f, true);
    controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Rent, November' });
    await controller.saveExpense();
    await home(controller);
    expect(f.reads(november, sent)).toBeGreaterThan(0);
    expect(f.reads(november, sent)).toBe(f.reads(homePath, sent));
    expect(share(controller.getSnapshot())).toEqual([['INR', 120_100]]);
  });

  it('after an Expense is deleted', async () => {
    const f = fixture();
    const { controller, sent } = await onAnExpense(f, true);
    controller.reviewExpenseDeletion();
    await controller.deleteExpense();
    await home(controller);
    expect(f.reads(november, sent)).toBeGreaterThan(0);
    expect(f.reads(november, sent)).toBe(f.reads(homePath, sent));
    expect(share(controller.getSnapshot())).toEqual([['INR', 119_900]]);
  });

  it('after a To review item is saved as an Expense', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    await controller.refreshHome();
    await settle();
    const sent = f.sent;
    // The review the member confirmed: the save sends its id, revision and review.
    await controller
      .sharedDrafts(mapleId)
      .save([{ draft: { id: draftId, revision: 1 }, review: 'a'.repeat(64) } as never], []);
    await settle();
    expect(f.reads(november, sent)).toBeGreaterThan(0);
    expect(f.reads(november, sent)).toBe(f.reads(homePath, sent));
    expect(share(controller.getSnapshot())).toEqual([['INR', 120_100]]);
  });

  it('after leaving a Group', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    await controller.openGroup(mapleId);
    controller.openMembers();
    await controller.refreshHome();
    await settle();
    const sent = f.sent;
    await controller.reviewLeaveGroup();
    await controller.leaveGroup();
    await home(controller);
    expect(controller.getSnapshot().groups.data.map(({ name }) => name)).toEqual(['Cabin Weekend']);
    expect(f.reads(november, sent)).toBeGreaterThan(0);
    expect(f.reads(november, sent)).toBe(f.reads(homePath, sent));
  });

  it('after joining a Group', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    await controller.openInvitation(`http://localhost:4138/join/${code}`);
    const sent = f.sent;
    await controller.joinInvitation();
    await settle();
    expect(controller.getSnapshot().screen).toBe('group');
    await home(controller);
    // Joining shows Home while the list is read: the Month is read again after the join.
    expect(f.reads(november, sent)).toBeGreaterThanOrEqual(1);
    expect(controller.getSnapshot().spending.current).toMatchObject({ status: 'ready' });
  });
});

describe('Spending by day: the review of #1274', () => {
  it('lets only Home’s own figures, not a Month, tell the widgets Home is verified again', async () => {
    // What the app tells the home-screen widgets: whether each copy it writes has Home verified.
    const verified: boolean[] = [];
    const widgets: WidgetsNative = {
      write: async (_copy, options) => void verified.push(!!options?.homeVerified),
      clear: async () => undefined,
      setSession: async () => undefined,
      redraw: async () => undefined,
    };
    const f = fixture({ widgets });
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(verified).toContain(true);
    // Alex saves an Expense in Maple House: Home's figures are no longer verified until read again.
    await controller.openGroup(mapleId);
    await controller.openExpense(mapleId);
    await controller.updateExpenseDraft({ description: 'Groceries', amount: '1', tagId });
    await settle();
    // The save's follow-up reads Home's figures again, slowly; the Month, in Home's scope, answers
    // first, while the figures from before the save are still on screen.
    const figures = f.hold(homePath),
      from = verified.length,
      months = f.reads(november);
    const saving = controller.saveExpense();
    await figures.reached;
    await settle();
    expect(f.reads(november)).toBeGreaterThan(months);
    // Home isn't verified by the Month.
    expect(verified.slice(from)).not.toContain(true);
    figures.release();
    await saving;
    await home(controller);
    expect(verified.slice(from)).toContain(true);
  });

  it('reads the Month again in the phone’s new zone, when the zone changes within the same Month', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(f.reads(november)).toBe(1);
    // The phone moves to a zone where it is still 16 November.
    const moved = zone === 'Asia/Kolkata' ? 'America/New_York' : 'Asia/Kolkata';
    const there = `/api/user/spending/days?month=2026-11&tz=${encodeURIComponent(moved)}`;
    const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    const travel = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...resolved.call(this), timeZone: moved };
      });
    try {
      f.server.share = 150_000;
      // Home still shows; the app returns to the foreground within the read's window.
      await controller.refresh('foreground');
      await settle();
      expect(f.reads(there)).toBe(1);
      expect(share(controller.getSnapshot())).toEqual([['INR', 150_000]]);
      expect(controller.getSnapshot().spending.current).toMatchObject({ status: 'ready' });
    } finally {
      travel.mockRestore();
    }
  });

  it('turned off and quickly on again, reads this Month and shows it', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await f.spending.select(true);
    await settle();
    expect(f.reads(november)).toBe(1);
    const off = f.spending.select(false);
    const on = f.spending.select(true);
    await Promise.all([off, on]);
    await settle();
    expect(f.reads(november)).toBe(2);
    expect(controller.getSnapshot().spending.current).toMatchObject({
      month: '2026-11',
      status: 'ready',
    });
    expect(share(controller.getSnapshot())).toEqual([['INR', 120_000]]);
    expect(f.row(november)).toMatchObject({ refreshedAt: start });
  });

  it('neither keeps nor shows a reply that lands after the switch is turned off', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    const month = f.hold(november);
    await f.spending.select(true);
    await month.reached;
    await f.spending.select(false);
    month.release();
    await settle();
    expect(f.spendingRows()).toEqual([]);
    expect(controller.getSnapshot().spending).toMatchObject({ enabled: false, current: null });
  });

  it('neither keeps nor shows a reply that lands after sign-out', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await settle();
    const month = f.hold(november);
    await f.spending.select(true);
    await month.reached;
    await controller.signOut();
    month.release();
    await settle();
    expect(f.spendingRows()).toEqual([]);
    expect(controller.getSnapshot().spending.current).toBeNull();
  });

  it('takes a Month that may hold a lost Group’s Expenses off the screen at once, saved copy too, until it is read again', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    await f.spending.select(true);
    await settle();
    first.dispose();
    // The next start shows the saved Month while it reads the list and the Month again.
    later(60_000);
    f.server.listed = [maple];
    f.server.share = 50_000;
    const list = f.hold(listPath),
      before = f.hold(november);
    const restarted = f.create();
    const restoring = restarted.restore();
    await list.reached;
    await before.reached;
    await settle();
    expect(restarted.getSnapshot().spending.current).toMatchObject({
      restored: true,
      data: { currencies: [{ totalMinor: 120_000 }] },
    });
    // The list leaves Cabin Weekend out: no Month from before stays on screen or on this phone.
    const shown: (number | null)[] = [];
    const stop = restarted.subscribe(() =>
      shown.push(restarted.getSnapshot().spending.current?.data?.currencies[0]?.totalMinor ?? null),
    );
    const after = f.hold(november);
    list.release();
    await settle();
    expect(restarted.getSnapshot().spending.current).toMatchObject({
      status: 'loading',
      data: null,
      restored: false,
    });
    expect(f.row(november)).toBeNull();
    before.release();
    await after.reached;
    after.release();
    await restoring;
    await settle();
    stop();
    expect(shown).not.toContain(120_000);
    expect(restarted.getSnapshot().spending.current).toMatchObject({
      status: 'ready',
      restored: false,
      data: { currencies: [{ totalMinor: 50_000 }] },
    });
  });
});
