import { afterAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// The real runtime wiring, with only the native modules and the controller replaced.
const wired = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  return {
    dependencies: undefined as Record<string, unknown> | undefined,
    reachability: undefined as Record<string, unknown> | undefined,
    cache: '',
  };
});
vi.mock('@react-native-community/netinfo', () => ({
  default: {
    configure: (options: Record<string, unknown>) => {
      wired.reachability = options;
    },
  },
}));
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
vi.mock('expo-file-system', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  wired.cache = fs.mkdtempSync(path.join(os.tmpdir(), 'splitbook-http-store-'));
  fs.mkdirSync(path.join(wired.cache, 'http-cache'));
  fs.writeFileSync(
    path.join(wired.cache, 'http-cache', 'old-response'),
    'Fictional saved response',
  );
  fs.writeFileSync(path.join(wired.cache, 'bundled-font.ttf'), 'Keep the bundled asset');
  return {
    Paths: { cache: wired.cache },
    Directory: class {
      uri: string;
      constructor(...parts: string[]) {
        this.uri = path.join(...parts);
      }
      get exists() {
        return fs.existsSync(this.uri);
      }
      delete() {
        fs.rmSync(this.uri, { recursive: true });
      }
    },
  };
});

await import('expo-file-system');
await import('./runtime');
afterAll(() => rmSync(wired.cache, { recursive: true, force: true }));

describe('runtime storage wiring', () => {
  it('empties only the HTTP store before the first request reaches native fetch (#1060)', async () => {
    const { fetch } = await import('expo/fetch');
    vi.mocked(fetch).mockImplementationOnce(async () => {
      expect(existsSync(join(wired.cache, 'http-cache'))).toBe(false);
      expect(readFileSync(join(wired.cache, 'bundled-font.ttf'), 'utf8')).toBe(
        'Keep the bundled asset',
      );
      return Response.json({ user: null });
    });
    const request = wired.dependencies!.fetch as typeof fetch;
    const response = await request('http://127.0.0.1:4138/api/auth/get-session');
    expect(await response.json()).toEqual({ user: null });
  });

  it('asks for no HTTP caching when NetInfo needs its reachability probe (#1060)', () => {
    expect(wired.reachability).toMatchObject({
      reachabilityHeaders: { 'Cache-Control': 'no-store' },
    });
  });

  it.each([
    'expenseDrafts',
    'settlementAttempts',
    'groupCreations',
    'savedQueries',
    'offlineIdentity',
  ])('purges %s on sign-out and account change', (name) => {
    const dependencies = wired.dependencies!;
    expect(dependencies[name]).toBeDefined();
    expect((dependencies.accountLocal as { stores: unknown[] }).stores).toContain(
      dependencies[name],
    );
  });

  it('records a sign-out outside SecureStore, and never purges that record with the account (#202)', () => {
    const accountLocal = wired.dependencies!.accountLocal as {
      signOutRecord?: object;
      stores: unknown[];
    };
    expect(accountLocal.signOutRecord).toMatchObject({
      load: expect.any(Function),
      mark: expect.any(Function),
      clear: expect.any(Function),
    });
    expect(accountLocal.stores).not.toContain(accountLocal.signOutRecord);
  });

  it('records saved copies it couldn’t remove outside their database, and purges that record with the account (#212)', async () => {
    const accountLocal = wired.dependencies!.accountLocal as {
      untrustedCopies?: { save(record: unknown): Promise<void> };
      stores: unknown[];
    };
    const SecureStore = await import('expo-secure-store');
    await accountLocal.untrustedCopies!.save({ accountId: 'a1', scopes: { home: 1 } });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^splitbook\.untrusted-copies\./),
      JSON.stringify({ accountId: 'a1', scopes: { home: 1 } }),
    );
    expect(accountLocal.stores).toContain(accountLocal.untrustedCopies);
  });
});
