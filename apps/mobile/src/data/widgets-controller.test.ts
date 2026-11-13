import { widgetDimensions } from '../test-utils/widget-size';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MobileController } from './mobile-controller';
import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import { notificationTaskProtected } from './notification-alerts';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';
import { groupWidget } from '@splitbook/shared/group-widget';
import { createWidgetCopy } from './widget-copy';
import { quickWidget } from '@splitbook/shared/quick-widget';

const alex = { id: 'a00000000000000000000001', name: 'Alex Rivera', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 'sam@example.test' };
const tagId = 'e00000000000000000000001';
const groupId = 'b00000000000000000000001';
const controllers: MobileController[] = [];
const verified = Date.parse('2026-11-08T04:11:00Z');
function fixture(extraMembers: (typeof alex)[] = []) {
  let user = alex,
    expired = false,
    owed = 2400;
  let groupBalances: unknown = { byCurrency: [] };
  let refused = 0;
  let offlineAfterSave = false;
  let noGroups = false;
  let archived = false;
  let trip = false;
  let theme = 'home';
  let monthStatus = 0;
  let hold: Promise<void> | undefined;
  let groupTags = [
    { _id: tagId, name: 'Groceries', createdAt: '2026-11-01T00:00:00Z', isArchived: false },
  ];
  let storedCopy: WidgetCopy | null = null;
  const requests: { path: string; method: string; query?: string }[] = [];
  const copies: WidgetCopy[] = [];
  const events: string[] = [];
  const group = () => ({
    _id: groupId,
    name: 'Maple House',
    isArchived: archived,
    createdBy: user.id,
    category: trip ? 'trip' : theme,
    startDate: trip ? '2026-11-08T00:00:00Z' : null,
    endDate: trip ? '2026-11-10T00:00:00Z' : null,
    defaultCurrency: 'INR',
    tags: groupTags,
    members: [
      { user: { ...user, _id: user.id }, role: 'admin', joinedAt: '2026-11-01T00:00:00Z' },
      ...[
        alex,
        sam,
        { id: 'a00000000000000000000003', name: 'Priya Shah', email: 'priya@example.test' },
        ...extraMembers,
      ]
        .filter((person) => person.id !== user.id)
        .map((person) => ({
          user: { ...person, _id: person.id },
          role: 'member',
          joinedAt: '2026-11-01T00:00:00Z',
        })),
    ],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  });
  const backend = fakeSplitbook();
  backend.world.people.alex = { ...alex, image: null };
  backend.world.people.sam = { ...sam, image: null };
  backend.auth.cookie = () => 'better-auth.session_token=fictional.signature';
  Object.defineProperty(backend.world, 'groups', { get: () => [group()] });
  for (const id of [alex.id, sam.id])
    Object.defineProperty(backend.world.groupsByAccount, id, {
      get: () => (noGroups || archived ? [] : [group()]),
    });
  Object.defineProperty(backend.world.balances, groupId, { get: () => groupBalances });
  Object.defineProperty(backend.world, 'home', {
    get: () => ({
      buckets: [
        { currency: 'INR', youOwe: 1480, youAreOwed: owed, net: owed - 1480 },
        { currency: 'EUR', youOwe: 0, youAreOwed: 40, net: 40 },
      ],
      groups: [
        { groupId, name: 'Maple House', balances: [{ currency: 'INR', balance: owed - 1480 }] },
      ],
    }),
  });
  backend.world.toReview = { total: 0, groups: [] };
  backend.world.pages[`/api/groups/${groupId}/currencies`] = {
    mainCurrency: { code: 'INR', locked: true },
    extraCurrencies: [],
  };
  backend.reply('*', '*', ({ url, init }) => {
    const path = url.pathname;
    requests.push({ path, method: init.method ?? 'GET', query: url.search });
    if (path === '/api/auth/demo-persona/sign-in') {
      user = JSON.parse(String(init.body)).personaId === 'sam' ? sam : alex;
      return undefined;
    }
    if (['/api/auth/get-session', '/api/auth/sign-out'].includes(path)) return undefined;
    if (expired) return Response.json({ error: 'Session expired' }, { status: 401 });
    if (path.endsWith('/expenses') && url.searchParams.has('dateFrom') && monthStatus)
      return Response.json({ error: 'Month read failed' }, { status: monthStatus });
    if (path === `/api/groups/${groupId}` && refused)
      return Response.json({ error: 'Not a member' }, { status: refused });
    if (path === `/api/groups/${groupId}`) return Response.json({ status: 200, data: group() });
    if (path.endsWith('/expenses') && init.method === 'POST') {
      owed = 2500;
      if (offlineAfterSave) backend.online = false;
      return Response.json({
        status: 201,
        data: {
          _id: 'c00000000000000000000001',
          group: groupId,
          ...JSON.parse(String(init.body)),
          revision: 1,
          isDeleted: false,
          createdAt: '2026-11-08T00:00:00Z',
          updatedAt: '2026-11-08T00:00:00Z',
        },
      });
    }
    if (path === `/api/groups/${groupId}/expenses/c00000000000000000000001`)
      return Response.json({
        status: 200,
        data: {
          _id: 'c00000000000000000000001',
          group: groupId,
          createdBy: alex.id,
          description: 'Saved groceries',
          amount: 100,
          amountMinor: 10000,
          moneyVersion: 1,
          currency: 'INR',
          category: 'food',
          tag: 'Groceries',
          tagId,
          date: '2026-11-08T00:00:00Z',
          paidBy: [{ user: { ...alex, _id: alex.id }, amount: 100, amountMinor: 10000 }],
          splitBetween: [{ user: { ...alex, _id: alex.id }, amount: 100, amountMinor: 10000 }],
          splitMethod: 'equal',
          revision: 1,
          isDeleted: false,
          createdAt: '2026-11-08T00:00:00Z',
          updatedAt: '2026-11-08T00:00:00Z',
        },
      });
    if (path === `/api/groups/${groupId}/balances` || path.endsWith('/expenses')) return undefined;
    return undefined;
  });
  const native = testPhone(backend, {
    origin: 'http://localhost:4986',
    newSubmissionKey: () => 'widget-expense-fictional-986',
    parts: {
      pendingInvitation: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      netInfo: undefined,
      widgets: {
        write: async (copy) => {
          await hold;
          copies.push(structuredClone(copy));
          storedCopy = structuredClone(copy);
          events.push('write:' + copy.accountId);
        },
        clear: async () => {
          events.push('clear');
          storedCopy = null;
        },
        setSession: async (state) => {
          events.push(state.status);
        },
        redraw: async () => {
          events.push('redraw');
        },
      },
    },
  });
  const clear = native.stores.savedQueries.clear;
  native.stores.savedQueries.clear = async () => {
    await clear();
    events.push('account-purged');
  };
  native.stores.owner.value = alex.id;
  delete native.stores.savedQueries.retainGroups;
  const make = () => {
    const controller = native.open();
    controllers.push(controller);
    return controller;
  };
  return {
    make,
    month: (count = 12) => {
      backend.world.expenses[groupId] = {
        expenses: [],
        pagination: { page: 1, limit: 20, total: count, totalPages: 1 },
        summary: {
          count,
          totalsByCurrency: [
            { currency: 'INR', totalAmount: 23540 },
            { currency: 'JPY', totalAmount: 42000 },
          ],
          userOwes: 0,
          userGetsBack: 0,
          byMember: [{ user: { _id: alex.id, name: alex.name }, paid: 0, share: 7850, net: -7850 }],
        },
      };
    },
    theme: (value: string) => {
      theme = value;
    },
    monthFails: (status: number) => {
      monthStatus = status;
    },
    trip: () => {
      trip = true;
    },
    archive: () => {
      archived = true;
    },
    noGroups: () => {
      noGroups = true;
    },
    groupBalances: (value: unknown) => {
      groupBalances = value;
    },
    offlineAfterSave: () => {
      offlineAfterSave = true;
    },
    refuse: (status: number) => {
      refused = status;
    },
    blockWrite: () => {
      let release!: () => void;
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    copies,
    storedCopy: () => storedCopy,
    groupTags: (value: typeof groupTags) => {
      groupTags = value;
    },
    requests,
    events,
    offline: () => {
      backend.online = false;
    },
    expire: () => {
      expired = true;
    },
    recover: () => {
      expired = false;
    },
    owe: (amount: number) => {
      owed = amount;
    },
  };
}
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe('Balances widget at the controller seam', () => {
  it('projects Home in currency order with its original verification time and no To review count when Drafts are off', async () => {
    vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'false');
    vi.spyOn(Date, 'now').mockReturnValue(verified);
    const f = fixture();
    await f.make().signIn('alex');
    await vi.waitFor(() =>
      expect(f.copies.at(-1)).toMatchObject({
        accountId: alex.id,
        home: {
          verifiedAt: verified,
          groupCount: 1,
          currencies: [
            { currency: 'INR', owedMinor: 240000, oweMinor: 148000 },
            { currency: 'EUR', owedMinor: 4000, oweMinor: 0 },
          ],
        },
      }),
    );
    expect(f.copies.at(-1)).not.toHaveProperty('review');
  });
});

it('includes a separately verified To review count only while Drafts are on', async () => {
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.review).toMatchObject({ count: 0, verifiedAt: expect.any(Number) }),
  );
  c.dispose();
});
it('opens Home and To review after the session check, including cold start', async () => {
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  c.dispose();
  const restart = f.make();
  const checking = restart.restore();
  const opening = restart.openWidget('review');
  await checking;
  await opening;
  expect(restart.getSnapshot()).toMatchObject({
    auth: { status: 'authenticated' },
    screen: 'groups',
    widgetOpen: { target: 'review' },
  });
  await restart.openWidget('home');
  await restart.signOut();
  await restart.openWidget('sign-in');
  expect(restart.getSnapshot()).toMatchObject({ auth: { status: 'signed-out' }, screen: 'groups' });
  restart.dispose();
});
it('restores the original verification time from saved Home reads', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home?.verifiedAt).toBe(verified));
  const count = f.copies.length;
  c.dispose();
  f.offline();
  vi.spyOn(Date, 'now').mockReturnValue(verified + 60_000);
  const restart = f.make();
  await restart.restore();
  await vi.waitFor(() => expect(f.copies.length).toBeGreaterThan(count));
  expect(restart.getSnapshot().auth.status).toBe('authenticated');
  expect(f.copies.at(-1)?.home?.verifiedAt).toBe(verified);
  restart.dispose();
});
it('purges before the signed-out redraw and never redraws an older queued copy afterwards', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home).toBeTruthy());
  f.events.length = 0;
  await c.signOut();
  expect(f.events.indexOf('clear')).toBeGreaterThanOrEqual(0);
  expect(f.events.indexOf('signed-out')).toBeGreaterThan(f.events.indexOf('clear'));
  expect(f.events.at(-1)).toBe('redraw');
  c.dispose();
});
it('keeps the copy on a 401 and refills it for the same account', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home).toBeTruthy());
  f.events.length = 0;
  f.expire();
  await c.refreshHome();
  await vi.waitFor(() => expect(f.events).toContain('expired'));
  expect(f.events).not.toContain('clear');
  f.recover();
  f.owe(2500);
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home?.currencies[0]?.owedMinor).toBe(250000));
  c.dispose();
});
it('clears the old account before writing the next account’s copy', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home).toBeTruthy());
  f.events.length = 0;
  await c.signIn('sam');
  await vi.waitFor(() => expect(f.copies.at(-1)?.accountId).toBe(sam.id));
  expect(f.events.indexOf('write:' + sam.id)).toBeGreaterThan(f.events.indexOf('clear'));
  expect(f.events.indexOf('signed-out')).toBeGreaterThan(f.events.indexOf('clear'));
  c.dispose();
});

it('updates from the Home read after a member saves an Expense, never from the submitted amount', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home?.currencies[0]?.owedMinor).toBe(240000));
  await c.openExpense(groupId);
  await c.updateExpenseDraft({ description: 'Weekly groceries', amount: '100', tagId });
  await c.saveExpense();
  expect(c.getSnapshot().expense.status).toBe('saved');
  await c.back();
  await vi.waitFor(() => expect(f.copies.at(-1)?.home?.currencies[0]?.owedMinor).toBe(250000));
});
it('waits for an already running saved-copy write before purging and cancels the remaining writes', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home).toBeTruthy());
  const release = f.blockWrite();
  f.owe(2500);
  await c.refreshHome();
  f.events.length = 0;
  const signingOut = c.signOut();
  await Promise.resolve();
  expect(f.events).not.toContain('clear');
  release();
  await signingOut;
  const signedOut = f.events.indexOf('signed-out');
  expect(signedOut).toBeGreaterThan(f.events.indexOf('account-purged'));
  expect(f.events.slice(signedOut)).toEqual(['signed-out', 'redraw']);
});
it('hides a 401 immediately even while a saved-copy write is still running', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home).toBeTruthy());
  const release = f.blockWrite();
  f.owe(2500);
  await c.refreshHome();
  f.events.length = 0;
  f.expire();
  await c.refreshHome();
  try {
    await vi.waitFor(() => expect(f.events).toContain('expired'));
    expect(f.events).not.toContain('clear');
  } finally {
    release();
  }
});

it('projects a Group and its Balances reads into the widget copy with both verification times', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture();
  const controller = f.make();
  await controller.signIn('alex');
  await controller.openGroup(groupId);
  await controller.refreshBalances();
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.groups?.[groupId]).toMatchObject({
      id: groupId,
      name: 'Maple House',
      theme: 'home',
      archived: false,
      mainCurrency: 'INR',
      verifiedAt: verified,
      balancesVerifiedAt: verified,
      currencies: [],
    }),
  );
  expect(f.copies.at(-1)?.savedGroups?.rows.map((g) => g.id)).toEqual([groupId]);
});

for (const status of [403, 404])
  it(`removes the Group widget part after a refused read (${status})`, async () => {
    const f = fixture(),
      c = f.make();
    await c.signIn('alex');
    await c.openGroup(groupId);
    await c.refreshBalances();
    await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeDefined());
    expect(f.copies.at(-1)?.tags?.[groupId]).toEqual([{ id: tagId, name: 'Groceries' }]);
    f.refuse(status);
    await c.openGroup(groupId, false);
    await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeUndefined());
    expect(f.copies.at(-1)?.lostGroupIds).toContain(groupId);
    expect(f.copies.at(-1)?.tags?.[groupId]).toBeUndefined();
  });
it('restores Group widget parts and offline setup with their original saved verification times', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture(),
    first = f.make();
  await first.signIn('alex');
  await first.openGroup(groupId);
  await first.refreshBalances();
  await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeDefined());
  first.dispose();
  f.offline();
  vi.spyOn(Date, 'now').mockReturnValue(verified + 3600000);
  const restarted = f.make();
  await restarted.restore();
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.groups?.[groupId]?.balancesVerifiedAt).toBe(verified),
  );
  expect(f.copies.at(-1)?.savedGroups?.rows.map((g) => g.id)).toEqual([groupId]);
});

it('a widget payment tap opens the chosen payment without sending a Settlement request', async () => {
  const f = fixture(),
    c = f.make(),
    priya = { _id: 'a00000000000000000000003', name: 'Priya Shah' };
  f.groupBalances({
    byCurrency: [
      {
        currency: 'INR',
        balances: [
          { user: { _id: alex.id, name: alex.name }, balance: -1060 },
          { user: priya, balance: 1060 },
        ],
        debts: [{ from: { _id: alex.id, name: alex.name }, to: priya, amount: 1060 }],
      },
    ],
  });
  await c.signIn('alex');
  await c.openWidget({
    kind: 'settle',
    groupId,
    payment: { from: alex.id, to: priya._id, currency: 'INR' },
  });
  expect(c.getSnapshot().screen).toBe('settlement');
  expect(c.getSnapshot().settlement.draft).toMatchObject({
    paidBy: alex.id,
    paidTo: priya._id,
    currency: 'INR',
    amount: '1060',
  });
  expect(f.requests.filter((r) => r.method === 'POST' && r.path.includes('/settlements'))).toEqual(
    [],
  );
});
it('a widget Add expense tap resumes the Group’s unfinished draft', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openExpense(groupId);
  await c.updateExpenseDraft({ description: 'Unfinished groceries', amount: '123', tagId });
  await c.back();
  await c.openWidget({ kind: 'expense', groupId });
  expect(c.getSnapshot().screen).toBe('expense');
  expect(c.getSnapshot().expense.draft).toMatchObject({
    description: 'Unfinished groceries',
    amount: '123',
  });
});

it('removes a Group widget part when a save retires its saved copies, until the next successful read', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openGroup(groupId);
  await c.refreshBalances();
  await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeDefined());
  await c.openExpense(groupId);
  await c.updateExpenseDraft({ description: 'Groceries', amount: '100', tagId });
  f.offlineAfterSave();
  await c.saveExpense();
  await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeUndefined());
  expect(f.copies.at(-1)?.lostGroupIds).not.toContain(groupId);
});
it('Ask each time opens a Group picker after restoration, and choosing resumes the same draft', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openExpense(groupId);
  await c.updateExpenseDraft({ description: 'Widget unfinished', amount: '123', tagId });
  await c.back();
  await c.openWidget('choose-group');
  expect(c.getSnapshot().widgetPicker).toBe(true);
  await c.chooseWidgetGroup(groupId);
  expect(c.getSnapshot().widgetPicker).toBe(false);
  expect(c.getSnapshot().expense.draft).toMatchObject({
    description: 'Widget unfinished',
    amount: '123',
  });
});

it('opens Ask each time from a cold start with no Groups, then hands Create a Group to the app', async () => {
  const f = fixture();
  f.noGroups();
  const first = f.make();
  await first.signIn('alex');
  first.dispose();
  const cold = f.make();
  await cold.openWidget('choose-group');
  expect(cold.getSnapshot().widgetPicker).toBe(true);
  expect(cold.getSnapshot().groups.data).toEqual([]);
  cold.closeWidgetPicker();
  await cold.openWidget('create-group');
  expect(cold.getSnapshot().screen).toBe('create');
});
it('closes an open widget picker when a chosen-Group widget opens its Expense', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openWidget('choose-group');
  await c.openWidget({ kind: 'expense', groupId });
  expect(c.getSnapshot().widgetPicker).toBe(false);
  expect(c.getSnapshot().screen).toBe('expense');
});

it('holds a widget tap during Add expense and offers it after close without changing the draft', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openExpense(groupId);
  await c.updateExpenseDraft({ description: 'Still entering groceries', amount: '123', tagId });
  const form = c.getSnapshot().expense;
  const before = f.requests.length;
  await c.openWidget('home');
  expect(c.getSnapshot()).toMatchObject({
    screen: 'expense',
    notificationOpening: { status: 'held' },
  });
  expect(c.getSnapshot().expense).toBe(form);
  expect(f.requests.slice(before)).toEqual([]);
  const owner = c.getSnapshot().heldNotification;
  expect(c.getSnapshot().heldNotificationNotice).toBe(owner);
  expect(owner).not.toBeNull();
  await c.closeExpense();
  expect(c.getSnapshot().notificationOpening.status).toBe('held');
  await c.openPendingNotification();
  expect(c.getSnapshot()).toMatchObject({
    screen: 'groups',
    notificationOpening: { status: 'idle' },
    heldNotification: null,
  });
});

it.each(
  (
    [
      'Add expense',
      'edit',
      'payment',
      'To review',
      'Group form',
      'Tags',
      'Currencies',
      'Leave Group',
    ] as const
  ).flatMap((task) =>
    (['home', 'record-payment', 'expense-tag'] as const).map((destination) => ({
      task,
      destination,
    })),
  ),
)(
  'holds $destination with the entire protected $task task unchanged',
  async ({ task, destination }) => {
    vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
    const f = fixture(),
      c = f.make();
    await c.signIn('alex');
    await c.openGroup(groupId);
    if (task === 'Add expense') {
      await c.openExpense(groupId);
      await c.updateExpenseDraft({ description: 'Unfinished', amount: '123', tagId });
    }
    if (task === 'edit') {
      await c.openExpense(groupId, 'c00000000000000000000001');
      await c.editExpense();
      await c.updateExpenseDraft({ description: 'Unfinished edit' });
      expect(c.getSnapshot().expense.status, c.getSnapshot().expense.message ?? '').toBe('editing');
    }
    if (task === 'payment') {
      f.groupBalances({
        byCurrency: [
          {
            currency: 'INR',
            balances: [
              { user: { _id: alex.id, name: alex.name }, balance: -100 },
              { user: { _id: sam.id, name: sam.name }, balance: 100 },
            ],
            debts: [
              {
                from: { _id: alex.id, name: alex.name },
                to: { _id: sam.id, name: sam.name },
                amount: 100,
              },
            ],
          },
        ],
      });
      await c.selectDestination('balances');
      await c.openRecordPayment(alex.id, sam.id, 'INR');
      expect(c.getSnapshot().screen).toBe('settlement');
    }
    if (task === 'To review') await c.openToReview(groupId);
    if (task === 'Group form') {
      c.startCreate();
      c.updateCreation({ name: 'Unfinished Group' });
    }
    if (task === 'Tags') c.openTags(groupId);
    if (task === 'Currencies') await c.openCurrencies(groupId);
    if (task === 'Leave Group') {
      c.openMembers();
      await c.reviewLeaveGroup();
    }
    const before = c.getSnapshot();
    expect(notificationTaskProtected(before)).toBe(true);
    const count = f.requests.length;
    await c.openWidget(
      destination === 'home'
        ? 'home'
        : destination === 'expense-tag'
          ? { kind: 'expense-tag', groupId, tagId }
          : { kind: 'record-payment', groupId },
    );
    const after = c.getSnapshot();
    expect(after.screen).toBe(before.screen);
    expect(after.detail).toBe(before.detail);
    for (const key of [
      'expense',
      'settlement',
      'creation',
      'toReview',
      'tagManager',
      'groupCurrencies',
      'leave',
    ] as const)
      expect(after[key]).toBe(before[key]);
    expect(after.tagsOpenFor).toBe(before.tagsOpenFor);
    expect(after.currenciesOpenFor).toBe(before.currenciesOpenFor);
    expect(after.notificationOpening.status).toBe('held');
    expect(after.heldNotificationNotice).toBe(after.heldNotification);
    expect(after.heldNotification).not.toBeNull();
    expect(f.requests.slice(count)).toEqual([]);
  },
);
it.each(['sign out', 'account change'] as const)(
  'drops a held widget tap on %s',
  async (action) => {
    const f = fixture(),
      c = f.make();
    await c.signIn('alex');
    c.startCreate();
    await c.openWidget('home');
    const owner = c.getSnapshot().heldNotification!;
    if (action === 'sign out') await c.signOut();
    else await c.signIn('sam');
    expect(c.getSnapshot().heldNotification).toBeNull();
    expect(c.getSnapshot().notificationOpening.status).toBe('idle');
    c.dismissPendingNotification(owner);
    await c.openPendingNotification();
    expect(c.getSnapshot().heldNotification).toBeNull();
  },
);

it('keeps the last Group balance as final when an authoritative read says it is archived', async () => {
  const f = fixture(),
    c = f.make();
  f.groupBalances({
    byCurrency: [
      {
        currency: 'INR',
        balances: [
          { user: { _id: alex.id, name: alex.name }, balance: -12 },
          { user: { _id: sam.id, name: sam.name }, balance: 12 },
        ],
        debts: [
          {
            from: { _id: alex.id, name: alex.name },
            to: { _id: sam.id, name: sam.name },
            amount: 12,
          },
        ],
      },
    ],
  });
  await c.signIn('alex');
  await c.openGroup(groupId);
  await c.refreshBalances();
  await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeDefined());
  const original = f.copies.at(-1)!.groups![groupId]!;
  f.archive();
  await c.openWidget({ kind: 'group', groupId });
  await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]?.archived).toBe(true));
  const copy = f.copies.at(-1)!;
  expect(copy.lostGroupIds).not.toContain(groupId);
  expect(copy.groups![groupId]).toMatchObject({
    currencies: original.currencies,
    verifiedAt: original.verifiedAt,
    balancesVerifiedAt: original.balancesVerifiedAt,
  });
  const session = { status: 'authenticated' as const, accountId: alex.id, loading: false };
  const setup = { widgetId: 7, accountId: alex.id, groupId };
  expect(
    groupWidget(
      copy.groups![groupId],
      { ...setup, kind: 'group' },
      widgetDimensions('4x2'),
      session,
      verified,
    ),
  ).toMatchObject({ state: 'archived', final: true, addExpense: false });
  expect(
    quickWidget(copy, { ...setup, kind: 'quick' }, { width: 172, height: 104 }, session),
  ).toMatchObject({
    state: 'archived',
    title: 'Group archived',
    subtitle: 'Choose another',
  });
  // The app's existing archived-Group refusal is unchanged.
  expect(c.getSnapshot().detail.data).toBeNull();
});

it('stores first names and two initials so members with the same first name remain distinct', async () => {
  const shah = { _id: 'a00000000000000000000003', name: 'Priya Shah' };
  const kapoor = { _id: 'a00000000000000000000004', name: 'Priya Kapoor' };
  const f = fixture([{ id: kapoor._id, name: kapoor.name, email: 'kapoor@example.test' }]);
  const c = f.make();
  f.groupBalances({
    byCurrency: [
      {
        currency: 'INR',
        balances: [
          { user: { _id: alex.id, name: alex.name }, balance: -30 },
          { user: shah, balance: 10 },
          { user: kapoor, balance: 20 },
        ],
        debts: [
          { from: { _id: alex.id, name: alex.name }, to: shah, amount: 10 },
          { from: { _id: alex.id, name: alex.name }, to: kapoor, amount: 20 },
        ],
      },
    ],
  });
  await c.signIn('alex');
  await c.openGroup(groupId);
  await c.refreshBalances();
  await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeDefined());
  const part = f.copies.at(-1)!.groups![groupId];
  expect(part.currencies[0].payments).toMatchObject([
    { fromName: 'Alex', fromInitials: 'AR', toName: 'Priya', toInitials: 'PS' },
    { fromName: 'Alex', fromInitials: 'AR', toName: 'Priya', toInitials: 'PK' },
  ]);
  expect(JSON.stringify(part)).not.toMatch(/Rivera|Shah|Kapoor/);
  const session = { status: 'authenticated' as const, accountId: alex.id, loading: false };
  const setup = { kind: 'group' as const, widgetId: 7, accountId: alex.id, groupId };
  expect(
    groupWidget(part, setup, widgetDimensions('4x2'), session, verified).payments,
  ).toMatchObject([
    { firstName: 'Priya', initials: 'PS' },
    { firstName: 'Priya', initials: 'PK' },
  ]);
});

it('keeps Trip calendar dates from the existing Group read and its verification time', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture();
  f.trip();
  const c = f.make();
  await c.signIn('alex');
  await c.openGroup(groupId);
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.groups?.[groupId]?.tripDates).toEqual({
      start: '2026-11-08',
      end: '2026-11-10',
    }),
  );
  expect(f.copies.at(-1)?.groups?.[groupId]?.verifiedAt).toBe(verified);
  expect(f.requests.filter((r) => r.path === `/api/groups/${groupId}`)).toHaveLength(1);
});

it.each(['sign out', 'account change', '403', '404', '401'] as const)(
  'applies the Widget copy purge rules to Trip dates on %s',
  async (action) => {
    const f = fixture();
    f.trip();
    const c = f.make();
    await c.signIn('alex');
    await c.openGroup(groupId);
    await vi.waitFor(() =>
      expect(f.copies.at(-1)?.groups?.[groupId]?.tripDates?.start).toBe('2026-11-08'),
    );
    f.events.length = 0;
    if (action === 'sign out' || action === 'account change') {
      if (action === 'sign out') await c.signOut();
      else await c.signIn('sam');
      expect(f.events.indexOf('clear')).toBeGreaterThanOrEqual(0);
      expect(f.events.indexOf('signed-out')).toBeGreaterThan(f.events.indexOf('clear'));
    } else if (action === '401') {
      const saved = structuredClone(f.copies.at(-1));
      f.expire();
      await c.openGroup(groupId, false);
      await vi.waitFor(() => expect(f.events).toContain('expired'));
      expect(f.events).not.toContain('clear');
      expect(f.copies.at(-1)).toEqual(saved);
    } else {
      f.refuse(Number(action));
      await c.openGroup(groupId, false);
      await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeUndefined());
      expect(f.copies.at(-1)?.lostGroupIds).toContain(groupId);
    }
  },
);

it('saves a Month summary from the existing page read with its own time and exact currency amounts', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture();
  f.month();
  const c = f.make();
  await c.signIn('alex');
  const groupTime = verified + 60_000;
  clock.mockReturnValue(groupTime);
  await c.openGroup(groupId);
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.months?.[groupId]).toEqual({
      month: '2026-11',
      verifiedAt: groupTime,
      count: 12,
      mainCurrency: 'INR',
      mainCurrencyOnly: true,
      totals: [
        { currency: 'INR', totalMinor: 2354000 },
        { currency: 'JPY', totalMinor: 42000 },
      ],
      shareMinor: 785000,
    }),
  );
  expect(f.requests.filter((r) => r.path.endsWith('/expenses'))).toHaveLength(1);
  expect(f.requests.filter((r) => r.path === `/api/groups/${groupId}`)).toHaveLength(1);
  clock.mockReturnValue(groupTime + 60_000);
  await c.refreshBalances();
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.groups?.[groupId]?.balancesVerifiedAt).toBe(groupTime + 60_000),
  );
  expect(f.copies.at(-1)?.months?.[groupId]?.verifiedAt).toBe(groupTime);
});

it('restores the current Month summary with the time of its saved read after restarting offline', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture();
  f.month();
  const first = f.make();
  await first.signIn('alex');
  await first.openGroup(groupId);
  await vi.waitFor(() => expect(f.copies.at(-1)?.months?.[groupId]?.shareMinor).toBe(785000));
  first.dispose();
  f.offline();
  vi.spyOn(Date, 'now').mockReturnValue(verified + 3_600_000);
  const restarted = f.make();
  await restarted.restore();
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.months?.[groupId]).toMatchObject({
      month: '2026-11',
      shareMinor: 785000,
      verifiedAt: verified,
    }),
  );
});

it('keeps the current Month copy when another Month is read, without relabelling its figures', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture();
  f.month();
  const c = f.make();
  await c.signIn('alex');
  await c.openGroup(groupId);
  await vi.waitFor(() => expect(f.copies.at(-1)?.months?.[groupId]).toBeDefined());
  const original = structuredClone(f.copies.at(-1)?.months?.[groupId]);
  f.month(7);
  await c.selectMonth('2026-10');
  expect(c.getSnapshot().financial.month).toBe('2026-10');
  expect(f.copies.at(-1)?.months?.[groupId]).toEqual(original);
});

it.each(['sign out', 'account change', '403', '404', '401'] as const)(
  'applies the Widget copy purge rules to the Month on %s',
  async (action) => {
    vi.spyOn(Date, 'now').mockReturnValue(verified);
    const f = fixture();
    f.month();
    const c = f.make();
    await c.signIn('alex');
    await c.openGroup(groupId);
    await vi.waitFor(() => expect(f.copies.at(-1)?.months?.[groupId]).toBeDefined());
    f.events.length = 0;
    if (action === 'sign out' || action === 'account change') {
      if (action === 'sign out') await c.signOut();
      else await c.signIn('sam');
      expect(f.events.indexOf('clear')).toBeGreaterThanOrEqual(0);
      expect(f.events.indexOf('signed-out')).toBeGreaterThan(f.events.indexOf('clear'));
      if (action === 'account change') {
        await vi.waitFor(() => expect(f.copies.at(-1)?.accountId).toBe(sam.id));
        expect(f.copies.at(-1)?.months?.[groupId]).toBeUndefined();
      }
    } else if (action === '401') {
      const saved = structuredClone(f.copies.at(-1));
      f.expire();
      await c.openGroup(groupId, false);
      await vi.waitFor(() => expect(f.events).toContain('expired'));
      expect(f.events).not.toContain('clear');
      expect(f.copies.at(-1)).toEqual(saved);
    } else {
      f.refuse(Number(action));
      await c.openGroup(groupId, false);
      await vi.waitFor(() => expect(f.copies.at(-1)?.months?.[groupId]).toBeUndefined());
      expect(f.copies.at(-1)?.groups?.[groupId]).toBeUndefined();
      expect(f.copies.at(-1)?.lostGroupIds).toContain(groupId);
    }
  },
);

it('keeps the Month section even if the separate Balances read fails', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture();
  f.month();
  f.groupBalances({ byCurrency: null });
  const c = f.make();
  await c.signIn('alex');
  await c.openGroup(groupId);
  await vi.waitFor(() => expect(f.copies.at(-1)?.months?.[groupId]?.shareMinor).toBe(785000));
  expect(f.copies.at(-1)?.groups?.[groupId]).toBeUndefined();
});

it('retires the saved Month after a save until the existing Month read succeeds again', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture();
  f.month();
  const c = f.make();
  await c.signIn('alex');
  await c.openGroup(groupId);
  await vi.waitFor(() => expect(f.copies.at(-1)?.months?.[groupId]).toBeDefined());
  await c.openExpense(groupId);
  await c.updateExpenseDraft({ description: 'Groceries', amount: '100', tagId });
  f.offlineAfterSave();
  await c.saveExpense();
  await vi.waitFor(() => expect(f.copies.at(-1)?.months?.[groupId]).toBeUndefined());
});

it('saves an empty Month as zero spending and keeps a missing member share absent', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await c.openGroup(groupId);
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.months?.[groupId]).toMatchObject({
      count: 0,
      totals: [{ currency: 'INR', totalMinor: 0 }],
      verifiedAt: verified,
    }),
  );
  expect(f.copies.at(-1)?.months?.[groupId]).not.toHaveProperty('shareMinor');
});

it.each(['trip', 'other', 'work', 'couple'] as const)(
  'reads the current Month for a %s Group and keeps its All time screen',
  async (theme) => {
    vi.spyOn(Date, 'now').mockReturnValue(verified);
    const f = fixture();
    f.theme(theme);
    f.month();
    const c = f.make();
    await c.signIn('alex');
    const before = f.requests.length;
    await c.openGroup(groupId);
    await vi.waitFor(() => expect(f.copies.at(-1)?.months?.[groupId]?.shareMinor).toBe(785000));
    expect(c.getSnapshot().financial.month).toBeNull();
    expect(c.getSnapshot().financial.expenses.month).toBeNull();
    expect(f.requests.slice(before).filter((r) => r.method === 'GET')).toHaveLength(
      theme === 'trip' ? 5 : 4,
    );
    expect(
      f.requests
        .slice(before)
        .filter((r) => r.path.endsWith('/expenses') && r.query?.includes('dateFrom=2026-11-01')),
    ).toHaveLength(1);
    expect(f.copies.at(-1)?.months?.[groupId]?.verifiedAt).toBe(verified);
  },
);

it.each(['trip', 'other'] as const)(
  'keeps the %s Group’s Month time after an offline restart and a failed refresh',
  async (theme) => {
    vi.spyOn(Date, 'now').mockReturnValue(verified);
    const f = fixture();
    f.theme(theme);
    f.month();
    const first = f.make();
    await first.signIn('alex');
    await first.openGroup(groupId);
    await vi.waitFor(() => expect(f.copies.at(-1)?.months?.[groupId]).toBeDefined());
    f.monthFails(500);
    vi.spyOn(Date, 'now').mockReturnValue(verified + 60_000);
    await first.openGroup(groupId, false);
    expect(f.copies.at(-1)?.months?.[groupId]?.verifiedAt).toBe(verified);
    first.dispose();
    f.offline();
    const restarted = f.make();
    await restarted.restore();
    await restarted.openGroup(groupId);
    await vi.waitFor(() =>
      expect(f.copies.at(-1)?.months?.[groupId]).toMatchObject({
        verifiedAt: verified,
        shareMinor: 785000,
      }),
    );
    expect(restarted.getSnapshot().financial.month).toBeNull();
  },
);

it.each([true, false])(
  'does not project a cached Month after the Group is forgotten, denied=%s',
  async (denied) => {
    vi.spyOn(Date, 'now').mockReturnValue(verified);
    const f = fixture();
    const c = f.make();
    await c.signIn('alex');
    await c.openGroup(groupId);
    const copies: WidgetCopy[] = [];
    const monthRead = vi.fn(() => ({
      month: '2026-11',
      read: {
        source: 'network' as const,
        refreshedAt: verified,
        value: {
          status: 200,
          data: {
            expenses: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
            summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0 },
          },
        },
      },
    }));
    const copy = createWidgetCopy(
      {
        write: async (value) => {
          copies.push(value);
        },
        clear: async () => {},
        setSession: async () => {},
        redraw: async () => {},
      },
      () => ({
        accountId: alex.id,
        write: (operation) => operation(),
        writeSavedCopy: (operation) => operation(),
      }),
      () => undefined,
      () => null,
      undefined,
      () => verified,
      () => null,
      () => true,
      monthRead,
    );
    copy.forgetGroup(groupId, denied);
    copy.update(c.getSnapshot());
    await copy.idle();
    expect(monthRead).not.toHaveBeenCalled();
    expect(copies.at(-1)?.months?.[groupId]).toBeUndefined();
  },
);

it.each(['trip', 'other'] as const)(
  'purges a %s Group when its additional Month read is refused',
  async (theme) => {
    vi.spyOn(Date, 'now').mockReturnValue(verified);
    const f = fixture();
    f.theme(theme);
    f.month();
    const c = f.make();
    await c.signIn('alex');
    await c.openGroup(groupId);
    await vi.waitFor(() => expect(f.copies.at(-1)?.months?.[groupId]).toBeDefined());
    f.monthFails(403);
    await c.openGroup(groupId, false);
    await vi.waitFor(() => expect(f.copies.at(-1)?.lostGroupIds).toContain(groupId));
    expect(f.copies.at(-1)?.months?.[groupId]).toBeUndefined();
    expect(f.copies.at(-1)?.groups?.[groupId]).toBeUndefined();
  },
);

it('uses the newly reported phone zone for the app Month read and the saved Widget copy', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T00:30:00Z'));
  const resolve = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...resolve.call(this), timeZone: 'Pacific/Honolulu' };
  });
  const f = fixture();
  f.theme('other');
  f.month();
  const c = f.make();
  await c.signIn('alex');
  await c.openGroup(groupId);
  await vi.waitFor(() => expect(f.copies.at(-1)?.months?.[groupId]?.month).toBe('2026-10'));
  expect(f.requests.some((r) => r.query?.includes('dateFrom=2026-10-01'))).toBe(true);
});

it('Quick actions Record payment opens Settle up with nothing filled, including when all square', async () => {
  const f = fixture(),
    c = f.make();
  f.groupBalances({
    byCurrency: [
      {
        currency: 'INR',
        balances: [
          { user: { _id: alex.id, name: alex.name }, balance: 0 },
          { user: { _id: sam.id, name: sam.name }, balance: 0 },
        ],
        debts: [],
      },
    ],
  });
  await c.signIn('alex');
  await c.openWidget({ kind: 'record-payment', groupId });
  expect(c.getSnapshot().settlement.balances.flatMap((b) => b.debts)).toEqual([]);
  expect(c.getSnapshot().settlement.balances).toHaveLength(1);
  expect(c.getSnapshot().screen).toBe('settlement');
  expect(c.getSnapshot().settlement).toMatchObject({ status: 'ready', chosen: null, draft: null });
  expect(
    f.requests.filter((r) => r.method !== 'GET' && r.path !== '/api/auth/demo-persona/sign-in'),
  ).toEqual([]);
});

it('keeps active Tags in the Widget copy after a Group read, without reading balances or making another request', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  const before = f.requests.length;
  await c.openExpense(groupId);
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.tags?.[groupId]).toEqual([{ id: tagId, name: 'Groceries' }]),
  );
  expect(f.requests.slice(before).filter((r) => r.path === `/api/groups/${groupId}`)).toHaveLength(
    1,
  );
  expect(f.requests.slice(before).some((r) => r.path.endsWith('/balances'))).toBe(false);
});

it('a Tag shortcut sets a new Expense Tag and never replaces an unfinished draft', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openWidget({ kind: 'expense-tag', groupId, tagId });
  expect(c.getSnapshot().expense.draft?.tagId).toBe(tagId);
  await c.updateExpenseDraft({ description: 'Kept draft', tagId: '' });
  await c.back();
  await c.openWidget({ kind: 'expense-tag', groupId, tagId });
  expect(c.getSnapshot().expense.draft).toMatchObject({ description: 'Kept draft', tagId: '' });
});

it.each(['sign out', 'account change', '401'] as const)(
  'active Tag copies follow the account purge rule on %s',
  async (action) => {
    vi.spyOn(Date, 'now').mockReturnValue(verified);
    const f = fixture(),
      c = f.make();
    await c.signIn('alex');
    await c.openExpense(groupId);
    await c.closeExpense();
    await vi.waitFor(() =>
      expect(f.storedCopy()?.tags?.[groupId]).toEqual([{ id: tagId, name: 'Groceries' }]),
    );
    f.events.length = 0;
    if (action === '401') {
      f.expire();
      await c.refreshHome();
      await vi.waitFor(() => expect(f.events).toContain('expired'));
      expect(f.storedCopy()?.tags?.[groupId]).toHaveLength(1);
      expect(f.events).not.toContain('clear');
      const view = quickWidget(
        f.storedCopy(),
        { kind: 'quick', widgetId: 8, accountId: alex.id, groupId, tagIds: [tagId] },
        { width: 360, height: 104 },
        { status: 'expired' },
      );
      expect(JSON.stringify(view)).not.toContain('Groceries');
    } else {
      if (action === 'sign out') await c.signOut();
      else await c.signIn('sam');
      expect(f.events.indexOf('signed-out')).toBeGreaterThan(f.events.indexOf('clear'));
      expect(f.storedCopy()?.tags?.[groupId]).toBeUndefined();
    }
  },
);

it('a fresh Group read replaces active Tags, removing archived and deleted Tags', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openGroup(groupId, false);
  await vi.waitFor(() => expect(f.storedCopy()?.tags?.[groupId]).toHaveLength(1));
  f.groupTags([
    { _id: tagId, name: 'Groceries', createdAt: '2026-11-01T00:00:00Z', isArchived: true },
  ]);
  await c.openGroup(groupId, false);
  await vi.waitFor(() => expect(f.storedCopy()?.tags?.[groupId]).toEqual([]));
});
