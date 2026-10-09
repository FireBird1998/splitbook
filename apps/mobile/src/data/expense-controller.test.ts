import { describe, expect, it, vi } from 'vitest';
import { toDateParam } from '@splitbook/shared/date';
import { gatewayReply, hangUntilAborted, manualTimer } from '../test-utils/transport-faults';
import { savedQueriesIn } from '../test-utils/saved-queries';
import { resolveDraftReview, type ExpenseDraft, type ExpenseField } from './expense-draft';
import { createMobileController, type MobileController } from './mobile-controller';
import type {
  FetchResponse,
  MobileFetch,
  MobileSnapshot,
  MobileTimer,
  CredentialStore,
  MobileDependencies,
} from './types';

const memberIds = [
  'a00000000000000000000001',
  'a00000000000000000000002',
  'a00000000000000000000003',
];
const groupId = 'a00000000000000000000010';
const tagId = 'a00000000000000000000020';
const iso = '2026-09-28T10:00:00.000Z';
/** The device clock: local noon is 28 September in every time zone, as the member's day is. */
const localNoon = new Date(2026, 8, 28, 12).getTime();
const people = memberIds.map((id, i) => ({
  id,
  name: ['Alex', 'Sam', 'Priya'][i],
  email: `person${i}@example.test`,
  image: null,
}));
const group = {
  _id: groupId,
  createdBy: memberIds[0],
  name: 'Shared home',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  members: people.map(({ id, ...user }) => ({
    user: { _id: id, ...user },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const json = (data: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  });
function setup(
  intercept?: (path: string, init: RequestInit) => Promise<FetchResponse> | undefined,
  options: {
    newSubmissionKey?: () => string;
    timer?: MobileTimer;
    pendingInvitation?: CredentialStore;
    savedQueries?: MobileDependencies['savedQueries'];
  } = {},
) {
  let cookie: string | null = null;
  let account: string | null = null;
  let cleanup = false;
  const records = new Map<string, unknown>();
  const drafts = {
    keys: async (accountId: string) =>
      [...records.keys()]
        .filter((key) => key.startsWith(accountId + ':'))
        .map((key) => key.slice(accountId.length + 1)),
    load: async (accountId: string, id: string) =>
      structuredClone(records.get(`${accountId}:${id}`) ?? null),
    save: async (accountId: string, id: string, value: unknown) => {
      records.set(`${accountId}:${id}`, structuredClone(value));
    },
    remove: async (accountId: string, id: string) => {
      records.delete(`${accountId}:${id}`);
    },
    clear: async () => {
      records.clear();
    },
  };
  const fetch: MobileFetch = async (url, init) => {
    const path = new URL(url).pathname;
    const intercepted = intercept?.(path, init);
    if (intercepted) return intercepted;
    if (path.endsWith('/demo-persona/sign-in'))
      return json(
        { user: people[0] },
        200,
        'better-auth.session_token=alex.signature; Max-Age=2592000',
      );
    if (path.endsWith('/get-session'))
      return json({
        user: people[0],
        session: { userId: people[0].id, expiresAt: '2030-01-01T00:00:00Z' },
      });
    if (path === '/api/groups') return json({ data: [group], status: 200 });
    if (path === `/api/groups/${groupId}`) return json({ data: group, status: 200 });
    if (path.endsWith('/expenses'))
      return json({
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
        },
        status: 200,
      });
    if (path === `/api/groups/${groupId}/balances`)
      return json({
        data: { currency: 'INR', balances: [], debts: [], byCurrency: [] },
        status: 200,
      });
    if (path.endsWith('/user/balances')) return json({ data: { buckets: [] }, status: 200 });
    if (path.endsWith('/sign-out')) return json({ success: true });
    return json({ error: 'Unavailable', status: 404 }, 404);
  };
  /** `now` lets a restarted app open on a later day. */
  const create = (now = localNoon) =>
    createMobileController(
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
        expenseDrafts: drafts,
        pendingInvitation: options.pendingInvitation,
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
          cleanupMarker: {
            load: async () => cleanup,
            mark: async () => {
              cleanup = true;
            },
            clear: async () => {
              cleanup = false;
            },
          },
          stores: [drafts],
        },
        now: () => now,
        newSubmissionKey: options.newSubmissionKey ?? (() => 'native-expense-test-0001'),
        timer: options.timer,
        savedQueries: options.savedQueries,
      },
    );
  return { create, controller: create(), drafts, records };
}

const expenseId = 'a00000000000000000000030';
const savedExpense = {
  _id: expenseId,
  group: groupId,
  description: 'Original dinner',
  amount: 10,
  currency: 'INR',
  amountMinor: 1000,
  moneyVersion: 1,
  revision: 3,
  splitMethod: 'equal',
  paidBy: [{ user: { _id: memberIds[0], name: 'Alex' }, amount: 10, amountMinor: 1000 }],
  splitBetween: memberIds.map((user, index) => ({
    user: { _id: user, name: people[index].name },
    amount: [3.33, 3.34, 3.33][index],
    amountMinor: [333, 334, 333][index],
  })),
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'food',
  tagId,
  tag: 'Groceries',
  notes: 'Keep these notes',
  isDeleted: false,
  editHistory: [
    {
      editedBy: { _id: memberIds[0], name: 'Alex' },
      editedAt: iso,
      changes: { description: { old: 'Dinner', new: 'Original dinner' } },
    },
  ],
};

describe('native Expense creation and editing', () => {
  it.each([403, 404, 'missing member'] as const)(
    'blocks retained entries when the held Group check refuses access (%s)',
    async (refusal) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      let hold = false,
        checking = false,
        posts = 0;
      let release: () => void = () => undefined;
      let opening: Promise<void> | undefined;
      try {
        const { controller, records } = setup((path, init) => {
          if (path.endsWith('/expenses') && init.method === 'POST') posts += 1;
          if (hold && path === `/api/groups/${groupId}`)
            return new Promise((resolve) => {
              checking = true;
              release = () =>
                resolve(
                  refusal === 'missing member'
                    ? json({ status: 200, data: { ...group, members: group.members.slice(1) } })
                    : json({ error: 'Group access lost', status: refusal }, refusal),
                );
            });
        });
        await controller.signIn('alex');
        await controller.openGroup(groupId);
        vi.setSystemTime(Date.now() + 31_000);
        hold = true;
        opening = controller.openExpense(groupId);
        await vi.waitFor(() => expect(checking).toBe(true));
        await controller.updateExpenseDraft({
          description: 'Retained on refusal',
          amount: '10.01',
        });
        release();
        await opening;
        expect(controller.getSnapshot().expense).toMatchObject({
          status: 'blocked',
          context: null,
          accessLost: true,
          draft: { description: 'Retained on refusal', amount: '10.01' },
        });
        await controller.updateExpenseDraft({ description: 'Do not edit blocked entries' });
        await controller.saveExpense();
        expect(posts).toBe(0);
        expect([...records.values()][0]).toMatchObject({
          draft: { description: 'Retained on refusal' },
        });
        await controller.closeExpense();
        expect(records.size).toBe(0);
      } finally {
        release();
        await opening;
        vi.useRealTimers();
      }
    },
  );
  it('keeps a restored Group’s original check time and draft while reconnecting without sending', async () => {
    const copies = new Map<string, unknown>();
    let offline = false,
      held = false,
      reads = 0,
      posts = 0;
    let release: () => void = () => undefined;
    const { controller, create } = setup(
      (path, init) => {
        if (path.endsWith('/expenses') && init.method === 'POST') posts += 1;
        if (path === `/api/groups/${groupId}`) {
          if (offline) return Promise.reject(new Error('Offline'));
          if (held)
            return new Promise((resolve) => {
              reads += 1;
              release = () => resolve(json({ status: 200, data: group }));
            });
        }
      },
      { savedQueries: savedQueriesIn(copies) },
    );
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ amount: '24.01', description: 'A saved draft', tagId });
    await vi.waitFor(() => expect(copies.has(memberIds[0] + `/api/groups/${groupId}`)).toBe(true));
    const row = copies.get(memberIds[0] + `/api/groups/${groupId}`);
    offline = true;
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId);
    expect(restarted.getSnapshot().expense.contextCheck).toMatchObject({
      status: 'saved',
      saved: true,
    });
    expect(row).toMatchObject({
      refreshedAt: restarted.getSnapshot().expense.contextCheck?.refreshedAt,
    });
    restarted.resumeExpenseDraft();
    await restarted.updateExpenseDraft({ notes: 'Offline notes' });
    await restarted.saveExpense();
    expect(posts).toBe(0);
    offline = false;
    held = true;
    const retrying = restarted.refresh();
    await vi.waitFor(() => expect(reads).toBe(1));
    expect(restarted.getSnapshot().expense.contextCheck?.status).toBe('checking');
    await restarted.updateExpenseDraft({ description: 'Typing while reconnecting' });
    release();
    await retrying;
    expect(restarted.getSnapshot().expense.contextCheck).toBeUndefined();
    expect(restarted.getSnapshot().expense.draft).toMatchObject({
      amount: '24.01',
      notes: 'Offline notes',
      description: 'Typing while reconnecting',
      tagId,
    });
    expect(posts).toBe(0);
  });
  it('resolves recovery before exposing entries, then keeps a resumed draft through verification', async () => {
    let hold = false;
    let release: () => void = () => undefined;
    const { controller, records, drafts } = setup((path) => {
      if (hold && path === `/api/groups/${groupId}`)
        return new Promise((resolve) => {
          release = () =>
            resolve(json({ status: 200, data: { ...group, members: group.members.slice(0, 2) } }));
        });
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({
      description: 'My recovered entries',
      amount: '14.01',
      tagId,
    });
    await controller.closeExpense();
    let restore: () => void = () => undefined;
    const load = drafts.load;
    drafts.load = async (accountId, id) => {
      await new Promise<void>((resolve) => {
        restore = resolve;
      });
      return load(accountId, id);
    };
    // Expire only the network read, not the recovery data.
    vi.useFakeTimers({ toFake: ['Date'] });
    let opening: Promise<void> | undefined;
    try {
      vi.setSystemTime(Date.now() + 31_000);
      hold = true;
      opening = controller.openExpense(groupId);
      await vi.waitFor(() => expect(controller.getSnapshot().screen).toBe('expense'));
      expect(controller.getSnapshot().expense.draft).toBeNull();
      await controller.updateExpenseDraft({ description: 'Do not replace recovery' });
      restore();
      await vi.waitFor(() => expect(controller.getSnapshot().expense.status).toBe('resume'));
      expect(controller.getSnapshot().expense.draft?.description).toBe('My recovered entries');
      controller.resumeExpenseDraft();
      await controller.updateExpenseDraft({
        description: 'Resumed while checking',
        notes: 'Still mine',
      });
      release();
      await opening;
      expect(controller.getSnapshot().expense).toMatchObject({
        status: 'editing',
        draft: {
          amount: '14.01',
          description: 'Resumed while checking',
          notes: 'Still mine',
          participantIds: memberIds,
          tagId,
        },
      });
      // Existing choices are retained for review, unlike an untouched new form's defaults.
      expect(controller.getSnapshot().expense.context?.group.members).toHaveLength(2);
      expect([...records.values()][0]).toMatchObject({
        draft: { description: 'Resumed while checking' },
      });
    } finally {
      restore();
      release();
      await opening;
      vi.useRealTimers();
    }
  });

  it('does not reopen or replace a newer task when a held check answers after Back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let hold = false;
    let release: () => void = () => undefined;
    let checking = false;
    let opening: Promise<void> | undefined;
    try {
      const { controller, records } = setup((path) => {
        if (hold && path === `/api/groups/${groupId}`)
          return new Promise((resolve) => {
            checking = true;
            release = () => resolve(json({ status: 200, data: group }));
          });
      });
      await controller.signIn('alex');
      await controller.openGroup(groupId);
      vi.setSystemTime(Date.now() + 31_000);
      hold = true;
      opening = controller.openExpense(groupId);
      await vi.waitFor(() => expect(checking).toBe(true));
      await controller.updateExpenseDraft({ description: 'Kept before Back' });
      const closing = controller.closeExpense();
      await vi.waitFor(() => expect(controller.getSnapshot().screen).toBe('group'));
      expect(controller.getSnapshot().screen).toBe('group');
      release();
      await Promise.all([opening, closing]);
      expect(controller.getSnapshot().screen).toBe('group');
      expect([...records.values()][0]).toMatchObject({
        draft: { description: 'Kept before Back' },
      });
    } finally {
      release();
      await opening;
      vi.useRealTimers();
    }
  });
  it('preserves a typed amount and its currency across a failed check and Retry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let hold = false;
    let reads = 0;
    let release: () => void = () => undefined;
    let opening: Promise<void> | undefined;
    let retrying: Promise<void> | undefined;
    try {
      const { controller, records } = setup((path) => {
        if (path !== `/api/groups/${groupId}` || !hold) return;
        reads += 1;
        return new Promise((resolve) => {
          release = () =>
            resolve(
              json({
                status: 200,
                data:
                  reads === 1
                    ? { ...group, _id: 'a00000000000000000000099' }
                    : { ...group, defaultCurrency: 'USD', members: group.members.slice(0, 2) },
              }),
            );
        });
      });
      await controller.signIn('alex');
      await controller.openGroup(groupId);
      vi.setSystemTime(Date.now() + 31_000);
      hold = true;
      opening = controller.openExpense(groupId);
      await vi.waitFor(() => expect(reads).toBe(1));
      await controller.updateExpenseDraft({
        amount: '12.34',
        description: 'Keep my amount',
        notes: 'Keep my notes',
      });
      await controller.updateExpenseDraft({
        currency: 'USD',
        participantIds: [memberIds[2]],
        tagId,
      });
      expect(controller.getSnapshot().expense.draft).toMatchObject({
        currency: 'INR',
        participantIds: memberIds,
        tagId: '',
      });
      expect(controller.getSnapshot().expense.preview).toBeNull();
      release();
      await opening;
      expect(controller.getSnapshot().expense).toMatchObject({
        status: 'editing',
        contextCheck: { status: 'failed' },
      });
      await controller.updateExpenseDraft({ description: 'Keep these newer entries' });
      retrying = controller.refresh();
      await vi.waitFor(() => expect(reads).toBe(2));
      expect(controller.getSnapshot().expense.draft?.description).toBe('Keep these newer entries');
      release();
      await retrying;
      expect(controller.getSnapshot().expense.contextCheck).toBeUndefined();
      expect(controller.getSnapshot().expense.draft).toMatchObject({
        amount: '12.34',
        currency: 'INR',
        notes: 'Keep my notes',
        description: 'Keep these newer entries',
        participantIds: memberIds.slice(0, 2),
      });
      expect([...records.values()][0]).toMatchObject({
        draft: controller.getSnapshot().expense.draft,
      });
      await controller.saveExpense();
      expect(controller.getSnapshot().expense.validation.errors.amount).toMatch(/currency|USD/i);
      await controller.updateExpenseDraft({ currency: 'USD' });
      expect(controller.getSnapshot().expense.draft?.amount).toBe('12.34');
      expect(controller.getSnapshot().expense.draft?.currency).toBe('USD');
    } finally {
      release();
      await opening;
      await retrying;
      vi.useRealTimers();
    }
  });
  it('keeps ordinary entries usable while an expired Group is checked, without sending a save', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let release = () => {};
    let opening: Promise<void> | undefined;
    try {
      let hold = false;
      let checking = false;
      let posts = 0;
      const { controller } = setup((path, init) => {
        if (path.endsWith('/expenses') && init.method === 'POST') posts += 1;
        if (hold && path === `/api/groups/${groupId}`)
          return new Promise((resolve) => {
            checking = true;
            release = () =>
              resolve(
                json({ status: 200, data: { ...group, members: group.members.slice(0, 2) } }),
              );
          });
      });
      await controller.signIn('alex');
      await controller.openGroup(groupId);
      vi.setSystemTime(Date.now() + 31_000);
      hold = true;
      opening = controller.openExpense(groupId);
      await vi.waitFor(() => expect(checking).toBe(true));
      expect(controller.getSnapshot().expense).toMatchObject({
        status: 'editing',
        draft: { description: '', amount: '' },
      });
      await controller.updateExpenseDraft({
        description: 'Dinner entered during the check',
        amount: '12.34',
        date: '2026-09-27',
        notes: 'Keep these entries',
      });
      await controller.saveExpense();
      expect(posts).toBe(0);
      release();
      await opening;
      expect(controller.getSnapshot().expense).toMatchObject({
        status: 'editing',
        draft: {
          description: 'Dinner entered during the check',
          amount: '12.34',
          date: '2026-09-27',
          notes: 'Keep these entries',
          participantIds: memberIds.slice(0, 2),
        },
      });
    } finally {
      release();
      await opening;
      vi.useRealTimers();
    }
  });

  it('reads an expired Group before opening a new Expense', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let reads = 0;
      const { controller } = setup((path) => {
        if (path === `/api/groups/${groupId}`) reads += 1;
        return undefined;
      });
      await controller.signIn('alex');
      await controller.openGroup(groupId);
      const before = reads;
      vi.setSystemTime(Date.now() + 31_000);
      await controller.openExpense(groupId);
      expect(reads).toBe(before + 1);
      expect(controller.getSnapshot().expense.status).toBe('editing');
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves a recovered draft when opening over a recently verified Group', async () => {
    const { controller } = setup();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Keep my dinner', amount: '12' });
    await controller.closeExpense();
    await controller.openExpense(groupId);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'resume',
      draft: { description: 'Keep my dinner', amount: '12' },
    });
  });

  it('checks Group access live on Save even when the new form reused a recent Group', async () => {
    let deny = false;
    let posts = 0;
    const { controller } = setup((path, init) => {
      if (deny && path === `/api/groups/${groupId}`)
        return Promise.resolve(json({ status: 403, error: 'No access' }, 403));
      if (path.endsWith('/expenses') && init.method === 'POST') posts += 1;
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '12', tagId });
    deny = true;
    await controller.saveExpense();
    expect(posts).toBe(0);
    expect(controller.getSnapshot().expense.context).toBeNull();
    expect(controller.getSnapshot().detail.data).toBeNull();
  });

  it('keeps the Group visible while checking local recovery for a warm new form', async () => {
    const { controller, drafts } = setup();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    let release!: () => void;
    vi.spyOn(drafts, 'load').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        }),
    );
    const opening = controller.openExpense(groupId);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(controller.getSnapshot().screen).toBe('group');
    release();
    await opening;
    expect(controller.getSnapshot().expense.status).toBe('editing');
  });

  it('does not navigate to the form if Back is pressed during warm draft recovery', async () => {
    const { controller, drafts } = setup();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    let release!: () => void;
    vi.spyOn(drafts, 'load').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        }),
    );
    const opening = controller.openExpense(groupId);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await controller.back();
    const destination = controller.getSnapshot().screen;
    release();
    await opening;
    expect(controller.getSnapshot().screen).toBe(destination);
    expect(destination).not.toBe('expense');
  });

  it('joins an in-flight Group refresh instead of opening with its previous members', async () => {
    let hold = false;
    let release!: () => void;
    let reads = 0;
    const { controller } = setup((path) => {
      if (path !== `/api/groups/${groupId}`) return;
      reads += 1;
      if (hold)
        return new Promise((resolve) => {
          release = () =>
            resolve(json({ status: 200, data: { ...group, members: group.members.slice(0, 2) } }));
        });
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    const before = reads;
    hold = true;
    const refreshing = controller.refresh();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const opening = controller.openExpense(groupId);
    await vi.waitFor(() => expect(controller.getSnapshot().screen).toBe('expense'));
    await vi.waitFor(() => expect(controller.getSnapshot().expense.status).toBe('editing'));
    expect(controller.getSnapshot().expense.contextCheck?.status).toBe('checking');
    await controller.updateExpenseDraft({
      description: 'Joining the existing check',
      amount: '12.34',
    });
    expect(reads).toBe(before + 1);
    release();
    await Promise.all([refreshing, opening]);
    expect(controller.getSnapshot().expense.draft?.participantIds).toEqual(memberIds.slice(0, 2));
    expect(controller.getSnapshot().expense.draft?.description).toBe('Joining the existing check');
  });

  it('still checks Group access again when opening a saved Expense over a recent Group', async () => {
    let reads = 0;
    const { controller } = setup((path) => {
      if (path === `/api/groups/${groupId}`) reads += 1;
      if (path.endsWith(`/expenses/${expenseId}`))
        return Promise.resolve(json({ status: 200, data: savedExpense }));
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    const before = reads;
    await controller.openExpense(groupId, expenseId);
    expect(reads).toBe(before + 1);
    expect(controller.getSnapshot().expense.status).toBe('detail');
  });

  it('opens a new Expense over a recently verified Group without another network read', async () => {
    let reads = 0;
    const { controller } = setup((path) => {
      if (path === `/api/groups/${groupId}`) reads += 1;
      return undefined;
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    const before = reads;
    await controller.openExpense(groupId);
    expect(reads).toBe(before);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'editing',
      draft: { currency: 'INR', payerId: memberIds[0], participantIds: memberIds },
    });
  });

  it('confirms a lost delete of a historical Expense with missing member identities after restart', async () => {
    let deleted = false,
      offline = false,
      writes = 0;
    const { controller, create, records } = setup((path, init) => {
      if (!path.endsWith(`/${expenseId}`)) return;
      if (init.method === 'DELETE') {
        deleted = true;
        offline = true;
        writes++;
        return Promise.reject(new Error('Lost response'));
      }
      if (offline) return Promise.reject(new Error('Offline'));
      return Promise.resolve(
        json({
          status: 200,
          data: {
            ...savedExpense,
            isDeleted: deleted,
            revision: deleted ? 4 : 3,
            paidBy: savedExpense.paidBy.map((row) => ({ ...row, user: null })),
            splitBetween: savedExpense.splitBetween.map((row) => ({ ...row, user: null })),
          },
        }),
      );
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    controller.reviewExpenseDeletion();
    await controller.deleteExpense();
    offline = false;
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId, expenseId);
    expect(restarted.getSnapshot().expense.status).toBe('resume');
    restarted.resumeExpenseDraft();
    await restarted.reconcileExpense();
    // The saved Expense reads deleted: the member's own delete, confirmed as if its reply came.
    expect(restarted.getSnapshot()).toMatchObject({
      screen: 'group',
      expense: { status: 'saved', mutation: null, draft: null, message: 'Expense deleted.' },
      snackbar: { message: 'Expense deleted · Original dinner' },
    });
    expect(records.size).toBe(0);
    expect(writes).toBe(1);
  });
  it('keeps restored drafts blocked after authoritative membership denial', async () => {
    let denied = false,
      writes = 0;
    const { controller, create } = setup((path, init) => {
      if (path === `/api/groups/${groupId}` && denied)
        return Promise.resolve(json({ status: 403, error: 'No access' }, 403));
      if (path.endsWith(`/${expenseId}`)) {
        if (init.method === 'PATCH') writes++;
        return Promise.resolve(json({ status: 200, data: savedExpense }));
      }
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Retained input' });
    denied = true;
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId, expenseId);
    expect(restarted.getSnapshot().expense.status).toBe('blocked');
    restarted.resumeExpenseDraft();
    await restarted.saveExpense();
    expect(writes).toBe(0);
    expect(restarted.getSnapshot().expense.draft?.notes).toBe('Retained input');
  });
  it('retains actionable correction and editable input after a definite edit rejection', async () => {
    const { controller, create } = setup((path, init) => {
      if (!path.endsWith(`/${expenseId}`)) return;
      if (init.method === 'PATCH')
        return Promise.resolve(
          json({ status: 422, error: 'INVALID_TAG', code: 'INVALID_TAG' }, 422),
        );
      return Promise.resolve(json({ status: 200, data: savedExpense }));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Keep my input' });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('editing');
    expect(controller.getSnapshot().expense.message).toContain('Choose an active Tag');
    expect(controller.getSnapshot().expense.mutation).toBeNull();
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId, expenseId);
    restarted.resumeExpenseDraft();
    expect(restarted.getSnapshot().expense.status).toBe('editing');
    expect(restarted.getSnapshot().expense.draft?.notes).toBe('Keep my input');
  });

  it.each(['edit', 'delete'] as const)(
    'confirms a lost %s response as the member’s own when checked after a restart, and never repeats it',
    async (kind) => {
      let changed = false,
        offline = false,
        writes = 0;
      const { controller, create, records } = setup((path, init) => {
        if (path.endsWith(`/${expenseId}`)) {
          if (init.method === 'PATCH' || init.method === 'DELETE') {
            writes++;
            changed = true;
            offline = true;
            return Promise.reject(new Error('Committed response lost'));
          }
          if (offline) return Promise.reject(new Error('Offline'));
          return Promise.resolve(
            json({
              status: 200,
              data: {
                ...savedExpense,
                revision: changed ? 4 : 3,
                isDeleted: changed && kind === 'delete',
                description: changed ? 'Saved correction' : savedExpense.description,
              },
            }),
          );
        }
      });
      await controller.signIn('alex');
      await controller.openExpense(groupId, expenseId);
      if (kind === 'edit') {
        await controller.editExpense();
        await controller.updateExpenseDraft({ description: 'Saved correction' });
        await controller.saveExpense();
      } else {
        controller.reviewExpenseDeletion();
        await controller.deleteExpense();
      }
      expect(controller.getSnapshot().expense.status).toBe('uncertain');
      const restarted = create();
      offline = false;
      await restarted.restore();
      await restarted.openExpense(groupId, expenseId);
      restarted.resumeExpenseDraft();
      await restarted.refresh();
      expect(writes).toBe(1);
      // Revision 3 + 1, holding the description sent, or deleted: the member's own change.
      await restarted.reconcileExpense();
      expect(restarted.getSnapshot()).toMatchObject({
        screen: 'group',
        expense: {
          status: 'saved',
          mutation: null,
          draft: null,
          message: kind === 'delete' ? 'Expense deleted.' : 'Expense updated.',
        },
        snackbar: {
          message:
            kind === 'delete'
              ? 'Expense deleted · Original dinner'
              : 'Expense updated · Saved correction',
        },
      });
      expect(records.size).toBe(0);
      await restarted.saveExpense();
      await restarted.deleteExpense();
      expect(writes).toBe(1);
    },
  );

  it.each([403, 404])(
    'keeps today’s blocked state when the check after a lost edit answer is refused with %s',
    async (status) => {
      let committed = false,
        writes = 0;
      const { controller } = setup((path, init) => {
        if (!path.endsWith(`/${expenseId}`)) return;
        if (init.method === 'PATCH') {
          writes++;
          committed = true;
          return Promise.reject(new Error('Committed response lost'));
        }
        // The edit committed at revision 3 + 1 with the description sent, but this read is refused.
        if (committed) return Promise.resolve(json({ status, error: 'Unavailable' }, status));
        return Promise.resolve(json({ status: 200, data: savedExpense }));
      });
      await controller.signIn('alex');
      await controller.openExpense(groupId, expenseId);
      await controller.editExpense();
      await controller.updateExpenseDraft({ description: 'Saved correction' });
      await controller.saveExpense();
      expect(controller.getSnapshot().expense).toMatchObject({
        status: 'blocked',
        mutation: { kind: 'edit', revision: 3 },
        message: expect.stringContaining('This Expense is unavailable'),
      });
      expect(writes).toBe(1);
    },
  );

  it('reads a different Expense beside the draft and frees it only on explicit discard', async () => {
    const { controller } = setup((path) =>
      path.endsWith(`/${expenseId}`)
        ? Promise.resolve(json({ status: 200, data: savedExpense }))
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Unfinished new expense', amount: '12' });
    await controller.openExpense(groupId, expenseId);
    expect(controller.getSnapshot().expense.status).toBe('detail');
    expect(controller.getSnapshot().expense.groupDraft?.description).toBe('Unfinished new expense');
    controller.resumeExpenseDraft();
    expect(controller.getSnapshot().expense.status).toBe('editing');
    expect(controller.getSnapshot().expense.draft?.description).toBe('Unfinished new expense');
    await controller.discardExpenseDraft();
    expect(controller.getSnapshot().expense.status).toBe('detail');
    expect(controller.getSnapshot().expense.draft?.original?._id).toBe(expenseId);
    expect(controller.getSnapshot().expense.groupDraft).toBeNull();
  });

  it('disables edits after membership is revoked without sending a mutation', async () => {
    let denied = false;
    let writes = 0;
    const { controller } = setup((path, init) => {
      if (init.method === 'PATCH') writes++;
      if (denied && path === `/api/groups/${groupId}`)
        return Promise.resolve(json({ status: 403 }, 403));
      if (path.endsWith(`/${expenseId}`))
        return Promise.resolve(json({ status: 200, data: savedExpense }));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    denied = true;
    await controller.saveExpense();
    expect(writes).toBe(0);
    expect(controller.getSnapshot().expense.status).toBe('blocked');
    await controller.saveExpense();
    expect(writes).toBe(0);
  });

  it('settles edit preflight interrupted by a warm link without stranding the draft in saving', async () => {
    let block = false;
    let release!: (response: FetchResponse) => void;
    const { controller } = setup((path) => {
      if (path === `/api/groups/${groupId}` && block)
        return new Promise((resolve) => {
          release = resolve;
        });
      if (path.endsWith(`/${expenseId}`))
        return Promise.resolve(json({ data: savedExpense, status: 200 }));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'My note' });
    block = true;
    const save = controller.saveExpense();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await controller.openInvitation('http://localhost:4138/join/abcdef12');
    release(json({ data: group, status: 200 }));
    await save;
    expect(controller.getSnapshot().expense.status).toBe('editing');
    expect(controller.getSnapshot().expense.draft?.notes).toBe('My note');
  });

  it('sends the displayed revision of an edit and a deletion in X-Splitbook-Revision, never If-Match', async () => {
    let saved: typeof savedExpense = savedExpense;
    const writes: { method: string; revision: string | null; ifMatch: string | null }[] = [];
    const { controller } = setup((path, init) => {
      if (!path.endsWith(`/${expenseId}`)) return;
      if (init.method === 'PATCH' || init.method === 'DELETE') {
        const headers = new Headers(init.headers);
        writes.push({
          method: init.method,
          revision: headers.get('X-Splitbook-Revision'),
          ifMatch: headers.get('If-Match'),
        });
        saved =
          init.method === 'PATCH'
            ? { ...saved, ...JSON.parse(String(init.body)), revision: saved.revision + 1 }
            : { ...saved, isDeleted: true, revision: saved.revision + 1 };
        // The route has committed. A host that evaluates If-Match as an HTTP precondition
        // then replaces the route's answer with its own 412, as staging's host did.
        if (headers.has('If-Match'))
          return Promise.resolve(new Response('Precondition Failed', { status: 412 }));
        return Promise.resolve(
          json({
            status: 200,
            data:
              init.method === 'PATCH'
                ? saved
                : { revision: saved.revision, message: 'Expense deleted' },
          }),
        );
      }
      return Promise.resolve(json({ status: 200, data: saved }));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Corrected dinner' });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'saved',
      mutation: null,
      message: 'Expense updated.',
    });

    await controller.openExpense(groupId, expenseId);
    controller.reviewExpenseDeletion();
    await controller.deleteExpense();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'saved',
      mutation: null,
      message: 'Expense deleted.',
    });
    expect(writes).toEqual([
      { method: 'PATCH', revision: '3', ifMatch: null },
      { method: 'DELETE', revision: '4', ifMatch: null },
    ]);
  });

  it('requires delete review, uses its revision, and confirms the soft-deleted authorized record', async () => {
    let deleted = false;
    const writes: string[] = [];
    const { controller } = setup((path, init) => {
      if (path.endsWith(`/${expenseId}`)) {
        if (init.method === 'DELETE') {
          writes.push(new Headers(init.headers).get('X-Splitbook-Revision')!);
          deleted = true;
          return Promise.resolve(
            json({ status: 200, data: { revision: 4, message: 'Expense deleted' } }),
          );
        }
        return Promise.resolve(
          json({
            status: 200,
            data: { ...savedExpense, isDeleted: deleted, revision: deleted ? 4 : 3 },
          }),
        );
      }
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.deleteExpense();
    expect(writes).toEqual([]);
    controller.reviewExpenseDeletion();
    expect(controller.getSnapshot().expense.status).toBe('delete-review');
    controller.cancelExpenseDeletion();
    expect(writes).toEqual([]);
    controller.reviewExpenseDeletion();
    await controller.deleteExpense();
    expect(writes).toEqual(['3']);
    expect(controller.getSnapshot().expense.message).toBe('Expense deleted.');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    expect(controller.getSnapshot().expense.status).toBe('detail');
    expect(controller.getSnapshot().expense.draft?.original?.isDeleted).toBe(true);
  });

  it('preserves a stale edit across restart and only rebases after explicit review', async () => {
    let revision = 3;
    const writes: string[] = [];
    const { controller, create } = setup((path, init) => {
      if (path.endsWith(`/${expenseId}`)) {
        if (init.method === 'PATCH') {
          writes.push(new Headers(init.headers).get('X-Splitbook-Revision')!);
          if (writes.length === 1) {
            revision = 4;
            return Promise.resolve(json({ code: 'STALE_REVISION', status: 409 }, 409));
          }
          return Promise.resolve(
            json({
              data: { ...savedExpense, description: 'My correction', revision: 5 },
              status: 200,
            }),
          );
        }
        return Promise.resolve(
          json({
            data: {
              ...savedExpense,
              description: revision === 4 ? 'Other editor' : savedExpense.description,
              revision,
            },
            status: 200,
          }),
        );
      }
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'My correction' });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('conflict');
    expect(controller.getSnapshot().expense.latest?.description).toBe('Other editor');
    expect(controller.getSnapshot().expense.draft?.original?.revision).toBe(3);
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId, expenseId);
    restarted.resumeExpenseDraft();
    await restarted.reconcileExpense();
    await restarted.saveExpense();
    expect(writes).toEqual(['3']);
    await restarted.reviewLatestExpense();
    expect(restarted.getSnapshot().expense.draft?.description).toBe('My correction');
    expect(restarted.getSnapshot().expense.draft?.original?.revision).toBe(4);
    await restarted.saveExpense();
    expect(writes).toEqual(['3', '4']);
    expect(restarted.getSnapshot().expense.status).toBe('saved');
  });

  it('edits metadata with the displayed revision and preserves historical rounding and timestamp', async () => {
    const writes: { method: string; body: unknown; revision: string | null }[] = [];
    const { controller } = setup((path, init) => {
      if (path.endsWith(`/${expenseId}`)) {
        if (init.method === 'PATCH') {
          const body = JSON.parse(String(init.body));
          writes.push({
            method: init.method,
            body,
            revision: new Headers(init.headers).get('X-Splitbook-Revision'),
          });
          return Promise.resolve(
            json({ data: { ...savedExpense, ...body, revision: 4 }, status: 200 }),
          );
        }
        return Promise.resolve(json({ data: savedExpense, status: 200 }));
      }
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Corrected dinner' });
    await controller.saveExpense();
    expect(writes).toEqual([
      { method: 'PATCH', revision: '3', body: { description: 'Corrected dinner' } },
    ]);
    expect(controller.getSnapshot().expense.status).toBe('saved');
  });

  it('keeps a saved payer of 0 while the payers are unchanged, so a metadata edit sends no money', async () => {
    // An entry of 0 counts as blank (#187), but a saved Expense may list someone who paid 0.
    const zeroPayer = {
      ...savedExpense,
      paidBy: [
        ...savedExpense.paidBy,
        { user: { _id: memberIds[1], name: 'Sam' }, amount: 0, amountMinor: 0 },
      ],
    };
    const bodies: unknown[] = [];
    const { controller } = setup((path, init) => {
      if (!path.endsWith(`/${expenseId}`)) return undefined;
      if (init.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        return Promise.resolve(json({ data: { ...zeroPayer, ...body, revision: 4 }, status: 200 }));
      }
      return Promise.resolve(json({ data: zeroPayer, status: 200 }));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Corrected dinner' });
    await controller.saveExpense();
    expect(bodies).toEqual([{ description: 'Corrected dinner' }]);
    expect(controller.getSnapshot().expense.status).toBe('saved');
  });

  it('drops a saved payer of 0 who left the Group from a money edit, instead of blocking it', async () => {
    // The 0 row has no entry to remove on Paid by, so a money edit must not carry it.
    const formerId = 'a00000000000000000000099';
    const zeroFormer = {
      ...savedExpense,
      paidBy: [
        ...savedExpense.paidBy,
        { user: { _id: formerId, name: 'Former' }, amount: 0, amountMinor: 0 },
      ],
    };
    // What the server saves for the edit below.
    const edited = {
      ...savedExpense,
      revision: 4,
      splitBetween: memberIds.slice(0, 2).map((user, index) => ({
        user: { _id: user, name: people[index].name },
        amount: 5,
        amountMinor: 500,
      })),
    };
    const bodies: Record<string, unknown>[] = [];
    const { controller } = setup((path, init) => {
      if (!path.endsWith(`/${expenseId}`)) return undefined;
      if (init.method === 'PATCH') {
        bodies.push(JSON.parse(String(init.body)));
        return Promise.resolve(json({ data: edited, status: 200 }));
      }
      return Promise.resolve(json({ data: zeroFormer, status: 200 }));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ participantIds: memberIds.slice(0, 2) });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.validation.errors).toEqual({});
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      paidBy: [{ user: memberIds[0], amount: 10 }],
      splitBetween: [
        { user: memberIds[0], amount: 5 },
        { user: memberIds[1], amount: 5 },
      ],
    });
    expect(controller.getSnapshot().expense.status).toBe('saved');
  });

  it('opens authorized Expense detail with historical allocations and edit history', async () => {
    const { controller } = setup((path) =>
      path.endsWith(`/${expenseId}`)
        ? Promise.resolve(json({ data: savedExpense, status: 200 }))
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    expect(controller.getSnapshot().expense.status).toBe('detail');
    expect(controller.getSnapshot().expense.draft?.original).toMatchObject({
      _id: expenseId,
      revision: 3,
      notes: 'Keep these notes',
      editHistory: [{ changes: { description: { old: 'Dinner', new: 'Original dinner' } } }],
    });
    expect(controller.getSnapshot().expense.preview?.map((row) => row.amountMinor)).toEqual([
      333, 334, 333,
    ]);
  });

  it.each([
    ['equal', {}, [334, 333, 333]],
    ['unequal', { [memberIds[0]]: '5', [memberIds[1]]: '3', [memberIds[2]]: '2' }, [500, 300, 200]],
    ['exact', { [memberIds[0]]: '0.01', [memberIds[1]]: '9.99', [memberIds[2]]: '0' }, [1, 999, 0]],
    [
      'percentage',
      { [memberIds[0]]: '33.33', [memberIds[1]]: '33.33', [memberIds[2]]: '33.34' },
      [333, 333, 334],
    ],
    ['shares', { [memberIds[0]]: '1', [memberIds[1]]: '1', [memberIds[2]]: '1' }, [334, 333, 333]],
  ] as const)(
    'saves %s with preview agreement and deterministic member ordering',
    async (splitMethod, splitValues, expected) => {
      let body: unknown;
      const { controller } = setup((path, init) => {
        if (path.endsWith('/expenses') && init.method === 'POST') {
          body = JSON.parse(String(init.body));
          return Promise.resolve(json({ status: 201, data: { _id: tagId, group: groupId } }, 201));
        }
      });
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({
        description: 'Dinner',
        amount: '10',
        tagId,
        splitMethod,
      });
      await controller.updateExpenseDraft({
        splitValues,
        participantIds: [...memberIds].reverse(),
      });
      expect(controller.getSnapshot().expense.preview?.map((row) => row.amountMinor)).toEqual(
        [...expected].reverse(),
      );
      await controller.saveExpense();
      expect(controller.getSnapshot().expense.status).toBe('saved');
      expect(body).toMatchObject({ splitMethod });
    },
  );

  it.each([
    [
      { splitMethod: 'shares', splitValues: { [memberIds[0]]: '1.0000000000000001' } },
      'Amount supports at most 0 decimal places',
    ],
    [
      {
        splitMethod: 'percentage',
        splitValues: { [memberIds[0]]: '33.33000000000000001', [memberIds[1]]: '66.67' },
      },
      'Amount supports at most 2 decimal places',
    ],
    [
      { splitMethod: 'exact', splitValues: { [memberIds[0]]: '10.001' } },
      'Amount supports at most 2 decimal places',
    ],
    [
      { splitMethod: 'unequal', splitValues: { [memberIds[0]]: '9' } },
      'Split amounts must add up to the expense amount',
    ],
    [{ splitMethod: 'shares', splitValues: { [memberIds[0]]: '-1' } }, 'Shares cannot be negative'],
    [
      { splitMethod: 'shares', splitValues: { [memberIds[0]]: '1.5' } },
      'Amount supports at most 0 decimal places',
    ],
    [{ splitMethod: 'shares' }, 'Total split weight must be positive'],
    [{ participantIds: [memberIds[0], memberIds[0]] }, 'Each person can appear only once'],
    [
      { multiPayer: true, payers: [{ user: memberIds[0], amount: '9' }] },
      'Payer amounts must add up to the expense amount',
    ],
    [
      {
        multiPayer: true,
        payers: [
          { user: memberIds[0], amount: '5' },
          { user: memberIds[0], amount: '5' },
        ],
      },
      'Each person can appear only once',
    ],
  ] satisfies [Partial<ExpenseDraft>, string][])(
    'retains invalid allocation with shared correction: %j',
    async (patch, message) => {
      let posts = 0;
      const { controller } = setup((path, init) => {
        if (path.endsWith('/expenses') && init.method === 'POST') posts++;
        return undefined;
      });
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
      if ('splitMethod' in patch)
        await controller.updateExpenseDraft({ splitMethod: patch.splitMethod });
      await controller.updateExpenseDraft(patch);
      await controller.saveExpense();
      expect(posts).toBe(0);
      expect(controller.getSnapshot().expense.message).toBe(message);
      expect(controller.getSnapshot().expense.status).toBe('editing');
    },
  );

  it('resumes a pre-custom-splits draft with the original equal allocation', async () => {
    const { controller, records } = setup();
    await controller.signIn('alex');
    records.set(`${memberIds[0]}:${groupId}`, {
      version: 1,
      accountId: memberIds[0],
      groupId,
      draft: {
        amount: '10',
        currency: 'INR',
        description: 'Existing draft',
        date: '2026-09-28',
        payerId: memberIds[0],
        participantIds: memberIds,
        category: 'other',
        tagId,
        notes: '',
      },
    });
    await controller.openExpense(groupId);
    expect(controller.getSnapshot().expense.status).toBe('resume');
    expect(controller.getSnapshot().expense.draft).toMatchObject({
      splitMethod: 'equal',
      multiPayer: false,
      description: 'Existing draft',
    });
    expect(controller.getSnapshot().expense.preview?.map((row) => row.amountMinor)).toEqual([
      334, 333, 333,
    ]);
  });

  it('shows the shared correction for incomplete percentages and keeps invalid input without posting', async () => {
    let posts = 0;
    const { controller } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST') posts++;
      return undefined;
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({
      amount: '10',
      description: 'Dinner',
      tagId,
      splitMethod: 'percentage',
    });
    await controller.updateExpenseDraft({ splitValues: { [memberIds[0]]: '90' } });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.message).toBe('Percentages must add up to 100');
    expect(controller.getSnapshot().expense.draft?.splitValues).toEqual({ [memberIds[0]]: '90' });
    expect(posts).toBe(0);
  });

  it('clears incompatible values on method changes but preserves participants, payers and other entries', async () => {
    const { controller, create } = setup();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({
      description: 'Keep dinner',
      amount: '10',
      tagId,
      splitMethod: 'percentage',
    });
    await controller.updateExpenseDraft({
      splitValues: { [memberIds[0]]: '100' },
      participantIds: [memberIds[0]],
    });
    await controller.updateExpenseDraft({ splitMethod: 'shares' });
    expect(controller.getSnapshot().expense.draft?.splitValues).toEqual({});
    await controller.updateExpenseDraft({ splitValues: { [memberIds[0]]: '2' } });
    await controller.updateExpenseDraft({ splitMethod: 'shares' });
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId);
    expect(restarted.getSnapshot().expense.draft).toMatchObject({
      description: 'Keep dinner',
      amount: '10',
      tagId,
      participantIds: [memberIds[0]],
      splitMethod: 'shares',
      splitValues: { [memberIds[0]]: '2' },
    });
    expect(restarted.getSnapshot().expense.preview?.map((row) => row.amountMinor)).toEqual([1000]);
  });

  it('preserves multiple payers and percentage shares through restart and an explicit identical retry', async () => {
    const submissions: { key: string | null; body: string }[] = [];
    const { controller, create } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST') {
        submissions.push({
          key: new Headers(init.headers).get('Idempotency-Key'),
          body: String(init.body),
        });
        if (submissions.length === 1) return Promise.reject(new Error('Lost response'));
        return Promise.resolve(json({ status: 201, data: { _id: tagId, group: groupId } }, 201));
      }
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({
      description: 'Dinner',
      amount: '10.01',
      tagId,
      multiPayer: true,
      payers: [
        { user: memberIds[0], amount: '6' },
        { user: memberIds[1], amount: '4.01' },
      ],
      splitMethod: 'percentage',
      participantIds: [memberIds[0], memberIds[2]],
    });
    await controller.updateExpenseDraft({
      splitValues: { [memberIds[0]]: '25', [memberIds[2]]: '75' },
    });
    expect(controller.getSnapshot().expense.preview?.map((row) => row.amountMinor)).toEqual([
      250, 751,
    ]);
    await controller.saveExpense();
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId);
    expect(restarted.getSnapshot().expense.draft).toMatchObject({
      multiPayer: true,
      splitMethod: 'percentage',
      payers: [
        { user: memberIds[0], amount: '6' },
        { user: memberIds[1], amount: '4.01' },
      ],
    });
    restarted.resumeExpenseDraft();
    await restarted.updateExpenseDraft({ amount: '99', splitMethod: 'equal' });
    await restarted.refresh();
    expect(submissions).toHaveLength(1);
    await restarted.saveExpense();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(JSON.parse(submissions[1].body)).toMatchObject({
      paidBy: [
        { user: memberIds[0], amount: 6 },
        { user: memberIds[1], amount: 4.01 },
      ],
      splitMethod: 'percentage',
      splitBetween: [
        { user: memberIds[0], amount: 2.5, percentage: 25 },
        { user: memberIds[2], amount: 7.51, percentage: 75 },
      ],
    });
    expect(restarted.getSnapshot().expense.status).toBe('saved');
  });

  it('previews and saves an unequal allocation with the shared exact totals', async () => {
    let submitted: unknown;
    const { controller } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST') {
        submitted = JSON.parse(String(init.body));
        return Promise.resolve(json({ status: 201, data: { _id: tagId, group: groupId } }, 201));
      }
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
    await controller.updateExpenseDraft({ splitMethod: 'unequal' });
    await controller.updateExpenseDraft({
      splitValues: { [memberIds[0]]: '5', [memberIds[1]]: '3', [memberIds[2]]: '2' },
    });
    expect(controller.getSnapshot().expense.preview?.map((row) => row.amountMinor)).toEqual([
      500, 300, 200,
    ]);
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('saved');
    expect(submitted).toMatchObject({
      splitMethod: 'unequal',
      splitBetween: [
        { user: memberIds[0], amount: 5 },
        { user: memberIds[1], amount: 3 },
        { user: memberIds[2], amount: 2 },
      ],
    });
  });

  it.each([
    [{ amount: '10.001' }, 'amount', 'INR amounts can have at most 2 decimal places.'],
    [{ participantIds: [] }, 'split', 'Choose at least one person to share this Expense.'],
    [{ payerId: 'a00000000000000000000099' }, 'payers', 'is no longer in this Group'],
    [{ tagId: 'a00000000000000000000099' }, 'tag', 'This Tag is no longer available.'],
    [{ currency: 'USD' }, 'amount', 'This draft uses USD, but the Group now uses INR.'],
    [{ date: '2026-02-30' }, 'date', '2026-02-30 isn’t a real date.'],
    [{ description: '' }, 'description', 'Add a description, such as Groceries.'],
  ] satisfies [Partial<ExpenseDraft>, ExpenseField, string][])(
    'identifies the invalid field and retains entries without sending a write: %j',
    async (patch, field, message) => {
      let posts = 0;
      const { controller } = setup((path, init) => {
        if (path.endsWith('/expenses') && init.method === 'POST') posts++;
        return undefined;
      });
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId, ...patch });
      await controller.saveExpense();
      const expense = controller.getSnapshot().expense;
      expect(posts).toBe(0);
      expect(expense.status).toBe('editing');
      expect(expense.draft).toMatchObject(patch);
      expect(Object.keys(expense.validation.errors)).toEqual([field]);
      expect(expense.validation.errors[field]).toContain(message);
      expect(expense.validation.focus?.field).toBe(field);
    },
  );

  it.each([403, 409, 422, 500])(
    'keeps unknown or ambiguous HTTP %s failures immutable',
    async (status) => {
      const { controller } = setup((path, init) => {
        if (path.endsWith('/expenses') && init.method === 'POST')
          return Promise.resolve(json({ error: 'INVALID_TAG', status }, status));
      });
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
      await controller.saveExpense();
      expect(controller.getSnapshot().expense.status).toBe('uncertain');
      expect(controller.getSnapshot().expense.attempt).not.toBeNull();
    },
  );

  it.each([
    ['permission', 'You no longer have access to this group.'],
    ['connection', 'Could not reach SplitBook. Check your connection and try again.'],
  ])('keeps the %s failure visible alongside immutable recovery', async (failure, message) => {
    const { controller, records } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST') {
        return failure === 'permission'
          ? Promise.resolve(json({ error: 'Forbidden', status: 403 }, 403))
          : Promise.reject(new Error('Network unavailable'));
      }
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
    await controller.saveExpense();
    const expense = controller.getSnapshot().expense;
    expect(expense.status).toBe('uncertain');
    expect(expense.message).toContain(message);
    expect(expense.message).toContain('Checking reuses the same submission');
    expect(expense.attempt).not.toBeNull();
    expect([...records.values()][0]).toMatchObject({ attempt: expense.attempt });
  });

  it.each([false, true])(
    'opens legacy Expense context with omitted optional Tags: %s',
    async (omitTags) => {
      const legacy = {
        ...group,
        tags: omitTags ? undefined : [{ _id: tagId, name: 'Groceries', createdAt: iso }],
      };
      const { controller } = setup((path) =>
        path === `/api/groups/${groupId}`
          ? Promise.resolve(json({ data: legacy, status: 200 }))
          : undefined,
      );
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      expect(controller.getSnapshot().expense.status).toBe('editing');
      expect(controller.getSnapshot().expense.context?.tags).toEqual(
        omitTags ? [] : [{ id: tagId, name: 'Groceries', isArchived: false, isDeleted: false }],
      );
    },
  );

  it('refreshes Tag names and refuses an archived Tag without substituting another one', async () => {
    let renamed = false;
    let archived = false;
    let posts = 0;
    const { controller } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST') posts++;
      if (path === `/api/groups/${groupId}`)
        return Promise.resolve(
          json({
            data: {
              ...group,
              tags: [
                {
                  _id: tagId,
                  name: renamed ? 'New name' : 'Groceries',
                  isArchived: archived,
                  createdAt: iso,
                },
              ],
            },
            status: 200,
          }),
        );
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
    renamed = true;
    archived = true;
    await controller.saveExpense();
    expect(posts).toBe(0);
    expect(controller.getSnapshot().expense.context?.tags[0].name).toBe('New name');
    expect(controller.getSnapshot().expense.draft?.tagId).toBe(tagId);
    expect(controller.getSnapshot().expense.status).toBe('editing');
  });

  it('does not restore an old edit when sign-out interrupts rejection cleanup', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredCleanup = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { controller, drafts } = setup((path, init) => {
      if (path.endsWith(`/${expenseId}`) && init.method === 'PATCH')
        return Promise.resolve(json({ code: 'INVALID_TAG', status: 422 }, 422));
      if (path.endsWith(`/${expenseId}`))
        return Promise.resolve(json({ data: savedExpense, status: 200 }));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Private dinner', amount: '10', tagId });
    const save = drafts.save;
    let writes = 0;
    drafts.save = async (...args) => {
      writes++;
      if (writes === 2) {
        entered();
        await held;
        throw new Error('Storage failed');
      }
      await save(...args);
    };
    const saving = controller.saveExpense();
    await enteredCleanup;
    const leaked: unknown[] = [];
    controller.subscribe(() => {
      const state = controller.getSnapshot();
      if (state.auth.status === 'signed-out' && state.expense.mutation)
        leaked.push(state.expense.mutation);
    });
    const signingOut = controller.signOut();
    release();
    await Promise.all([saving, signingOut]);
    expect(leaked).toEqual([]);
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(controller.getSnapshot().expense.mutation).toBeNull();
    expect(controller.getSnapshot().expense.draft).toBeNull();
  });

  it('does not restore an old attempt when sign-out interrupts rejection cleanup', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredCleanup = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { controller, drafts } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST')
        return Promise.resolve(json({ code: 'INVALID_TAG', status: 422 }, 422));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Private dinner', amount: '10', tagId });
    const save = drafts.save;
    let writes = 0;
    drafts.save = async (...args) => {
      writes++;
      if (writes === 2) {
        entered();
        await held;
        throw new Error('Storage failed');
      }
      await save(...args);
    };
    const saving = controller.saveExpense();
    await enteredCleanup;
    const leaked: unknown[] = [];
    controller.subscribe(() => {
      const state = controller.getSnapshot();
      if (state.auth.status === 'signed-out' && state.expense.attempt)
        leaked.push(state.expense.attempt);
    });
    const signingOut = controller.signOut();
    release();
    await Promise.all([saving, signingOut]);
    expect(leaked).toEqual([]);
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(controller.getSnapshot().expense.attempt).toBeNull();
    expect(controller.getSnapshot().expense.draft).toBeNull();
  });

  it('settles an interrupted save when a warm invitation replaces the editor', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPreflight = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let hold = false;
    const { controller } = setup((path) => {
      if (hold && path === `/api/groups/${groupId}`)
        return (async () => {
          entered();
          await held;
          return json({ data: group, status: 200 });
        })();
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
    hold = true;
    const saving = controller.saveExpense();
    await enteredPreflight;
    await controller.openInvitation('http://localhost:4138/join/abcdef12');
    release();
    await saving;
    expect(controller.getSnapshot().screen).toBe('invite');
    expect(controller.getSnapshot().expense.status).toBe('editing');
    expect(controller.getSnapshot().expense.draft?.description).toBe('Dinner');
  });

  it.each([201, 422])(
    'never overwrites a newer draft when the original response arrives late (%s)',
    async (status) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const submitted = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let posts = 0;
      const { controller, create } = setup((path, init) => {
        if (path.endsWith('/expenses') && init.method === 'POST') {
          posts++;
          if (posts === 1)
            return (async () => {
              entered();
              await held;
              return status === 201
                ? json(
                    { data: { _id: 'a00000000000000000000030', group: groupId }, status: 201 },
                    201,
                  )
                : json({ code: 'INVALID_TAG', status: 422 }, 422);
            })();
          return Promise.resolve(
            json({ data: { _id: 'a00000000000000000000030', group: groupId }, status: 201 }, 201),
          );
        }
      });
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ description: 'First dinner', amount: '10', tagId });
      const first = controller.saveExpense();
      await submitted;
      await controller.openInvitation('http://localhost:4138/join/abcdef12');
      await controller.openExpense(groupId);
      controller.resumeExpenseDraft();
      await controller.saveExpense();
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ description: 'A newer dinner', amount: '20', tagId });
      release();
      await first;
      const restarted = create();
      await restarted.restore();
      await restarted.openExpense(groupId);
      expect(restarted.getSnapshot().expense.draft?.description).toBe('A newer dinner');
      expect(restarted.getSnapshot().expense.draft?.amount).toBe('20');
    },
  );

  it('refreshes the affected visible Group when a save completes after navigation', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const submitted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let reads = 0;
    const { controller } = setup((path, init) => {
      if (path === `/api/groups/${groupId}`) reads++;
      if (path.endsWith('/expenses') && init.method === 'POST')
        return (async () => {
          entered();
          await held;
          return json(
            { data: { _id: 'a00000000000000000000030', group: groupId }, status: 201 },
            201,
          );
        })();
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
    const saving = controller.saveExpense();
    await submitted;
    await controller.openInvitation('http://localhost:4138/join/abcdef12');
    await controller.openGroup(groupId);
    const before = reads;
    release();
    await saving;
    expect(reads).toBeGreaterThan(before);
    expect(controller.getSnapshot().screen).toBe('group');
    expect(controller.getSnapshot().financial.expenses.status).toBe('ready');
    expect(controller.getSnapshot().expense.status).toBe('saved');
  });

  it('requires explicit discard, protects unresolved attempts, and purges drafts on sign-out', async () => {
    const { controller, create, records } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST')
        return Promise.reject(new Error('Lost response'));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Discard me', amount: '10', tagId });
    await controller.discardExpenseDraft();
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().expense.draft?.description).toBe('');
    await controller.updateExpenseDraft({ description: 'Keep recovery', amount: '20', tagId });
    await controller.saveExpense();
    await controller.discardExpenseDraft();
    expect(records.size).toBe(1);
    expect(controller.getSnapshot().expense.status).toBe('uncertain');
    await controller.signOut();
    expect(records.size).toBe(0);
    const restarted = create();
    await restarted.signIn('alex');
    await restarted.openExpense(groupId);
    expect(restarted.getSnapshot().expense.draft?.amount).toBe('');
  });

  it('restores an editable draft offline and never queues a save', async () => {
    let offline = false;
    let posts = 0;
    const { controller, create } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST') posts++;
      if (offline && path === `/api/groups/${groupId}`) return Promise.reject(new Error('Offline'));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
    offline = true;
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId);
    restarted.resumeExpenseDraft();
    await restarted.updateExpenseDraft({ description: 'Offline correction' });
    await restarted.saveExpense();
    expect(posts).toBe(0);
    expect(restarted.getSnapshot().expense.draft?.description).toBe('Offline correction');
    expect(restarted.getSnapshot().expense.status).toBe('editing');
    offline = false;
    await restarted.refresh();
    expect(posts).toBe(0);
    expect(restarted.getSnapshot().screen).toBe('expense');
  });

  it('unlocks a definitively rejected submission by machine code and retains input for correction', async () => {
    const { controller, create } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST')
        return Promise.resolve(
          json({ error: 'Translated message', code: 'INVALID_TAG', status: 422 }, 422),
        );
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('editing');
    expect(controller.getSnapshot().expense.attempt).toBeNull();
    expect(controller.getSnapshot().expense.message).toContain('Tag');
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId);
    restarted.resumeExpenseDraft();
    expect(restarted.getSnapshot().expense.status).toBe('editing');
    expect(restarted.getSnapshot().expense.draft?.amount).toBe('10');
  });

  it('never sends a write when durable submission storage fails', async () => {
    let posts = 0;
    const { controller, drafts } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST') posts++;
      return undefined;
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
    drafts.save = async () => {
      throw new Error('Disk full');
    };
    await controller.saveExpense();
    expect(posts).toBe(0);
    expect(controller.getSnapshot().expense.status).toBe('editing');
    expect(controller.getSnapshot().expense.attempt).toBeNull();
    expect(controller.getSnapshot().expense.persistence).toBe('error');
  });

  it('retains the immutable submitted payload and key through a lost response and restart', async () => {
    const submissions: { key: string | null; body: string }[] = [];
    const { controller, create } = setup((path, init) => {
      if (!path.endsWith('/expenses') || init.method !== 'POST') return;
      submissions.push({
        key: new Headers(init.headers).get('Idempotency-Key'),
        body: String(init.body),
      });
      if (submissions.length === 1) return Promise.reject(new Error('Response lost after commit'));
      return Promise.resolve(
        json({ data: { _id: 'a00000000000000000000030', group: groupId }, status: 201 }, 201),
      );
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Shared dinner', amount: '10.00', tagId });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('uncertain');
    await controller.updateExpenseDraft({ amount: '100.00' });
    expect(controller.getSnapshot().expense.draft?.amount).toBe('10.00');
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId);
    restarted.resumeExpenseDraft();
    expect(restarted.getSnapshot().expense.status).toBe('uncertain');
    await restarted.saveExpense();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[0].key).toBe('native-expense-test-0001');
    expect(restarted.getSnapshot().expense.status).toBe('saved');
    const reopened = create();
    await reopened.restore();
    await reopened.openExpense(groupId);
    expect(reopened.getSnapshot().expense.status).toBe('editing');
    expect(reopened.getSnapshot().expense.draft?.amount).toBe('');
  });

  it('previews an exact equal split and restores the same account’s draft after restart', async () => {
    const { controller, create } = setup();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10.00', tagId });
    expect(controller.getSnapshot().expense.preview?.map((item) => item.amountMinor)).toEqual([
      334, 333, 333,
    ]);
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId);
    expect(restarted.getSnapshot().expense.status).toBe('resume');
    restarted.resumeExpenseDraft();
    expect(restarted.getSnapshot().expense.draft).toMatchObject({
      description: 'Dinner',
      amount: '10.00',
      tagId,
      participantIds: memberIds,
    });
  });
});

describe('reading an Expense beside the Group’s draft', () => {
  const recordWrites = (drafts: ReturnType<typeof setup>['drafts']) => {
    const writes: string[] = [];
    const { save, remove } = drafts;
    drafts.save = async (accountId, id, value) => {
      writes.push('save');
      await save(accountId, id, value);
    };
    drafts.remove = async (accountId, id) => {
      writes.push('remove');
      await remove(accountId, id);
    };
    return writes;
  };
  const withDraft = async (intercept?: Parameters<typeof setup>[0]) => {
    const harness = setup(
      (path, init) =>
        intercept?.(path, init) ??
        (path.endsWith(`/${expenseId}`)
          ? Promise.resolve(json({ status: 200, data: savedExpense }))
          : undefined),
    );
    await harness.controller.signIn('alex');
    await harness.controller.openExpense(groupId);
    await harness.controller.updateExpenseDraft({ description: 'Taxi', amount: '12', tagId });
    return { ...harness, stored: structuredClone([...harness.records]) };
  };

  it('opens another Expense read-only and leaves the draft as it was', async () => {
    const { controller, drafts, records, stored } = await withDraft();
    const writes = recordWrites(drafts);
    await controller.openExpense(groupId, expenseId);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { original: { _id: expenseId } },
      groupDraft: { description: 'Taxi', amount: '12' },
      message: null,
    });
    expect(writes).toEqual([]);
    expect([...records]).toEqual(stored);
  });

  it('refuses Edit and Delete beside the draft without writing to it', async () => {
    let deletes = 0;
    const { controller, drafts, records, stored } = await withDraft((path, init) => {
      if (path.endsWith(`/${expenseId}`) && init.method === 'DELETE') deletes++;
      return undefined;
    });
    const writes = recordWrites(drafts);
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    expect(controller.getSnapshot().expense.status).toBe('detail');
    controller.reviewExpenseDeletion();
    expect(controller.getSnapshot().expense.status).toBe('detail');
    await controller.deleteExpense();
    expect(deletes).toBe(0);
    expect(writes).toEqual([]);
    expect([...records]).toEqual(stored);
  });

  it('still resumes a draft editing this same Expense', async () => {
    const { controller } = setup((path) =>
      path.endsWith(`/${expenseId}`)
        ? Promise.resolve(json({ status: 200, data: savedExpense }))
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Unfinished correction' });
    await controller.openExpense(groupId, expenseId);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'resume',
      draft: { notes: 'Unfinished correction' },
      groupDraft: null,
    });
  });

  it('puts a save that may already be recorded before any other Expense', async () => {
    const { controller } = await withDraft((path, init) =>
      path.endsWith('/expenses') && init.method === 'POST'
        ? Promise.reject(new Error('Lost response'))
        : undefined,
    );
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('uncertain');
    await controller.openExpense(groupId, expenseId);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'resume',
      draft: { description: 'Taxi' },
      groupDraft: null,
    });
    expect(controller.getSnapshot().expense.attempt).not.toBeNull();
    expect(controller.getSnapshot().expense.message).toContain('before opening another Expense');
  });
});

describe('keeping only drafts that change something', () => {
  const withSaved = () => {
    const harness = setup((path) =>
      path.endsWith(`/${expenseId}`)
        ? Promise.resolve(json({ status: 200, data: savedExpense }))
        : undefined,
    );
    let saves = 0;
    const { save } = harness.drafts;
    harness.drafts.save = async (accountId, id, value) => {
      saves++;
      await save(accountId, id, value);
    };
    return { ...harness, saves: () => saves };
  };
  const key = `${memberIds[0]}:${groupId}`;

  it('stores nothing for an Edit closed without a change', async () => {
    const { controller, records, saves } = withSaved();
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    expect(controller.getSnapshot().expense.status).toBe('editing');
    await controller.back();
    expect(saves()).toBe(0);
    expect(records.size).toBe(0);

    await controller.openExpense(groupId);
    expect(controller.getSnapshot().expense.status).toBe('editing');
    await controller.openExpense(groupId, expenseId);
    expect(controller.getSnapshot().expense).toMatchObject({ status: 'detail', groupDraft: null });
  });

  it('writes nothing for a tap that changes nothing, such as Today when today is set', async () => {
    const { controller, records, saves } = withSaved();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    const today = controller.getSnapshot().expense.draft!.date;
    await controller.updateExpenseDraft({ date: today });
    await controller.updateExpenseDraft({ splitMethod: 'equal' });
    await controller.back();
    expect(saves()).toBe(0);
    expect(records.size).toBe(0);

    await controller.openExpense(groupId);
    expect(controller.getSnapshot().expense.status).toBe('editing');
  });

  it('removes the stored draft when a change is undone', async () => {
    const { controller, records } = withSaved();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ amount: '12' });
    expect(records.size).toBe(1);
    await controller.updateExpenseDraft({ amount: '' });
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().expense.persistence).toBe('saved');

    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Changed' });
    expect(records.size).toBe(1);
    await controller.updateExpenseDraft({ notes: savedExpense.notes });
    expect(records.size).toBe(0);
  });

  it('keeps a real change through a restart', async () => {
    const { controller, create, records } = withSaved();
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Split the tip too' });
    await controller.back();
    expect(records.size).toBe(1);

    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId, expenseId);
    expect(restarted.getSnapshot().expense).toMatchObject({
      status: 'resume',
      draft: { notes: 'Split the tip too' },
    });
  });

  it('removes an unchanged draft when the form opens, when its start is known', async () => {
    const { controller, records } = withSaved();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    const blank = controller.getSnapshot().expense.draft;
    await controller.openExpense(groupId, expenseId);
    const unedited = controller.getSnapshot().expense.draft;

    // An untouched Edit, as earlier versions stored it, starts from its saved Expense.
    records.set(key, { version: 1, accountId: memberIds[0], groupId, draft: unedited });
    await controller.openExpense(groupId, expenseId);
    expect(controller.getSnapshot().expense.status).toBe('detail');
    expect(records.size).toBe(0);

    // An untouched new form stored with its start.
    records.set(key, { version: 1, accountId: memberIds[0], groupId, draft: blank, blank });
    await controller.openExpense(groupId);
    expect(controller.getSnapshot().expense.status).toBe('editing');
    expect(records.size).toBe(0);

    // Beside another Expense, it no longer holds Edit and Delete.
    records.set(key, { version: 1, accountId: memberIds[0], groupId, draft: blank, blank });
    await controller.openExpense(groupId, expenseId);
    expect(controller.getSnapshot().expense).toMatchObject({ status: 'detail', groupDraft: null });
    expect(records.size).toBe(0);
  });

  it('keeps an unchanged draft whose save may already be recorded', async () => {
    const { controller, records } = withSaved();
    await controller.signIn('alex');
    await controller.openExpense(groupId, expenseId);
    const unedited = controller.getSnapshot().expense.draft;
    const mutation = { kind: 'delete', revision: 3, body: '' };
    records.set(key, { version: 1, accountId: memberIds[0], groupId, draft: unedited, mutation });
    await controller.openExpense(groupId, expenseId);
    expect(controller.getSnapshot().expense).toMatchObject({ status: 'resume', mutation });
    expect(records.size).toBe(1);
  });

  it('still writes on Retry saving draft after a storage error', async () => {
    const { controller, drafts, records } = withSaved();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    const { save } = drafts;
    drafts.save = async () => {
      throw new Error('Disk full');
    };
    await controller.updateExpenseDraft({ description: 'Milk' });
    expect(controller.getSnapshot().expense.persistence).toBe('error');
    drafts.save = save;
    // The Retry button sends a patch that changes nothing.
    await controller.updateExpenseDraft({});
    expect(controller.getSnapshot().expense.persistence).toBe('saved');
    expect(records.get(key)).toMatchObject({ draft: { description: 'Milk' } });
  });

  it('keeps a draft an earlier version stored without its start, even once undone', async () => {
    const { controller, records } = withSaved();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    const blank = controller.getSnapshot().expense.draft;
    records.set(key, { version: 1, accountId: memberIds[0], groupId, draft: blank });
    const legacy = structuredClone(records.get(key));

    await controller.openExpense(groupId);
    expect(controller.getSnapshot().expense.status).toBe('resume');
    expect(records.get(key)).toEqual(legacy);
    controller.resumeExpenseDraft();
    await controller.updateExpenseDraft({ amount: '5' });
    await controller.updateExpenseDraft({ amount: '' });
    expect(records.get(key)).toMatchObject({ draft: blank });
  });

  describe('on a later day', () => {
    const nextDay = new Date(2026, 8, 29, 12).getTime();
    const restart = async (create: (now?: number) => ReturnType<typeof createMobileController>) => {
      const restarted = create(nextDay);
      await restarted.restore();
      return restarted;
    };

    it('removes a draft undone back to where it started, not to today’s blank form', async () => {
      const { controller, create, records, saves } = withSaved();
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ amount: '12' });
      await controller.back();

      const restarted = await restart(create);
      await restarted.openExpense(groupId);
      expect(restarted.getSnapshot().expense.status).toBe('resume');
      restarted.resumeExpenseDraft();
      const written = saves();
      await restarted.updateExpenseDraft({ date: restarted.getSnapshot().expense.draft!.date });
      expect(saves()).toBe(written);
      await restarted.updateExpenseDraft({ amount: '' });
      expect(records.size).toBe(0);

      await restarted.back();
      await restarted.openExpense(groupId);
      expect(restarted.getSnapshot().expense).toMatchObject({
        status: 'editing',
        draft: { date: toDateParam(new Date(nextDay)) },
      });
    });

    it('removes a draft resumed beside another Expense once it is undone', async () => {
      const { controller, create, records } = withSaved();
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ amount: '12' });

      const restarted = await restart(create);
      await restarted.openExpense(groupId, expenseId);
      expect(restarted.getSnapshot().expense.groupDraft).toMatchObject({ amount: '12' });
      restarted.resumeExpenseDraft();
      await restarted.updateExpenseDraft({ amount: '' });
      expect(records.size).toBe(0);
    });

    it('keeps a draft whose only change is its date', async () => {
      const { controller, create, records } = withSaved();
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      const tomorrow = toDateParam(new Date(nextDay));
      await controller.updateExpenseDraft({ date: tomorrow });
      await controller.back();

      const restarted = await restart(create);
      await restarted.openExpense(groupId);
      expect(restarted.getSnapshot().expense).toMatchObject({
        status: 'resume',
        draft: { date: tomorrow },
      });
      expect(records.size).toBe(1);
    });

    it('stores the start on Retry saving draft, so the draft can still be undone', async () => {
      const { controller, create, drafts, records } = withSaved();
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      const { save } = drafts;
      drafts.save = async () => {
        throw new Error('Disk full');
      };
      await controller.updateExpenseDraft({ description: 'Milk' });
      drafts.save = save;
      await controller.updateExpenseDraft({});
      expect(records.get(key)).toMatchObject({
        draft: { description: 'Milk' },
        blank: { description: '' },
      });

      const restarted = await restart(create);
      await restarted.openExpense(groupId);
      restarted.resumeExpenseDraft();
      await restarted.updateExpenseDraft({ description: '' });
      expect(records.size).toBe(0);
    });

    it('still stores nothing for an unchanged Edit, and removes one an earlier version kept', async () => {
      const { controller, create, records, saves } = withSaved();
      await controller.signIn('alex');
      await controller.openExpense(groupId, expenseId);
      const unedited = controller.getSnapshot().expense.draft;
      await controller.editExpense();
      await controller.back();
      expect(saves()).toBe(0);
      records.set(key, { version: 1, accountId: memberIds[0], groupId, draft: unedited });

      const restarted = await restart(create);
      await restarted.openExpense(groupId, expenseId);
      expect(restarted.getSnapshot().expense.status).toBe('detail');
      expect(records.size).toBe(0);
    });

    it('never removes a save that may already be recorded, whatever its entries', async () => {
      const { controller, create, records } = setup((path, init) =>
        init.method === 'POST' && path.endsWith('/expenses')
          ? Promise.reject(new Error('Lost response'))
          : undefined,
      );
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
      await controller.saveExpense();
      expect(controller.getSnapshot().expense.status).toBe('uncertain');
      const stored = records.get(key) as { draft: ExpenseDraft; blank: ExpenseDraft };
      expect(stored.blank).toMatchObject({ amount: '', description: '' });
      // Even entries back at their start leave the recovery in place.
      records.set(key, { ...stored, draft: stored.blank });
      const pending = structuredClone(records.get(key)) as { attempt: unknown };

      const restarted = await restart(create);
      await restarted.openExpense(groupId);
      expect(restarted.getSnapshot().expense).toMatchObject({
        status: 'resume',
        attempt: pending.attempt,
      });
      expect(records.get(key)).toEqual(pending);
    });
  });
});

describe('Save straight after the last keystroke', () => {
  /** Draft writes wait until released; each settled write and each ledger write is logged. */
  const held = (fail = false) => {
    const events: string[] = [];
    const harness = setup((path, init) => {
      if (init.method === 'POST' && path.endsWith('/expenses')) {
        events.push('POST');
        return Promise.resolve(
          json({ status: 201, data: { _id: 'a00000000000000000000031', group: groupId } }, 201),
        );
      }
      if (path.endsWith(`/${expenseId}`)) {
        if (init.method === 'PATCH') events.push('PATCH');
        return Promise.resolve(json({ status: 200, data: savedExpense }));
      }
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const hold = () => {
      const { save } = harness.drafts;
      harness.drafts.save = async (accountId, id, value) => {
        await gate;
        if (fail) throw new Error('Disk full');
        await save(accountId, id, value);
        const record = value as { attempt?: unknown; mutation?: unknown };
        events.push(record.attempt ? 'attempt' : record.mutation ? 'mutation' : 'draft');
      };
    };
    return { ...harness, events, hold, release: () => release() };
  };

  it.each(['new', 'edit'] as const)(
    'sends a %s Expense once, after the draft write it was waiting for',
    async (kind) => {
      const { controller, events, hold, release } = held();
      await controller.signIn('alex');
      if (kind === 'new') {
        await controller.openExpense(groupId);
        await controller.updateExpenseDraft({ amount: '10', tagId });
      } else {
        await controller.openExpense(groupId, expenseId);
        await controller.editExpense();
      }
      hold();
      const typing = controller.updateExpenseDraft({ description: 'Dinner' });
      expect(controller.getSnapshot().expense.persistence).toBe('saving');
      const saves = Promise.all([controller.saveExpense(), controller.saveExpense()]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(controller.getSnapshot().expense.status).toBe('saving');
      expect(events).toEqual([]);

      release();
      await Promise.all([typing, saves]);
      expect(events).toEqual(
        kind === 'new' ? ['draft', 'attempt', 'POST'] : ['draft', 'mutation', 'PATCH'],
      );
      expect(controller.getSnapshot().expense.status).toBe('saved');
    },
  );

  it('sends nothing when that draft write fails, and says why', async () => {
    const { controller, events, hold, release } = held(true);
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ amount: '10', tagId });
    hold();
    const typing = controller.updateExpenseDraft({ description: 'Dinner' });
    const save = controller.saveExpense();
    release();
    await Promise.all([typing, save]);
    expect(events).toEqual([]);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'editing',
      persistence: 'error',
      message: 'Could not save your draft on this device. Keep this screen open and try again.',
    });
    await controller.saveExpense();
    expect(events).toEqual([]);
  });

  it('waits for the draft write before Back leaves the form', async () => {
    const { controller, records, hold, release } = held();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    hold();
    const typing = controller.updateExpenseDraft({ description: 'Dinner' });
    const leaving = controller.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getSnapshot().screen).toBe('expense');

    release();
    await Promise.all([typing, leaving]);
    expect(controller.getSnapshot().screen).toBe('group');
    expect(records.get(`${memberIds[0]}:${groupId}`)).toMatchObject({
      draft: { description: 'Dinner' },
    });
  });

  it.each(['new', 'edit'] as const)(
    'sends a %s Expense once when Save follows a Back still waiting for the draft write',
    async (kind) => {
      const { controller, events, hold, release } = held();
      await controller.signIn('alex');
      if (kind === 'new') {
        await controller.openExpense(groupId);
        await controller.updateExpenseDraft({ amount: '10', tagId });
      } else {
        await controller.openExpense(groupId, expenseId);
        await controller.editExpense();
      }
      hold();
      const typing = controller.updateExpenseDraft({ description: 'Dinner' });
      const leaving = controller.back();
      const saves = Promise.all([controller.saveExpense(), controller.saveExpense()]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'expense',
        expense: { status: 'saving' },
      });

      release();
      await Promise.all([typing, leaving, saves]);
      expect(events).toEqual(
        kind === 'new' ? ['draft', 'attempt', 'POST'] : ['draft', 'mutation', 'PATCH'],
      );
      expect(controller.getSnapshot().expense.status).toBe('saved');
    },
  );

  it('keeps the form open with the error when Back and Save wait on a failed draft write', async () => {
    const { controller, events, hold, release } = held(true);
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ amount: '10', tagId });
    hold();
    const typing = controller.updateExpenseDraft({ description: 'Dinner' });
    const leaving = controller.back();
    const save = controller.saveExpense();
    release();
    await Promise.all([typing, leaving, save]);
    expect(events).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: { status: 'editing', persistence: 'error' },
    });
  });
});

describe('a save that may already be recorded', () => {
  it('finishes from the reopened form with the same submission; Keep for later sends nothing', async () => {
    const submissions: { key: string | null; body: string }[] = [];
    const { controller, records } = setup((path, init) => {
      if (!path.endsWith('/expenses') || init.method !== 'POST') return;
      submissions.push({
        key: new Headers(init.headers).get('Idempotency-Key'),
        body: String(init.body),
      });
      return submissions.length === 1
        ? Promise.reject(new Error('Response lost after commit'))
        : Promise.resolve(json({ data: { _id: expenseId, group: groupId }, status: 201 }, 201));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Shared dinner', amount: '10.00', tagId });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('uncertain');
    const recovery = structuredClone([...records]);

    // Keep for later returns to the Group, from the failed save and from the reopened form.
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('group');
    await controller.openExpense(groupId);
    expect(controller.getSnapshot().expense.status).toBe('resume');
    await controller.back();
    expect(submissions).toHaveLength(1);
    expect([...records]).toEqual(recovery);

    // Check and finish saving, straight from the reopened form.
    await controller.openExpense(groupId);
    await controller.saveExpense();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(controller.getSnapshot().expense.status).toBe('saved');
    expect(records.size).toBe(0);
  });

  it.each(['headers', 'body'] as const)(
    'ends unconfirmed, with its stored key and body, when its request times out waiting for the %s (#209)',
    async (stage) => {
      const timers = manualTimer();
      const submissions: { key: string | null; body: string }[] = [];
      const { controller, records } = setup(
        (path, init) => {
          if (!path.endsWith('/expenses') || init.method !== 'POST') return;
          submissions.push({
            key: new Headers(init.headers).get('Idempotency-Key'),
            body: String(init.body),
          });
          return hangUntilAborted(init, stage);
        },
        { timer: timers.timer },
      );
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ description: 'Shared dinner', amount: '10.00', tagId });
      const saving = controller.saveExpense();
      await vi.waitFor(() => expect(submissions).toHaveLength(1));
      // Stored before it was sent.
      expect([...records.values()]).toEqual([expect.objectContaining({ attempt: submissions[0] })]);
      timers.elapse(20_000);
      await saving;
      expect(controller.getSnapshot().expense).toMatchObject({
        status: 'uncertain',
        attempt: submissions[0],
      });
      expect([...records.values()]).toEqual([expect.objectContaining({ attempt: submissions[0] })]);
      expect(submissions).toEqual([{ key: 'native-expense-test-0001', body: expect.any(String) }]);
    },
  );
});

describe('a retried save the server rejects', () => {
  /**
   * A keyed fictional ledger. Like the server, it validates a create before it looks for a
   * replay, so once a deploy tightens validation, even the retry of a recorded save is refused.
   */
  function ledger() {
    const expenses = new Map<string, string>();
    const posts: { key: string | null; body: string }[] = [];
    let loseReply = false;
    let tightened = false;
    let answer: { status: number; body: unknown } | null = null;
    return {
      expenses,
      posts,
      loseNextReply: () => {
        loseReply = true;
      },
      tighten: () => {
        tightened = true;
      },
      /** Every later create gets this answer, before any replay check. */
      answerWith: (status: number, body: unknown = { status }) => {
        answer = { status, body };
      },
      intercept: (path: string, init: RequestInit) => {
        if (!path.endsWith('/expenses') || init.method !== 'POST') return;
        const key = new Headers(init.headers).get('Idempotency-Key')!;
        const body = String(init.body);
        posts.push({ key, body });
        if (answer) return Promise.resolve(json(answer.body, answer.status));
        const { description } = JSON.parse(body) as { description: string };
        // The tightened rule: a description of at least five characters.
        if (tightened && description.trim().length < 5)
          return Promise.resolve(
            json({ error: 'Validation error', code: 'VALIDATION_ERROR', status: 422 }, 422),
          );
        if (!expenses.has(key)) expenses.set(key, description);
        if (loseReply) {
          loseReply = false;
          return Promise.reject(new Error('Response lost after commit'));
        }
        return Promise.resolve(
          json({ data: { _id: expenseId, group: groupId }, status: 201 }, 201),
        );
      },
    };
  }
  const keyed = () => {
    let keys = 0;
    return () => `native-expense-key-${String(++keys).padStart(4, '0')}`;
  };

  it('keeps the submission through the rejection and a restart, and sends no new key until the member discards it', async () => {
    const server = ledger();
    const { controller, create, records } = setup(server.intercept, {
      newSubmissionKey: keyed(),
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Tea', amount: '10.00', tagId });
    server.loseNextReply();
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('uncertain');
    const [first] = server.posts;

    server.tighten();
    await controller.saveExpense();
    const refused = controller.getSnapshot().expense;
    expect(refused.status).toBe('uncertain');
    expect(refused.message).toContain(
      'Check the amount, description, date, and participants before saving.',
    );
    expect(refused.message).toContain('Check this Group’s Expenses first');
    expect(refused.draft).toMatchObject({ description: 'Tea', amount: '10.00' });
    expect([...records.values()]).toEqual([
      expect.objectContaining({
        attempt: first,
        draft: expect.objectContaining({ description: 'Tea' }),
      }),
    ]);

    // The member corrects the draft and saves: the correction waits, and the same save is retried.
    await controller.updateExpenseDraft({ description: 'Masala tea' });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.draft?.description).toBe('Tea');

    // So does a restarted app.
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId);
    restarted.resumeExpenseDraft();
    await restarted.updateExpenseDraft({ description: 'Masala tea' });
    await restarted.saveExpense();
    expect(restarted.getSnapshot().expense).toMatchObject({
      status: 'uncertain',
      draft: { description: 'Tea' },
    });
    expect(server.posts).toHaveLength(4);
    expect(server.posts.every((post) => post.key === first.key && post.body === first.body)).toBe(
      true,
    );
    expect(server.expenses.size).toBe(1);

    // Only an explicit discard ends it. It sends nothing and keeps the draft for correction.
    await restarted.discardUnconfirmedExpense();
    expect(server.posts).toHaveLength(4);
    expect(restarted.getSnapshot().expense).toMatchObject({
      status: 'editing',
      attempt: null,
      draft: { description: 'Tea', amount: '10.00' },
    });
    const [kept] = records.values();
    expect(kept).toMatchObject({ draft: { description: 'Tea' } });
    expect(kept).not.toHaveProperty('attempt');
    await restarted.updateExpenseDraft({ description: 'Masala tea' });
    await restarted.saveExpense();
    expect(server.posts).toHaveLength(5);
    expect(server.posts[4].key).not.toBe(first.key);
    expect(JSON.parse(server.posts[4].body)).toMatchObject({ description: 'Masala tea' });
    expect(restarted.getSnapshot().expense.status).toBe('saved');
  });

  /** Alex's first save is recorded but its reply is lost; the retry then gets `status`. */
  const retryAnswered = async (status: number, body?: unknown) => {
    const server = ledger();
    const harness = setup(server.intercept, { newSubmissionKey: keyed() });
    const { controller } = harness;
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Tea', amount: '10.00', tagId });
    server.loseNextReply();
    await controller.saveExpense();
    server.answerWith(status, body);
    await controller.saveExpense();
    return { ...harness, server };
  };

  it.each([
    [409, { error: 'Conflict', code: 'IDEMPOTENCY_CONFLICT', status: 409 }],
    [422, { error: 'Something new', code: 'NEW_RULE', status: 422 }],
    [422, { error: 'Validation error', status: 422 }],
    [400, { error: 'Bad request', status: 400 }],
  ])('offers Discard when the server refuses a retry with %s %j', async (status, body) => {
    const { controller, server, records } = await retryAnswered(status, body);
    const [first] = server.posts;
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'uncertain',
      attempt: first,
      attemptRejected: true,
      draft: { description: 'Tea' },
    });
    expect(controller.getSnapshot().expense.message).toContain('Check this Group’s Expenses first');
    expect([...records.values()]).toEqual([expect.objectContaining({ attempt: first })]);

    await controller.discardUnconfirmedExpense();
    expect(server.posts).toHaveLength(2);
    expect(controller.getSnapshot().expense).toMatchObject({ status: 'editing', attempt: null });
  });

  it.each([429, 408])('offers no Discard when a retry meets a passing %s', async (status) => {
    const { controller, server, records } = await retryAnswered(status);
    const [first] = server.posts;
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'uncertain',
      attempt: first,
      attemptRejected: false,
    });
    const stored = structuredClone([...records]);
    await controller.discardUnconfirmedExpense();
    expect(controller.getSnapshot().expense).toMatchObject({ status: 'uncertain', attempt: first });
    expect([...records]).toEqual(stored);
    expect(server.posts).toHaveLength(2);
  });

  it('still offers Discard after the member leaves to check the Group and comes back, and after a restart', async () => {
    const { controller, create, server, records } = await retryAnswered(422, {
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      status: 422,
    });
    // Keep for later, to check the Group's Expenses, then back to the form.
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('group');
    await controller.openExpense(groupId);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'resume',
      attemptRejected: true,
    });
    controller.resumeExpenseDraft();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'uncertain',
      attemptRejected: true,
    });
    expect(controller.getSnapshot().expense.message).toContain('Check this Group’s Expenses first');

    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId);
    expect(restarted.getSnapshot().expense).toMatchObject({
      status: 'resume',
      attemptRejected: true,
    });
    await restarted.discardUnconfirmedExpense();
    expect(restarted.getSnapshot().expense).toMatchObject({
      status: 'editing',
      attempt: null,
      attemptRejected: false,
      draft: { description: 'Tea' },
    });
    expect([...records.values()][0]).not.toHaveProperty('attempt');
    expect(server.posts).toHaveLength(2);
  });

  it('keeps the save, and says so, when the discard can’t be written', async () => {
    const { controller, drafts, server, records } = await retryAnswered(422, {
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      status: 422,
    });
    const stored = structuredClone([...records]);
    drafts.save = async () => {
      throw new Error('SQLITE_FULL: database or disk is full');
    };
    await controller.discardUnconfirmedExpense();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'uncertain',
      attempt: server.posts[0],
      attemptRejected: true,
      message: 'Could not discard this unconfirmed save. Please retry.',
    });
    expect([...records]).toEqual(stored);
    expect(server.posts).toHaveLength(2);
  });

  it('discards only this Group’s save, and only while the device still holds it', async () => {
    const otherGroup = 'a00000000000000000000011';
    const { controller, server, records } = await retryAnswered(422, {
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      status: 422,
    });
    const [[slot, value]] = [...records] as [string, Record<string, unknown>][];
    const otherSlot = slot.replace(groupId, otherGroup);
    records.set(otherSlot, { ...structuredClone(value), groupId: otherGroup });
    // Another recovery replaced this Group's stored save after the form showed it.
    const replaced = {
      ...structuredClone(value),
      attempt: { ...(value.attempt as object), key: 'native-expense-key-9999' },
    };
    records.set(slot, replaced);

    await controller.discardUnconfirmedExpense();
    expect(records.get(slot)).toEqual(replaced);
    expect(records.get(otherSlot)).toMatchObject({ groupId: otherGroup, attempt: value.attempt });
    expect(server.posts).toHaveLength(2);

    // With the stored save back as the form showed it, Discard removes it from this Group only.
    records.set(slot, value);
    await controller.openExpense(groupId);
    await controller.discardUnconfirmedExpense();
    expect(records.get(slot)).not.toHaveProperty('attempt');
    expect(records.get(otherSlot)).toMatchObject({ attempt: value.attempt });
    expect(server.posts).toHaveLength(2);
  });

  it('offers no discard for a save whose reply was only lost', async () => {
    const server = ledger();
    const { controller, records } = setup(server.intercept, { newSubmissionKey: keyed() });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Shared dinner', amount: '10.00', tagId });
    server.loseNextReply();
    await controller.saveExpense();
    const stored = structuredClone([...records]);

    await controller.discardUnconfirmedExpense();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'uncertain',
      attempt: server.posts[0],
    });
    expect([...records]).toEqual(stored);
    expect(server.posts).toHaveLength(1);
  });
});

describe('a save that meets a gateway error (#231)', () => {
  const unreachable = 'Could not reach SplitBook. Check your connection and try again.';
  const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

  it('keeps a new Expense unconfirmed after one send, and sends it again only on Retry, with its key and body', async () => {
    let gateway = true;
    const posts: RequestInit[] = [];
    const { controller, records } = setup((path, init) => {
      if (path !== `/api/groups/${groupId}/expenses` || init.method !== 'POST') return;
      posts.push(init);
      return Promise.resolve(
        gateway
          ? gatewayReply(502)
          : json({ data: { _id: expenseId, group: groupId }, status: 201 }, 201),
      );
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
    await controller.saveExpense();
    expect(posts).toHaveLength(1);
    const expense = controller.getSnapshot().expense;
    expect(expense.status).toBe('uncertain');
    // Only its message changes: SplitBook couldn't be reached, so the save may have landed.
    expect(expense.message).toBe(
      `${unreachable} This Expense may already be saved. Checking reuses the same submission, so it can’t be recorded twice.`,
    );
    const attempt = { key: header(posts[0], 'Idempotency-Key'), body: posts[0].body };
    expect(expense.attempt).toEqual(attempt);
    expect([...records.values()]).toEqual([expect.objectContaining({ attempt })]);

    // Nothing is sent again by itself, even once SplitBook can be reached.
    gateway = false;
    await controller.refresh();
    expect(posts).toHaveLength(1);

    await controller.saveExpense();
    expect(posts).toHaveLength(2);
    expect({ key: header(posts[1], 'Idempotency-Key'), body: posts[1].body }).toEqual(attempt);
    expect(controller.getSnapshot().expense.status).toBe('saved');
    expect(records.size).toBe(0);
  });

  it.each(['edit', 'delete'] as const)(
    'keeps a stored %s after one send, checks the saved Expense, and never sends it again',
    async (kind) => {
      const sent: string[] = [];
      const writes: RequestInit[] = [];
      const { controller, records } = setup((path, init) => {
        sent.push(`${init.method ?? 'GET'} ${path}`);
        if (!path.endsWith(`/${expenseId}`)) return;
        if (init.method === 'PATCH' || init.method === 'DELETE') {
          writes.push(init);
          return Promise.resolve(gatewayReply(502));
        }
        return Promise.resolve(json({ status: 200, data: savedExpense }));
      });
      await controller.signIn('alex');
      await controller.openExpense(groupId, expenseId);
      if (kind === 'edit') {
        await controller.editExpense();
        await controller.updateExpenseDraft({ description: 'Saved correction' });
      } else controller.reviewExpenseDeletion();
      const shown: MobileSnapshot['expense'][] = [];
      controller.subscribe(() => shown.push(controller.getSnapshot().expense));
      if (kind === 'edit') await controller.saveExpense();
      else await controller.deleteExpense();

      const method = kind === 'edit' ? 'PATCH' : 'DELETE';
      expect(writes).toHaveLength(1);
      expect(header(writes[0], 'X-Splitbook-Revision')).toBe('3');
      const mutation = { kind, revision: 3, body: kind === 'edit' ? writes[0].body : '' };
      expect([...records.values()]).toEqual([expect.objectContaining({ mutation })]);
      // Only its message changes: SplitBook couldn't be reached. Then the saved Expense is checked.
      expect(shown).toContainEqual(
        expect.objectContaining({ status: 'uncertain', mutation, message: unreachable }),
      );
      const write = sent.indexOf(`${method} /api/groups/${groupId}/expenses/${expenseId}`);
      expect(sent.slice(write + 1)).toContain(`GET /api/groups/${groupId}/expenses/${expenseId}`);
      expect(controller.getSnapshot().expense).toMatchObject({
        status: 'conflict',
        mutation,
        latest: { revision: 3 },
      });

      // Saving, deleting or refreshing never sends it again.
      await controller.saveExpense();
      await controller.deleteExpense();
      await controller.refresh();
      expect(writes).toHaveLength(1);
      expect([...records.values()]).toEqual([expect.objectContaining({ mutation })]);
    },
  );
});

describe('an edit that meets a newer saved Expense', () => {
  // Someone else changed the description, Category, notes and amount.
  const latest = {
    ...savedExpense,
    revision: 4,
    description: 'Their dinner',
    category: 'travel',
    notes: 'Their notes',
    amount: 12,
    amountMinor: 1200,
    paidBy: [{ user: { _id: memberIds[0], name: 'Alex' }, amount: 12, amountMinor: 1200 }],
    splitBetween: memberIds.map((user, index) => ({
      user: { _id: user, name: people[index].name },
      amount: 4,
      amountMinor: 400,
    })),
  };
  /** The first save is refused as stale; later ones are accepted. */
  const conflicted = async (changes: Partial<ExpenseDraft>) => {
    const patches: { revision: string | null; body: Record<string, unknown> }[] = [];
    let saved: Record<string, unknown> = savedExpense;
    const harness = setup((path, init) => {
      if (!path.endsWith(`/${expenseId}`)) return;
      if (init.method === 'PATCH') {
        patches.push({
          revision: new Headers(init.headers).get('X-Splitbook-Revision'),
          body: JSON.parse(String(init.body)),
        });
        if (saved === savedExpense) {
          saved = latest;
          return Promise.resolve(json({ code: 'STALE_REVISION', status: 409 }, 409));
        }
        return Promise.resolve(json({ status: 200, data: { ...saved, revision: 5 } }));
      }
      return Promise.resolve(json({ status: 200, data: saved }));
    });
    await harness.controller.signIn('alex');
    await harness.controller.openExpense(groupId, expenseId);
    await harness.controller.editExpense();
    await harness.controller.updateExpenseDraft(changes);
    await harness.controller.saveExpense();
    expect(harness.controller.getSnapshot().expense).toMatchObject({
      status: 'conflict',
      latest: { revision: 4 },
      message: expect.stringContaining('Compare your version with the saved one'),
    });
    return { ...harness, patches };
  };
  const choose = (controller: MobileController, keep: 'mine' | 'saved') =>
    controller.updateExpenseDraft(
      resolveDraftReview(controller.getSnapshot().expense.draft!, 'amount', keep),
    );

  it('keeps the member’s changes, takes the saved values for the rest, and holds a changed amount for review', async () => {
    const { controller, create, patches } = await conflicted({
      notes: 'My notes',
      participantIds: [memberIds[0], memberIds[1]],
    });
    await controller.reviewLatestExpense();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'editing',
      draft: {
        original: { revision: 4 },
        // Untouched: the saved values.
        description: 'Their dinner',
        category: 'travel',
        // Changed by both: the member's.
        notes: 'My notes',
        // Money only the member changed: theirs.
        participantIds: [memberIds[0], memberIds[1]],
        // Money the saved Expense changed: neither kept nor taken until the member chooses.
        amount: '10',
        review: ['amount'],
      },
    });
    await controller.saveExpense();
    expect(patches).toHaveLength(1);

    // The open choice survives a restart and still holds Save.
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId, expenseId);
    restarted.resumeExpenseDraft();
    expect(restarted.getSnapshot().expense.draft?.review).toEqual(['amount']);
    await restarted.saveExpense();
    expect(patches).toHaveLength(1);

    await choose(restarted, 'saved');
    expect(restarted.getSnapshot().expense.draft).toMatchObject({ amount: '12' });
    expect(restarted.getSnapshot().expense.draft?.review).toBeUndefined();
    await restarted.saveExpense();
    expect(patches[1].revision).toBe('4');
    expect(patches[1].body).toMatchObject({
      notes: 'My notes',
      amount: 12,
      splitBetween: [
        { user: memberIds[0], amount: 6 },
        { user: memberIds[1], amount: 6 },
      ],
    });
    expect(Object.keys(patches[1].body)).not.toContain('description');
    expect(Object.keys(patches[1].body)).not.toContain('category');
    expect(restarted.getSnapshot().expense.status).toBe('saved');
  });

  it('sends the member’s own amount only once they choose to keep it', async () => {
    const { controller, patches } = await conflicted({ notes: 'My notes' });
    await controller.reviewLatestExpense();
    // The member never touched the amount, yet the saved change isn't taken silently either.
    expect(controller.getSnapshot().expense.draft).toMatchObject({
      amount: '10',
      review: ['amount'],
    });
    await choose(controller, 'mine');
    expect(controller.getSnapshot().expense.draft?.review).toBeUndefined();
    await controller.saveExpense();
    expect(patches[1]).toMatchObject({ revision: '4', body: { amount: 10, notes: 'My notes' } });
  });

  it('asks nothing about money the member already changed to the saved value', async () => {
    const { controller, patches } = await conflicted({ amount: '12.00', notes: 'My notes' });
    await controller.reviewLatestExpense();
    expect(controller.getSnapshot().expense.draft?.review).toBeUndefined();
    await controller.saveExpense();
    expect(patches[1]).toEqual({ revision: '4', body: { notes: 'My notes' } });
  });

  it('uses the saved version: drops the draft and opens the saved Expense, sending nothing more', async () => {
    const { controller, records, patches } = await conflicted({ notes: 'My notes' });
    await controller.acceptCurrentExpense();
    expect(patches).toHaveLength(1);
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { description: 'Their dinner', amount: '12', original: { revision: 4 } },
    });
  });
});

describe('native Expense field corrections', () => {
  const countingSetup = () => {
    const requests: string[] = [];
    const harness = setup((path, init) => {
      requests.push(`${init.method ?? 'GET'} ${path}`);
      return init.method === 'POST' && path.endsWith('/expenses')
        ? Promise.resolve(json({ status: 201, data: { _id: expenseId, group: groupId } }, 201))
        : undefined;
    });
    return { ...harness, requests };
  };

  it.each(['', '   '])(
    'identifies a missing Description %j before any request and saves once after correction',
    async (description) => {
      const { controller, requests } = countingSetup();
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ amount: '250.50', tagId, description });
      requests.length = 0;
      await controller.saveExpense();
      let expense = controller.getSnapshot().expense;
      expect(requests).toEqual([]);
      expect(expense.status).toBe('editing');
      expect(expense.attempt).toBeNull();
      expect(expense.validation.errors).toEqual({
        description: 'Add a description, such as Groceries.',
      });
      expect(expense.validation.focus).toEqual({ field: 'description', request: 1 });
      expect(expense.message).toBe('Add a description, such as Groceries.');
      expect(expense.draft).toMatchObject({ amount: '250.50', tagId, description });

      await controller.updateExpenseDraft({ description: 'Groceries' });
      expense = controller.getSnapshot().expense;
      expect(expense.validation.errors).toEqual({});
      expect(expense.message).toBeNull();
      expect(expense.draft).toMatchObject({ amount: '250.50', tagId });

      await controller.saveExpense();
      expect(requests.filter((request) => request.startsWith('POST'))).toEqual([
        `POST /api/groups/${groupId}/expenses`,
      ]);
      expect(controller.getSnapshot().expense.status).toBe('saved');
    },
  );

  it('explains the same blank Description when editing, without serialized validation details', async () => {
    const { controller, requests } = countingSetup();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ amount: '10', tagId, description: ' ' });
    await controller.saveExpense();
    const created = controller.getSnapshot().expense;
    await controller.discardExpenseDraft();

    const editing = setup((path, init) => {
      requests.push(`${init.method ?? 'GET'} ${path}`);
      return path.endsWith(`/${expenseId}`)
        ? Promise.resolve(json({ data: savedExpense, status: 200 }))
        : undefined;
    }).controller;
    await editing.signIn('alex');
    await editing.openExpense(groupId, expenseId);
    await editing.editExpense();
    await editing.updateExpenseDraft({ description: ' ', notes: 'Keep my note' });
    requests.length = 0;
    await editing.saveExpense();
    const edited = editing.getSnapshot().expense;
    expect(requests).toEqual([]);
    expect(edited.status).toBe('editing');
    expect(edited.mutation).toBeNull();
    expect(edited.validation.errors).toEqual(created.validation.errors);
    expect(edited.message).toBe(created.message);
    expect(edited.message).not.toMatch(/"code"|"path"|\[|\{/);
    expect(edited.draft).toMatchObject({ description: ' ', notes: 'Keep my note' });
  });

  it.each([
    ['', 'Enter the amount, such as 250.50.'],
    ['abc', 'Use digits and one decimal point, such as 250.50.'],
    ['1,250', 'Use digits and one decimal point, such as 250.50.'],
    ['0', 'Enter an amount greater than 0.'],
    ['-5', 'Enter an amount greater than 0.'],
    ['10000000.01', 'Enter an amount of at most 10,000,000.'],
    ['10.001', 'INR amounts can have at most 2 decimal places. Nothing is rounded for you.'],
  ])('explains Amount %j beside the Amount field', async (amount, message) => {
    const { controller, requests } = countingSetup();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ amount, description: 'Dinner', tagId });
    requests.length = 0;
    await controller.saveExpense();
    const expense = controller.getSnapshot().expense;
    expect(requests).toEqual([]);
    expect(expense.validation.errors).toEqual({ amount: message });
    expect(expense.draft?.amount).toBe(amount);
  });

  it('uses the Group currency precision instead of assuming two decimal places', async () => {
    const yen = { ...group, defaultCurrency: 'JPY' };
    const { controller } = setup((path) =>
      path === `/api/groups/${groupId}`
        ? Promise.resolve(json({ data: yen, status: 200 }))
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ amount: '1500.5', description: 'Ramen', tagId });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.validation.errors).toEqual({
      amount: 'JPY amounts can’t include decimal places. Nothing is rounded for you.',
    });
    await controller.updateExpenseDraft({ amount: '1500' });
    expect(controller.getSnapshot().expense.validation.errors).toEqual({});
  });

  it.each([
    ['', 'Enter the date as YYYY-MM-DD, such as 2026-09-28.'],
    ['28/09/2026', 'Enter the date as YYYY-MM-DD, such as 2026-09-28.'],
    ['2026-02-30', '2026-02-30 isn’t a real date. Check the day and month.'],
    ['2026-13-01', '2026-13-01 isn’t a real date. Check the day and month.'],
  ])('explains date %j beside the Date field', async (date, message) => {
    const { controller, requests } = countingSetup();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ amount: '10', description: 'Dinner', tagId, date });
    requests.length = 0;
    await controller.saveExpense();
    expect(requests).toEqual([]);
    expect(controller.getSnapshot().expense.validation.errors).toEqual({ date: message });
  });

  it('identifies a missing Tag and an archived Tag without substituting another Tag', async () => {
    const otherTag = 'a00000000000000000000021';
    let archived = false;
    let posts = 0;
    const { controller } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST') posts++;
      if (path === `/api/groups/${groupId}`)
        return Promise.resolve(
          json({
            data: {
              ...group,
              tags: [
                { _id: tagId, name: 'Groceries', isArchived: archived, createdAt: iso },
                { _id: otherTag, name: 'Rent', isArchived: false, createdAt: iso },
              ],
            },
            status: 200,
          }),
        );
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ amount: '10', description: 'Dinner' });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.validation.errors).toEqual({
      tag: 'Choose a Tag for this Expense.',
    });

    await controller.updateExpenseDraft({ tagId });
    expect(controller.getSnapshot().expense.validation.errors).toEqual({});
    archived = true;
    await controller.saveExpense();
    const expense = controller.getSnapshot().expense;
    expect(posts).toBe(0);
    expect(expense.status).toBe('editing');
    expect(expense.draft?.tagId).toBe(tagId);
    expect(expense.validation.errors).toEqual({
      tag: '“Groceries” is no longer active in this Group. Choose another Tag; nothing is swapped in for you.',
    });
    expect(expense.validation.focus?.field).toBe('tag');
  });

  it('shows every local error, focuses the first in screen order, and keeps unrelated entries', async () => {
    const { controller, requests } = countingSetup();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ notes: 'Split with flatmates', category: 'food' });
    requests.length = 0;
    await controller.saveExpense();
    let expense = controller.getSnapshot().expense;
    expect(requests).toEqual([]);
    expect(Object.keys(expense.validation.errors)).toEqual(['amount', 'description', 'tag']);
    expect(expense.validation.focus).toEqual({ field: 'amount', request: 1 });
    expect(expense.message).toBe('Correct 3 fields before saving: Amount, Description and Tag.');

    await controller.updateExpenseDraft({ amount: '12' });
    await controller.saveExpense();
    expense = controller.getSnapshot().expense;
    expect(Object.keys(expense.validation.errors)).toEqual(['description', 'tag']);
    expect(expense.validation.focus).toEqual({ field: 'description', request: 2 });
    expect(expense.draft).toMatchObject({
      amount: '12',
      notes: 'Split with flatmates',
      category: 'food',
    });
  });

  it('shows a field error after the member leaves it, not while they first type', async () => {
    const { controller } = setup();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    expect(controller.getSnapshot().expense.validation.errors).toEqual({});
    await controller.updateExpenseDraft({ amount: '10.0' });
    await controller.updateExpenseDraft({ amount: '10.005' });
    expect(controller.getSnapshot().expense.validation.errors).toEqual({});
    controller.touchExpenseField('amount');
    expect(controller.getSnapshot().expense.validation.errors).toEqual({
      amount: 'INR amounts can have at most 2 decimal places. Nothing is rounded for you.',
    });
    expect(controller.getSnapshot().expense.validation.focus).toBeNull();
    await controller.updateExpenseDraft({ amount: '10.05' });
    expect(controller.getSnapshot().expense.validation.errors).toEqual({});
  });

  it('keeps a rejected incomplete draft through restart', async () => {
    const { controller, create } = setup();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ amount: '10.001', description: 'QA correction' });
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.validation.errors).toMatchObject({
      amount: expect.any(String),
      tag: expect.any(String),
    });
    const restarted = create();
    await restarted.restore();
    await restarted.openExpense(groupId);
    restarted.resumeExpenseDraft();
    expect(restarted.getSnapshot().expense.status).toBe('editing');
    expect(restarted.getSnapshot().expense.draft).toMatchObject({
      amount: '10.001',
      description: 'QA correction',
    });
    expect(restarted.getSnapshot().expense.validation.errors).toEqual({});
  });
});

describe('invitations while the phone cannot keep an Expense draft', () => {
  it.each(['http://localhost:4138/join/abcdef12', 'http://localhost:4138/join/invalid'])(
    'keeps the form on an incoming link until the draft stores and Back is pressed: %s',
    async (url) => {
      const requests: string[] = [];
      const { controller, drafts } = setup((path, init) => {
        requests.push(`${init.method ?? 'GET'} ${path}`);
        if (path === '/api/join/abcdef12')
          return Promise.resolve(
            json({
              status: 200,
              data: {
                _id: 'b00000000000000000000002',
                name: 'Pine Cabin',
                category: 'trip',
                memberCount: 1,
              },
            }),
          );
      });
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      const save = drafts.save;
      drafts.save = async () => {
        throw new Error('Storage full');
      };
      await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
      const error = controller.getSnapshot().expense.message;
      const before = requests.length;
      await controller.openInvitation(url);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'expense',
        expense: {
          persistence: 'error',
          draft: { description: 'Dinner', amount: '10' },
          message: error,
          waitingInvitation: url,
        },
      });
      await controller.back();
      expect(controller.getSnapshot().screen).toBe('expense');
      expect(requests.slice(before)).toEqual([]);
      drafts.save = save;
      await controller.updateExpenseDraft({ notes: 'Keep this too' });
      await controller.back();
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'invite',
        invitation: { status: url.endsWith('invalid') ? 'invalid' : 'ready' },
      });
      expect(requests.slice(before).filter((request) => request.startsWith('POST '))).toEqual([]);
    },
  );
});

it.each(['save', 'discard'] as const)(
  'opens the waiting invitation after a deliberate %s',
  async (finish) => {
    const { controller, drafts } = setup((path, init) => {
      if (path === '/api/join/abcdef12')
        return Promise.resolve(
          json({
            status: 200,
            data: {
              _id: 'b00000000000000000000002',
              name: 'Pine Cabin',
              category: 'trip',
              memberCount: 1,
            },
          }),
        );
      if (path.endsWith('/expenses') && init.method === 'POST')
        return Promise.resolve(
          json({ status: 201, data: { _id: expenseId, group: groupId } }, 201),
        );
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    const save = drafts.save;
    drafts.save = async () => {
      throw new Error('Storage full');
    };
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
    await controller.openInvitation('http://localhost:4138/join/abcdef12');
    drafts.save = save;
    if (finish === 'save') {
      await controller.updateExpenseDraft({ notes: 'Ready' });
      await controller.saveExpense();
    } else await controller.discardExpenseDraft();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { status: 'ready', preview: { name: 'Pine Cabin' } },
    });
  },
);

it.each([true, false])(
  'waits for a pending draft write before opening an invitation (failure %s)',
  async (fails) => {
    const { controller, drafts } = setup((path) =>
      path === '/api/join/abcdef12'
        ? Promise.resolve(
            json({
              status: 200,
              data: {
                _id: 'b00000000000000000000002',
                name: 'Pine Cabin',
                category: 'trip',
                memberCount: 1,
              },
            }),
          )
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    const save = drafts.save;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    drafts.save = async (...args) => {
      await waiting;
      if (fails) throw new Error('Storage full');
      await save(...args);
    };
    const typing = controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
    const opening = controller.openInvitation('http://localhost:4138/join/abcdef12');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getSnapshot().screen).toBe('expense');
    release();
    await Promise.all([typing, opening]);
    expect(controller.getSnapshot().screen).toBe(fails ? 'expense' : 'invite');
    if (fails)
      expect(controller.getSnapshot().expense).toMatchObject({
        persistence: 'error',
        draft: { description: 'Dinner' },
        waitingInvitation: 'http://localhost:4138/join/abcdef12',
      });
  },
);

it('opens the held invitation after an edited Expense is confirmed', async () => {
  const { controller, drafts } = setup((path) => {
    if (path.endsWith(`/${expenseId}`))
      return Promise.resolve(json({ status: 200, data: savedExpense }));
    if (path === '/api/join/abcdef12')
      return Promise.resolve(
        json({
          status: 200,
          data: {
            _id: 'b00000000000000000000002',
            name: 'Pine Cabin',
            category: 'trip',
            memberCount: 1,
          },
        }),
      );
  });
  await controller.signIn('alex');
  await controller.openExpense(groupId, expenseId);
  await controller.editExpense();
  const save = drafts.save;
  drafts.save = async () => {
    throw new Error('Storage full');
  };
  await controller.updateExpenseDraft({ notes: 'Keep these edits' });
  await controller.openInvitation('http://localhost:4138/join/abcdef12');
  drafts.save = save;
  await controller.updateExpenseDraft({ notes: 'Keep these edited notes' });
  await controller.saveExpense();
  expect(controller.getSnapshot()).toMatchObject({
    screen: 'invite',
    invitation: { status: 'ready' },
  });
});

it('keeps an Expense draft when the save preflight names a different Group', async () => {
  let wrong = false;
  let posts = 0;
  const f = setup((path, init) => {
    if (wrong && path === `/api/groups/${groupId}`)
      return Promise.resolve(
        json({ status: 200, data: { ...group, _id: 'b00000000000000000000009' } }),
      );
    if (path.endsWith('/expenses') && init.method === 'POST') posts++;
  });
  await f.controller.signIn('alex');
  await f.controller.openExpense(groupId);
  await f.controller.updateExpenseDraft({ description: 'Dinner', amount: '12', tagId });
  wrong = true;
  await f.controller.saveExpense();
  await f.controller.back();
  expect(f.records.size).toBe(1);
  expect(posts).toBe(0);
});

it.each(['create', 'edit', 'delete'] as const)(
  'keeps an unconfirmed %s blocked until confirmed Discard after Group refusal',
  async (kind) => {
    let denied = false;
    const requests: string[] = [];
    const { controller, records } = setup((path, init) => {
      requests.push(`${init.method ?? 'GET'} ${path}`);
      if (denied && path === `/api/groups/${groupId}`)
        return Promise.resolve(json({ status: 403, error: 'Access removed' }, 403));
      if (
        ['POST', 'PATCH', 'DELETE'].includes(init.method ?? '') &&
        path.startsWith(`/api/groups/${groupId}/expenses`)
      )
        return Promise.reject(new TypeError('Reply lost'));
      if (path.endsWith(`/${expenseId}`))
        return Promise.resolve(json({ status: 200, data: savedExpense }));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, kind === 'create' ? undefined : expenseId);
    if (kind === 'delete') {
      controller.reviewExpenseDeletion();
      await controller.deleteExpense();
    } else {
      if (kind === 'edit') await controller.editExpense();
      await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
      await controller.saveExpense();
    }
    expect(records.size).toBe(1);
    denied = true;
    await controller.refresh('retry');
    expect(controller.getSnapshot().expense).toMatchObject({ status: 'blocked', accessLost: true });
    expect(records.size).toBe(1);
    const before = requests.length;
    await controller.discardUnconfirmedExpense();
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().screen).toBe('groups');
    expect(requests.slice(before).filter((request) => !request.startsWith('GET '))).toEqual([]);
  },
);

it('keeps a new draft when an older Group refusal arrives after joining it', async () => {
  let hold = true,
    release!: (response: FetchResponse) => void,
    reached!: () => void;
  const arrived = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const { controller, records } = setup((path, init) => {
    if (path === `/api/groups/${groupId}` && hold) {
      hold = false;
      return new Promise((resolve) => {
        release = resolve;
        reached();
      });
    }
    if (path === '/api/join/abcdef12')
      return Promise.resolve(
        init.method === 'POST'
          ? json({ status: 201, data: { groupId } }, 201)
          : json({
              status: 200,
              data: { _id: groupId, name: 'Shared home', category: 'home', memberCount: 3 },
            }),
      );
  });
  await controller.signIn('alex');
  const opening = controller.openExpense(groupId);
  await arrived;
  await controller.openInvitation('http://localhost:4138/join/abcdef12');
  const joining = controller.joinInvitation();
  try {
    await vi.waitFor(
      () =>
        expect(controller.getSnapshot()).toMatchObject({
          screen: 'group',
          detail: { status: 'ready' },
        }),
      { timeout: 300 },
    );
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({
      description: 'New membership dinner',
      amount: '10',
      tagId,
    });
  } finally {
    release(json({ status: 403, error: 'Earlier access refused' }, 403));
    await Promise.all([joining, opening]);
  }
  expect(controller.getSnapshot()).toMatchObject({
    screen: 'expense',
    expense: { status: 'editing', draft: { description: 'New membership dinner' } },
  });
  expect(records.size).toBe(1);
});

it('keeps unstored Expense entries even when the incoming invitation cannot be stored', async () => {
  const { controller, drafts } = setup(undefined, {
    pendingInvitation: {
      load: async () => null,
      clear: async () => {},
      save: async () => {
        throw new Error('Disk full');
      },
    },
  });
  await controller.signIn('alex');
  await controller.openExpense(groupId);
  drafts.save = async () => {
    throw new Error('Disk full');
  };
  await controller.updateExpenseDraft({ description: 'Keep my dinner', amount: '10' });
  await controller.openInvitation('http://localhost:4138/join/abcdef12');
  expect(controller.getSnapshot()).toMatchObject({
    screen: 'expense',
    expense: {
      persistence: 'error',
      draft: { description: 'Keep my dinner' },
      waitingInvitation: 'http://localhost:4138/join/abcdef12',
    },
  });
});

it.each(['create', 'edit', 'delete'] as const)(
  'cleans an unconfirmed %s on Home only after the unlisted Group refuses access',
  async (kind) => {
    let denied = false;
    const requests: string[] = [];
    const { controller, records } = setup((path, init) => {
      requests.push(`${init.method ?? 'GET'} ${path}`);
      if (denied && path === '/api/groups') return Promise.resolve(json({ status: 200, data: [] }));
      if (denied && path === `/api/groups/${groupId}`)
        return Promise.resolve(json({ status: 403, error: 'Access removed' }, 403));
      if (
        ['POST', 'PATCH', 'DELETE'].includes(init.method ?? '') &&
        path.startsWith(`/api/groups/${groupId}/expenses`)
      )
        return Promise.reject(new TypeError('Reply lost'));
      if (path.endsWith(`/${expenseId}`))
        return Promise.resolve(json({ status: 200, data: savedExpense }));
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId, kind === 'create' ? undefined : expenseId);
    if (kind === 'delete') {
      controller.reviewExpenseDeletion();
      await controller.deleteExpense();
    } else {
      if (kind === 'edit') await controller.editExpense();
      await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId });
      await controller.saveExpense();
    }
    await controller.back();
    await controller.back();
    expect(records.size).toBe(1);
    denied = true;
    const before = requests.length;
    await controller.refresh('pull');
    expect(records.size).toBe(0);
    expect(
      requests.slice(before).filter((request) => request === `GET /api/groups/${groupId}`),
    ).toHaveLength(1);
    expect(requests.slice(before).filter((request) => !request.startsWith('GET '))).toEqual([]);
  },
);
