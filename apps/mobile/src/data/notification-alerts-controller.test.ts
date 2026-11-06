import { parseNotificationEnvelope } from './notification-alerts';
import { savedQueriesIn } from '../test-utils/saved-queries';
import type { SavedQueryRecords } from './saved-copy-budget';
import { describe, expect, it, vi } from 'vitest';
import { createCheckedMobileController as createMobileController } from '../test-utils/flow-monitor';
import type { FetchResponse } from './types';
const groupId = 'b00000000000000000000001';
const actor = 'a00000000000000000000001';
const expenseId = 'c00000000000000000000001';
const eventId = 'd00000000000000000000001';
const iso = '2026-09-28T12:00:00.000Z';
const user = { id: actor, name: 'Alex', email: 'alex@example.test', image: null };
const group = {
  _id: groupId,
  createdBy: actor,
  name: 'Shared home',
  category: 'home',
  defaultCurrency: 'INR',
  tags: [{ _id: 'e00000000000000000000001', name: 'Food', isArchived: false, createdAt: iso }],
  members: [{ user: { ...user, _id: actor }, role: 'admin', joinedAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const event = {
  _id: eventId,
  group: groupId,
  actor: { _id: actor, name: 'Alex' },
  type: 'expense_added',
  createdAt: iso,
  metadata: { expenseId, description: 'Dinner', amount: 12.34, currency: 'INR' },
};
const page = (events: unknown[] = [event], pageNumber = 1, total = events.length) => ({
  status: 200,
  data: {
    activities: events,
    pagination: { page: pageNumber, limit: 20, total, totalPages: Math.ceil(total / 20) },
  },
});
const json = (value: unknown, status = 200) => Response.json(value, { status });
function setup(
  intercept: (
    url: URL,
    init: RequestInit,
  ) => FetchResponse | Promise<FetchResponse | undefined> | undefined = () => undefined,
  savedQueries?: SavedQueryRecords,
) {
  let cookie: string | null = null;
  let owner: string | null = null;
  let cleanup = false;
  const records = new Map<string, unknown>();
  const drafts = {
    load: async (account: string, id: string) => records.get(account + ':' + id) ?? null,
    save: async (account: string, id: string, value: unknown) => {
      records.set(account + ':' + id, structuredClone(value));
    },
    remove: async (account: string, id: string) => {
      records.delete(account + ':' + id);
    },
    clear: async () => {
      records.clear();
    },
    keys: async () => [],
  };
  return createMobileController(
    {
      apiBaseUrl: 'http://localhost:4141',
      authOrigin: 'http://localhost:4141',
      developmentPersonaEnabled: true,
    },
    {
      savedQueries,
      expenseDrafts: drafts,
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
        stores: [drafts],
      },
      notifications: {
        installation: async () => ({
          id: '00000000-0000-4000-8000-000000000840',
          key: 'private-installation-proof-840840840',
        }),
        permission: async () => 'granted',
        requestPermission: async () => 'granted',
        token: async () => 'private-token',
        clear: async () => {},
        openSettings: async () => {},
      },
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      fetch: async (url, init) => {
        const address = new URL(url),
          path = address.pathname;
        const override = intercept(address, init);
        if (override) {
          const response = await override;
          if (response) return response;
        }
        if (path === '/api/notifications/device')
          return json({
            data: {
              available: true,
              enabled: true,
              expenseUpdates: true,
              payments: true,
              revision: 1,
              activation,
              binding,
              expenseCutoff: new Date(0).toISOString(),
              paymentCutoff: new Date(0).toISOString(),
            },
          });
        if (path.endsWith('/sign-in'))
          return new Response(JSON.stringify({ user }), {
            headers: { 'Set-Cookie': 'better-auth.session_token=alex.signature; Max-Age=2592000' },
          });
        if (path.endsWith('/get-session'))
          return json({ user, session: { userId: actor, expiresAt: '2030-01-01T00:00:00Z' } });
        if (path.endsWith('/sign-out')) return json({ success: true });
        if (path === '/api/groups') return json({ status: 200, data: [group] });
        if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
        if (path.endsWith('/user/balances')) return json({ status: 200, data: { buckets: [] } });
        if (path.endsWith('/expenses'))
          return json({
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
        if (path.endsWith('/balances'))
          return json({ data: { currency: 'INR', balances: [], debts: [], byCurrency: [] } });
        if (path.endsWith('/activity')) return json(page());
        return json({}, 404);
      },
    },
  );
}

const binding = '00000000-0000-4000-8000-000000000001';
const activation = '00000000-0000-4000-8000-000000000002';
const hint = (extra = {}) => {
  const occurred = Date.now() - 1000;
  return {
    version: 2,
    eventId,
    kind: 'expense_added',
    groupId,
    recordId: expenseId,
    accountId: actor,
    environment: 'development',
    binding,
    activation,
    occurredAt: new Date(occurred).toISOString(),
    expiresAt: new Date(occurred + 86_400_000).toISOString(),
    ...extra,
  };
};
describe('Expense notification receipt and tap at the Android controller seam', () => {
  it('quietly refreshes the affected Group, suppresses duplicate receipts and never sends a financial write', async () => {
    const writes: string[] = [];
    const controller = setup((url, init) => {
      if (init.method === 'POST' && !url.pathname.includes('auth')) writes.push(url.pathname);
    });
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    const before = controller.getSnapshot().activity;
    const envelope = hint();
    expect(await controller.receiveNotification(envelope)).toBe(false);
    expect(controller.getSnapshot().destination).toBe('activity');
    expect(controller.getSnapshot().activity.status).toBe('ready');
    expect(controller.getSnapshot().activity).not.toBe(before);
    expect(await controller.receiveNotification(envelope)).toBe(false);
    expect(writes).toEqual([]);
  });
  it('elsewhere permits only the generic preview and an authorized warm tap reads Activity without looking up the record', async () => {
    const requests: string[] = [];
    const controller = setup((url) => {
      requests.push(url.pathname);
    });
    await controller.signIn('alex');
    expect(await controller.receiveNotification(hint())).toBe(true);
    await controller.tapNotification(hint());
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      activity: { status: 'ready' },
    });
    expect(requests.some((path) => path.includes('/expenses/' + expenseId))).toBe(false);
  });
  it('bounds occurrence skew at 30 seconds and leaves expiry strict', () => {
    const time = Date.now();
    const at = (occurred: number, expires = occurred + 86_400_000) =>
      hint({
        occurredAt: new Date(occurred).toISOString(),
        expiresAt: new Date(expires).toISOString(),
      });
    expect(parseNotificationEnvelope(at(time + 30_000), time)).not.toBeNull();
    expect(parseNotificationEnvelope(at(time + 30_001), time)).toBeNull();
    expect(parseNotificationEnvelope(at(time - 86_400_000), time)).toBeNull();
    expect(parseNotificationEnvelope(at(time, time + 86_400_001), time)).toBeNull();
  });
  it('accepts small server clock skew without extending expiry or accepting distant future events', async () => {
    const controller = setup();
    await controller.signIn('alex');
    const occurred = Date.now() + 5_000;
    expect(
      await controller.receiveNotification(
        hint({
          occurredAt: new Date(occurred).toISOString(),
          expiresAt: new Date(occurred + 86_400_000).toISOString(),
        }),
      ),
    ).toBe(true);
    const future = Date.now() + 60_000;
    expect(
      await controller.receiveNotification(
        hint({
          eventId: 'd00000000000000000000002',
          occurredAt: new Date(future).toISOString(),
          expiresAt: new Date(future + 86_400_000).toISOString(),
        }),
      ),
    ).toBe(false);
    expect(
      await controller.receiveNotification(
        hint({
          occurredAt: new Date(Date.now() - 86_400_001).toISOString(),
          expiresAt: new Date(Date.now() - 1).toISOString(),
        }),
      ),
    ).toBe(false);
  });
  it.each([
    { version: 1 },
    { accountId: 'a00000000000000000000002' },
    { environment: 'production' },
    { binding: '00000000-0000-4000-8000-000000000099' },
    { expiresAt: new Date(0).toISOString() },
  ])('rejects an untrusted or retired envelope %j', async (extra) => {
    const controller = setup();
    await controller.signIn('alex');
    const before = controller.getSnapshot().screen;
    expect(await controller.receiveNotification(hint(extra))).toBe(false);
    await controller.tapNotification(hint(extra));
    expect(controller.getSnapshot().screen).toBe(before);
  });
  it('holds a tap during an unfinished Group form and opens only on explicit later action', async () => {
    const controller = setup();
    await controller.signIn('alex');
    controller.startCreate();
    const form = controller.getSnapshot().creation;
    await controller.tapNotification(hint());
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'create',
      notificationOpening: { status: 'held' },
    });
    expect(controller.getSnapshot().creation).toBe(form);
    controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
    expect(controller.getSnapshot().notificationOpening.status).toBe('held');
    await controller.openPendingNotification();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      notificationOpening: { status: 'idle' },
    });
  });
  it('preserves an unfinished Expense on receipt and holds its tap until explicit later opening', async () => {
    const writes: string[] = [];
    const controller = setup((url, init) => {
      if (init.method === 'POST' && !url.pathname.includes('auth')) writes.push(url.pathname);
    });
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    await controller.openExpense(groupId);
    expect(controller.getSnapshot().expense.status).toBe('editing');
    await controller.updateExpenseDraft({ description: 'Unfinished member task', amount: '12.34' });
    const draft = structuredClone(controller.getSnapshot().expense.draft);
    await controller.receiveNotification(hint());
    await controller.tapNotification(hint());
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: { draft },
      notificationOpening: { status: 'held' },
    });
    expect(writes).toEqual([]);
    await controller.closeExpense();
    expect(controller.getSnapshot().notificationOpening.status).toBe('held');
    await controller.openPendingNotification();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      notificationOpening: { status: 'idle' },
    });
  });
  it.each([403, 404])(
    'a tap after Group access loss (%i) clears readable Activity and uses the existing unavailable state',
    async (status) => {
      let denied = false;
      const controller = setup((url) =>
        denied && url.pathname === '/api/groups/' + groupId
          ? json({ error: 'Unavailable' }, status)
          : undefined,
      );
      await controller.signIn('alex');
      await controller.openActivity(groupId);
      expect(controller.getSnapshot().activity.events).toHaveLength(1);
      denied = true;
      await controller.tapNotification(hint());
      expect(controller.getSnapshot().detail.status).toBe(status === 403 ? 'denied' : 'error');
      expect(controller.getSnapshot().activity.events).toHaveLength(0);
      expect(controller.getSnapshot().notificationOpening.status).toBe('idle');
    },
  );
  it('a form opened while a tap checks access keeps the tap held and explicitly openable later', async () => {
    let entered!: () => void, release!: () => void;
    const checking = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = setup(async (url) => {
      if (url.pathname === '/api/groups/' + groupId) {
        entered();
        await held;
        return json({ data: group });
      }
      return undefined;
    });
    await controller.signIn('alex');
    const tap = controller.tapNotification(hint());
    await checking;
    controller.startCreate();
    release();
    await tap;
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'create',
      notificationOpening: { status: 'held' },
    });
    controller.back();
    await controller.openPendingNotification();
    expect(controller.getSnapshot().destination).toBe('activity');
  });
  it('a form opened during receipt saved-copy removal cannot be displaced by quiet refresh', async () => {
    const rows = new Map<string, unknown>();
    let blocking = false,
      entered!: () => void,
      release!: () => void;
    const removing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const copies = savedQueriesIn(rows, {
      remove: async (account, path) => {
        if (blocking) {
          entered();
          await held;
        }
        rows.delete(account + path);
      },
    });
    const controller = setup(undefined, copies);
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    await vi.waitFor(() =>
      expect(
        [...rows.keys()].some(
          (path) => path.endsWith('/activity?page=1&limit=20') || path.includes('/activity'),
        ),
      ).toBe(true),
    );
    blocking = true;
    const receipt = controller.receiveNotification(hint());
    await removing;
    controller.startCreate();
    release();
    await receipt;
    expect(controller.getSnapshot().screen).toBe('create');
  });
  it('keeps a To review overlay intact and holds a tap until the member closes it', async () => {
    vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
    try {
      const controller = setup((url) =>
        url.pathname === '/api/user/to-review'
          ? json({ status: 200, data: { total: 0, groups: [] } })
          : undefined,
      );
      await controller.signIn('alex');
      await controller.openToReview(groupId);
      expect(controller.getSnapshot().toReview.groupId).toBe(groupId);
      await controller.tapNotification(hint());
      expect(controller.getSnapshot().notificationOpening.status).toBe('held');
      expect(controller.getSnapshot().toReview.groupId).toBe(groupId);
      controller.closeToReview();
      expect(controller.getSnapshot().notificationOpening.status).toBe('held');
      await controller.openPendingNotification();
      expect(controller.getSnapshot().destination).toBe('activity');
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('failed authorized reads retain an explicit retry and sign-out clears the held destination', async () => {
    let failed = true;
    const controller = setup((url) =>
      url.pathname === '/api/groups/' + groupId && failed
        ? json({ error: 'Fictional unavailable' }, 500)
        : undefined,
    );
    await controller.signIn('alex');
    await controller.tapNotification(hint());
    expect(controller.getSnapshot().notificationOpening.status).toBe('error');
    failed = false;
    await controller.openPendingNotification();
    expect(controller.getSnapshot()).toMatchObject({
      destination: 'activity',
      notificationOpening: { status: 'idle' },
    });
    await controller.signOut();
    expect(controller.getSnapshot().notificationOpening.status).toBe('idle');
  });
});
