import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { FetchResponse, MobileFetch } from './types';

const memberIds = [
  'a00000000000000000000001',
  'a00000000000000000000002',
  'a00000000000000000000003',
];
const groupId = 'a00000000000000000000010';
const tagId = 'a00000000000000000000020';
const iso = '2026-09-28T10:00:00.000Z';
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
) {
  let cookie: string | null = null;
  let account: string | null = null;
  let cleanup = false;
  const records = new Map<string, unknown>();
  const drafts = {
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
    return json({ error: 'Unavailable', status: 404 }, 404);
  };
  const create = () =>
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
        now: () => Date.parse(iso),
        newSubmissionKey: () => 'native-expense-test-0001',
      },
    );
  return { create, controller: create(), drafts, records };
}

describe('native Expense creation', () => {
  it.each([
    { amount: '10.001' },
    { participantIds: [] },
    { payerId: 'a00000000000000000000099' },
    { tagId: 'a00000000000000000000099' },
    { currency: 'USD' },
    { date: '2026-02-30' },
    { description: '' },
  ])('retains invalid entries without sending a write: %j', async (patch) => {
    let posts = 0;
    const { controller } = setup((path, init) => {
      if (path.endsWith('/expenses') && init.method === 'POST') posts++;
      return undefined;
    });
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '10', tagId, ...patch });
    await controller.saveExpense();
    expect(posts).toBe(0);
    expect(controller.getSnapshot().expense.status).toBe('editing');
    expect(controller.getSnapshot().expense.draft).toMatchObject(patch);
    expect(controller.getSnapshot().expense.message).toBeTruthy();
  });

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
    expect(expense.message).toContain('Retry this same submission');
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
