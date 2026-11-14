import { afterEach, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

const device = vi.hoisted(() => ({
  database: undefined as DatabaseSync | undefined,
  ids: { Balances: [10], Group: [20], Quick: [30], Person: [40] } as Record<string, number[]>,
  unavailable: false,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => ({
  File: class {
    exists = true;
  },
}));
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return {
    defaultDatabaseDirectory: '/device/SQLite',
    openDatabaseAsync: async () => {
      const db = (device.database ??= new DatabaseSync(':memory:'));
      return {
        execAsync: async (sql: string) => db.exec(sql),
        runAsync: async (sql: string, ...values: (number | string)[]) =>
          db.prepare(sql).run(...values),
        getAllAsync: async (sql: string, ...values: (number | string)[]) =>
          db.prepare(sql).all(...values),
        getFirstAsync: async (sql: string, ...values: (number | string)[]) =>
          db.prepare(sql).get(...values),
      };
    },
  };
});
vi.mock('react-native-android-widget/src/api/get-widget-info', () => ({
  getWidgetInfo: async (kind: string) => {
    if (device.unavailable) throw new Error('Native ids unavailable');
    return (device.ids[kind] ?? []).map((widgetId) => ({ widgetId }));
  },
}));
import { createWidgetsStore } from './widgets-native';
// Startup must run this even with EXPO_PUBLIC_ANDROID_WIDGETS_ENABLED unset.
import { reconcileWidgetSetups } from './widget-lifecycle';

afterEach(() => {
  device.database?.close();
  device.database = undefined;
  device.ids = { Balances: [10], Group: [20], Quick: [30], Person: [40] };
  device.unavailable = false;
  vi.unstubAllEnvs();
});
const setup = (widgetId: number) => ({
  kind: 'balances' as const,
  widgetId,
  accountId: 'alex',
  hideAmounts: false,
});

it('removes only orphan setup rows, keeping every live kind and other environments intact', async () => {
  const store = createWidgetsStore('local');
  const other = createWidgetsStore('other-local');
  for (const id of [10, 20, 30, 40, 99]) await store.saveSetup(setup(id));
  await other.saveSetup(setup(20));
  await other.saveSetup(setup(98));
  await reconcileWidgetSetups();
  for (const id of [10, 20, 30, 40]) expect(await store.setup(id)).toEqual(setup(id));
  expect(await other.setup(20)).toEqual(setup(20));
  expect(await store.setup(99)).toBeNull();
  expect(await other.setup(98)).toBeNull();
});

it('also purges removed placements on a widgets-off startup without changing saved copy or session', async () => {
  vi.stubEnv('EXPO_PUBLIC_ANDROID_WIDGETS_ENABLED', 'false');
  const store = createWidgetsStore('local');
  await store.saveSetup(setup(10));
  const copy = { version: 1 as const, accountId: 'alex', home: null };
  await store.write(copy);
  await store.setSession({ status: 'expired' });
  device.ids = { Balances: [], Group: [], Quick: [] };
  await reconcileWidgetSetups();
  expect(await store.setup(10)).toBeNull();
  expect(await store.read()).toEqual({ copy, session: { status: 'expired' } });
});

it('keeps all rows if Android cannot enumerate widgets', async () => {
  const store = createWidgetsStore('local');
  await store.saveSetup(setup(10));
  device.unavailable = true;
  await expect(reconcileWidgetSetups()).rejects.toThrow('Native ids unavailable');
  expect(await store.setup(10)).toEqual(setup(10));
});
