import { describe, expect, it, vi } from 'vitest';

// The real runtime wiring, with only the native modules and the controller replaced.
const wired = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  return { dependencies: undefined as Record<string, unknown> | undefined };
});
vi.mock('./data', () => ({
  createMobileController: (_config: unknown, dependencies: Record<string, unknown>) => {
    wired.dependencies = dependencies;
    return {};
  },
}));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(), getRandomBytes: vi.fn() }));
vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));

await import('./runtime');

describe('runtime storage wiring', () => {
  it.each([
    'expenseDrafts',
    'settlementAttempts',
    'groupCreations',
    'readCache',
    'offlineIdentity',
  ])('purges %s on sign-out and account change', (name) => {
    const dependencies = wired.dependencies!;
    expect(dependencies[name]).toBeDefined();
    expect((dependencies.accountLocal as { stores: unknown[] }).stores).toContain(
      dependencies[name],
    );
  });
});
