import { afterAll, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { MobileDependencies } from './data/types';
import { fakeSplitbook } from './test-utils/fake-splitbook';
import { until } from './test-utils/test-phone';
const native = vi.hoisted(() => {
  vi.stubGlobal('__DEV__', true);
  vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'development');
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'http://localhost:4138');
  vi.stubEnv('EXPO_PUBLIC_AUTH_ORIGIN', 'http://localhost:4138');
  return {
    values: new Map<string, string>(),
    databases: new Map<string, DatabaseSync>(),
    fetch: undefined as MobileDependencies['fetch'] | undefined,
  };
});
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => native.values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    native.values.set(key, value);
  },
  deleteItemAsync: vi.fn(async (key: string) => {
    native.values.delete(key);
  }),
}));
vi.mock('expo-crypto', async () => {
  const crypto = await import('node:crypto');
  return {
    randomUUID: crypto.randomUUID,
    getRandomBytes: (size: number) => crypto.randomBytes(size),
  };
});
vi.mock('expo/fetch', () => ({
  fetch: (url: string, init?: RequestInit) => native.fetch!(url, init ?? {}),
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'fictional-cache' },
  File: class {
    exists = false;
  },
  Directory: class {
    exists = false;
    delete() {}
  },
}));
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return {
    defaultDatabaseDirectory: '/fictional-sqlite',
    openDatabaseAsync: async (file: string) => {
      let db = native.databases.get(file);
      if (!db) {
        db = new DatabaseSync(':memory:');
        native.databases.set(file, db);
      }
      const opened = db;
      return {
        execAsync: async (sql: string) => opened.exec(sql),
        runAsync: async (sql: string, ...values: (string | number)[]) =>
          opened.prepare(sql).run(...values),
        getFirstAsync: async (sql: string, ...values: (string | number)[]) =>
          opened.prepare(sql).get(...values),
        getAllAsync: async (sql: string, ...values: (string | number)[]) =>
          opened.prepare(sql).all(...values),
      };
    },
  };
});
afterAll(() => {
  for (const db of native.databases.values()) db.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('real runtime controller sign-out purges account stores while retaining the SecureStore Motion key', async () => {
  const server = fakeSplitbook();
  native.fetch = server.fetch;
  const { controller } = await import('./runtime');
  const { sceneMotion } = await import('./data/scene-motion');
  const secure = await import('expo-secure-store');
  try {
    await controller.signIn('alex');
    expect(controller.getSnapshot().auth.status).toBe('authenticated');
    await controller.openGroup(server.world.groups[0]!._id);
    await until(controller, (state) => state.detail.status === 'ready');
    await sceneMotion.select(false);
    expect(native.values.get('splitbook.header-motion')).toBe('off');
    await controller.signOut();
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(native.values.get('splitbook.header-motion')).toBe('off');
    expect(secure.deleteItemAsync).toHaveBeenCalled();
    expect(secure.deleteItemAsync).not.toHaveBeenCalledWith('splitbook.header-motion');
  } finally {
    controller.dispose();
  }
});
