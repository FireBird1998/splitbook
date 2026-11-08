import { expect, it, vi } from 'vitest';
// SQLite is the native edge. Keep its rows across new store instances, as on a process restart.
const rows = vi.hoisted(() => ({
  setups: new Map<string, string>(),
  sessions: new Map<string, string>(),
}));
vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => ({
    execAsync: async () => {},
    runAsync: async (sql: string, environment: string, id?: number | string, value?: string) => {
      if (sql.startsWith('INSERT OR REPLACE INTO widget_setup'))
        rows.setups.set(`${environment}/${id}`, value!);
      if (
        sql.startsWith('INSERT OR IGNORE INTO widget_setup') &&
        !rows.setups.has(`${environment}/${id}`)
      )
        rows.setups.set(`${environment}/${id}`, value!);
      if (sql.startsWith('DELETE FROM widget_setup')) rows.setups.delete(`${environment}/${id}`);
      if (sql.startsWith('UPDATE widget_state SET session'))
        rows.sessions.set(String(id), environment);
      if (sql.startsWith('DELETE FROM widget_state')) rows.sessions.delete(environment);
    },
    getFirstAsync: async (sql: string, environment: string, id?: number) =>
      sql.includes('widget_setup')
        ? rows.setups.has(`${environment}/${id}`)
          ? { setup: rows.setups.get(`${environment}/${id}`) }
          : null
        : { copy: null, session: rows.sessions.get(environment) ?? null },
  }),
}));
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
