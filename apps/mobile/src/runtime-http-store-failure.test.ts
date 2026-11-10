import { describe, expect, it, vi } from 'vitest';

// The real runtime wiring on a phone whose HTTP response store can't be deleted at start.
const wired = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  return { dependencies: undefined as Record<string, unknown> | undefined, attempts: 0 };
});
vi.mock('@react-native-community/netinfo', () => ({ default: { configure: () => undefined } }));
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
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache/' },
  Directory: class {
    exists = true;
    delete() {
      wired.attempts++;
      throw new Error('Fictional filesystem failure');
    }
  },
}));

await import('./runtime');

describe('a phone whose HTTP response store can’t be emptied at start (#1060)', () => {
  it('still sends requests: they ask for no-store, so the store stays unused', async () => {
    const { fetch } = await import('expo/fetch');
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ user: null }) as unknown as Awaited<ReturnType<typeof fetch>>,
    );
    expect(wired.attempts).toBe(1);
    const request = wired.dependencies!.fetch as typeof fetch;
    const response = await request('http://127.0.0.1:4138/api/auth/get-session');
    expect(await response.json()).toEqual({ user: null });
  });

  it('still fails the account purge, which keeps its clean-up to retry', async () => {
    const { httpResponseStore } = await import('./http-response-store');
    await expect(httpResponseStore.clear()).rejects.toThrow('Fictional filesystem failure');
  });
});
