import { describe, expect, it } from 'vitest';
import { calculateSplitAmountsMinor } from '@splitbook/shared/split-calculation';
import { expensePosition } from './expense-position';
import { createMobileController } from './mobile-controller';
import type { FetchResponse, MobileFetch } from './types';

// #116: the Expenses destination's reads, the member's position on each Expense, and the
// Group's kept draft. Fictional people and Groups only.
const [alex, sam, priya] = [
  { id: 'a00000000000000000000001', name: 'Alex Rivera' },
  { id: 'a00000000000000000000002', name: 'Sam Chen' },
  { id: 'a00000000000000000000003', name: 'Priya Shah' },
];
type Person = typeof alex;
const householdId = 'a00000000000000000000010';
const tripId = 'a00000000000000000000011';
const tagId = 'a00000000000000000000020';
const iso = '2026-09-28T10:00:00.000Z';
const ref = ({ id, name }: Person) => ({ _id: id, name, image: null });
const group = (id: string, name: string, category: 'home' | 'trip') => ({
  _id: id,
  createdBy: alex.id,
  name,
  description: '',
  category,
  defaultCurrency: 'INR',
  members: [alex, sam, priya].map((person, index) => ({
    user: { ...ref(person), email: `person${index}@example.test` },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
const groups = [group(householdId, 'Maple House', 'home'), group(tripId, 'Goa trip', 'trip')];
const json = (data: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  }) as FetchResponse;
const equally = (amountMinor: number, people: Person[]) =>
  calculateSplitAmountsMinor(
    'equal',
    amountMinor,
    people.map((person) => ({ user: person.id })),
  ).map((row, index) => [people[index], row.amountMinor] as [Person, number]);
/** A stored Expense as the ledger lists it, with exact allocations. */
const stored = (
  id: string,
  groupId: string,
  description: string,
  paidBy: [Person, number][],
  splitBetween: [Person, number][],
) => {
  const amountMinor = paidBy.reduce((total, [, minor]) => total + minor, 0);
  const allocation = (rows: [Person, number][]) =>
    rows.map(([person, minor]) => ({ user: ref(person), amount: minor / 100, amountMinor: minor }));
  return {
    _id: id,
    group: groupId,
    description,
    currency: 'INR',
    amount: amountMinor / 100,
    amountMinor,
    moneyVersion: 1,
    category: 'food',
    tag: 'Groceries',
    tagId,
    date: iso,
    createdAt: iso,
    updatedAt: iso,
    paidBy: allocation(paidBy),
    splitBetween: allocation(splitBetween),
    splitMethod: 'equal',
  };
};

/** A fictional ledger: Expenses by Group, draft storage on the device, and lost responses. */
function ledger() {
  const requests: { method: string; path: string }[] = [];
  const expenses = new Map<string, Record<string, unknown>[]>();
  const drafts = new Map<string, unknown>();
  let cookie: string | null = null;
  let account: string | null = null;
  let loseNextCreate = false;
  let nextId = 1;
  const fetch: MobileFetch = async (url, init) => {
    const { pathname, search } = new URL(url);
    const method = init.method ?? 'GET';
    requests.push({ method, path: pathname + search });
    if (pathname.endsWith('/demo-persona/sign-in'))
      return json(
        { user: { ...alex, email: 'person0@example.test', image: null } },
        200,
        'better-auth.session_token=alex.signature; Max-Age=2592000',
      );
    if (pathname.endsWith('/get-session'))
      return json({
        user: { ...alex, email: 'person0@example.test', image: null },
        session: { userId: alex.id, expiresAt: '2030-01-01T00:00:00Z' },
      });
    if (pathname === '/api/groups') return json({ data: groups, status: 200 });
    if (pathname === '/api/user/balances') return json({ data: { buckets: [] }, status: 200 });
    const target = groups.find((row) => pathname.startsWith(`/api/groups/${row._id}`));
    if (!target) return json({ status: 404 }, 404);
    if (pathname === `/api/groups/${target._id}`) return json({ data: target, status: 200 });
    if (pathname.endsWith('/balances')) return json({ data: { byCurrency: [] }, status: 200 });
    const rows = expenses.get(target._id) ?? [];
    if (pathname.endsWith('/expenses') && method === 'POST') {
      const body = JSON.parse(String(init.body));
      const id = `b${String(nextId++).padStart(23, '0')}`;
      const person = (user: string) => [alex, sam, priya].find((row) => row.id === user)!;
      const minor = (amount: number) => Math.round(amount * 100);
      rows.unshift(
        stored(
          id,
          target._id,
          body.description,
          body.paidBy.map((row: { user: string; amount: number }) => [
            person(row.user),
            minor(row.amount),
          ]),
          body.splitBetween.map((row: { user: string; amount: number }) => [
            person(row.user),
            minor(row.amount),
          ]),
        ),
      );
      expenses.set(target._id, rows);
      if (loseNextCreate) {
        loseNextCreate = false;
        throw new Error('The response was lost after the server committed the Expense');
      }
      return json({ status: 201, data: { _id: id, group: target._id } }, 201);
    }
    if (pathname.endsWith('/expenses'))
      return json({
        status: 200,
        data: {
          expenses: rows,
          pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 },
          summary: {
            count: rows.length,
            totalsByCurrency: [],
            userOwes: 0,
            userGetsBack: 0,
            byMember: [alex, sam, priya].map((person) => ({
              user: ref(person),
              paid: 0,
              share: 0,
              net: 0,
            })),
          },
        },
      });
    return json({ status: 404 }, 404);
  };
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
    },
    {
      fetch,
      now: () => new Date(2026, 8, 28, 12).getTime(),
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
        stores: [{ clear: async () => drafts.clear() }],
      },
      newSubmissionKey: () => `native-expenses-${requests.length}-0001`,
    },
  );
  return {
    controller,
    requests,
    expenses,
    drafts,
    keptKey: `${alex.id}:${householdId}`,
    writes: () =>
      requests.filter((row) => row.method !== 'GET' && row.path.startsWith('/api/groups/')),
    loseNextCreate: () => {
      loseNextCreate = true;
    },
  };
}

async function signedIn() {
  const server = ledger();
  await server.controller.signIn('alex');
  return server;
}

/** Leaves a draft for Maple House on the device, as closing the form does. */
async function keepDraft(controller: ReturnType<typeof ledger>['controller']) {
  await controller.openGroup(householdId);
  await controller.openExpense(householdId);
  await controller.updateExpenseDraft({
    amount: '1249.50',
    description: 'Weekly groceries',
    tagId,
  });
  await controller.back();
}

describe('Expenses read through the controller', () => {
  it('say exactly what the signed-in member lent or owes on each Expense', async () => {
    const server = await signedIn();
    server.expenses.set(tripId, [
      stored(
        'b00000000000000000000101',
        tripId,
        'Weekly groceries',
        [[alex, 124950]],
        equally(124950, [alex, sam, priya]),
      ),
      stored(
        'b00000000000000000000102',
        tripId,
        'Villa stay',
        [
          [alex, 200000],
          [sam, 100000],
        ],
        equally(300000, [alex, sam, priya]),
      ),
      stored(
        'b00000000000000000000103',
        tripId,
        'Electricity bill',
        [[sam, 286000]],
        // The leftover paisa falls to Alex.
        equally(286000, [alex, sam, priya]),
      ),
      stored(
        'b00000000000000000000104',
        tripId,
        'Beach shack lunch',
        [[priya, 186000]],
        equally(186000, [sam, priya]),
      ),
    ]);
    await server.controller.openGroup(tripId);
    const shown = server.controller.getSnapshot().financial.expenses.data;
    expect(shown.map((row) => [row.description, expensePosition(row, alex.id)])).toEqual([
      ['Weekly groceries', { kind: 'lent', amountMinor: 83300, amount: 833 }],
      ['Villa stay', { kind: 'lent', amountMinor: 100000, amount: 1000 }],
      ['Electricity bill', { kind: 'owe', amountMinor: 95334, amount: 953.34 }],
      ['Beach shack lunch', null],
    ]);
    expect(expensePosition(shown[1], sam.id)).toBeNull();
    expect(expensePosition(shown[2], priya.id)).toMatchObject({ kind: 'owe', amount: 953.33 });
  });

  it('reads legacy allocations without float drift', async () => {
    const server = await signedIn();
    const legacy = {
      ...stored('b00000000000000000000105', tripId, 'Milk and bread', [[priya, 10000]], []),
      moneyVersion: undefined,
      amountMinor: undefined,
      paidBy: [{ user: ref(priya), amount: 100 }],
      splitBetween: [
        { user: ref(alex), amount: 33.33 },
        { user: ref(sam), amount: 33.33 },
        { user: ref(priya), amount: 33.34 },
      ],
    };
    server.expenses.set(tripId, [legacy]);
    await server.controller.openGroup(tripId);
    const [row] = server.controller.getSnapshot().financial.expenses.data;
    expect(expensePosition(row, alex.id)).toEqual({
      kind: 'owe',
      amountMinor: 3333,
      amount: 33.33,
    });
    expect(expensePosition(row, priya.id)).toEqual({
      kind: 'lent',
      amountMinor: 6666,
      amount: 66.66,
    });
  });

  it('asks every Theme’s summary for the member’s own share and paid amount', async () => {
    const server = await signedIn();
    await server.controller.openGroup(tripId);
    const read = server.requests.find((row) => row.path.includes('/expenses?'))!;
    const query = new URL(read.path, 'http://local').searchParams;
    expect(query.get('includeMemberBreakdown')).toBe('1');
    expect(query.has('dateFrom')).toBe(false);
    expect(server.controller.getSnapshot().financial.expenses.summary?.byMember).toHaveLength(3);
  });
});

describe('A kept draft on Expenses', () => {
  it('is offered for its own Group without being opened or changed', async () => {
    const server = await signedIn();
    await server.controller.openGroup(householdId);
    expect(server.controller.getSnapshot().keptDraft).toBeNull();

    await keepDraft(server.controller);
    expect(server.controller.getSnapshot()).toMatchObject({
      screen: 'group',
      keptDraft: {
        groupId: householdId,
        draft: { description: 'Weekly groceries', amount: 1249.5, currency: 'INR', edit: false },
        unconfirmed: false,
      },
    });
    const kept = structuredClone(server.drafts.get(server.keptKey));

    await server.controller.back();
    await server.controller.openGroup(tripId);
    expect(server.controller.getSnapshot().keptDraft).toBeNull();
    await server.controller.back();
    await server.controller.openGroup(householdId);
    expect(server.controller.getSnapshot().keptDraft?.draft?.description).toBe('Weekly groceries');
    expect(server.drafts.get(server.keptKey)).toEqual(kept);
    expect(server.writes()).toEqual([]);
  });

  it('Resume draft opens it straight into the form, returning to Expenses', async () => {
    const server = await signedIn();
    await keepDraft(server.controller);

    await server.controller.resumeKeptDraft({ scrollY: 240 });
    expect(server.controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: {
        status: 'editing',
        draft: { description: 'Weekly groceries', amount: '1249.50' },
        message: null,
        returnTo: { groupId: householdId, destination: 'expenses', scrollY: 240 },
      },
    });
    expect(server.writes()).toEqual([]);
  });

  it('Discard removes only this Group’s ordinary draft from the device', async () => {
    const server = await signedIn();
    await keepDraft(server.controller);

    expect(await server.controller.discardKeptDraft()).toBe(true);
    expect(server.drafts.size).toBe(0);
    expect(server.controller.getSnapshot()).toMatchObject({ screen: 'group', keptDraft: null });
    expect(server.writes()).toEqual([]);
  });

  it('a save that may already be recorded is finished from Expenses, never discarded there', async () => {
    const server = await signedIn();
    await server.controller.openGroup(householdId);
    await server.controller.openExpense(householdId);
    await server.controller.updateExpenseDraft({
      amount: '1249.50',
      description: 'Weekly groceries',
      tagId,
      date: '2026-09-28',
    });
    server.loseNextCreate();
    await server.controller.saveExpense();
    expect(server.controller.getSnapshot().expense.status).toBe('uncertain');
    await server.controller.back();
    expect(server.controller.getSnapshot().keptDraft).toMatchObject({
      groupId: householdId,
      unconfirmed: true,
    });
    const kept = structuredClone(server.drafts.get(server.keptKey));

    expect(await server.controller.discardKeptDraft()).toBe(false);
    expect(server.drafts.get(server.keptKey)).toEqual(kept);
    const posts = server.writes().length;

    await server.controller.resumeKeptDraft();
    expect(server.controller.getSnapshot().expense.status).toBe('uncertain');
    // Resuming sends nothing; only Check and finish saving retries the same submission.
    expect(server.writes()).toHaveLength(posts);
  });

  it('a record that can’t be read is offered to open, never discarded', async () => {
    const server = await signedIn();
    server.drafts.set(server.keptKey, { version: 1, draft: 'unreadable' });
    await server.controller.openGroup(householdId);
    expect(server.controller.getSnapshot().keptDraft).toEqual({
      groupId: householdId,
      draft: null,
      unconfirmed: false,
    });
    expect(await server.controller.discardKeptDraft()).toBe(false);
    expect(server.drafts.get(server.keptKey)).toEqual({ version: 1, draft: 'unreadable' });
  });
});

describe('After a save on Expenses', () => {
  it('nothing is kept, and the saved Expense is marked while its confirmation shows', async () => {
    const server = await signedIn();
    await server.controller.openGroup(householdId);
    await server.controller.openExpense(householdId);
    await server.controller.updateExpenseDraft({
      amount: '1249.50',
      description: 'Weekly groceries',
      tagId,
      date: '2026-09-28',
    });
    await server.controller.saveExpense();
    const shown = server.controller.getSnapshot();
    const [saved] = shown.financial.expenses.data;
    expect(saved.description).toBe('Weekly groceries');
    expect(shown).toMatchObject({
      screen: 'group',
      destination: 'expenses',
      keptDraft: null,
      snackbar: { message: 'Expense saved · Weekly groceries', expenseId: saved.id },
    });
    expect(server.drafts.size).toBe(0);

    server.controller.dismissSnackbar();
    expect(server.controller.getSnapshot().snackbar).toBeNull();
  });
});
