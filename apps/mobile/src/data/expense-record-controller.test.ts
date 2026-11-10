import { describe, expect, it } from 'vitest';
import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook, expensePage, activityPage } from '../test-utils/fake-splitbook';
import type { AccountGroupRecordStore } from './account-record-storage';

// Fictional people and Groups only.
const sam = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 'sam@example.test' };
const priya = { id: 'a00000000000000000000003', name: 'Priya Shah', email: 'priya@example.test' };
const groupId = 'a00000000000000000000010';
const tagId = 'a00000000000000000000020';
const expenseId = 'b00000000000000000000001';
const iso = '2026-08-20T10:00:00.000Z';
const group = {
  _id: groupId,
  createdBy: sam.id,
  name: 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  members: [sam, priya].map((user) => ({
    user: { ...user, _id: user.id, image: null },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Utilities', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const person = (user: typeof sam) => ({ _id: user.id, name: user.name, image: null });
const record = {
  _id: expenseId,
  group: groupId,
  revision: 0,
  description: 'Electricity bill',
  amount: 30,
  amountMinor: 3000,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: person(priya), amount: 30, amountMinor: 3000 }],
  splitBetween: [
    { user: person(sam), amount: 15, amountMinor: 1500 },
    { user: person(priya), amount: 15, amountMinor: 1500 },
  ],
  splitMethod: 'equal',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'housing',
  tagId,
  tag: 'Utilities',
  notes: '',
  isDeleted: false,
  editHistory: [],
};
// Twenty-five events: the Expense's edit and a payment are on the second page.
const eventId = (index: number) => `d${String(index).padStart(23, '0')}`;
const events = Array.from({ length: 25 }, (_, index) => ({
  _id: eventId(index),
  group: groupId,
  actor: person(priya),
  createdAt: new Date(Date.parse('2026-09-27T10:00:00.000Z') - index * 3_600_000).toISOString(),
  ...(index === 22
    ? {
        type: 'settlement_recorded',
        metadata: { amount: 15, currency: 'INR', paidByName: 'Sam Chen', paidToName: 'Priya Shah' },
      }
    : {
        type: index === 21 ? 'expense_edited' : 'expense_added',
        metadata: {
          expenseId: index === 21 ? expenseId : undefined,
          description: index === 21 ? 'Electricity bill' : `Seeded ${index}`,
          amount: 30,
          currency: 'INR',
        },
      }),
}));
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** `served` is the record the server answers with: the Electricity bill unless a test says. */
function setup(served: Record<string, unknown> = record) {
  const server = fakeSplitbook();
  server.world.people.sam = { ...sam, image: null };
  server.world.groups = [group];
  server.world.expenseRecords[groupId] = { [expenseId]: served };
  server.world.expenses[groupId] = expensePage([record]);
  server.world.balances[groupId] = { currency: 'INR', balances: [], debts: [], byCurrency: [] };
  server.reply('GET', `/api/groups/${groupId}/activity`, ({ url }) => {
    const expense = url.searchParams.get('expenseId');
    const own = events.filter((event) => !expense || event.metadata.expenseId === expense);
    return json({ status: 200, data: activityPage(own, Number(url.searchParams.get('page'))) });
  });
  const phone = testPhone(server, {
    now: new Date(2026, 8, 27, 12).getTime(),
    recordSeparator: ':',
    purge: [],
    parts: {
      newSubmissionKey: undefined,
      savedQueries: undefined,
      offlineIdentity: undefined,
      pendingInvitation: undefined,
      settlementAttempts: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      netInfo: undefined,
      accountLocal: {
        financialCleanup: undefined,
        untrustedCopies: undefined,
        signOutRecord: undefined,
        cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
      },
    },
  });
  delete (phone.stores.expenseDrafts as AccountGroupRecordStore).list;
  delete (phone.stores.expenseDrafts as AccountGroupRecordStore).keys;
  const controller = phone.open(),
    drafts = phone.stores.expenseDrafts.records;
  /** The Group's Activity pages read since the last call; a record reads its own apart. */
  const activityPages = () =>
    server
      .sent()
      .splice(0)
      .map((path) => path.slice(path.indexOf(' ') + 1))
      .filter((path) => path.includes('/activity?') && !path.includes('expenseId='))
      .map((path) => Number(new URL(path, 'http://local').searchParams.get('page')));
  return { controller, drafts, activityPages };
}

async function signedIn(served?: Record<string, unknown>) {
  const setupResult = setup(served);
  await setupResult.controller.signIn('sam');
  return setupResult;
}

describe('Opening an Expense record', () => {
  it('opens read-only from an Expenses row; Back returns to that Month and scroll', async () => {
    const { controller, drafts } = await signedIn();
    await controller.openGroup(groupId);
    await controller.selectMonth('2026-08');
    await controller.openExpense(groupId, expenseId, { scrollY: 240 });
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: {
        status: 'detail',
        draft: { original: { _id: expenseId } },
        returnTo: { destination: 'expenses', month: '2026-08', scrollY: 240 },
      },
    });
    // Reading a record stores nothing.
    expect(drafts.size).toBe(0);

    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'expenses',
      financial: { month: '2026-08' },
      restoreScroll: { y: 240 },
    });
  });

  // #820: an Expense in a currency Splitbook no longer supports, such as a legacy DEM row, is
  // listed as stored (#810), but its record can't be read exactly here, so opening it says why.
  it('says why an Expense in a currency Splitbook no longer supports can’t be opened, and stores nothing', async () => {
    const { controller, drafts } = await signedIn({ ...record, currency: 'DEM' });
    await controller.openGroup(groupId);
    await controller.openExpense(groupId, expenseId);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'blocked',
      message:
        'This Expense is in DEM, which Splitbook no longer supports, so it can’t be opened here. It stays in the list as it was recorded.',
    });
    expect(drafts.size).toBe(0);
  });

  it('opens from an Activity event about it; Back returns to Activity with the older events it showed', async () => {
    const { controller, drafts, activityPages } = await signedIn();
    await controller.openActivity(groupId);
    await controller.loadMoreActivity();
    expect(controller.getSnapshot().activity.events).toHaveLength(25);
    activityPages();

    await controller.openActivityEvent(eventId(21), { scrollY: 1800 });
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: {
        status: 'detail',
        draft: { original: { _id: expenseId } },
        returnTo: { destination: 'activity', scrollY: 1800, activityPages: 2 },
      },
    });
    expect(drafts.size).toBe(0);

    await controller.back();
    const shown = controller.getSnapshot();
    expect(shown).toMatchObject({
      screen: 'group',
      destination: 'activity',
      restoreScroll: { y: 1800 },
      activity: { status: 'ready', pagination: { page: 2 }, selected: null },
    });
    // Both pages are read again, so the event's position still exists.
    expect(activityPages()).toEqual([1, 2]);
    expect(shown.activity.events.map((event) => event._id)).toEqual(events.map((e) => e._id));

    // A later refresh reads both pages loaded again (#222, M1-3).
    await controller.refreshActivity();
    expect(activityPages()).toEqual([1, 2]);
  });

  it('returns to Activity from the form after Edit on a record opened there', async () => {
    const { controller } = await signedIn();
    await controller.openActivity(groupId);
    await controller.loadMoreActivity();
    await controller.openActivityEvent(eventId(21), { scrollY: 600 });
    await controller.editExpense();
    expect(controller.getSnapshot().expense.status).toBe('editing');

    // × returns to the record Edit was pressed on (#664); Back from there returns to Activity.
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: { status: 'detail', returnTo: { destination: 'activity', scrollY: 600 } },
    });
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      restoreScroll: { y: 600 },
      activity: { pagination: { page: 2 } },
    });
  });

  it('opens what was recorded for an event that names no Expense', async () => {
    const { controller } = await signedIn();
    await controller.openActivity(groupId);
    await controller.loadMoreActivity();
    await controller.openActivityEvent(eventId(22));
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      activity: { selected: { _id: eventId(22), type: 'settlement_recorded' } },
      expense: { draft: null },
    });
  });
});

describe('Returning from Members and Group details to Activity', () => {
  it('reads again the older events Activity showed, so its scroll position still exists', async () => {
    const { controller, activityPages } = await signedIn();
    await controller.openActivity(groupId);
    await controller.loadMoreActivity();
    activityPages();

    controller.openMembers({ scrollY: 1800 });
    expect(controller.getSnapshot().screen).toBe('members');
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      restoreScroll: { y: 1800 },
      activity: { status: 'ready', pagination: { page: 2 } },
    });
    expect(activityPages()).toEqual([1, 2]);
  });
});
