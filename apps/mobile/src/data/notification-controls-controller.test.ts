import { onlineManager } from '@tanstack/query-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testPhone, notificationNative } from '../test-utils/test-phone';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
const user = {
  id: 'a00000000000000000000001',
  name: 'Alex',
  email: 'alex@example.test',
  image: null,
};
const off = {
  available: true,
  enabled: false,
  expenseUpdates: false,
  payments: false,
  revision: 0,
  activation: null,
  expenseCutoff: null,
  paymentCutoff: null,
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'better-auth.session_token=fictional.signature; Path=/; HttpOnly',
    },
  });
function device(available = true) {
  let confirmed = { ...off, available };
  let fail = false;
  let unavailable = false;
  let unreachable = false;
  let hold: Promise<void> | null = null;
  let heldRead: Promise<void> | null = null;
  const writes: unknown[] = [];
  const notifications = notificationNative({
    installation: {
      id: '00000000-0000-4000-8000-000000000001',
      key: 'private-installation-proof-000000000001',
    },
    token: 'private-native-token',
  });
  const backend = fakeSplitbook();
  backend.world.people.alex = user;
  backend.world.groups = [];
  backend.auth.cookie = () => 'better-auth.session_token=fictional.signature';
  backend.reply('*', '*', async ({ url: address, init }) => {
    const url = address.href;
    if (
      ['/api/auth/demo-persona/sign-in', '/api/auth/get-session', '/api/auth/sign-out'].includes(
        address.pathname,
      )
    )
      return undefined;
    if (url.includes('/api/notifications/device')) {
      if (unreachable) throw new TypeError('Fictional offline boundary');
      if (init.method !== 'POST' && heldRead) await heldRead;
      if (init.method === 'POST') {
        writes.push(JSON.parse(String(init.body)));
        if (hold) await hold;
        if (unavailable)
          return response(
            {
              error: 'Notifications are not available yet.',
              status: 503,
              code: 'NOTIFICATIONS_UNAVAILABLE',
            },
            503,
          );
        if (fail) return response({ error: 'Failed' }, 500);
        const sent = JSON.parse(String(init.body));
        confirmed = {
          ...confirmed,
          ...sent,
          available: true,
          expenseUpdates: sent.enabled ? (sent.expenseUpdates ?? true) : false,
          payments: sent.enabled ? (sent.payments ?? true) : false,
          revision: confirmed.revision + 1,
        };
      }
      // The real server never returns the native token/proof.
      const {
        available,
        enabled,
        expenseUpdates,
        payments,
        revision,
        activation,
        expenseCutoff,
        paymentCutoff,
      } = confirmed;
      return response({
        data: {
          available,
          enabled,
          expenseUpdates,
          payments,
          revision,
          activation,
          expenseCutoff,
          paymentCutoff,
        },
      });
    }
    if (url.includes('/api/groups')) return response({ data: [] });
    return response({ data: {} });
  });
  const native = testPhone(backend, {
    origin: 'http://localhost:3000',
    parts: {
      savedQueries: undefined,
      offlineIdentity: undefined,
      pendingInvitation: undefined,
      expenseDrafts: undefined,
      settlementAttempts: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      netInfo: undefined,
      newSubmissionKey: undefined,
      accountLocal: undefined,
      notifications,
      credentials: { load: async () => null, save: async () => {}, clear: async () => {} },
    },
  });
  const controller = native.open();

  return {
    controller,
    notifications,
    writes,
    setOffline: (value: boolean) => {
      unreachable = value;
    },
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
    setFailure: (value: boolean) => {
      fail = value;
    },
    holdRead: (value: Promise<void>) => {
      heldRead = value;
    },
    hold: (value: Promise<void>) => {
      hold = value;
    },
  };
}
describe('Settings notification controls at the controller/native seam', () => {
  it('starts off and never asks permission on launch or Settings read', async () => {
    const { controller, notifications } = device();
    await controller.signIn('alex');
    controller.openSettings();
    await controller.refreshNotifications();
    expect(notifications.requestPermission).not.toHaveBeenCalled();
    expect(controller.getSnapshot().notifications.confirmed.enabled).toBe(false);
  });
  it.each([true, false])(
    'distinguishes cold offline from confirmed off (available=%s) and resets on sign-out',
    async (available) => {
      const { controller, setOffline } = device(available);
      await controller.signIn('alex');
      expect(controller.getSnapshot().notifications.hasConfirmed).toBe(false);
      setOffline(true);
      await controller.refreshNotifications();
      expect(controller.getSnapshot().notifications).toMatchObject({
        status: 'offline',
        hasConfirmed: false,
      });
      setOffline(false);
      await controller.refreshNotifications();
      expect(controller.getSnapshot().notifications).toMatchObject({
        status: 'ready',
        hasConfirmed: true,
        confirmed: { ...off, available },
      });
      setOffline(true);
      await controller.refreshNotifications();
      expect(controller.getSnapshot().notifications).toMatchObject({
        status: 'offline',
        hasConfirmed: true,
        confirmed: { ...off, available },
      });
      await controller.signOut();
      expect(controller.getSnapshot().notifications.hasConfirmed).toBe(false);
    },
  );
  it('explicit enable waits for backend confirmation, keeps tokens private and switches categories independently', async () => {
    const { controller, notifications, writes, hold } = device();
    await controller.signIn('alex');
    let release!: () => void;
    hold(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const enabling = controller.enableNotifications();
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(controller.getSnapshot().notifications.status).toBe('pending');
    expect(controller.getSnapshot().notifications.confirmed.enabled).toBe(false);
    release();
    await enabling;
    expect(controller.getSnapshot().notifications.hasConfirmed).toBe(true);
    expect(notifications.requestPermission).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().notifications.confirmed.enabled).toBe(true);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('private-native-token');
    await controller.setNotificationCategory('expenseUpdates', false);
    expect(controller.getSnapshot().notifications.confirmed).toMatchObject({
      expenseUpdates: false,
      payments: true,
    });
    expect(writes).toHaveLength(2);
  });
  it('denial never registers a token and offers Android settings', async () => {
    const { controller, notifications, writes } = device();
    notifications.requestPermission.mockResolvedValueOnce('denied' as never);
    await controller.signIn('alex');
    await controller.enableNotifications();
    expect(controller.getSnapshot().notifications.status).toBe('denied');
    expect(writes).toHaveLength(0);
    await controller.openNotificationSettings();
    expect(notifications.openSettings).toHaveBeenCalledOnce();
  });
  it('backend refusal is distinguishable and Retry confirms the intended preference only after acknowledgement', async () => {
    const { controller, setFailure } = device();
    await controller.signIn('alex');
    setFailure(true);
    await controller.enableNotifications();
    expect(controller.getSnapshot().notifications.status).toBe('error');
    expect(controller.getSnapshot().notifications.confirmed.enabled).toBe(false);
    setFailure(false);
    await controller.retryNotifications();
    expect(controller.getSnapshot().notifications.confirmed.enabled).toBe(true);
  });
  it('keeps confirmed settings and the offline message when notifications are unavailable', async () => {
    const { controller, setUnavailable } = device();
    await controller.signIn('alex');
    await controller.refreshNotifications();
    setUnavailable(true);
    await controller.enableNotifications();
    expect(controller.getSnapshot().notifications).toMatchObject({
      status: 'offline',
      message: 'Connect to confirm notification settings.',
      hasConfirmed: true,
      confirmed: off,
    });
  });
  it('keeps notification retry and monitored transitions local to Settings', async () => {
    const { controller, notifications, writes, setUnavailable } = device();
    await controller.signIn('alex');
    const statuses: string[] = [];
    const unsubscribe = controller.subscribe(() => {
      const status = controller.getSnapshot().notifications.status;
      if (statuses.at(-1) !== status) statuses.push(status);
    });
    setUnavailable(true);
    await controller.enableNotifications();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated' },
      offline: { active: false },
      notifications: { hasConfirmed: false, confirmed: { enabled: false } },
    });
    expect(writes).toHaveLength(1);
    setUnavailable(false);
    await controller.retryNotifications();
    unsubscribe();
    expect(statuses).toEqual(['pending', 'offline', 'loading', 'ready', 'pending', 'ready']);
    expect(controller.getSnapshot().notifications).toMatchObject({
      status: 'ready',
      hasConfirmed: true,
      confirmed: { enabled: true },
    });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(notifications.requestPermission).toHaveBeenCalledOnce();
  });
  it('sign-out clears native state and a late token or reply cannot restore previous account settings', async () => {
    const { controller, notifications, writes, hold } = device();
    await controller.signIn('alex');
    let release!: () => void;
    hold(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const enabling = controller.enableNotifications();
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await controller.signOut();
    release();
    await enabling;
    expect(notifications.clear).toHaveBeenCalled();
    expect(controller.getSnapshot().notifications.confirmed.enabled).toBe(false);
    expect(controller.getSnapshot().auth.user).toBeNull();
  });

  it('distinguishes an offline update from a backend refusal without displaying unconfirmed preferences', async () => {
    const { controller, setOffline } = device();
    await controller.signIn('alex');
    setOffline(true);
    await controller.enableNotifications();
    expect(controller.getSnapshot().notifications.status).toBe('offline');
    expect(controller.getSnapshot().notifications.confirmed.enabled).toBe(false);
    await controller.retryNotifications();
    expect(controller.getSnapshot().notifications.status).toBe('offline');
    setOffline(false);
    await controller.retryNotifications();
    expect(controller.getSnapshot().notifications.confirmed.enabled).toBe(true);
  });
  it('shows current Android OS blocking without another permission request', async () => {
    const { controller, notifications } = device();
    await controller.signIn('alex');
    await controller.enableNotifications();
    vi.spyOn(notifications, 'permission').mockResolvedValueOnce('blocked' as never);
    await controller.refreshNotifications();
    expect(controller.getSnapshot().notifications.status).toBe('blocked');
    expect(controller.getSnapshot().notifications.confirmed.enabled).toBe(true);
    expect(controller.getSnapshot().notifications.hasConfirmed).toBe(true);
    expect(notifications.requestPermission).toHaveBeenCalledOnce();
  });
  it.each([
    ['blocked', 'granted', 'ready'],
    ['granted', 'blocked', 'blocked'],
  ] as const)(
    'keeps the notification flow declared when Settings resumes after %s → %s (#1128)',
    async (initial, next, status) => {
      const { controller, notifications, writes } = device();
      await controller.signIn('alex');
      await controller.enableNotifications();
      notifications.permission.mockResolvedValue(initial);
      controller.openSettings();
      await controller.refreshNotifications();
      expect(controller.getSnapshot().notifications.status).toBe(
        initial === 'granted' ? 'ready' : 'blocked',
      );
      const confirmed = structuredClone(controller.getSnapshot().notifications.confirmed);
      const writesBeforeResume = writes.length;
      for (const method of ['permission', 'requestPermission', 'token', 'clear'] as const)
        notifications[method].mockClear();
      notifications.permission.mockResolvedValue(next);
      await controller.refresh('foreground');
      expect(controller.getSnapshot().notifications).toMatchObject({ status, confirmed });
      expect(notifications.permission).toHaveBeenCalledOnce();
      expect(notifications.requestPermission).not.toHaveBeenCalled();
      expect(notifications.token).not.toHaveBeenCalled();
      expect(notifications.clear).not.toHaveBeenCalled();
      expect(writes).toHaveLength(writesBeforeResume);
    },
  );
  it('drops a native token that arrives after account invalidation without uploading it', async () => {
    const { controller, notifications, writes } = device();
    await controller.signIn('alex');
    let release!: (value: string) => void;
    vi.spyOn(notifications, 'token').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const enabling = controller.enableNotifications();
    await vi.waitFor(() => expect(notifications.token).toHaveBeenCalled());
    await controller.signOut();
    release('private-late-native-token');
    await enabling;
    expect(writes).toHaveLength(0);
    expect(controller.getSnapshot().notifications.confirmed.enabled).toBe(false);
  });

  it('confirms category preferences while Android blocks display without registering another token', async () => {
    const { controller, notifications, writes } = device();
    await controller.signIn('alex');
    await controller.enableNotifications();
    vi.spyOn(notifications, 'permission').mockResolvedValueOnce('blocked' as never);
    await controller.setNotificationCategory('payments', false);
    expect(controller.getSnapshot().notifications.confirmed.payments).toBe(false);
    expect(controller.getSnapshot().notifications.status).toBe('blocked');
    expect(writes).toHaveLength(2);
    expect(writes[1]).not.toHaveProperty('token');
  });

  it('never carries an in-flight Retry intent into a replacement account session', async () => {
    const { controller, setFailure, writes, holdRead } = device();
    await controller.signIn('alex');
    setFailure(true);
    await controller.enableNotifications();
    setFailure(false);
    let release!: () => void;
    holdRead(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const retry = controller.retryNotifications();
    await vi.waitFor(() => expect(controller.getSnapshot().notifications.status).toBe('loading'));
    await controller.signOut();
    await controller.signIn('alex');
    release();
    await retry;
    expect(writes).toHaveLength(1);
    expect(controller.getSnapshot().notifications.confirmed.enabled).toBe(false);
  });

  it('waits for previous native alert cleanup before registering a replacement session', async () => {
    const { controller, notifications, writes } = device();
    await controller.signIn('alex');
    await controller.enableNotifications();
    let release!: () => void;
    notifications.clear.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await controller.signIn('alex');
    const enabling = controller.enableNotifications();
    await vi.waitFor(() => expect(controller.getSnapshot().notifications.status).toBe('pending'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes).toHaveLength(1);
    release();
    await enabling;
    expect(writes).toHaveLength(2);
  });
});

describe('notification controls flow table (#839)', () => {
  afterEach(() => onlineManager.setOnline(true));
  // The flow monitor fails the test after it on any transition the table doesn't declare.
  it.each(['denied', 'blocked', 'error'] as const)(
    'a change made offline from %s says it needs a connection',
    async (from) => {
      const { controller, notifications, setFailure } = device();
      await controller.signIn('alex');
      if (from === 'error') setFailure(true);
      else notifications.requestPermission.mockResolvedValueOnce(from as never);
      await controller.enableNotifications();
      expect(controller.getSnapshot().notifications.status).toBe(from);
      onlineManager.setOnline(false);
      await controller.enableNotifications();
      expect(controller.getSnapshot().notifications.status).toBe('offline');
    },
  );
});
