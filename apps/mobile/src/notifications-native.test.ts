import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationNative } from './notifications-native';
import { attachNotificationCallbacks } from './notification-callbacks';
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
  it('passes receipt decisions to native presentation without prompting', async () => {
    const controller = {
      receiveNotification: vi.fn(async () => false),
      tapNotification: vi.fn(async () => {}),
    };
    const stop = await attachNotificationCallbacks(controller, Promise.resolve());
    const handler = native.setNotificationHandler.mock.calls[0][0];
    expect(await handler.handleNotification(notification)).toMatchObject({
      shouldShowBanner: false,
      shouldShowList: false,
    });
    controller.receiveNotification.mockResolvedValue(true);
    expect(await handler.handleNotification(notification)).toMatchObject({
      shouldShowBanner: true,
      shouldShowList: true,
    });
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
    stop();
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
