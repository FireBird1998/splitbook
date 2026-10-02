import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';

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

function setup() {
  let cookie: string | null = null;
  let account: string | null = null;
  const drafts = new Map<string, unknown>();
  const reads: string[] = [];
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
    },
    {
      now: () => new Date(2026, 8, 27, 12).getTime(),
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      expenseDrafts: {
        load: async (accountId, id) => structuredClone(drafts.get(`${accountId}:${id}`) ?? null),
        save: async (accountId, id, value) => {
          drafts.set(`${accountId}:${id}`, structuredClone(value));
        },
        remove: async (accountId, id) => {
          drafts.delete(`${accountId}:${id}`);
        },
        clear: async () => drafts.clear(),
      },
      accountLocal: {
        owner: {
          load: async () => account,
          save: async (value) => {
            account = value;
          },
          clear: async () => {
            account = null;
          },
        },
        cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
        stores: [],
      },
      fetch: async (url) => {
        const address = new URL(url);
        const path = address.pathname;
        reads.push(path + address.search);
        if (path.endsWith('/sign-in'))
          return new Response(JSON.stringify({ user: sam }), {
            headers: { 'Set-Cookie': 'better-auth.session_token=test.signature; Path=/; HttpOnly' },
          });
        if (path.endsWith('/get-session'))
          return json({
            user: sam,
            session: { userId: sam.id, expiresAt: '2030-01-01T00:00:00Z' },
          });
        if (path === '/api/groups') return json({ status: 200, data: [group] });
        if (path === '/api/user/balances') return json({ status: 200, data: { buckets: [] } });
        if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
        if (path === `/api/groups/${groupId}/expenses/${expenseId}`)
          return json({ status: 200, data: record });
        if (path === `/api/groups/${groupId}/expenses`)
          return json({
            status: 200,
            data: {
              expenses: [record],
              pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
              summary: {
                count: 1,
                totalsByCurrency: [],
                userOwes: 0,
                userGetsBack: 0,
                byMember: [],
              },
            },
          });
        if (path === `/api/groups/${groupId}/balances`)
          return json({
            status: 200,
            data: { currency: 'INR', balances: [], debts: [], byCurrency: [] },
          });
        if (path === `/api/groups/${groupId}/activity`) {
          const page = Number(address.searchParams.get('page'));
          return json({
            status: 200,
            data: {
              activities: events.slice((page - 1) * 20, page * 20),
              pagination: { page, limit: 20, total: events.length, totalPages: 2 },
            },
          });
        }
        return json({}, 404);
      },
    },
  );
  /** The Group's Activity pages read since the last call; a record reads its own apart. */
  const activityPages = () =>
    reads
      .splice(0)
      .filter((path) => path.includes('/activity?') && !path.includes('expenseId='))
      .map((path) => Number(new URL(path, 'http://local').searchParams.get('page')));
  return { controller, drafts, activityPages };
}

async function signedIn() {
  const setupResult = setup();
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

    // A later refresh starts from the first page again.
    await controller.refreshActivity();
    expect(activityPages()).toEqual([1]);
  });

  it('returns to Activity from the form after Edit on a record opened there', async () => {
    const { controller } = await signedIn();
    await controller.openActivity(groupId);
    await controller.loadMoreActivity();
    await controller.openActivityEvent(eventId(21), { scrollY: 600 });
    await controller.editExpense();
    expect(controller.getSnapshot().expense.status).toBe('editing');

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
