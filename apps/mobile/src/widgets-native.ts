import { openDatabaseAsync, defaultDatabaseDirectory, type SQLiteDatabase } from 'expo-sqlite';
import type { WidgetSetupRecord } from '@splitbook/shared/widget-setup';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';
import type { WidgetsNative } from './data/widget-copy';

/** Separate saved read in app-private SQLite, readable by the headless widget renderer. */
export function createWidgetsStore(environment: string) {
  let opening: Promise<SQLiteDatabase> | undefined;
  const database = () =>
    (opening ??= (async () => {
      const db = await openDatabaseAsync('splitbook-widgets.db');
      await db.execAsync(`PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS widget_state (environment TEXT PRIMARY KEY, copy TEXT, session TEXT);
      CREATE TABLE IF NOT EXISTS widget_setup (environment TEXT, widget_id INTEGER, setup TEXT, PRIMARY KEY(environment, widget_id));`);
      return db;
    })());
  const ensure = async () => {
    const db = await database();
    await db.runAsync('INSERT OR IGNORE INTO widget_state(environment) VALUES (?)', environment);
    return db;
  };
  return {
    async setup(widgetId: number): Promise<WidgetSetupRecord | null> {
      const row = await (
        await database()
      ).getFirstAsync<{ setup: string }>(
        'SELECT setup FROM widget_setup WHERE environment = ? AND widget_id = ?',
        environment,
        widgetId,
      );
      return row ? JSON.parse(row.setup) : null;
    },
    async saveSetup(setup: WidgetSetupRecord) {
      await (
        await database()
      ).runAsync(
        'INSERT OR REPLACE INTO widget_setup(environment, widget_id, setup) VALUES (?, ?, ?)',
        environment,
        setup.widgetId,
        JSON.stringify(setup),
      );
    },
    async removeSetup(widgetId: number) {
      await (
        await database()
      ).runAsync(
        'DELETE FROM widget_setup WHERE environment = ? AND widget_id = ?',
        environment,
        widgetId,
      );
    },
    async read(): Promise<{ copy: WidgetCopy | null; session: WidgetSession }> {
      const row = await (
        await database()
      ).getFirstAsync<{ copy: string | null; session: string | null }>(
        'SELECT copy, session FROM widget_state WHERE environment = ?',
        environment,
      );
      return {
        copy: row?.copy ? JSON.parse(row.copy) : null,
        session: row?.session ? JSON.parse(row.session) : { status: 'signed-out' },
      };
    },
    async write(copy: WidgetCopy) {
      const db = await ensure();
      // To review has its own verification time. Offline Home restoration must not erase it.
      if (process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true' && !copy.review) {
        const previous = await this.read();
        if (previous.copy?.accountId === copy.accountId && previous.copy.review)
          copy = { ...copy, review: previous.copy.review };
      }
      await db.runAsync(
        'UPDATE widget_state SET copy = ? WHERE environment = ?',
        JSON.stringify(copy),
        environment,
      );
    },
    async clear() {
      if (!opening) {
        const { File } = await import('expo-file-system');
        if (!new File(`file://${defaultDatabaseDirectory}`, 'splitbook-widgets.db').exists) return;
      }
      await (
        await database()
      ).runAsync('DELETE FROM widget_state WHERE environment = ?', environment);
    },
    async setSession(session: WidgetSession) {
      await (
        await ensure()
      ).runAsync(
        'UPDATE widget_state SET session = ? WHERE environment = ?',
        JSON.stringify(session),
        environment,
      );
    },
  };
}

export function createWidgetsNative(environment: string): WidgetsNative {
  const store = createWidgetsStore(environment);
  let sessions: Promise<void> = Promise.resolve();
  return {
    openSetup: async (widgetId) => {
      const { Linking } = await import('react-native');
      const { default: Constants } = await import('expo-constants');
      const applicationId = Constants.expoConfig?.android?.package;
      await Linking.sendIntent(`${applicationId}.WIDGET_CONFIGURE`, [
        { key: 'appWidgetId', value: widgetId },
      ]);
    },
    write: (copy) => store.write(copy),
    clear: () => store.clear(),
    setSession: (state) => {
      const next = sessions.catch(() => undefined).then(() => store.setSession(state));
      sessions = next;
      return next;
    },
    redraw: async () => {
      const { redrawBalances } = await import('./widgets');
      await redrawBalances();
    },
  };
}
