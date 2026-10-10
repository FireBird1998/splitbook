import { createCheckedMobileController as createMobileController } from '../test-utils/flow-monitor';
import { describe, expect, it, vi } from 'vitest';
import {
  bodyFails,
  gatewayBodies,
  gatewayFailures,
  gatewayReply,
  hangUntilAborted,
  manualTimer,
  within,
  type GatewayBody,
} from '../test-utils/transport-faults';
import type { MobileTimer } from './types';
import { savedQueriesIn } from '../test-utils/saved-queries';
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
function fixture(
  options: {
    timer?: MobileTimer;
    rowSizes?: Map<string, number>;
    rowUsed?: Map<string, number>;
    usageWait?: () => Promise<void>;
    removed?: string[];
    clock?: { now: number };
    extraGroups?: (typeof group)[];
  } = {},
) {
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
  const device = {
    failRemoval: false,
    failJournalClear: false,
    failJournalSave: false,
    holdDraftWrite: null as Promise<void> | null,
    holdGroupRead: null as Promise<void> | null,
  };
  let archived = false;
  let financialCleanup: unknown = null;
  /** Replies with a status, and a body that defaults to an empty JSON object. */
  const errors = new Map<string, { status: number; body?: string }>();
  const failedPaths = new Set<string>();
  /** Replies whose body stops arriving once the headers are in. */
  const brokenBodies = new Set<string>();
  /** A gateway in front of the whole backend that can't reach it. */
  let gateway: { status: number; body: GatewayBody } | null = null;
  /** Replies that hang until their request is aborted, before or after the headers. */
  const hung = new Map<string, 'headers' | 'body'>();
  const requests: string[] = [];
  const cache = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    creations = new Map<string, unknown>(),
    attempts = new Map<string, unknown>();
  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4145',
        authOrigin: 'http://localhost:4145',
        developmentPersonaEnabled: true,
      },
      {
        now: () => options.clock?.now ?? now,
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
        savedQueries: {
          ...savedQueriesIn(cache),
          usage: async (account: string) => {
            await options.usageWait?.();
            return [...cache.keys()]
              .filter((key) => key.startsWith(account))
              .map((key) => ({
                path: key.slice(account.length),
                bytes: options.rowSizes?.get(key.slice(account.length)) ?? 0,
                lastUsed: options.rowUsed?.get(key.slice(account.length)) ?? 0,
              }));
          },
          touch: async (account: string, path: string, time: number) => {
            if (cache.has(account + path)) options.rowUsed?.set(path, time);
          },
          save: async (account: string, path: string, value: unknown) => {
            cache.set(account + path, structuredClone(value));
            options.rowUsed?.set(path, options.clock?.now ?? now);
          },
          remove: async (account: string, path: string) => {
            options.removed?.push(path);
            cache.delete(account + path);
          },
        },
        settlementAttempts: {
          list: async (account) =>
            [...attempts]
              .filter(([key]) => key.startsWith(account))
              .map(([key, value]) => ({
                groupId: key.slice(account.length),
                value: structuredClone(value),
              })),
          load: async (account, group) => structuredClone(attempts.get(account + group) ?? null),
          save: async (account, group, value) => {
            attempts.set(account + group, structuredClone(value));
          },
          remove: async (account, group) => {
            attempts.delete(account + group);
          },
          clear: async () => {
            attempts.clear();
          },
        },
        expenseDrafts: {
          list: async (account) =>
            [...drafts]
              .filter(([key]) => key.startsWith(account))
              .map(([key, value]) => ({
                groupId: key.slice(account.length),
                value: structuredClone(value),
              })),
          load: async (account, group) => structuredClone(drafts.get(account + group) ?? null),
          save: async (account, group, value) => {
            await device.holdDraftWrite;
            drafts.set(account + group, structuredClone(value));
          },
          remove: async (account, group) => {
            if (device.failRemoval) throw new Error('Device storage failed');
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
          financialCleanup: {
            load: async () => structuredClone(financialCleanup),
            save: async (value) => {
              if (device.failJournalSave) throw new Error('Cleanup journal unavailable');
              financialCleanup = structuredClone(value);
            },
            clear: async () => {
              if (device.failJournalClear) throw new Error('Cleanup journal unavailable');
              financialCleanup = null;
            },
          },
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
                attempts.clear();
                financialCleanup = null;
              },
            },
          ],
        },
        fetch: async (url, init) => {
          requests.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
          if (offline) throw new Error('Offline');
          if (gateway) return gatewayReply(gateway.status, gateway.body);
          const path = new URL(url).pathname;
          if (path === `/api/groups/${groupId}`) await device.holdGroupRead;
          if (hung.has(path)) return hangUntilAborted(init, hung.get(path)!);
          if (errors.has(path)) {
            const { status, body } = errors.get(path)!;
            return body === undefined
              ? Response.json({}, { status })
              : new Response(body, { status });
          }
          if (failedPaths.has(path)) throw new Error('Partial network failure');
          if (brokenBodies.has(path)) return bodyFails();
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
              // As on the real server, a Group created here is listed from then on.
              data:
                activeUser.id !== accountId
                  ? []
                  : [
                      ...(revoked || archived ? [] : [group]),
                      ...(options.extraGroups ?? []),
                      ...(created ? [created] : []),
                    ],
            });
          if (path === '/api/user/balances')
            return Response.json({
              status: 200,
              data: { buckets: [{ currency: 'INR', youOwe: 0, youAreOwed: 12 }] },
            });
          const extra = options.extraGroups?.find((item) => path === `/api/groups/${item._id}`);
          if (extra) return Response.json({ status: 200, data: extra });
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
          if (path === `/api/groups/${groupId}/expenses` && init.method === 'POST')
            return Response.json(
              { status: 201, data: { _id: 'e00000000000000000000002', group: groupId } },
              { status: 201 },
            );
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
    device,
    archive: () => {
      archived = true;
    },
    restoreAccess: () => {
      revoked = false;
    },
    expireIdentity: () => {
      identity = { user, session: { userId: accountId, expiresAt: '2020-01-01T00:00:00.000Z' } };
    },
    expireSession: () => {
      sessionStatus = 401;
    },
    failResponse: (path: string, status: number, body?: string) => {
      errors.set(path, { status, body });
    },
    /** The headers arrive, then the body stops arriving. */
    breakBody: (path: string) => {
      brokenBodies.add(path);
    },
    /** Every request meets a gateway that can't reach the backend, until `gatewayUp`. */
    gatewayDown: (status: number, body: GatewayBody = 'HTML') => {
      gateway = { status, body };
    },
    gatewayUp: () => {
      gateway = null;
    },
    cache,
    drafts,
    attempts,
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
  it('discards a blocked ordinary draft without any server write', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '12' });
    f.revoke();
    await controller.refresh('retry');
    const before = f.requests().length;
    await controller.discardExpenseDraft();
    expect(f.drafts.size).toBe(0);
    expect(controller.getSnapshot().screen).toBe('groups');
    expect(
      f
        .requests()
        .slice(before)
        .filter((request) => !request.startsWith('GET ')),
    ).toEqual([]);
  });

  it('checks an unlisted draft’s Group before deleting it on a verified Home refresh', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '12' });
    await controller.back();
    await controller.back();
    expect(f.drafts.size).toBe(1);
    f.revoke();
    const before = f.requests().length;
    await controller.refresh('pull');
    expect(
      f
        .requests()
        .slice(before)
        .filter((request) => request === `GET /api/groups/${groupId}`),
    ).toHaveLength(1);
    expect(f.drafts.size).toBe(0);
    expect(
      f
        .requests()
        .slice(before)
        .filter((request) => !request.startsWith('GET ')),
    ).toEqual([]);
  });

  it('keeps a refused draft blocked on its form, then removes it when leaving for Home', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Keep my dinner', amount: '12' });
    f.revoke();
    const before = f.requests().length;
    await controller.refresh('retry');
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'blocked',
      draft: { description: 'Keep my dinner' },
    });
    expect(f.drafts.size).toBe(1);
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
    expect(f.drafts.size).toBe(0);
    expect(
      f
        .requests()
        .slice(before)
        .filter((request) => !request.startsWith('GET ')),
    ).toEqual([]);
  });

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
    // The list read after the create lists it beside the Group already there (#283).
    expect(restarted.getSnapshot().groups.data.map(({ name }) => name)).toEqual([
      'Offline home',
      'Cabin Weekend',
    ]);
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
  describe('a read waiting on its reply (#209)', () => {
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
    it('shows the saved copy, with its own verification time, when it times out after the headers (#231)', async () => {
      const controller = await timedOut('body');
      expect(controller.getSnapshot()).toMatchObject({
        detail: { status: 'ready', data: { id: groupId }, refreshedAt: verifiedAt },
        offline: { active: true, refreshedAt: verifiedAt },
      });
    });
    it('ends at once when the member signs out while it waits for its reply', async () => {
      const f = fixture({ timer: manualTimer().timer }),
        controller = f.create();
      await controller.signIn('alex');
      await controller.openGroup(groupId);
      f.hang(path, 'headers');
      const before = f.requests().length;
      const refreshing = controller.refresh();
      await vi.waitFor(() => expect(f.requests().slice(before)).toContain(`GET ${path}`));
      await controller.signOut();
      // Only the sign-out's abort can end it: no timer runs and the reply never comes.
      await within(refreshing);
      expect(controller.getSnapshot()).toMatchObject({
        auth: { status: 'signed-out', user: null },
        detail: { data: null },
      });
    });
  });
  describe('a gateway in front of SplitBook that can’t reach it (#231)', () => {
    const path = `/api/groups/${groupId}`;
    /** The saved Group was verified an hour before it is read again. */
    const verifiedAt = now - 3_600_000;
    const unreachable = 'Could not reach SplitBook. Check your connection and try again.';
    const serverFault = 'The server could not complete this request. Please try again.';
    type Fixture = ReturnType<typeof fixture>;
    const count = (sent: string[], request: string) =>
      sent.filter((sentRequest) => sentRequest === request).length;
    /** The Group's saved copy now says it was verified at `verifiedAt`. */
    const verifiedEarlier = (f: Fixture) =>
      f.cache.set(accountId + path, {
        ...(f.cache.get(accountId + path) as object),
        refreshedAt: verifiedAt,
      });

    /** Opens the Group, then reads it again with Retry after `fail`: what it sent and showed. */
    async function readAgain(fail: (f: Fixture) => void) {
      const f = fixture(),
        controller = f.create();
      await controller.signIn('alex');
      await controller.openGroup(groupId);
      verifiedEarlier(f);
      fail(f);
      const before = f.requests().length;
      await controller.refresh('retry');
      return { snapshot: controller.getSnapshot(), sent: f.requests().slice(before) };
    }

    it.each(gatewayFailures)(
      'shows the saved copy with its own time when a gateway answers %i with a body that is %s, as for a lost connection',
      async (status, body) => {
        const lost = await readAgain((f) => f.failPath(path));
        const gateway = await readAgain((f) => f.failResponse(path, status, gatewayBodies[body]));
        expect(gateway.snapshot).toMatchObject({
          detail: { status: 'ready', data: { id: groupId }, refreshedAt: verifiedAt },
          offline: { active: true, refreshedAt: verifiedAt },
        });
        expect(gateway.snapshot).toEqual(lost.snapshot);
        expect(count(gateway.sent, `GET ${path}`)).toBe(1);
        expect(gateway.sent).toEqual(lost.sent);
      },
    );

    it.each([502, 503, 504])(
      'shows a view with no saved copy as not saved on this device when a gateway answers %i, as for a lost connection',
      async (status) => {
        async function openUnsaved(fail: (f: Fixture) => void) {
          const f = fixture(),
            controller = f.create();
          await controller.signIn('alex');
          fail(f);
          const before = f.requests().length;
          await controller.openGroup(groupId);
          return { snapshot: controller.getSnapshot(), sent: f.requests().slice(before) };
        }
        const lost = await openUnsaved((f) => f.failPath(path));
        const gateway = await openUnsaved((f) => f.failResponse(path, status, gatewayBodies.HTML));
        expect(gateway.snapshot).toMatchObject({
          detail: {
            status: 'error',
            data: null,
            message: 'This view was not saved on this device. Connect to load it.',
          },
          offline: { active: true },
        });
        expect(gateway.snapshot).toEqual(lost.snapshot);
        expect(count(gateway.sent, `GET ${path}`)).toBe(1);
        expect(gateway.sent).toEqual(lost.sent);
      },
    );

    it('keeps SplitBook’s own coded 503 a server error with no saved copy, unlike a gateway’s uncoded one', async () => {
      const coded = await readAgain((f) =>
        f.failResponse(
          path,
          503,
          JSON.stringify({
            error: 'The audit feed is temporarily unavailable. Please retry later.',
            status: 503,
            code: 'ACTIVITY_BACKLOG_FULL',
          }),
        ),
      );
      // The Group on screen keeps its own time: the saved copy, an hour older, isn't loaded.
      expect(coded.snapshot).toMatchObject({
        detail: { status: 'error', data: { id: groupId }, refreshedAt: now, message: serverFault },
        offline: { active: false, refreshedAt: null },
      });
      expect(count(coded.sent, `GET ${path}`)).toBe(1);

      const gateway = await readAgain((f) =>
        f.failResponse(path, 503, gatewayBodies['uncoded JSON']),
      );
      expect(gateway.snapshot).toMatchObject({
        detail: { status: 'ready', refreshedAt: verifiedAt },
        offline: { active: true, refreshedAt: verifiedAt },
      });
      expect(count(gateway.sent, `GET ${path}`)).toBe(1);
    });

    it.each([
      ['without a code', '{"error":"Internal server error","status":500}'],
      ['with a code', '{"error":"Internal server error","status":500,"code":"INTERNAL_ERROR"}'],
    ])(
      'keeps a 500 %s an error with Retry and no saved copy, unlike a gateway’s 502',
      async (_, body) => {
        const fault = await readAgain((f) => f.failResponse(path, 500, body));
        expect(fault.snapshot).toMatchObject({
          detail: {
            status: 'error',
            data: { id: groupId },
            refreshedAt: now,
            message: serverFault,
          },
          offline: { active: false, refreshedAt: null },
        });
        expect(count(fault.sent, `GET ${path}`)).toBe(1);

        const gateway = await readAgain((f) => f.failResponse(path, 502, gatewayBodies.HTML));
        expect(gateway.snapshot).toMatchObject({
          detail: { status: 'ready', refreshedAt: verifiedAt },
          offline: { active: true, refreshedAt: verifiedAt },
        });
        expect(count(gateway.sent, `GET ${path}`)).toBe(1);
      },
    );

    it('shows the saved copy when a body stops arriving, but keeps today’s error for a whole reply that isn’t JSON', async () => {
      const malformed = await readAgain((f) => f.failResponse(path, 200, '<html>Maple</html>'));
      expect(malformed.snapshot).toMatchObject({
        detail: { status: 'error', data: { id: groupId }, refreshedAt: now, message: unreachable },
        offline: { active: false, refreshedAt: null },
      });
      expect(count(malformed.sent, `GET ${path}`)).toBe(1);

      const lost = await readAgain((f) => f.failPath(path));
      const broken = await readAgain((f) => f.breakBody(path));
      expect(broken.snapshot).toMatchObject({
        detail: { status: 'ready', data: { id: groupId }, refreshedAt: verifiedAt },
        offline: { active: true, refreshedAt: verifiedAt },
      });
      expect(broken.snapshot).toEqual(lost.snapshot);
      expect(count(broken.sent, `GET ${path}`)).toBe(1);
      expect(broken.sent).toEqual(lost.sent);
    });

    it.each([502, 503, 504])(
      'restores the saved Home offline when a gateway answers %i, as when the phone is offline',
      async (status) => {
        async function restart(fail: (f: Fixture) => void) {
          const f = fixture(),
            first = f.create();
          await first.signIn('alex');
          first.dispose();
          fail(f);
          const before = f.requests().length;
          const restarted = f.create();
          await restarted.restore();
          return { snapshot: restarted.getSnapshot(), sent: f.requests().slice(before) };
        }
        const offline = await restart((f) => f.goOffline());
        const gateway = await restart((f) => f.gatewayDown(status));
        expect(gateway.snapshot).toMatchObject({
          auth: { status: 'authenticated', user: { id: accountId } },
          groups: { data: [{ id: groupId }] },
          home: { data: [{ currency: 'INR', youAreOwed: 12 }] },
          offline: { active: true, refreshedAt: now },
        });
        expect(gateway.snapshot).toEqual(offline.snapshot);
        // Only session checks: the restore's, then one that Home's list and figures, read
        // together (#333), both wait for before their saved copies show, as offline.
        expect(gateway.sent).toEqual(Array(2).fill('GET /api/auth/get-session'));
        expect(gateway.sent).toEqual(offline.sent);
      },
    );

    it('clears offline at the next pull that reaches SplitBook, with no reconnect event, and shows fresh data', async () => {
      const f = fixture(),
        controller = f.create();
      await controller.signIn('alex');
      await controller.openGroup(groupId);
      verifiedEarlier(f);
      f.gatewayDown(502);
      await controller.refresh('pull');
      expect(controller.getSnapshot()).toMatchObject({
        detail: { status: 'ready', data: { id: groupId }, refreshedAt: verifiedAt },
        offline: { active: true, refreshedAt: verifiedAt },
      });

      // The backend is back, and the phone never went offline: the member pulls to refresh.
      f.gatewayUp();
      const before = f.requests().length;
      await controller.refresh('pull');
      const sent = f.requests().slice(before);
      // The session is checked before anything is read live again.
      expect(sent[0]).toBe('GET /api/auth/get-session');
      expect(count(sent, `GET ${path}`)).toBe(1);
      expect(controller.getSnapshot()).toMatchObject({
        detail: { status: 'ready', data: { id: groupId }, refreshedAt: now },
        offline: { active: false, refreshedAt: null },
      });
    });

    it('blocks Save while a gateway fails, then allows it once a pull reaches SplitBook, sending it once', async () => {
      const f = fixture(),
        controller = f.create();
      await controller.signIn('alex');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({
        description: 'Market run',
        amount: '12',
        tagId: 'c00000000000000000000001',
      });
      f.gatewayDown(503);
      await controller.refresh('pull');
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'expense',
        offline: { active: true },
        expense: { status: 'editing', draft: { description: 'Market run' } },
      });
      let before = f.requests().length;
      await controller.saveExpense();
      // Saving needs SplitBook: nothing is sent, and nothing waits to be sent later.
      expect(f.requests().slice(before)).toEqual([]);
      expect(controller.getSnapshot().expense).toMatchObject({ status: 'editing', attempt: null });

      f.gatewayUp();
      before = f.requests().length;
      await controller.refresh('pull');
      expect(f.requests().slice(before)[0]).toBe('GET /api/auth/get-session');
      expect(controller.getSnapshot().offline).toMatchObject({ active: false });
      // Nothing was sent by the recovery itself.
      expect(f.requests().filter((request) => request.startsWith('POST /api/groups/'))).toEqual([]);

      await controller.saveExpense();
      expect(f.requests().filter((request) => request.startsWith('POST /api/groups/'))).toEqual([
        `POST ${path}/expenses`,
      ]);
      expect(controller.getSnapshot().expense.status).toBe('saved');
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
  it('keeps cached Groups labelled stale after Home balances reconnect, while the list can’t be read', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    first.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    f.goOnline();
    // Retry reads the saved list beside the balances (#333); SplitBook can't answer it yet.
    f.failPath('/api/groups');
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
    // A recently verified form can open locally; an expired Group must check access (#366).
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    try {
      await controller.openExpense(groupId);
    } finally {
      clock.mockRestore();
    }
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

/** A stored-size inspection held by the boundary adapter, before any eviction can be made. */
function heldUsage() {
  let active = false;
  let arrive!: () => void, release!: () => void;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    arrived,
    release,
    arm: () => {
      active = true;
    },
    wait: async () => {
      if (!active) return;
      active = false;
      arrive();
      await released;
    },
  };
}

describe('saved-copy storage budget (#223)', () => {
  it('saves both Home rows while an earlier cap inspection is held, then restores them after a restart', async () => {
    const held = heldUsage();
    const f = fixture({ usageWait: held.wait });
    const first = f.create();
    held.arm();
    await first.signIn('alex');
    await within(held.arrived);
    expect(first.getSnapshot().home.status).toBe('ready');
    expect(f.cache.has(accountId + '/api/groups')).toBe(true);
    expect(f.cache.has(accountId + '/api/user/balances')).toBe(true);
    first.dispose();
    held.release();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    expect(restarted.getSnapshot().home.status).toBe('ready');
    expect(restarted.getSnapshot().offline.refreshedAt).toBe(now);
    expect(f.writes()).toBe(0);
    restarted.dispose();
  });

  it('caps pre-existing persister rows on offline account restoration without any new network saves', async () => {
    const a = { ...group, _id: 'b00000000000000000000002', name: 'Maple House' };
    const b = { ...group, _id: 'b00000000000000000000003', name: 'Cabin Weekend' };
    const pathA = `/api/groups/${a._id}`,
      pathB = `/api/groups/${b._id}`;
    const f = fixture({
      extraGroups: [a, b],
      rowUsed: new Map([
        [pathA, 1],
        [pathB, 2],
      ]),
      rowSizes: new Map([
        [pathA, 12_000_000],
        [pathB, 12_000_000],
        ['/api/groups', 2_000_000],
        ['/api/user/balances', 2_000_000],
      ]),
    });
    const first = f.create();
    await first.signIn('alex');
    first.dispose();
    for (const [path, data] of [
      [pathA, a],
      [pathB, b],
    ] as const)
      f.cache.set(accountId + path, {
        version: 1,
        accountId,
        path,
        groupId: data._id,
        refreshedAt: now - 86_400_000,
        value: { status: 200, data },
      });
    const verifiedHome = f.cache.get(accountId + '/api/user/balances');
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    expect(restarted.getSnapshot().home.status).toBe('ready');
    await vi.waitFor(() => expect(f.cache.has(accountId + pathA)).toBe(false));
    expect(f.cache.get(accountId + pathB)).toMatchObject({ refreshedAt: now - 86_400_000 });
    expect(f.cache.get(accountId + '/api/user/balances')).toEqual(verifiedHome);
    expect(restarted.getSnapshot().home.refreshedAt).toBe(now);
    expect(f.writes()).toBe(0);
    restarted.dispose();
  });

  it('evicts the least recently used rows while keeping Home and the open Group at 20 MB', async () => {
    const mb = 1_000_000;
    const oldPath = '/api/groups/b00000000000000000000002';
    const recentPath = '/api/groups/b00000000000000000000003';
    const openPath = `/api/groups/${groupId}`;
    const rowSizes = new Map([
      [oldPath, 8 * mb],
      [recentPath, 8 * mb],
      [openPath, 8 * mb],
      ['/api/groups', 2 * mb],
      ['/api/user/balances', 2 * mb],
    ]);
    const f = fixture({
      rowSizes,
      rowUsed: new Map([
        [oldPath, 1],
        [recentPath, 2],
      ]),
    });
    const controller = f.create();
    await controller.signIn('alex');
    f.cache.set(accountId + oldPath, { version: 1, accountId, path: oldPath, value: {} });
    f.cache.set(accountId + recentPath, { version: 1, accountId, path: recentPath, value: {} });
    await controller.openGroup(groupId);
    await vi.waitFor(() => expect(f.cache.has(accountId + oldPath)).toBe(false));
    expect(f.cache.has(accountId + recentPath)).toBe(true);
    expect(f.cache.has(accountId + openPath)).toBe(true);
    expect(f.cache.has(accountId + '/api/groups')).toBe(true);
    expect(f.cache.has(accountId + '/api/user/balances')).toBe(true);
    expect(f.writes()).toBe(0);
    controller.dispose();
  });

  it('uses the last time a saved row was shown, including a fresh query reused without another request', async () => {
    const a = { ...group, _id: 'b00000000000000000000002', name: 'Maple House' };
    const b = { ...group, _id: 'b00000000000000000000003', name: 'Cabin Weekend' };
    const pathA = `/api/groups/${a._id}`,
      pathB = `/api/groups/${b._id}`;
    const clock = { now };
    const rowUsed = new Map<string, number>();
    const f = fixture({
      clock,
      rowUsed,
      extraGroups: [a, b],
      rowSizes: new Map([
        [pathA, 8_000_000],
        [pathB, 8_000_000],
        [`/api/groups/${groupId}`, 8_000_000],
        ['/api/groups', 2_000_000],
        ['/api/user/balances', 2_000_000],
      ]),
    });
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(a._id);
    const verified = (f.cache.get(accountId + pathA) as { refreshedAt: number }).refreshedAt;
    clock.now += 1;
    await controller.openGroup(b._id);
    const before = f.requests().filter((request) => request === `GET ${pathA}`).length;
    clock.now += 1;
    await controller.openGroup(a._id);
    await vi.waitFor(() => expect(rowUsed.get(pathA)).toBe(clock.now));
    expect(f.requests().filter((request) => request === `GET ${pathA}`).length).toBe(before);
    expect((f.cache.get(accountId + pathA) as { refreshedAt: number }).refreshedAt).toBe(verified);
    clock.now += 1;
    await controller.openGroup(groupId);
    await vi.waitFor(() => expect(f.cache.has(accountId + pathB)).toBe(false));
    expect(f.cache.has(accountId + pathA)).toBe(true);
    controller.dispose();
  });

  it.each(['Group', 'Expense', 'payment'] as const)(
    'keeps Home and the %s route’s Group even when protected rows alone exceed the budget',
    async (screen) => {
      const oldPath = '/api/groups/b00000000000000000000002';
      const openPath = `/api/groups/${groupId}`;
      const held = heldUsage();
      const f = fixture({
        usageWait: held.wait,
        rowSizes: new Map([
          [oldPath, 8_000_000],
          [openPath, 26_000_000],
          ['/api/groups', 2_000_000],
          ['/api/user/balances', 2_000_000],
        ]),
      });
      const controller = f.create();
      await controller.signIn('alex');
      f.cache.set(accountId + oldPath, { version: 1, accountId, path: oldPath, value: {} });
      held.arm();
      if (screen === 'Group') await controller.openGroup(groupId);
      else if (screen === 'Expense') await controller.openExpense(groupId, expenseId);
      else {
        // Payments open over a Group view; an incoming Home copy finishes while that sheet is open.
        await controller.openGroup(groupId);
        await controller.openSettlements(groupId);
      }
      await within(held.arrived);
      expect(controller.getSnapshot().screen).toBe(
        screen === 'Group' ? 'group' : screen === 'Expense' ? 'expense' : 'settlement',
      );
      held.release();
      await vi.waitFor(() => expect(f.cache.has(accountId + oldPath)).toBe(false));
      expect(f.cache.has(accountId + openPath)).toBe(true);
      expect(f.cache.has(accountId + '/api/groups')).toBe(true);
      expect(f.cache.has(accountId + '/api/user/balances')).toBe(true);
      expect(f.writes()).toBe(0);
      controller.dispose();
    },
  );

  it('shows an evicted view’s offline miss as an error, never an indefinite loader', async () => {
    const path = `/api/groups/${groupId}`;
    const f = fixture({ rowSizes: new Map([[path, 20_000_001]]) });
    const first = f.create();
    await first.signIn('alex');
    await first.openGroup(groupId);
    await vi.waitFor(() => expect(f.cache.has(accountId + path)).toBe(true));
    await first.back();
    await first.refreshHome();
    await vi.waitFor(() => expect(f.cache.has(accountId + path)).toBe(false));
    first.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(groupId);
    expect(restarted.getSnapshot().detail.status).toBe('error');
    expect(restarted.getSnapshot().detail.data).toBeNull();
    expect(restarted.getSnapshot().detail.message).toBe(
      'This view was not saved on this device. Connect to load it.',
    );
    restarted.dispose();
  });

  it('keeps any-age copies with original verification time while there is room, and reads them again when active', async () => {
    const path = `/api/groups/${groupId}`;
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    await first.openGroup(groupId);
    const saved = f.cache.get(accountId + path) as { refreshedAt: number };
    f.cache.set(accountId + path, { ...saved, refreshedAt: 1 });
    first.dispose();
    f.goOffline();
    const restarted = f.create();
    await restarted.restore();
    const before = f.requests().filter((request) => request === `GET ${path}`).length;
    await restarted.openGroup(groupId);
    expect(restarted.getSnapshot().detail).toMatchObject({ status: 'ready', refreshedAt: 1 });
    expect(restarted.getSnapshot().offline).toMatchObject({ active: true, refreshedAt: 1 });
    f.goOnline();
    await restarted.refresh();
    expect(f.requests().filter((request) => request === `GET ${path}`).length).toBeGreaterThan(
      before,
    );
    expect(restarted.getSnapshot().detail.refreshedAt).toBe(now);
    restarted.dispose();
  });

  it('lets a draft write finish while eviction is held, without evicting drafts or unconfirmed saves', async () => {
    const path = '/api/groups/b00000000000000000000002';
    const held = heldUsage();
    const f = fixture({ usageWait: held.wait, rowSizes: new Map([[path, 21_000_000]]) });
    const controller = f.create();
    await controller.signIn('alex');
    f.cache.set(accountId + path, { version: 1, accountId, path, value: {} });
    f.attempts.set(accountId + groupId, { submissionKey: 'unconfirmed-same-key' });
    held.arm();
    await controller.openExpense(groupId);
    await within(held.arrived);
    await within(controller.updateExpenseDraft({ description: 'Keep this dinner', amount: '12' }));
    expect(f.drafts.get(accountId + groupId)).toMatchObject({
      draft: { description: 'Keep this dinner' },
    });
    expect(f.cache.has(accountId + path)).toBe(true);
    held.release();
    await vi.waitFor(() => expect(f.cache.has(accountId + path)).toBe(false));
    expect(f.drafts.get(accountId + groupId)).toMatchObject({
      draft: { description: 'Keep this dinner' },
    });
    expect(f.attempts.get(accountId + groupId)).toEqual({ submissionKey: 'unconfirmed-same-key' });
    expect(f.writes()).toBe(0);
    controller.dispose();
  });

  it.each(['sign-out', '401'] as const)(
    'refuses held eviction when the account lease retires through %s',
    async (retirement) => {
      const path = '/api/groups/b00000000000000000000002';
      const held = heldUsage(),
        removed: string[] = [];
      const f = fixture({ usageWait: held.wait, removed, rowSizes: new Map([[path, 21_000_000]]) });
      const controller = f.create();
      await controller.signIn('alex');
      f.cache.set(accountId + path, { version: 1, accountId, path, value: {} });
      held.arm();
      await controller.openExpense(groupId);
      await within(held.arrived);
      await controller.updateExpenseDraft({ description: 'Retained after expiry' });
      removed.length = 0;
      if (retirement === 'sign-out') {
        const leaving = controller.signOut();
        expect(controller.getSnapshot().auth.status).toBe('signed-out');
        held.release();
        await within(leaving);
        expect(f.cache.size).toBe(0);
        expect(f.drafts.size).toBe(0);
      } else {
        f.expireSession();
        await within(controller.refresh());
        expect(controller.getSnapshot().auth.status).toBe('signed-out');
        expect(f.drafts.get(accountId + groupId)).toMatchObject({
          draft: { description: 'Retained after expiry' },
        });
        held.release();
        // The explicit purge waits for every running saved-copy operation, exposing any late delete.
        await within(controller.signOut());
      }
      expect(removed).toEqual([]);
      controller.dispose();
    },
  );
});

it('retains an archived Group’s financial records after a verified list omits it', async () => {
  const f = fixture();
  const controller = f.create();
  await controller.signIn('alex');
  await controller.openExpense(groupId);
  await controller.updateExpenseDraft({ description: 'Dinner', amount: '12' });
  await controller.back();
  await controller.back();
  f.archive();
  const before = f.requests().length;
  await controller.refresh('pull');
  expect(
    f
      .requests()
      .slice(before)
      .filter((request) => request === `GET /api/groups/${groupId}`),
  ).toHaveLength(1);
  expect(f.drafts.size).toBe(1);
});
it('retains a refused draft and reports a failed Discard without signing out', async () => {
  const f = fixture();
  const controller = f.create();
  await controller.signIn('alex');
  await controller.openExpense(groupId);
  await controller.updateExpenseDraft({ description: 'Dinner', amount: '12' });
  f.revoke();
  await controller.refresh('retry');
  f.device.failRemoval = true;
  await controller.discardExpenseDraft();
  expect(f.drafts.size).toBe(1);
  expect(controller.getSnapshot()).toMatchObject({
    auth: { status: 'authenticated' },
    screen: 'expense',
    expense: { status: 'blocked', draft: { description: 'Dinner' } },
  });
  expect(controller.getSnapshot().expense.message).toContain('Could not remove');
  f.device.failRemoval = false;
  await controller.discardExpenseDraft();
  expect(f.drafts.size).toBe(0);
});

it('finishes a draft write before lost-access cleanup, so it cannot restore the removed record', async () => {
  const f = fixture();
  const controller = f.create();
  await controller.signIn('alex');
  await controller.openExpense(groupId);
  let release!: () => void, releaseGroup!: () => void;
  f.device.holdGroupRead = new Promise<void>((resolve) => {
    releaseGroup = resolve;
  });
  const before = f.requests().length;
  const reading = controller.refresh('retry');
  await vi.waitFor(() =>
    expect(f.requests().slice(before)).toContain(`GET /api/groups/${groupId}`),
  );
  f.device.holdDraftWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  const typing = controller.updateExpenseDraft({ description: 'Dinner', amount: '12' });
  f.revoke();
  releaseGroup();
  let leaving: ReturnType<typeof controller.back>;
  try {
    await vi.waitFor(() => expect(controller.getSnapshot().expense.status).toBe('blocked'));
    leaving = controller.back();
  } finally {
    release();
  }
  await Promise.all([typing, reading, leaving!]);
  expect(f.drafts.size).toBe(0);
  expect(controller.getSnapshot()).toMatchObject({
    screen: 'groups',
    auth: { status: 'authenticated' },
  });
});

it('starts a new ordinary draft after access returns without recovering or replaying the removed one', async () => {
  const f = fixture();
  const controller = f.create();
  await controller.signIn('alex');
  await controller.openExpense(groupId);
  await controller.updateExpenseDraft({ description: 'Old dinner', amount: '12' });
  f.revoke();
  await controller.refresh('retry');
  await controller.back();
  expect(f.drafts.size).toBe(0);
  f.restoreAccess();
  await controller.openGroup(groupId);
  await controller.openExpense(groupId);
  expect(controller.getSnapshot().expense).toMatchObject({
    status: 'editing',
    attempt: null,
    mutation: null,
    draft: { description: '' },
  });
  await controller.updateExpenseDraft({ description: 'New dinner', amount: '15' });
  await controller.back();
  expect(f.drafts.size).toBe(1);
  expect(f.writes()).toBe(0);
});

it('retries failed financial cleanup before restoring an offline account’s draft', async () => {
  const f = fixture();
  const controller = f.create();
  await controller.signIn('alex');
  await controller.openExpense(groupId);
  await controller.updateExpenseDraft({ description: 'Removed membership dinner', amount: '12' });
  f.revoke();
  await controller.refresh('retry');
  f.device.failRemoval = true;
  await controller.back();
  expect(f.drafts.size).toBe(1);
  controller.dispose();
  f.device.failRemoval = false;
  f.goOffline();
  const restarted = f.create();
  await restarted.restore();
  expect(f.drafts.size).toBe(0);
  expect(restarted.getSnapshot().auth.status).toBe('authenticated');
});

it('never shows a pending lost Group’s financial record when restart cleanup still fails', async () => {
  const f = fixture();
  const controller = f.create();
  await controller.signIn('alex');
  await controller.openExpense(groupId);
  await controller.updateExpenseDraft({ description: 'Removed membership dinner', amount: '12' });
  f.revoke();
  await controller.refresh('retry');
  f.device.failRemoval = true;
  await controller.back();
  controller.dispose();
  f.goOffline();
  const restarted = f.create();
  await restarted.restore();
  await restarted.openExpense(groupId);
  expect(f.drafts.size).toBe(1);
  expect(restarted.getSnapshot().expense.draft).toBeNull();
  expect(restarted.getSnapshot().expense.status).toBe('blocked');
});

it('retains a draft when the Group check returns another Group instead of a refusal', async () => {
  const f = fixture();
  const controller = f.create();
  await controller.signIn('alex');
  await controller.openExpense(groupId);
  await controller.updateExpenseDraft({ description: 'Dinner', amount: '12' });
  f.failResponse(
    `/api/groups/${groupId}`,
    200,
    JSON.stringify({ status: 200, data: { ...group, _id: 'b00000000000000000000010' } }),
  );
  await controller.refresh('retry');
  await controller.back();
  expect(f.drafts.size).toBe(1);
});

it('never publishes a pending lost draft through saved Home after a cold restart', async () => {
  const f = fixture();
  const first = f.create();
  await first.signIn('alex');
  await first.openExpense(groupId);
  await first.updateExpenseDraft({ description: 'Must remain hidden', amount: '12' });
  f.revoke();
  await first.refresh('retry');
  f.device.failRemoval = true;
  await first.back();
  f.restoreAccess();
  await first.openGroup(groupId);
  await first.back();
  expect(first.getSnapshot().drafts).toEqual([]);
  first.dispose();
  f.goOffline();
  const restarted = f.create();
  const shown: unknown[] = [];
  const unsubscribe = restarted.subscribe(() => {
    if (restarted.getSnapshot().drafts.length) shown.push(restarted.getSnapshot().drafts);
  });
  await restarted.restore();
  unsubscribe();
  expect(shown).toEqual([]);
});

it('holds new drafts until a failed cleanup journal retirement succeeds', async () => {
  const f = fixture();
  const first = f.create();
  await first.signIn('alex');
  await first.openExpense(groupId);
  await first.updateExpenseDraft({ description: 'Old draft', amount: '12' });
  f.revoke();
  await first.refresh('retry');
  f.device.failJournalClear = true;
  await first.back();
  expect(f.drafts.size).toBe(0);
  f.restoreAccess();
  await first.openGroup(groupId);
  await first.openExpense(groupId);
  expect(first.getSnapshot().expense.status).toBe('blocked');
  await first.updateExpenseDraft({ description: 'New draft', amount: '15' });
  expect(f.drafts.size).toBe(0);
  first.dispose();
  f.device.failJournalClear = false;
  const restarted = f.create();
  await restarted.restore();
  await restarted.openExpense(groupId);
  await restarted.updateExpenseDraft({ description: 'New draft', amount: '15' });
  expect(f.drafts.size).toBe(1);
});

it('finishes access-loss cleanup after the blocked form’s process is killed without Back', async () => {
  const f = fixture();
  const first = f.create();
  await first.signIn('alex');
  await first.openExpense(groupId);
  await first.updateExpenseDraft({ description: 'Lost Group draft', amount: '12' });
  f.revoke();
  await first.refresh('retry');
  expect(f.drafts.size).toBe(1);
  first.dispose();
  f.goOffline();
  const restarted = f.create();
  await restarted.restore();
  expect(f.drafts.size).toBe(0);
  expect(restarted.getSnapshot().auth.status).toBe('authenticated');
});

it('keeps another Group’s form unchanged if background loss recording fails', async () => {
  const otherId = 'b00000000000000000000009';
  const f = fixture({ extraGroups: [{ ...group, _id: otherId }] });
  const controller = f.create();
  await controller.signIn('alex');
  let release!: () => void;
  f.device.holdGroupRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = f.requests().length;
  const opening = controller.openGroup(groupId);
  await vi.waitFor(() =>
    expect(f.requests().slice(before)).toContain(`GET /api/groups/${groupId}`),
  );
  await controller.openExpense(otherId);
  await controller.updateExpenseDraft({ description: 'Other Group dinner', amount: '12' });
  f.device.failJournalSave = true;
  f.revoke();
  release();
  await opening;
  expect(controller.getSnapshot()).toMatchObject({
    screen: 'expense',
    expense: {
      groupId: otherId,
      status: 'editing',
      message: null,
      draft: { description: 'Other Group dinner' },
    },
  });
});
