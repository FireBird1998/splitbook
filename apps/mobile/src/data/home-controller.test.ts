import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import { buildExpenseBody, draftFromExpense, type ExpenseDraft } from './expense-draft';
import { expenseRecordSchema } from './expense-record';
import type { MobileGroup } from './types';

// #126: Home keeps each Group's balance from the Home response and lists every Expense draft.
const accountId = 'a00000000000000000000001',
  otherAccount = 'a00000000000000000000002';
const maple = 'b00000000000000000000001',
  goa = 'b00000000000000000000002',
  lisbon = 'b00000000000000000000003',
  football = 'b00000000000000000000004',
  unlisted = 'b00000000000000000000009';
const tagId = 'c00000000000000000000001',
  expenseId = 'd00000000000000000000001';
const iso = '2026-09-28T12:00:00.000Z',
  now = Date.parse(iso);
const alex = { id: accountId, name: 'Alex Rivera', email: 'alex@example.test', image: null };
const group = (_id: string, name: string, category: string, defaultCurrency = 'INR') => ({
  _id,
  name,
  createdBy: accountId,
  category,
  defaultCurrency,
  members: [{ user: { ...alex, _id: accountId }, role: 'admin', joinedAt: iso }],
  tags: [{ _id: tagId, name: 'Food', createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
const groups = [
  group(maple, 'Maple House', 'home'),
  group(goa, 'Goa Friends Trip', 'trip'),
  group(lisbon, 'Lisbon Offsite', 'work', 'EUR'),
  group(football, 'Sunday Football', 'other'),
];
const homeBalances = {
  status: 200,
  data: {
    buckets: [
      { currency: 'EUR', youOwe: 0, youAreOwed: 42.5, net: 42.5 },
      { currency: 'INR', youOwe: 1480, youAreOwed: 620, net: -860 },
    ],
    groups: [
      { groupId: maple, name: 'Maple House', balances: [{ currency: 'INR', balance: -1480 }] },
      {
        groupId: goa,
        name: 'Goa Friends Trip',
        balances: [
          { currency: 'EUR', balance: 12.5 },
          {
            currency: 'INR',
            balance: 620,
            settlement: { counterpartyId: otherAccount, counterpartyName: 'Sam', amount: 620 },
          },
        ],
      },
      { groupId: lisbon, name: 'Lisbon Offsite', balances: [{ currency: 'EUR', balance: 30 }] },
      { groupId: football, name: 'Sunday Football', balances: [] },
    ],
    hasMixedCurrencies: true,
  },
};
const emptyPage = {
  status: 200,
  data: {
    expenses: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
  },
};

function fixture() {
  let offline = false,
    cookie: string | null = null,
    // Alex used this device before, so a sign-in keeps Alex's drafts.
    owner: string | null = accountId,
    identity: unknown = null,
    cleanup = false,
    balances: unknown = homeBalances;
  const cache = new Map<string, unknown>(),
    drafts = new Map<string, unknown>();
  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4146',
        authOrigin: 'http://localhost:4146',
        developmentPersonaEnabled: true,
      },
      {
        now: () => now,
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        offlineIdentity: {
          load: async () => structuredClone(identity),
          save: async (value) => {
            identity = structuredClone(value);
          },
          clear: async () => {
            identity = null;
          },
        },
        readCache: {
          retainGroups: async () => undefined,
          invalidateGroup: async () => undefined,
          invalidateLedger: async () => undefined,
          load: async (account, key) => structuredClone(cache.get(account + key) ?? null),
          save: async (account, key, value) => {
            cache.set(account + key, structuredClone(value));
          },
          clear: async () => {
            cache.clear();
          },
        },
        expenseDrafts: {
          load: async (account, id) => structuredClone(drafts.get(`${account}:${id}`) ?? null),
          save: async (account, id, value) => {
            drafts.set(`${account}:${id}`, structuredClone(value));
          },
          remove: async (account, id) => {
            drafts.delete(`${account}:${id}`);
          },
          clear: async () => {
            drafts.clear();
          },
          list: async (account) =>
            [...drafts]
              .filter(([key]) => key.startsWith(`${account}:`))
              .map(([key, value]) => ({
                groupId: key.split(':')[1],
                value: structuredClone(value),
              })),
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
          stores: [
            {
              clear: async () => {
                cache.clear();
                identity = null;
                drafts.clear();
              },
            },
          ],
        },
        fetch: async (url, init) => {
          if (offline) throw new Error('Offline');
          const path = new URL(url).pathname;
          if (path.endsWith('/sign-in'))
            return new Response(JSON.stringify({ user: alex }), {
              headers: {
                'Set-Cookie': 'better-auth.session_token=alex.signature; Max-Age=2592000',
              },
            });
          if (path.endsWith('/get-session'))
            return Response.json({
              user: alex,
              session: { userId: accountId, expiresAt: '2030-01-01T00:00:00.000Z' },
            });
          if (path.endsWith('/sign-out')) return Response.json({ success: true });
          if (path === '/api/groups') return Response.json({ status: 200, data: groups });
          if (path === '/api/user/balances') return Response.json(balances);
          const listed = groups.find(({ _id }) => path.startsWith(`/api/groups/${_id}`));
          if (listed && path === `/api/groups/${listed._id}`)
            return Response.json({ status: 200, data: listed });
          if (listed && path.endsWith('/expenses')) return Response.json(emptyPage);
          if (listed && path.endsWith('/balances'))
            return Response.json({ status: 200, data: { byCurrency: [] } });
          throw new Error(`Unexpected fixture request ${init.method} ${path}`);
        },
      },
    );
  return {
    create,
    drafts,
    /** Stores a draft record for an account and Group, as the Expense form would. */
    keep: (groupId: string, record: object, account = accountId) =>
      drafts.set(`${account}:${groupId}`, { version: 1, accountId: account, groupId, ...record }),
    respond: (value: unknown) => {
      balances = value;
    },
    goOffline: () => {
      offline = true;
    },
  };
}

const mobileGroup = (id: string, currency: string): MobileGroup => ({
  id,
  name: 'Group',
  description: '',
  category: 'trip',
  defaultCurrency: currency,
  members: [{ user: alex, role: 'admin', joinedAt: new Date(iso) }],
  startDate: null,
  endDate: null,
  createdAt: new Date(iso),
  updatedAt: new Date(iso),
});
const newDraft = (description: string, amount: string, currency = 'INR'): ExpenseDraft => ({
  amount,
  currency,
  description,
  date: '2026-09-28',
  payerId: accountId,
  multiPayer: false,
  payers: [],
  splitMethod: 'equal',
  splitValues: {},
  participantIds: [accountId],
  category: 'other',
  tagId,
  notes: '',
});
/** A new Expense whose save was sent without a confirmed result. */
const unconfirmedSave = (groupId: string, draft: ExpenseDraft) => ({
  draft,
  attempt: {
    key: 'native-home-test-0001',
    body: buildExpenseBody(draft, {
      group: mobileGroup(groupId, draft.currency),
      tags: [{ id: tagId, name: 'Food', isArchived: false, isDeleted: false }],
    }),
  },
});
/** A change to a saved Expense that was sent without a confirmed result. */
const unconfirmedEdit = (groupId: string) => {
  const original = expenseRecordSchema.parse({
    _id: expenseId,
    group: groupId,
    revision: 3,
    description: 'Team lunch',
    amount: 30,
    currency: 'EUR',
    amountMinor: 3000,
    moneyVersion: 1,
    paidBy: [{ user: { _id: accountId, name: 'Alex' }, amount: 30, amountMinor: 3000 }],
    splitBetween: [{ user: { _id: accountId, name: 'Alex' }, amount: 30, amountMinor: 3000 }],
    splitMethod: 'equal',
    date: iso,
    createdAt: iso,
    updatedAt: iso,
    category: 'food',
    tagId,
    notes: '',
    isDeleted: false,
  });
  return {
    draft: { ...draftFromExpense(original), description: 'Team dinner' },
    mutation: { kind: 'edit', revision: 3, body: JSON.stringify({ description: 'Team dinner' }) },
  };
};

describe('Home Group balances', () => {
  it('keeps the member’s balance in each Group from the Home balances response', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    expect(controller.getSnapshot().home).toMatchObject({
      status: 'ready',
      data: [
        { currency: 'EUR', youOwe: 0, youAreOwed: 42.5 },
        { currency: 'INR', youOwe: 1480, youAreOwed: 620 },
      ],
      byGroup: {
        [maple]: [{ currency: 'INR', balance: -1480 }],
        [goa]: [
          { currency: 'EUR', balance: 12.5 },
          { currency: 'INR', balance: 620 },
        ],
        [lisbon]: [{ currency: 'EUR', balance: 30 }],
        // Settled up in every currency.
        [football]: [],
      },
    });
  });

  it('leaves a Group’s balance unknown when the response doesn’t include it', async () => {
    const f = fixture(),
      controller = f.create();
    f.respond({
      ...homeBalances,
      data: { ...homeBalances.data, groups: homeBalances.data.groups.slice(0, 1) },
    });
    await controller.signIn('alex');
    expect(controller.getSnapshot().home.byGroup).toEqual({
      [maple]: [{ currency: 'INR', balance: -1480 }],
    });
  });

  it('keeps each Group’s balance from a recent read and from saved figures offline', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    const byGroup = first.getSnapshot().home.byGroup;
    // Back Home within the display freshness window reuses the verified read.
    await first.openGroup(maple);
    await first.back();
    expect(first.getSnapshot().home).toMatchObject({ status: 'ready', byGroup });
    first.dispose();

    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    expect(restarted.getSnapshot()).toMatchObject({
      offline: { active: true },
      home: { data: [{ currency: 'EUR' }, { currency: 'INR' }], byGroup },
    });
  });
});

describe('Home Expense drafts', () => {
  it('lists every draft in a listed Group, unconfirmed saves first, then in Groups order', async () => {
    const f = fixture(),
      controller = f.create();
    // Stored out of Groups order; the listing doesn't depend on storage order.
    f.keep(lisbon, unconfirmedEdit(lisbon));
    f.keep(maple, { draft: newDraft('Weekly groceries', '1249.5') });
    f.keep(goa, unconfirmedSave(goa, newDraft('Airport taxi', '1150')));
    f.keep(football, { draft: { description: 'Unreadable' } });
    f.keep(unlisted, { draft: newDraft('Left Group', '10') });
    f.keep(maple, { draft: newDraft('Someone else’s', '5') }, otherAccount);
    await controller.signIn('alex');
    expect(controller.getSnapshot().drafts).toEqual([
      {
        groupId: goa,
        groupName: 'Goa Friends Trip',
        expenseId: null,
        description: 'Airport taxi',
        amount: '1150',
        currency: 'INR',
        unconfirmed: true,
      },
      {
        groupId: lisbon,
        groupName: 'Lisbon Offsite',
        expenseId,
        description: 'Team dinner',
        amount: '30',
        currency: 'EUR',
        unconfirmed: true,
      },
      {
        groupId: maple,
        groupName: 'Maple House',
        expenseId: null,
        description: 'Weekly groceries',
        amount: '1249.5',
        currency: 'INR',
        unconfirmed: false,
      },
    ]);
  });

  it('lists drafts again whenever Home shows', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    expect(controller.getSnapshot().drafts).toEqual([]);

    f.keep(maple, { draft: newDraft('Weekly groceries', '1249.5') });
    await controller.openGroup(maple);
    await controller.back();
    expect(controller.getSnapshot().drafts).toMatchObject([
      { groupId: maple, description: 'Weekly groceries', unconfirmed: false },
    ]);

    f.drafts.clear();
    await controller.refresh('pull');
    expect(controller.getSnapshot().drafts).toEqual([]);
  });

  it('opens a listed draft in its Group’s form, and Back goes to that Group’s Expenses', async () => {
    const f = fixture(),
      controller = f.create();
    f.keep(maple, { draft: newDraft('Weekly groceries', '1249.5') });
    await controller.signIn('alex');
    const [listed] = controller.getSnapshot().drafts;
    await controller.openExpense(listed.groupId, listed.expenseId ?? undefined);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: {
        groupId: maple,
        status: 'resume',
        draft: { description: 'Weekly groceries' },
        returnTo: null,
        message: null,
      },
    });
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'expenses',
      detail: { id: maple },
    });
  });

  it('clears listed drafts and this device’s drafts on sign-out', async () => {
    const f = fixture(),
      controller = f.create();
    f.keep(maple, { draft: newDraft('Weekly groceries', '1249.5') });
    f.keep(goa, unconfirmedSave(goa, newDraft('Airport taxi', '1150')));
    await controller.signIn('alex');
    expect(controller.getSnapshot().drafts).toHaveLength(2);

    await controller.signOut();
    expect(controller.getSnapshot().drafts).toEqual([]);
    expect(f.drafts.size).toBe(0);

    await controller.signIn('alex');
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated' },
      drafts: [],
    });
  });
});
