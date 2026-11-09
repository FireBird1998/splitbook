import { afterEach, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';

const native = vi.hoisted(() => ({ databases: new Map<string, DatabaseSync>(), exists: true }));
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return {
    defaultDatabaseDirectory: '/data/user/0/com.splitbook.app.dev/files/SQLite',
    openDatabaseAsync: async (file: string) => {
      let db = native.databases.get(file);
      if (!db) {
        db = new DatabaseSync(':memory:');
        native.databases.set(file, db);
      }
      return {
        execAsync: async (sql: string) => db.exec(sql),
        runAsync: async (sql: string, ...values: (string | number | null)[]) =>
          db.prepare(sql).run(...values),
        getFirstAsync: async (sql: string, ...values: (string | number | null)[]) =>
          db.prepare(sql).get(...values),
      };
    },
  };
});
afterEach(() => {
  for (const db of native.databases.values()) db.close();
  native.databases.clear();
});
vi.mock('expo-file-system', () => ({
  File: class {
    constructor(directory: string) {
      if (!directory.startsWith('file://')) throw new Error('URI is not absolute');
    }
    get exists() {
      return native.exists;
    }
  },
}));
import { createWidgetsStore } from './widgets-native';

it('purges an existing copy after a cold start using an absolute file URI', async () => {
  const store = createWidgetsStore('development');
  await store.write({ version: 1, accountId: 'alex', home: null });
  await createWidgetsStore('development').clear();
  expect((await store.read()).copy).toBeNull();
});

it('keeps only the same account’s archived final balances across app-query eviction and restart', async () => {
  const copy: WidgetCopy = {
    version: 1,
    accountId: 'alex',
    home: null,
    groups: {
      maple: {
        id: 'maple',
        name: 'Maple House',
        theme: 'home',
        archived: true,
        mainCurrency: 'INR',
        verifiedAt: 100,
        balancesVerifiedAt: 200,
        currencies: [{ currency: 'INR', balanceMinor: -1200, payments: [] }],
      },
    },
  };
  await createWidgetsStore('development').write(copy);
  const restarted = createWidgetsStore('development');
  await restarted.write({ ...copy, groups: {} });
  expect((await restarted.read()).copy?.groups).toEqual(copy.groups);
  await restarted.write({ ...copy, groups: {}, lostGroupIds: ['maple'] });
  expect((await restarted.read()).copy?.groups).toEqual({});
  await restarted.write(copy);
  await restarted.write({ ...copy, accountId: 'sam', groups: {} });
  expect((await restarted.read()).copy?.groups).toEqual({});
});

it('treats an unreadable widget copy as absent while keeping the saved session and setup', async () => {
  const store = createWidgetsStore('development');
  const session = { status: 'authenticated' as const, accountId: 'alex', loading: false };
  const setup = { kind: 'group' as const, widgetId: 7, accountId: 'alex', groupId: 'maple' };
  await store.setSession(session);
  await store.saveSetup(setup);
  // Corruption at the SQLite boundary; observe only the store's public read interfaces.
  native.databases
    .get('splitbook-widgets.db')!
    .prepare('UPDATE widget_state SET copy = ? WHERE environment = ?')
    .run('{unreadable', 'development');
  await expect(store.read()).resolves.toEqual({ copy: null, session });
  expect(await store.setup(7)).toEqual(setup);
});
