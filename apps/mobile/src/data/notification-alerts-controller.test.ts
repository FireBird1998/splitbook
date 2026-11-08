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
  it('in the background on the affected Group, the alert shows: a quiet refresh is for a visible app (#968)', async () => {
    const controller = setup();
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    expect(await controller.receiveNotification(hint(), { visible: false })).toBe(true);
    // Its route is untouched: nothing navigates while the member isn't looking.
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', destination: 'activity' });
  });
  it("drops another account's envelope after a sign-out whose revoke failed and another sign-in (#968)", async () => {
    const sam = {
      id: 'a00000000000000000000002',
      name: 'Sam',
      email: 'sam@example.test',
      image: null,
    };
    let account = user;
    const controller = setup((url, init) => {
      if (url.pathname.endsWith('/sign-out'))
        return Promise.reject(new TypeError('Network request failed'));
      if (url.pathname.endsWith('/sign-in')) {
        account = String(init.body).includes('sam') ? sam : user;
        return new Response(JSON.stringify({ user: account }), {
          headers: {
            'Set-Cookie': `better-auth.session_token=${account.name}.signature; Max-Age=2592000`,
          },
        });
      }
      if (url.pathname.endsWith('/get-session'))
        return json({
          user: account,
          session: { userId: account.id, expiresAt: '2030-01-01T00:00:00Z' },
        });
    });
    await controller.signIn('alex');
    await controller.signOut();
    expect(controller.getSnapshot().auth.status).toBe('sign-out-unconfirmed');
    await controller.signIn('sam');
    expect(controller.getSnapshot().auth).toMatchObject({ status: 'authenticated', user: sam });
    const screen = controller.getSnapshot().screen;
    // Alex's session outlived the failed revoke, so Alex's alerts still reach this phone.
    expect(await controller.receiveNotification(hint())).toBe(false);
    expect(await controller.receiveNotification(hint(), { visible: false })).toBe(false);
    await controller.tapNotification(hint());
    expect(controller.getSnapshot().screen).toBe(screen);
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
  it('signals a protected hold once, consumes feedback without dropping the update, and dismisses explicitly', async () => {
    const controller = setup();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Still typing', amount: '12.34' });
    const form = controller.getSnapshot().expense;
    await controller.tapNotification(hint());
    const owner = controller.getSnapshot().heldNotification;
    expect(owner).toBeTruthy();
    expect(controller.getSnapshot().heldNotificationNotice).toBe(owner);
    controller.consumeHeldNotificationNotice(owner!);
    expect(controller.getSnapshot().heldNotificationNotice).toBeNull();
    await controller.tapNotification(hint({ eventId: 'd00000000000000000000002' }));
    expect(controller.getSnapshot().heldNotificationNotice).toBeNull();
    expect(controller.getSnapshot().expense).toBe(form);
    controller.dismissPendingNotification(owner!);
    expect(controller.getSnapshot().notificationOpening.status).toBe('idle');
    expect(controller.getSnapshot().heldNotification).toBeNull();
    await controller.closeExpense();
    const screen = controller.getSnapshot().screen;
    await controller.openPendingNotification();
    expect(controller.getSnapshot().screen).toBe(screen);
  });
  it('acknowledges the first protected tap even when an earlier open failed', async () => {
    let fail = true;
    const controller = setup((url) =>
      fail && url.pathname === '/api/groups/' + groupId
        ? json({ error: 'Unavailable' }, 500)
        : undefined,
    );
    await controller.signIn('alex');
    await controller.tapNotification(hint());
    expect(controller.getSnapshot().notificationOpening.status).toBe('error');
    expect(controller.getSnapshot().heldNotificationNotice).toBeNull();
    fail = false;
    controller.startCreate();
    await controller.tapNotification(hint());
    expect(controller.getSnapshot().heldNotificationNotice).toBe(
      controller.getSnapshot().heldNotification,
    );
    expect(controller.getSnapshot().heldNotificationNotice).not.toBeNull();
  });
  it('ignores a stale hold owner, including after signing into a new session', async () => {
    const controller = setup();
    await controller.signIn('alex');
    controller.startCreate();
    await controller.tapNotification(hint());
    const old = controller.getSnapshot().heldNotification!;
    expect(old).toBeTruthy();
    controller.dismissPendingNotification(old);
    await controller.tapNotification(hint());
    const next = controller.getSnapshot().heldNotification;
    controller.dismissPendingNotification({ ...next!, accountId: 'another-account' });
    controller.dismissPendingNotification(old);
    controller.consumeHeldNotificationNotice(old);
    expect(controller.getSnapshot().heldNotificationNotice).toBe(next);
    expect(controller.getSnapshot().notificationOpening.status).toBe('held');
    await controller.signOut();
    expect(controller.getSnapshot().heldNotificationNotice).toBeNull();
    await controller.signIn('alex');
    controller.startCreate();
    await controller.tapNotification(hint());
    controller.dismissPendingNotification(old);
    expect(controller.getSnapshot().notificationOpening.status).toBe('held');
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
      const notice = controller.getSnapshot().heldNotificationNotice;
      expect(notice).toBeTruthy();
      controller.consumeHeldNotificationNotice(notice!);
      expect(controller.getSnapshot().heldNotificationNotice).toBeNull();
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

describe('Expense updated and deleted alerts at the Android controller seam (#841)', () => {
  const kinds = ['expense_updated', 'expense_deleted'] as const;
  it.each(kinds)(
    '%s: quietly refreshes the open Group, suppresses a replay and never writes',
    async (kind) => {
      const writes: string[] = [];
      const controller = setup((url, init) => {
        if (init.method && init.method !== 'GET' && !url.pathname.includes('auth'))
          writes.push(url.pathname);
      });
      await controller.signIn('alex');
      await controller.openActivity(groupId);
      const before = controller.getSnapshot().activity;
      expect(await controller.receiveNotification(hint({ kind }))).toBe(false);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'group',
        destination: 'activity',
        activity: { status: 'ready' },
      });
      expect(controller.getSnapshot().activity).not.toBe(before);
      // FCM can redeliver: the same event is handled once.
      expect(await controller.receiveNotification(hint({ kind }), { visible: false })).toBe(false);
      expect(writes).toEqual([]);
    },
  );
  it.each(kinds)('%s: elsewhere or in the background, the alert may show', async (kind) => {
    const controller = setup();
    await controller.signIn('alex');
    expect(await controller.receiveNotification(hint({ kind }))).toBe(true);
    await controller.openActivity(groupId);
    expect(
      await controller.receiveNotification(hint({ kind, eventId: 'd00000000000000000000002' }), {
        visible: false,
      }),
    ).toBe(true);
  });
  it('a deleted Expense alert opens the current authorized Group history, never the missing record, and writes nothing', async () => {
    const requests: string[] = [];
    const writes: string[] = [];
    const deleted = {
      ...event,
      _id: 'd00000000000000000000003',
      type: 'expense_deleted',
      metadata: { expenseId, description: 'Dinner' },
    };
    const controller = setup((url, init) => {
      requests.push(url.pathname);
      if (init.method && init.method !== 'GET' && !url.pathname.includes('auth'))
        writes.push(url.pathname);
      if (url.pathname.includes('/expenses/' + expenseId)) return json({ error: 'Gone' }, 404);
      if (url.pathname.endsWith('/activity')) return json(page([deleted, event]));
    });
    await controller.signIn('alex');
    await controller.tapNotification(hint({ kind: 'expense_deleted' }));
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      activity: { status: 'ready' },
      notificationOpening: { status: 'idle' },
    });
    expect(controller.getSnapshot().activity.events.map((row) => row._id)).toContain(deleted._id);
    expect(requests).toContain('/api/groups/' + groupId);
    expect(requests.some((path) => path.includes('/expenses/' + expenseId))).toBe(false);
    expect(controller.getSnapshot().expense.status).not.toBe('editing');
    expect(writes).toEqual([]);
  });
  it.each(kinds)(
    '%s: an unfinished Expense keeps its contents and the tap waits for an explicit open',
    async (kind) => {
      const controller = setup();
      await controller.signIn('alex');
      await controller.openActivity(groupId);
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ description: 'Unfinished member task', amount: '5' });
      const draft = structuredClone(controller.getSnapshot().expense.draft);
      expect(await controller.receiveNotification(hint({ kind }))).toBe(true);
      await controller.tapNotification(hint({ kind }));
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'expense',
        expense: { draft },
        notificationOpening: { status: 'held' },
      });
      await controller.closeExpense();
      await controller.openPendingNotification();
      expect(controller.getSnapshot()).toMatchObject({
        destination: 'activity',
        notificationOpening: { status: 'idle' },
      });
    },
  );
  it.each(kinds)(
    '%s: after removal from the Group a tap shows the unavailable state, not its contents',
    async (kind) => {
      let removed = false;
      const controller = setup((url) =>
        removed && url.pathname === '/api/groups/' + groupId
          ? json({ error: 'Forbidden' }, 403)
          : undefined,
      );
      await controller.signIn('alex');
      await controller.openActivity(groupId);
      removed = true;
      await controller.tapNotification(hint({ kind }));
      expect(controller.getSnapshot().detail.status).toBe('denied');
      expect(controller.getSnapshot().activity.events).toHaveLength(0);
    },
  );
});

describe('Payment alerts at the Android controller seam (#842)', () => {
  const settlementId = 'c00000000000000000000009';
  const payment = (extra = {}) =>
    hint({ kind: 'settlement_recorded', recordId: settlementId, ...extra });
  /** This phone's confirmed controls with one category switched, as the device read answers. */
  const controls = (switches: { expenseUpdates?: boolean; payments?: boolean }) => (url: URL) =>
    url.pathname === '/api/notifications/device'
      ? json({
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
            ...switches,
          },
        })
      : undefined;
  it('quietly refreshes the open Group, suppresses a replay and never records a payment', async () => {
    const writes: string[] = [];
    const controller = setup((url, init) => {
      if (init.method && init.method !== 'GET' && !url.pathname.includes('auth'))
        writes.push(url.pathname);
    });
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    const before = controller.getSnapshot().activity;
    expect(await controller.receiveNotification(payment())).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      activity: { status: 'ready' },
    });
    expect(controller.getSnapshot().activity).not.toBe(before);
    expect(await controller.receiveNotification(payment(), { visible: false })).toBe(false);
    expect(writes).toEqual([]);
  });
  it('elsewhere or in the background the alert may show; a warm tap opens Group Activity with no Settlement read or write', async () => {
    const requests: string[] = [];
    const writes: string[] = [];
    const controller = setup((url, init) => {
      requests.push(url.pathname);
      if (init.method && init.method !== 'GET' && !url.pathname.includes('auth'))
        writes.push(url.pathname);
    });
    await controller.signIn('alex');
    expect(await controller.receiveNotification(payment())).toBe(true);
    await controller.tapNotification(payment());
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      activity: { status: 'ready' },
      notificationOpening: { status: 'idle' },
      settlement: { status: 'idle' },
    });
    expect(requests).toContain('/api/groups/' + groupId);
    expect(requests.some((path) => path.includes(settlementId))).toBe(false);
    expect(writes).toEqual([]);
    await controller.openActivity(groupId);
    expect(
      await controller.receiveNotification(payment({ eventId: 'd00000000000000000000009' }), {
        visible: false,
      }),
    ).toBe(true);
  });
  it('Payments off with Expense updates on: a Payment alert neither shows nor opens; an Expense alert still does', async () => {
    const controller = setup(controls({ expenseUpdates: true, payments: false }));
    await controller.signIn('alex');
    expect(await controller.receiveNotification(payment())).toBe(false);
    await controller.tapNotification(payment());
    expect(controller.getSnapshot().screen).not.toBe('group');
    expect(
      await controller.receiveNotification(hint({ eventId: 'd00000000000000000000008' })),
    ).toBe(true);
  });
  it('Expense updates off with Payments on: an Expense alert neither shows nor opens; a Payment alert still does', async () => {
    const controller = setup(controls({ expenseUpdates: false, payments: true }));
    await controller.signIn('alex');
    expect(await controller.receiveNotification(hint())).toBe(false);
    await controller.tapNotification(hint());
    expect(controller.getSnapshot().screen).not.toBe('group');
    expect(
      await controller.receiveNotification(payment({ eventId: 'd00000000000000000000008' })),
    ).toBe(true);
    await controller.tapNotification(payment({ eventId: 'd00000000000000000000008' }));
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', destination: 'activity' });
  });
  it('an unfinished Expense keeps its contents and a Payment tap waits for an explicit open', async () => {
    const controller = setup();
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Unfinished member task', amount: '5' });
    const draft = structuredClone(controller.getSnapshot().expense.draft);
    expect(await controller.receiveNotification(payment())).toBe(true);
    await controller.tapNotification(payment());
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: { draft },
      notificationOpening: { status: 'held' },
    });
    await controller.closeExpense();
    await controller.openPendingNotification();
    expect(controller.getSnapshot()).toMatchObject({
      destination: 'activity',
      notificationOpening: { status: 'idle' },
    });
  });
  it('after removal from the Group a Payment tap shows the unavailable state, not its contents', async () => {
    let removed = false;
    const controller = setup((url) =>
      removed && url.pathname === '/api/groups/' + groupId
        ? json({ error: 'Forbidden' }, 403)
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    removed = true;
    await controller.tapNotification(payment());
    expect(controller.getSnapshot().detail.status).toBe('denied');
    expect(controller.getSnapshot().activity.events).toHaveLength(0);
  });
  it('a cold tap waits for sign-in to restore, then opens the same Group Activity', async () => {
    const controller = setup();
    // Before sign-in is confirmed the tap reveals nothing and is not consumed.
    await controller.tapNotification(payment());
    expect(controller.getSnapshot().screen).not.toBe('group');
    await controller.signIn('alex');
    await controller.tapNotification(payment());
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', destination: 'activity' });
  });
});

describe('recovered alerts, delivered hours after their change, at the Android controller seam (#843)', () => {
  const hour = 3_600_000;
  /** The envelope recovery sends: its own recorded time, so its 24 hours started then. */
  const recovered = (hoursAgo: number, extra: Record<string, unknown> = {}) => {
    const occurred = Date.now() - hoursAgo * hour;
    return hint({
      occurredAt: new Date(occurred).toISOString(),
      expiresAt: new Date(occurred + 24 * hour).toISOString(),
      ...extra,
    });
  };
  const kinds = [
    ['expense_added', expenseId],
    ['expense_updated', expenseId],
    ['expense_deleted', expenseId],
    ['settlement_recorded', 'c00000000000000000000009'],
  ] as const;
  it.each(kinds)(
    '%s 23 hours late: elsewhere it may show, and a warm tap opens Group Activity without writing',
    async (kind, recordId) => {
      const requests: string[] = [];
      const writes: string[] = [];
      const controller = setup((url, init) => {
        requests.push(url.pathname);
        if (init.method && init.method !== 'GET' && !url.pathname.includes('auth'))
          writes.push(url.pathname);
      });
      await controller.signIn('alex');
      const late = recovered(23, { kind, recordId });
      expect(await controller.receiveNotification(late)).toBe(true);
      await controller.tapNotification(late);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'group',
        destination: 'activity',
        activity: { status: 'ready' },
        notificationOpening: { status: 'idle' },
      });
      expect(requests.some((path) => path.includes(recordId))).toBe(false);
      expect(writes).toEqual([]);
    },
  );
  it('a late alert for the open Group refreshes it quietly, and a redelivered one is suppressed', async () => {
    const controller = setup();
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    const before = controller.getSnapshot().activity;
    const late = recovered(20);
    expect(await controller.receiveNotification(late)).toBe(false);
    expect(controller.getSnapshot().activity).not.toBe(before);
    // FCM may deliver an uncertain send's message again: no second alert.
    expect(await controller.receiveNotification(late, { visible: false })).toBe(false);
  });
  it('a cold tap on a late alert waits for sign-in, then opens the same Group Activity', async () => {
    const controller = setup();
    const late = recovered(22, { kind: 'settlement_recorded' });
    await controller.tapNotification(late);
    expect(controller.getSnapshot().screen).not.toBe('group');
    await controller.signIn('alex');
    await controller.tapNotification(late);
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', destination: 'activity' });
  });
  it('one past its 24 hours neither shows nor opens anything', async () => {
    const controller = setup();
    await controller.signIn('alex');
    const expired = recovered(24.001);
    expect(await controller.receiveNotification(expired)).toBe(false);
    await controller.tapNotification(expired);
    expect(controller.getSnapshot().screen).not.toBe('group');
  });
  it('a late alert while an Expense is unfinished keeps the form and holds the tap', async () => {
    const controller = setup();
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Unfinished member task', amount: '5' });
    const draft = structuredClone(controller.getSnapshot().expense.draft);
    const late = recovered(23, { kind: 'expense_updated' });
    expect(await controller.receiveNotification(late)).toBe(true);
    await controller.tapNotification(late);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'expense',
      expense: { draft },
      notificationOpening: { status: 'held' },
    });
  });
});

describe('one held destination for notification and widget taps', () => {
  it.each(['widget-widget', 'widget-notification', 'notification-widget'] as const)(
    'the newer %s tap replaces the earlier destination',
    async (order) => {
      const c = setup();
      await c.signIn('alex');
      await c.openExpense(groupId);
      if (order.startsWith('notification')) await c.tapNotification(hint());
      else await c.openWidget('home');
      const owner = c.getSnapshot().heldNotification!;
      c.consumeHeldNotificationNotice(owner);
      if (order.endsWith('notification')) await c.tapNotification(hint());
      else await c.openWidget({ kind: 'group', groupId });
      expect(c.getSnapshot().heldNotification).toBe(owner);
      expect(c.getSnapshot().heldNotificationNotice).toBeNull();
      await c.closeExpense();
      await c.openPendingNotification();
      expect(c.getSnapshot()).toMatchObject({
        screen: 'group',
        destination: order.endsWith('notification') ? 'activity' : 'balances',
        notificationOpening: { status: 'idle' },
      });
    },
  );
  it('Not now drops a held widget destination without opening it', async () => {
    const c = setup();
    await c.signIn('alex');
    c.startCreate();
    await c.openWidget({ kind: 'group', groupId });
    c.back();
    const owner = c.getSnapshot().heldNotification!;
    c.dismissPendingNotification(owner);
    await c.openPendingNotification();
    expect(c.getSnapshot()).toMatchObject({
      screen: 'groups',
      heldNotification: null,
      notificationOpening: { status: 'idle' },
    });
  });
  it('retains a failed widget destination for explicit retry', async () => {
    let fail = false;
    const c = setup((url) =>
      fail && url.pathname === '/api/groups/' + groupId
        ? json({ error: 'Unavailable' }, 500)
        : undefined,
    );
    await c.signIn('alex');
    c.startCreate();
    await c.openWidget({ kind: 'group', groupId });
    c.back();
    fail = true;
    await c.openPendingNotification();
    expect(c.getSnapshot().notificationOpening.status).toBe('error');
    fail = false;
    await c.openPendingNotification();
    expect(c.getSnapshot()).toMatchObject({
      destination: 'balances',
      notificationOpening: { status: 'idle' },
    });
  });
});

it('a newer widget tap after the task closes replaces and clears the old held notification', async () => {
  const c=setup();await c.signIn('alex');c.startCreate();await c.tapNotification(hint());c.back();
  await c.openWidget('home');
  expect(c.getSnapshot()).toMatchObject({screen:'groups',heldNotification:null,notificationOpening:{status:'idle'}});
});
it('a newer widget tap wins over an older notification still checking its binding', async () => {
  let block=false, entered!:()=>void, release!:()=>void;
  const arrived=new Promise<void>(r=>{entered=r}), waiting=new Promise<void>(r=>{release=r});
  const c=setup(async url=>{
    if(block && url.pathname==='/api/notifications/device'){entered();await waiting;}
    return undefined;
  });
  await c.signIn('alex');await c.openExpense(groupId);block=true;
  const older=c.tapNotification(hint());await arrived;
  await c.openWidget({kind:'group',groupId});release();await older;
  await c.closeExpense();await c.openPendingNotification();
  expect(c.getSnapshot().destination).toBe('balances');
});
it('keeps a widget destination held if a new form opens while its access is checked', async () => {
  let block=false, entered!:()=>void, release!:()=>void;
  const arrived=new Promise<void>(r=>{entered=r}), waiting=new Promise<void>(r=>{release=r});
  const c=setup(async url=>{
    if(block && url.pathname==='/api/groups/'+groupId){entered();await waiting;}
    return undefined;
  });
  await c.signIn('alex');c.startCreate();await c.openWidget({kind:'group',groupId});c.back();block=true;
  const opening=c.openPendingNotification();await arrived;c.startCreate();c.updateCreation({name:'Unfinished while checking'});const form=c.getSnapshot().creation;release();await opening;
  expect(c.getSnapshot()).toMatchObject({screen:'create',notificationOpening:{status:'held'}});expect(c.getSnapshot().creation).toBe(form);
  c.back();await c.openPendingNotification();expect(c.getSnapshot()).toMatchObject({destination:'balances',notificationOpening:{status:'idle'}});
});
