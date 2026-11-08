import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationNative } from './notifications-native';
import { attachNotificationCallbacks } from './notification-callbacks';
import { notificationTaskName, receiveNotificationTask } from './notification-task';
import { checkNotificationWithoutApp, type NotificationAccess } from './data/notification-receipt';
import type { StoredSession } from './data/cookies';
import type { MobileSnapshot } from './data/types';
const native = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
  setNotificationChannelAsync: vi.fn(async () => {}),
  getDevicePushTokenAsync: vi.fn(async () => ({ type: 'android', data: 'private-fcm-token' })),
  dismissAllNotificationsAsync: vi.fn(async () => {}),
  cancelAllScheduledNotificationsAsync: vi.fn(async () => {}),
  AndroidImportance: { DEFAULT: 3 },
  DEFAULT_ACTION_IDENTIFIER: 'default',
  setNotificationHandler: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn((listener: (response: unknown) => void) => {
    void listener;
    return { remove: vi.fn() };
  }),
  getLastNotificationResponseAsync: vi.fn(async (): Promise<unknown> => null),
  clearLastNotificationResponseAsync: vi.fn(async () => {}),
  registerTaskAsync: vi.fn(async () => null),
  addPushTokenListener: vi.fn((listener: (token: { type: string; data: unknown }) => void) => {
    void listener;
    return { remove: vi.fn() };
  }),
}));
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-notifications', () => native);
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => storage.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    storage.set(key, value);
  },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
});
describe('Expo Android notification boundary', () => {
  it('never prompts or obtains tokens when constructed, and requests permission only from explicit enable', async () => {
    const phone = createNotificationNative('https://staging.example.test');
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(await phone.permission()).toBe('denied');
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(await phone.requestPermission()).toBe('granted');
    expect(native.setNotificationChannelAsync).toHaveBeenCalledOnce();
    expect(native.requestPermissionsAsync).toHaveBeenCalledOnce();
    expect(await phone.token()).toBe('private-fcm-token');
    expect(JSON.stringify([...storage.values()])).not.toContain('private-fcm-token');
  });
  it('keeps installation identity separate by environment and clears both displayed and scheduled alerts', async () => {
    const first = createNotificationNative('https://staging.example.test');
    const original = await first.installation();
    expect(await createNotificationNative('https://staging.example.test').installation()).toEqual(
      original,
    );
    expect(await createNotificationNative('https://other.example.test').installation()).not.toEqual(
      original,
    );
    await first.clear();
    expect(native.dismissAllNotificationsAsync).toHaveBeenCalledOnce();
    expect(native.cancelAllScheduledNotificationsAsync).toHaveBeenCalledOnce();
    expect(await first.installation()).toEqual(original);
  });
  it('forwards each new Android token to the listener only until it stops listening (#844)', async () => {
    const tokens: string[] = [];
    const stop = createNotificationNative('https://staging.example.test').onToken!((token) =>
      tokens.push(token),
    );
    await vi.waitFor(() => expect(native.addPushTokenListener).toHaveBeenCalledOnce());
    const listener = native.addPushTokenListener.mock.calls[0][0];
    listener({ type: 'android', data: 'private-fcm-token-2' });
    listener({ type: 'ios', data: 'not-for-android' });
    listener({ type: 'android', data: 42 });
    expect(tokens).toEqual(['private-fcm-token-2']);
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
    stop();
    expect(native.addPushTokenListener.mock.results[0].value.remove).toHaveBeenCalledOnce();
    expect(JSON.stringify([...storage.values()])).not.toContain('private-fcm-token');
  });
  it('stopping before the native module loads never starts listening (#844)', async () => {
    createNotificationNative('https://staging.example.test').onToken!(() => {})();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(native.addPushTokenListener).not.toHaveBeenCalled();
  });
  it('reports Android OS blocking separately from a permission denial', async () => {
    native.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false });
    expect(await createNotificationNative('https://staging.example.test').permission()).toBe(
      'blocked',
    );
  });
});

describe('Expo notification receipt and warm/cold response boundary', () => {
  const notification = {
    request: {
      identifier: 'fictional-event',
      content: { data: { version: 2, eventId: 'fictional' } },
    },
  };
  it('presents only the generic alert the notification task posted, quietly, and never a push itself (#968)', async () => {
    const controller = {
      receiveNotification: vi.fn(async () => true),
      tapNotification: vi.fn(async () => {}),
      getSnapshot: () => ({ auth: { status: 'authenticated' } }),
    };
    const stop = await attachNotificationCallbacks(controller, Promise.resolve());
    const handler = native.setNotificationHandler.mock.calls[0][0];
    const posted = {
      request: {
        identifier: 'expense-added:d00000000000000000000001',
        content: notification.request.content,
        trigger: { type: 'channel', channelId: 'ledger-updates' },
      },
    };
    expect(await handler.handleNotification(posted)).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
    // A message with a notification block reaches this handler unchecked: it never shows.
    const pushed = {
      request: { ...notification.request, trigger: { type: 'push', remoteMessage: {} } },
    };
    expect(await handler.handleNotification(pushed)).toMatchObject({
      shouldShowBanner: false,
      shouldShowList: false,
    });
    expect(
      await handler.handleNotification({
        request: {
          ...posted.request,
          identifier: 'expense-added:x',
          trigger: pushed.request.trigger,
        },
      }),
    ).toMatchObject({ shouldShowBanner: false });
    expect(controller.receiveNotification).not.toHaveBeenCalled();
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
    stop();
  });
  it('registers the notification task and lends it the controller until teardown (#968)', async () => {
    const controller = {
      receiveNotification: vi.fn(async () => false),
      tapNotification: vi.fn(async () => {}),
      getSnapshot: () => ({ auth: { status: 'authenticated' } }),
    };
    const stop = await attachNotificationCallbacks(controller, Promise.resolve());
    expect(native.registerTaskAsync).toHaveBeenCalledWith(notificationTaskName);
    const occurred = Date.now() - 1_000;
    const envelope = {
      version: 2,
      kind: 'expense_added',
      eventId: 'd00000000000000000000001',
      groupId: 'b00000000000000000000001',
      recordId: 'c00000000000000000000001',
      accountId: 'a00000000000000000000001',
      environment: 'development',
      binding: '00000000-0000-4000-8000-000000000001',
      activation: '00000000-0000-4000-8000-000000000002',
      occurredAt: new Date(occurred).toISOString(),
      expiresAt: new Date(occurred + 86_400_000).toISOString(),
    };
    const payload = { data: { body: JSON.stringify(envelope) }, notification: null };
    const d = {
      now: Date.now,
      visible: () => false,
      withoutApp: vi.fn(async () => null),
      present: vi.fn(async () => {}),
    };
    await receiveNotificationTask(payload, d);
    expect(controller.receiveNotification).toHaveBeenCalledWith(payload.data, { visible: false });
    expect(d.withoutApp).not.toHaveBeenCalled();
    stop();
    await receiveNotificationTask(payload, d);
    expect(controller.receiveNotification).toHaveBeenCalledOnce();
    expect(d.withoutApp).toHaveBeenCalledOnce();
  });
  describe('a mounted app that is not signed in yet (#968)', () => {
    const occurred = Date.now() - 1_000;
    const alex = 'a00000000000000000000001';
    const binding = '00000000-0000-4000-8000-000000000001';
    const activation = '00000000-0000-4000-8000-000000000002';
    const payload = {
      data: {
        body: JSON.stringify({
          version: 2,
          kind: 'expense_added',
          eventId: 'd00000000000000000000001',
          groupId: 'b00000000000000000000001',
          recordId: 'c00000000000000000000001',
          accountId: alex,
          environment: 'development',
          binding,
          activation,
          occurredAt: new Date(occurred).toISOString(),
          expiresAt: new Date(occurred + 86_400_000).toISOString(),
        }),
      },
      notification: null,
    };
    // This phone's saved records, as the no-app check reads them.
    const access = (session: StoredSession | null): NotificationAccess => ({
      environment: 'development',
      leaving: async () => false,
      session: async () => session,
      installation: async () => ({
        id: '00000000-0000-4000-8000-000000000968',
        key: 'private-installation-proof-968968968',
      }),
      controls: async () => ({
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
      }),
    });
    const receive = async (
      status: MobileSnapshot['auth']['status'],
      session: StoredSession | null,
    ) => {
      // As the controller answers before its sign-in is confirmed: never show.
      const controller = {
        receiveNotification: vi.fn(async () => false),
        tapNotification: vi.fn(async () => {}),
        getSnapshot: () => ({ auth: { status } }),
      };
      const stop = await attachNotificationCallbacks(controller, Promise.resolve());
      const d = {
        now: Date.now,
        visible: () => false,
        withoutApp: vi.fn((value: unknown) =>
          checkNotificationWithoutApp(value, access(session), Date.now),
        ),
        present: vi.fn(async () => {}),
      };
      const shown = await receiveNotificationTask(payload, d);
      stop();
      return { shown, controller, d };
    };

    it('restoring in the background with a valid saved session: the no-app check shows one alert', async () => {
      const { shown, controller, d } = await receive('restoring', {
        cookie: 'better-auth.session_token=alex.signature',
        accountId: alex,
      });
      expect(shown).toBe(true);
      expect(d.withoutApp).toHaveBeenCalledOnce();
      expect(controller.receiveNotification).not.toHaveBeenCalled();
      expect(d.present).toHaveBeenCalledOnce();
    });

    it.each([
      ['expense_updated', 'An Expense was updated.'],
      ['expense_deleted', 'An Expense was deleted.'],
    ])(
      '%s with no signed-in app: the no-app check passes it and its generic alert shows (#841)',
      async (kind, text) => {
        const controller = {
          receiveNotification: vi.fn(async () => false),
          tapNotification: vi.fn(async () => {}),
          getSnapshot: () => ({ auth: { status: 'restoring' } }),
        };
        const stop = await attachNotificationCallbacks(controller, Promise.resolve());
        const changed = {
          ...payload,
          data: { body: JSON.stringify({ ...JSON.parse(payload.data.body), kind }) },
        };
        const d = {
          now: Date.now,
          visible: () => false,
          withoutApp: vi.fn((value: unknown) =>
            checkNotificationWithoutApp(
              value,
              access({ cookie: 'better-auth.session_token=alex.signature', accountId: alex }),
              Date.now,
            ),
          ),
          present: vi.fn<
            (alert: { identifier: string; content: { body: string } }) => Promise<void>
          >(async () => {}),
        };
        expect(await receiveNotificationTask(changed, d)).toBe(true);
        const alert = d.present.mock.calls[0][0];
        expect(alert.content.body).toBe(text);
        // The foreground handler shows this posted alert quietly, as it does an added one.
        const handler = native.setNotificationHandler.mock.calls[0][0];
        expect(
          await handler.handleNotification({
            request: {
              identifier: alert.identifier,
              content: alert.content,
              trigger: { type: 'channel', channelId: 'ledger-updates' },
            },
          }),
        ).toMatchObject({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false });
        stop();
      },
    );

    it('signed out: the no-app check finds no saved session and nothing shows', async () => {
      const { shown, controller, d } = await receive('signed-out', null);
      expect(shown).toBe(false);
      expect(d.withoutApp).toHaveBeenCalledOnce();
      expect(controller.receiveNotification).not.toHaveBeenCalled();
      expect(d.present).not.toHaveBeenCalled();
    });
  });

  it('cold response waits for restoration, forwards only data and clears the consumed native response', async () => {
    let restore!: () => void;
    const restored = new Promise<void>((resolve) => {
      restore = resolve;
    });
    native.getLastNotificationResponseAsync.mockResolvedValueOnce({
      notification,
      actionIdentifier: 'default',
    });
    const controller = {
      receiveNotification: vi.fn(async () => false),
      tapNotification: vi.fn(async () => {}),
      getSnapshot: () => ({ auth: { status: 'authenticated' } }),
    };
    const stop = await attachNotificationCallbacks(controller, restored);
    await Promise.resolve();
    expect(controller.tapNotification).not.toHaveBeenCalled();
    restore();
    await vi.waitFor(() =>
      expect(controller.tapNotification).toHaveBeenCalledWith(notification.request.content.data),
    );
    expect(native.clearLastNotificationResponseAsync).toHaveBeenCalled();
    stop();
  });
  it('warm responses forward once and teardown detaches the listener and handler', async () => {
    const controller = {
      receiveNotification: vi.fn(async () => false),
      tapNotification: vi.fn(async () => {}),
      getSnapshot: () => ({ auth: { status: 'authenticated' } }),
    };
    const stop = await attachNotificationCallbacks(controller, Promise.resolve());
    const listener = native.addNotificationResponseReceivedListener.mock.calls[0][0];
    const response = { notification, actionIdentifier: 'default' };
    listener(response);
    listener(response);
    await vi.waitFor(() => expect(controller.tapNotification).toHaveBeenCalledTimes(1));
    stop();
    expect(native.setNotificationHandler).toHaveBeenLastCalledWith(null);
  });
  it('a rejected restoration keeps a warm response unconsumed and does not reject unhandled', async () => {
    let reject!: (error: Error) => void;
    const restored = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const controller = {
      receiveNotification: vi.fn(async () => false),
      tapNotification: vi.fn(async () => {}),
      getSnapshot: () => ({ auth: { status: 'authenticated' } }),
    };
    const stop = await attachNotificationCallbacks(controller, restored);
    const listener = native.addNotificationResponseReceivedListener.mock.calls[0][0];
    listener({ notification, actionIdentifier: 'default' });
    reject(new Error('Fictional restoration unavailable'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.tapNotification).not.toHaveBeenCalled();
    expect(native.clearLastNotificationResponseAsync).not.toHaveBeenCalled();
    stop();
  });
  it('bounds response identities while still suppressing the latest repeated native tap', async () => {
    const controller = {
      receiveNotification: vi.fn(async () => false),
      tapNotification: vi.fn(async () => {}),
      getSnapshot: () => ({ auth: { status: 'authenticated' } }),
    };
    const stop = await attachNotificationCallbacks(controller, Promise.resolve());
    const listener = native.addNotificationResponseReceivedListener.mock.calls[0][0];
    const response = (id: string) => ({
      notification: { ...notification, request: { ...notification.request, identifier: id } },
      actionIdentifier: 'default',
    });
    for (let index = 0; index < 1025; index++) listener(response(String(index)));
    await vi.waitFor(() => expect(controller.tapNotification).toHaveBeenCalledTimes(1025));
    listener(response('1024'));
    listener(response('0'));
    await vi.waitFor(() => expect(controller.tapNotification).toHaveBeenCalledTimes(1026));
    stop();
  });
});
