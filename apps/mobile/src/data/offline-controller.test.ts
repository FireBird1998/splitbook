import { describe, expect, it, vi } from 'vitest';
import { hangUntilAborted, manualTimer } from '../test-utils/transport-faults';
import { createMobileController } from './mobile-controller';
import type { MobileTimer } from './types';
const accountId = 'a00000000000000000000001',
  groupId = 'b00000000000000000000001';
const iso = '2026-09-28T12:00:00.000Z',
  now = Date.parse(iso);
const user = { id: accountId, name: 'Alex', email: 'alex@example.test', image: null };
const group = {
  _id: groupId,
  name: 'Offline home',
  createdBy: accountId,
  category: 'home',
  defaultCurrency: 'INR',
  members: [{ user: { ...user, _id: accountId }, role: 'admin', joinedAt: iso }],
  tags: [{ _id: 'c00000000000000000000001', name: 'Food', createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const expenseId = 'e00000000000000000000001';
const expense = {
  _id: expenseId,
  group: groupId,
  revision: 0,
  description: 'Market run',
  amount: 12,
  amountMinor: 1200,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: { _id: accountId, name: 'Alex', image: null }, amount: 12, amountMinor: 1200 }],
  splitBetween: [
    { user: { _id: accountId, name: 'Alex', image: null }, amount: 12, amountMinor: 1200 },
  ],
  splitMethod: 'equal',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'food',
  tagId: 'c00000000000000000000001',
  tag: 'Food',
  notes: '',
  isDeleted: false,
  editHistory: [],
};
function fixture(options: { timer?: MobileTimer } = {}) {
  let offline = false,
    revoked = false,
    deleted = false,
    created: typeof group | null = null,
    writes = 0,
    cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null,
    cleanup = false,
    sessionStatus = 200;
  let activeUser = user;
  const errors = new Map<string, number>();
  const failedPaths = new Set<string>();
  /** Replies that hang until their request is aborted, before or after the headers. */
  const hung = new Map<string, 'headers' | 'body'>();
  const requests: string[] = [];
  const cache = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    creations = new Map<string, unknown>();
  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4145',
        authOrigin: 'http://localhost:4145',
        developmentPersonaEnabled: true,
      },
      {
        now: () => now,
        timer: options.timer,
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
          retainGroups: async (account, ids) => {
            for (const key of cache.keys()) {
              const id = /^\/api\/groups\/([a-f\d]{24})(?:\/|\?|$)/i.exec(
                key.slice(account.length),
              )?.[1];
              if (key.startsWith(account) && id && !ids.includes(id)) {
                cache.delete(key);
                cache.delete(account + '/api/user/balances');
              }
            }
          },
          invalidateGroup: async (account, id) => {
            for (const key of cache.keys())
              if (
                key.startsWith(account + '/api/groups/' + id) ||
                key === account + '/api/groups' ||
                key === account + '/api/user/balances'
              )
                cache.delete(key);
          },
          invalidateLedger: async (account, id) => {
            for (const key of cache.keys())
              if (
                key.startsWith(account + '/api/groups/' + id + '/') ||
                key.startsWith(account + '/api/groups/' + id + '?') ||
                key === account + '/api/user/balances'
              )
                cache.delete(key);
          },
          load: async (account, key) => structuredClone(cache.get(account + key) ?? null),
          save: async (account, key, value) => {
            cache.set(account + key, structuredClone(value));
          },
          clear: async () => {
            cache.clear();
          },
        },
        expenseDrafts: {
          load: async (account, group) => structuredClone(drafts.get(account + group) ?? null),
          save: async (account, group, value) => {
            drafts.set(account + group, structuredClone(value));
          },
          remove: async (account, group) => {
            drafts.delete(account + group);
          },
          clear: async () => {
            drafts.clear();
          },
        },
        newSubmissionKey: () => 'native-group-key-0001',
        groupCreations: {
          load: async (account) => structuredClone(creations.get(account) ?? null),
          save: async (account, value) => {
            creations.set(account, structuredClone(value));
          },
          remove: async (account) => {
            creations.delete(account);
          },
          clear: async () => {
            creations.clear();
          },
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
                creations.clear();
              },
            },
          ],
        },
        fetch: async (url, init) => {
          requests.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
          if (offline) throw new Error('Offline');
          const path = new URL(url).pathname;
          if (hung.has(path)) return hangUntilAborted(init, hung.get(path)!);
          if (errors.has(path)) return Response.json({}, { status: errors.get(path)! });
          if (failedPaths.has(path)) throw new Error('Partial network failure');
          if (init.method !== 'GET' && !path.startsWith('/api/auth/')) writes += 1;
          if (revoked && path.startsWith(`/api/groups/${groupId}`))
            return Response.json({}, { status: 403 });
          if (path.endsWith('/sign-in')) {
            activeUser = String(init.body).includes('sam')
              ? { ...user, id: 'a00000000000000000000002', name: 'Sam' }
              : user;
            return new Response(JSON.stringify({ user: activeUser }), {
              headers: {
                'Set-Cookie': 'better-auth.session_token=alex.signature; Max-Age=2592000',
              },
            });
          }
          if (path.endsWith('/get-session') && sessionStatus !== 200)
            return Response.json({}, { status: sessionStatus });
          if (path.endsWith('/get-session'))
            return Response.json({
              user: activeUser,
              session: { userId: activeUser.id, expiresAt: '2030-01-01T00:00:00.000Z' },
            });
          if (path === '/api/groups' && init.method === 'POST') {
            created = {
              ...group,
              _id: 'b00000000000000000000002',
              name: JSON.parse(String(init.body)).name,
            };
            return Response.json({ status: 201, data: created }, { status: 201 });
          }
          // A created Group opens through its own read (#189).
          if (created && path === `/api/groups/${created._id}`)
            return Response.json({ status: 200, data: created });
          if (path === '/api/groups')
            return Response.json({
              status: 200,
              data: revoked || activeUser.id !== accountId ? [] : [group],
            });
          if (path === '/api/user/balances')
            return Response.json({
              status: 200,
              data: { buckets: [{ currency: 'INR', youOwe: 0, youAreOwed: 12 }] },
            });
          if (path === `/api/groups/${groupId}`) return Response.json({ status: 200, data: group });
          if (path === `/api/groups/${groupId}/expenses/${expenseId}`) {
            if (init.method === 'DELETE') deleted = true;
            return Response.json({ status: 200, data: { ...expense, isDeleted: deleted } });
          }
          if (path.endsWith('/balances'))
            return Response.json({
              status: 200,
              data: { byCurrency: [{ currency: 'INR', balances: [], debts: [] }] },
            });
          if (path.endsWith('/expenses'))
            return Response.json({
              status: 200,
              data: {
                expenses: [],
                pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
                summary: {
                  count: 0,
                  totalsByCurrency: [],
                  userOwes: 0,
                  userGetsBack: 0,
                  byMember: [],
                },
              },
            });
          if (path.endsWith('/activity'))
            return Response.json({
              status: 200,
              data: {
                activities: [
                  {
                    _id: 'd00000000000000000000001',
                    group: groupId,
                    type: 'group_created',
                    actor: { _id: accountId, name: 'Alex' },
                    metadata: {},
                    createdAt: iso,
                  },
                ],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
              },
            });
          if (path.endsWith('/sign-out')) return Response.json({ success: true });
          throw new Error(`Unexpected fixture request ${init.method} ${path}`);
        },
      },
    );
  return {
    create,
    expireIdentity: () => {
      identity = { user, session: { userId: accountId, expiresAt: '2020-01-01T00:00:00.000Z' } };
    },
    expireSession: () => {
      sessionStatus = 401;
    },
    failResponse: (path: string, status: number) => {
      errors.set(path, status);
    },
    cache,
    drafts,
    failPath: (path: string) => {
      failedPaths.add(path);
    },
    hang: (path: string, stage: 'headers' | 'body') => {
      hung.set(path, stage);
    },
    writes: () => writes,
    /** Every request sent so far, as `METHOD /path`. */
    requests: () => [...requests],
    deleted: () => deleted,
    revoke: () => {
      revoked = true;
    },
    goOffline: () => {
      offline = true;
    },
    goOnline: () => {
      offline = false;
    },
  };
}
describe('account-scoped offline financial views', () => {
  it('reopens previously loaded Home and Groups after an offline restart with last refresh information', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    expect(first.getSnapshot().home.data?.[0].youAreOwed).toBe(12);
    first.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: accountId } },
      groups: { data: [{ id: groupId }] },
      home: { data: [{ currency: 'INR', youAreOwed: 12 }] },
      offline: { active: true, refreshedAt: now },
    });
  });
  it('restores loaded Group, Month, balances and Activity while an unvisited Month remains unavailable', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    await first.openGroup(groupId);
    await first.selectMonth('2026-08');
    await first.openActivity(groupId);
    first.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(groupId);
    expect(restarted.getSnapshot().detail).toMatchObject({
      status: 'ready',
      data: { id: groupId },
    });
    await restarted.selectMonth('2026-08');
    expect(restarted.getSnapshot().financial.expenses).toMatchObject({
      status: 'ready',
      summary: { count: 0 },
    });
    expect(restarted.getSnapshot().financial.balances).toMatchObject({
      status: 'ready',
      data: [{ currency: 'INR' }],
    });
    await restarted.selectMonth('2026-07');
    expect(restarted.getSnapshot().financial.balances).toMatchObject({
      status: 'ready',
      data: [{ currency: 'INR' }],
    });
    expect(restarted.getSnapshot().financial.expenses).toMatchObject({
      status: 'error',
      summary: null,
    });
    await restarted.openActivity(groupId);
    expect(restarted.getSnapshot().activity).toMatchObject({
      status: 'ready',
      events: [{ type: 'group_created' }],
    });
  });

  it('keeps Record payment closed offline, because recording needs a connection', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    await first.openGroup(groupId, true, 'balances');
    first.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(groupId, true, 'balances');
    expect(restarted.getSnapshot().offline.active).toBe(true);
    await restarted.openRecordPayment(accountId, 'a00000000000000000000002', 'INR');
    expect(restarted.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      settlement: { status: 'idle', draft: null },
    });
  });

  it('keeps an offline draft editable but never queues a write, then revalidates without discarding it', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    await first.openExpense(groupId);
    await first.updateExpenseDraft({
      description: 'Kept offline',
      amount: '12',
      tagId: 'c00000000000000000000001',
    });
    first.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    await restarted.openExpense(groupId);
    restarted.resumeExpenseDraft();
    await restarted.updateExpenseDraft({ notes: 'Still preparing' });
    await restarted.saveExpense();
    expect(restarted.getSnapshot().expense).toMatchObject({
      status: 'editing',
      draft: { description: 'Kept offline', notes: 'Still preparing' },
      attempt: null,
    });
    expect(f.writes()).toBe(0);
    f.goOnline();
    await restarted.refresh();
    expect(restarted.getSnapshot().offline.active).toBe(false);
    expect(restarted.getSnapshot().expense.draft?.notes).toBe('Still preparing');
    expect(f.writes()).toBe(0);
  });
  it('reopens a Group being created as uncertain after an offline restart, and never sends it', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    first.startCreate();
    first.updateCreation({ name: 'Cabin Weekend' });
    f.goOffline();
    await first.createGroup();
    expect(first.getSnapshot().creation.status).toBe('uncertain');
    first.dispose();
    const restarted = f.create();
    await restarted.restore();
    expect(restarted.getSnapshot()).toMatchObject({
      offline: { active: true },
      creation: { status: 'uncertain', draft: { name: 'Cabin Weekend' } },
    });
    f.goOnline();
    await restarted.refresh();
    expect(restarted.getSnapshot().creation).toMatchObject({ status: 'uncertain' });
    expect(f.writes()).toBe(0);
  });
  it('keeps an Expense delete from sending anything offline, with its review still open (#200)', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    await first.openExpense(groupId, expenseId);
    first.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    await restarted.openExpense(groupId, expenseId);
    restarted.reviewExpenseDeletion();
    // Reconnected, but nothing has been read since: the saved copies are still what's shown.
    f.goOnline();
    const before = f.requests().length;
    await restarted.deleteExpense();
    expect(f.requests().slice(before)).toEqual([]);
    expect(restarted.getSnapshot()).toMatchObject({
      offline: { active: true },
      expense: {
        status: 'delete-review',
        mutation: null,
        draft: { original: { _id: expenseId, isDeleted: false } },
      },
    });
    expect(f.drafts.size).toBe(0);
    expect(f.deleted()).toBe(false);

    // Online, Delete works as before.
    await restarted.openExpense(groupId, expenseId);
    restarted.reviewExpenseDeletion();
    expect(restarted.getSnapshot().offline.active).toBe(false);
    await restarted.deleteExpense();
    expect(f.requests()).toContain(`DELETE /api/groups/${groupId}/expenses/${expenseId}`);
    expect(f.deleted()).toBe(true);
  });
  it('keeps Create from sending a Group offline, with the form’s entries kept (#200)', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    first.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    restarted.startCreate();
    restarted.updateCreation({ name: 'Cabin Weekend' });
    f.goOnline();
    const before = f.requests().length;
    await restarted.createGroup();
    expect(f.requests().slice(before)).toEqual([]);
    expect(restarted.getSnapshot()).toMatchObject({
      screen: 'create',
      offline: { active: true },
      creation: { status: 'editing', draft: { name: 'Cabin Weekend' }, attempt: null },
    });

    // Online, Create works as before.
    await restarted.refresh();
    expect(restarted.getSnapshot().offline.active).toBe(false);
    await restarted.createGroup();
    expect(f.requests()).toContain('POST /api/groups');
    expect(restarted.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { data: { name: 'Cabin Weekend' } },
    });
  });
  it('removes denied cached Group data so it cannot return on a later offline restart', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    await first.openGroup(groupId);
    await first.openActivity(groupId);
    f.revoke();
    await first.refresh();
    expect(first.getSnapshot().activity.status).toBe('denied');
    first.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(groupId);
    expect(restarted.getSnapshot().detail.data).toBeNull();
    await restarted.openActivity(groupId);
    expect(restarted.getSnapshot().activity.events).toEqual([]);
  });

  it('keeps the stale notice when one displayed view is cached even if later reads succeed online', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.failPath(`/api/groups/${groupId}`);
    await controller.refresh();
    expect(controller.getSnapshot().financial.expenses.status).toBe('ready');
    expect(controller.getSnapshot().offline).toMatchObject({ active: true, refreshedAt: now });
  });

  it('revalidates draft Group membership on reconnect without losing the prepared draft', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Keep after denial', amount: '12' });
    f.goOffline();
    await controller.openExpense(groupId);
    controller.resumeExpenseDraft();
    f.goOnline();
    f.revoke();
    await controller.refresh();
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'blocked',
      draft: { description: 'Keep after denial' },
    });
    expect(f.writes()).toBe(0);
  });
  it('purges Group caches when a refreshed authorized Group list no longer includes them', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.back();
    f.revoke();
    await controller.refresh();
    expect(controller.getSnapshot().groups.data).toEqual([]);
    controller.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(groupId);
    expect(restarted.getSnapshot().detail.data).toBeNull();
  });

  it('purges offline data on sign-out and cannot restore it after restarting disconnected', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    expect(f.cache.size).toBeGreaterThan(0);
    f.goOffline();
    await controller.signOut();
    controller.dispose();
    expect(f.cache.size).toBe(0);
    const restarted = f.create();
    await restarted.restore();
    expect(restarted.getSnapshot().auth.user).toBeNull();
  });
  it('does not reuse a previous account cache when switching accounts', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.signIn('sam');
    expect([...f.cache.keys()].some((key) => key.startsWith(accountId))).toBe(false);
    controller.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    expect(restarted.getSnapshot().auth.user?.name).toBe('Sam');
    expect(restarted.getSnapshot().groups.data).toEqual([]);
    await restarted.openGroup(groupId);
    expect(restarted.getSnapshot().detail.data).toBeNull();
  });
  it('refuses expired offline identity and blocks offline restoration after a rejected session', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    controller.dispose();
    f.expireIdentity();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    expect(restarted.getSnapshot().auth.user).toBeNull();
    f.goOnline();
    await restarted.signIn('alex');
    f.goOffline();
    await restarted.refresh();
    f.goOnline();
    f.expireSession();
    await restarted.refresh();
    expect(restarted.getSnapshot().auth.user).toBeNull();
    restarted.dispose();
    f.goOffline();
    const afterExpiry = f.create();
    await afterExpiry.restore();
    expect(afterExpiry.getSnapshot().auth.user).toBeNull();
  });
  it('does not substitute cached data for an authoritative server error', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.failResponse(`/api/groups/${groupId}`, 500);
    await controller.refresh();
    expect(controller.getSnapshot().detail.status).toBe('error');
    expect(controller.getSnapshot().offline.active).toBe(false);
  });
  describe('a read that times out (#209)', () => {
    const path = `/api/groups/${groupId}`;
    /** The saved Group was verified an hour before this read. */
    const verifiedAt = now - 3_600_000;
    async function timedOut(stage: 'headers' | 'body') {
      const timers = manualTimer();
      const f = fixture({ timer: timers.timer }),
        controller = f.create();
      await controller.signIn('alex');
      await controller.openGroup(groupId);
      f.cache.set(accountId + path, {
        ...(f.cache.get(accountId + path) as object),
        refreshedAt: verifiedAt,
      });
      f.hang(path, stage);
      const before = f.requests().length;
      const refreshing = controller.refresh();
      await vi.waitFor(() => expect(f.requests().slice(before)).toContain(`GET ${path}`));
      timers.elapse(20_000);
      await refreshing;
      return controller;
    }

    it('shows the saved copy, with its own verification time, when it times out before the headers', async () => {
      const controller = await timedOut('headers');
      expect(controller.getSnapshot()).toMatchObject({
        detail: { status: 'ready', data: { id: groupId }, refreshedAt: verifiedAt },
        offline: { active: true, refreshedAt: verifiedAt },
      });
    });
    it('shows the error and no offline notice when it times out after the headers, as today (#231 changes this)', async () => {
      const controller = await timedOut('body');
      expect(controller.getSnapshot().detail).toMatchObject({
        status: 'error',
        message: 'Could not reach SplitBook. Check your connection and try again.',
      });
      expect(controller.getSnapshot().offline.active).toBe(false);
    });
  });
  it.each(['owner', 'future', 'corrupt'])('refuses a %s cache envelope', async (kind) => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    const path = `/api/groups/${groupId}`;
    f.cache.set(
      accountId + path,
      kind === 'corrupt'
        ? {}
        : {
            version: 1,
            accountId: kind === 'owner' ? 'someone-else' : accountId,
            path,
            refreshedAt: kind === 'future' ? now + 1 : now,
            value: { status: 200, data: group },
          },
    );
    controller.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(groupId);
    expect(restarted.getSnapshot().detail.data).toBeNull();
    expect(restarted.getSnapshot().detail.message).toContain('not saved');
  });
  it('keeps cached Groups labelled stale after Home balances reconnect', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    first.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    f.goOnline();
    await restarted.refreshHome();
    expect(restarted.getSnapshot().offline).toMatchObject({ active: true, refreshedAt: now });
    await restarted.openGroup(groupId);
    await restarted.back();
    expect(restarted.getSnapshot().offline).toMatchObject({ active: true, refreshedAt: now });
  });

  it('removes denied Group cards from memory when opening an Expense is rejected', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.revoke();
    await controller.openExpense(groupId);
    f.goOffline();
    await controller.back();
    expect(controller.getSnapshot().groups.data).toEqual([]);
    expect(controller.getSnapshot().home.data).toBeNull();
  });
  it('still evicts protected Group content when independent balances deny access after an offline Month miss', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.selectMonth('2026-08');
    f.failPath(`/api/groups/${groupId}/expenses`);
    f.failResponse(`/api/groups/${groupId}/balances`, 403);
    await controller.selectMonth('2026-07');
    expect(controller.getSnapshot().detail).toMatchObject({ status: 'denied', data: null });
    expect(controller.getSnapshot().financial.balances.data).toBeNull();
    expect(controller.getSnapshot().groups.data).toEqual([]);
    controller.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(groupId);
    expect(restarted.getSnapshot().detail.data).toBeNull();
  });
});
