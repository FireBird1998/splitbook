import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationNative } from './notifications-native';
const native = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
  setNotificationChannelAsync: vi.fn(async () => {}),
  getDevicePushTokenAsync: vi.fn(async () => ({ type: 'android', data: 'private-fcm-token' })),
  dismissAllNotificationsAsync: vi.fn(async () => {}),
  cancelAllScheduledNotificationsAsync: vi.fn(async () => {}),
  AndroidImportance: { DEFAULT: 3 },
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
