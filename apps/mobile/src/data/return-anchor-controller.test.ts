import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { FetchResponse, MobileFetch } from './types';

// #225: fictional ledger, public commands, displayed rows and requests only.
const alex = { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test' };
const groupId = 'b00000000000000000000001';
const tagId = 'b00000000000000000000002';
const iso = '2026-09-15T06:30:00.000Z';
const id = (prefix: string, n: number) => `${prefix}${String(n).padStart(23, '0')}`;
const person = { _id: alex.id, name: alex.name, image: null };
const group = {
  _id: groupId,
  createdBy: alex.id,
  name: 'Maple House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  members: [{ user: { ...person, email: alex.email }, role: 'member', joinedAt: iso }],
  tags: [{ _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
function fixture() {
  const requests: { method: string; path: string }[] = [];
  const stored: unknown[] = [];
  let cookie: string | null = null;
  let refused = false;
  let expired = false;
  let owner: string | null = null;
  let cleanup = false;
  const expenses = Array.from({ length: 130 }, (_, index) => ({
    _id: id('c', index + 1),
    group: groupId,
    description: `Fictional expense ${index + 1}`,
    amount: 10,
    amountMinor: 1000,
    moneyVersion: 1,
    currency: 'INR',
    category: 'food',
    date: iso,
    tagId,
    tag: 'Groceries',
    splitMethod: 'equal',
    revision: 0,
    notes: '',
    isDeleted: false,
    paidBy: [{ user: person, amount: 10, amountMinor: 1000 }],
    splitBetween: [{ user: person, amount: 10, amountMinor: 1000 }],
    createdAt: iso,
    updatedAt: iso,
    editHistory: [],
  }));
  const events = expenses.map((expense, index) => ({
    _id: id('e', index + 1),
    group: groupId,
    actor: person,
    type: 'expense_added',
    createdAt: iso,
    metadata: {
      expenseId: expense._id,
      description: expense.description,
      amount: 10,
      currency: 'INR',
    },
  }));
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    Response.json(body, { status, headers }) as FetchResponse;
  const fetch: MobileFetch = async (address, init) => {
    const url = new URL(address),
      path = url.pathname;
    requests.push({ method: init.method ?? 'GET', path: path + url.search });
    const user =
      String(init.body).includes('sam') ||
      new Headers(init.headers).get('Cookie')?.includes('sam.signature')
        ? sam
        : alex;
    if (path.endsWith('/demo-persona/sign-in'))
      return json({ user }, 200, {
        'Set-Cookie': `better-auth.session_token=${user === sam ? 'sam' : 'alex'}.signature`,
      });
    if (path.endsWith('/get-session'))
      return expired
        ? json({ status: 401 }, 401)
        : json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path.endsWith('/sign-out')) return json({ success: true });
    if (path === '/api/groups') return json({ status: 200, data: refused ? [] : [group] });
    if (path === '/api/user/balances') return json({ status: 200, data: { buckets: [] } });
    if (refused) return json({ status: 403, message: 'Not a member' }, 403);
    if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
    if (path.endsWith('/balances'))
      return json({
        status: 200,
        data: { currency: 'INR', balances: [], debts: [], byCurrency: [] },
      });
    const page = Number(url.searchParams.get('page') ?? 1);
    const pagination = { page, limit: 20, total: 130, totalPages: 7 };
    if (path.endsWith('/expenses'))
      return json({
        status: 200,
        data: {
          expenses: expenses.slice((page - 1) * 20, page * 20),
          pagination,
          summary: { count: 130, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
        },
      });
    if (path.endsWith('/activity'))
      return json({
        status: 200,
        data: { activities: events.slice((page - 1) * 20, page * 20), pagination },
      });
    if (path.endsWith('/history'))
      return json({
        status: 200,
        data: { history: [], pagination: { ...pagination, total: 0, totalPages: 0 } },
      });
    const expense = expenses.find((row) => path.endsWith(row._id));
    return expense ? json({ status: 200, data: expense }) : json({ status: 404 }, 404);
  };
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
    },
    {
      fetch,
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
        load: async () => null,
        save: async (_account, _group, value) => {
          stored.push(value);
        },
        remove: async () => undefined,
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
        stores: [{ clear: async () => undefined }],
      },
      now: () => Date.parse(iso),
    },
  );
  return {
    controller,
    requests,
    stored,
    refuse: () => {
      refused = true;
    },
    expire: () => {
      expired = true;
    },
  };
}

async function opened(destination: 'expenses' | 'activity') {
  const server = fixture();
  await server.controller.signIn('alex');
  await server.controller.openGroup(groupId);
  if (destination === 'activity') await server.controller.selectDestination('activity');
  for (let n = 1; n < 6; n++) {
    if (destination === 'activity') await server.controller.loadMoreActivity();
    else await server.controller.loadMoreExpenses();
  }
  return server;
}

describe('returning to a row in a slid window (#225)', () => {
  it('keeps the anchor out of a stored draft and clears it on sign-out', async () => {
    const { controller, stored } = await opened('expenses');
    await controller.openExpense(groupId, id('c', 85), {
      scrollY: 4700,
      anchor: { key: id('c', 81), offset: 18 },
    });
    expect(
      controller.getSnapshot().expense.status,
      controller.getSnapshot().expense.message ?? '',
    ).toBe('detail');
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Fictional edit' });
    expect(stored.length).toBeGreaterThan(0);
    expect(JSON.stringify(stored)).not.toContain('anchor');
    await controller.signOut();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      restoreScroll: null,
      expense: { returnTo: null },
    });
  });

  it.each(['account switch', '401'])('clears all return anchors on %s', async (reason) => {
    const { controller, expire } = await opened('expenses');
    await controller.openExpense(groupId, id('c', 85), {
      scrollY: 4700,
      anchor: { key: id('c', 81), offset: 18 },
    });
    if (reason === 'account switch') await controller.signIn('sam');
    else {
      expire();
      await controller.refresh();
    }
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      restoreScroll: null,
      expense: { returnTo: null },
    });
    if (reason === 'account switch') expect(controller.getSnapshot().auth.user?.id).toBe(sam.id);
    else expect(controller.getSnapshot().auth.status).toBe('signed-out');
  });

  it('drops denied rows on return and Back cannot resurrect the window', async () => {
    const { controller, requests, refuse } = await opened('expenses');
    await controller.openExpense(groupId, id('c', 85), {
      scrollY: 4700,
      anchor: { key: id('c', 81), offset: 18 },
    });
    refuse();
    requests.length = 0;
    await controller.back();
    expect(controller.getSnapshot().financial.expenses.data).toEqual([]);
    expect(controller.getSnapshot().activity.events).toEqual([]);
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
    expect(controller.getSnapshot().restoreScroll).toBeNull();
    expect(requests.every(({ method }) => method === 'GET')).toBe(true);
  });

  it('Members returns with the same anchor and clearing that context removes it', async () => {
    const { controller } = await opened('expenses');
    const anchor = { key: id('c', 81), offset: 18 };
    controller.openMembers({ scrollY: 4700, anchor });
    await controller.back();
    expect(controller.getSnapshot().restoreScroll).toMatchObject({ anchor });
    await controller.back();
    expect(controller.getSnapshot().restoreScroll).toBeNull();
  });

  it('re-reads Activity pages 2–6 after its page-5 event opens an Expense', async () => {
    const { controller, requests } = await opened('activity');
    expect(controller.getSnapshot().activity).toMatchObject({
      firstPage: 2,
      pagination: { page: 6 },
    });
    const anchor = { key: id('e', 81), offset: 24 };
    await controller.openActivityEvent(id('e', 85), { scrollY: 4650, anchor });
    expect(controller.getSnapshot().expense.status).toBe('detail');
    expect(controller.getSnapshot().expense.returnTo).toMatchObject({
      activityFirstPage: 2,
      activityPages: 6,
      anchor,
    });
    requests.length = 0;
    await controller.back();
    const pages = requests
      .filter((row) => row.path.includes('/activity?'))
      .map((row) => Number(new URL(row.path, 'http://local').searchParams.get('page')));
    expect(pages).toEqual([2, 3, 4, 5, 6]);
    expect(controller.getSnapshot().activity).toMatchObject({
      firstPage: 2,
      pagination: { page: 6 },
    });
    expect(controller.getSnapshot().activity.events).toHaveLength(100);
    expect(controller.getSnapshot().restoreScroll).toMatchObject({ groupId, y: 4650, anchor });
    expect(requests.every(({ method }) => method === 'GET')).toBe(true);
  });

  it('re-reads Expense pages 2–6 and keeps the first visible row anchor from page 5', async () => {
    const { controller, requests, stored } = await opened('expenses');
    expect(controller.getSnapshot().financial.expenses.firstPage).toBe(2);
    const anchor = { key: id('c', 81), offset: 18 };
    await controller.openExpense(groupId, id('c', 85), { scrollY: 4700, anchor });
    expect(controller.getSnapshot().expense.status).toBe('detail');
    expect(controller.getSnapshot().expense.returnTo).toMatchObject({
      firstPage: 2,
      pages: 6,
      anchor,
    });
    requests.length = 0;
    await controller.back();
    const pages = requests
      .filter((row) => row.path.includes('/expenses?'))
      .map((row) => Number(new URL(row.path, 'http://local').searchParams.get('page')));
    expect(pages).toEqual([2, 3, 4, 5, 6]);
    expect(controller.getSnapshot().financial.expenses.data).toHaveLength(100);
    expect(controller.getSnapshot().restoreScroll).toMatchObject({ groupId, y: 4700, anchor });
    expect(requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('anchor');
  });
});
