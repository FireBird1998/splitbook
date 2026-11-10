import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkNotificationWithoutApp } from './data/notification-receipt';

// The real runtime wiring with Android notifications on, and only the native modules replaced.
const phone = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  Object.assign(process.env, {
    EXPO_PUBLIC_APP_ENV: 'development',
    EXPO_PUBLIC_API_URL: 'http://127.0.0.1:4138',
    EXPO_PUBLIC_AUTH_ORIGIN: 'http://127.0.0.1:4138',
    EXPO_PUBLIC_ANDROID_NOTIFICATIONS_ENABLED: 'true',
  });
  return { storage: new Map<string, string>() };
});
vi.mock('./data', () => ({ createMobileController: () => ({}) }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => phone.storage.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    phone.storage.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    phone.storage.delete(key);
  }),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID(), getRandomBytes: vi.fn() }));
vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache/' },
  Directory: class {
    exists = false;
    delete() {}
  },
}));

const { notificationAccess } = await import('./runtime');
const SecureStore = await import('expo-secure-store');
const { fetch } = await import('expo/fetch');

// Fictional identities only.
const alex = 'a00000000000000000000001';
const hex = (value: string) => Array.from(value, (c) => c.charCodeAt(0).toString(16)).join('');
const sessionKey = 'splitbook.session.' + hex('http://127.0.0.1:4138');
const installationKey = 'splitbook.notification-installation.' + hex('http://127.0.0.1:4138');
const time = Date.now();
const received = {
  body: JSON.stringify({
    version: 2,
    kind: 'expense_added',
    eventId: 'd00000000000000000000001',
    groupId: 'b00000000000000000000001',
    recordId: 'c00000000000000000000001',
    accountId: alex,
    environment: 'development',
    binding: '00000000-0000-4000-8000-000000000001',
    activation: '00000000-0000-4000-8000-000000000002',
    occurredAt: new Date(time - 1_000).toISOString(),
    expiresAt: new Date(time - 1_000 + 86_400_000).toISOString(),
  }),
};

beforeEach(() => {
  phone.storage.clear();
  phone.storage.set(
    sessionKey,
    JSON.stringify({ cookie: 'better-auth.session_token=alex.signature', accountId: alex }),
  );
  vi.clearAllMocks();
});

describe('the no-app check’s installation (#968)', () => {
  it('drops the event and writes nothing when this phone has no installation saved', async () => {
    expect(notificationAccess).not.toBeNull();
    expect(await checkNotificationWithoutApp(received, notificationAccess!, Date.now)).toBeNull();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(phone.storage.has(installationKey)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the saved installation for the controls read, unchanged', async () => {
    const saved = JSON.stringify({
      id: '00000000-0000-4000-8000-000000000968',
      key: 'private-installation-proof-968968968',
    });
    phone.storage.set(installationKey, saved);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Fictional offline'));
    expect(await checkNotificationWithoutApp(received, notificationAccess!, Date.now)).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('installationId=00000000-0000-4000-8000-000000000968'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Installation-Key': 'private-installation-proof-968968968',
          'Cache-Control': 'no-store',
        }),
      }),
    );
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(phone.storage.get(installationKey)).toBe(saved);
  });
});
