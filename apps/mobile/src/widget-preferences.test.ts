import { afterEach, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
// The native SQLite boundary keeps actual rows across store instances.
const edge = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined }));
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return {
    defaultDatabaseDirectory: '/device/SQLite',
    openDatabaseAsync: async () => {
      const db = (edge.db ??= new DatabaseSync(':memory:'));
      const runAsync = async (sql: string, ...values: (number | string | null)[]) =>
        db.prepare(sql).run(...values);
      return {
        execAsync: async (sql: string) => db.exec(sql),
        runAsync,
        getFirstAsync: async (sql: string, ...values: (number | string | null)[]) =>
          db.prepare(sql).get(...values),
        getAllAsync: async (sql: string, ...values: (number | string | null)[]) =>
          db.prepare(sql).all(...values),
        withExclusiveTransactionAsync: async (
          task: (transaction: { runAsync: typeof runAsync }) => Promise<void>,
        ) => {
          db.exec('BEGIN IMMEDIATE');
          try {
            await task({ runAsync });
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        },
      };
    },
  };
});
afterEach(() => {
  edge.db?.close();
  edge.db = undefined;
});
import { createWidgetsStore } from './widgets-native';
it('keeps per-widget preferences through a restart, expiry and account purge, until Android removes that widget', async () => {
  const original = createWidgetsStore('local');
  await original.saveSetup({
    kind: 'group',
    widgetId: 7,
    accountId: 'alex',
    groupId: 'maple',
    hideAmounts: true,
  });
  await original.saveSetup({ kind: 'balances', widgetId: 3, hideAmounts: false });
  const restarted = createWidgetsStore('local');
  await restarted.setSession({ status: 'expired' });
  expect(await restarted.setup(7)).toMatchObject({ groupId: 'maple', hideAmounts: true });
  await restarted.clear();
  expect(await restarted.setup(7)).toMatchObject({ accountId: 'alex', hideAmounts: true });
  expect(await restarted.setup(3)).toMatchObject({ kind: 'balances', hideAmounts: false });
  expect(await createWidgetsStore('different-local').setup(7)).toBeNull();
  await restarted.removeSetup(7);
  expect(await restarted.setup(7)).toBeNull();
  expect(await restarted.setup(3)).not.toBeNull();
});
it('does not overwrite a preference saved while a legacy update was starting', async () => {
  const store = createWidgetsStore('race');
  await store.saveSetup({ kind: 'balances', widgetId: 3, hideAmounts: true });
  await store.saveSetupIfAbsent({ kind: 'balances', widgetId: 3, hideAmounts: false });
  expect(await store.setup(3)).toMatchObject({ hideAmounts: true });
});
