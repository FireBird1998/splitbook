import { widgetPeople } from '@splitbook/shared/widget-people';
import { openDatabaseAsync, defaultDatabaseDirectory, type SQLiteDatabase } from 'expo-sqlite';
import { readWidgetTagIds, type WidgetSetupRecord } from '@splitbook/shared/widget-setup';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';
import type { WidgetsNative } from './data/widget-copy';

// SQLite checks the current setup in the same statement that stores a copy. A delayed app
// write cannot put descriptions back after setup was switched off or its widget removed.
const permittedRecents = `json_set(copy, '$.recents', json((
  SELECT json_group_object(recent.key, json(recent.value))
  FROM json_each(copy, '$.recents') AS recent
  WHERE NOT EXISTS (SELECT 1 FROM json_each(copy, '$.lostGroupIds') AS lost WHERE lost.value = recent.key)
  AND EXISTS (
    SELECT 1 FROM widget_setup AS placed
    WHERE placed.environment = widget_state.environment
      AND json_valid(placed.setup)
      AND json_extract(placed.setup, '$.kind') = 'group'
      AND json_extract(placed.setup, '$.accountId') = json_extract(copy, '$.accountId')
      AND json_extract(placed.setup, '$.groupId') = recent.key
      AND json_type(placed.setup, '$.showRecentExpenses') = 'true'
  )
)))`;
const pruneRecents = `UPDATE widget_state SET copy = ${permittedRecents}
  WHERE json_valid(copy) AND json_type(copy, '$.recents') = 'object'
    AND copy != ${permittedRecents};`;

/** Separate saved read in app-private SQLite, readable by the headless widget renderer. */
export function createWidgetsStore(environment: string) {
  let opening: Promise<SQLiteDatabase> | undefined;
  const database = () =>
    (opening ??= (async () => {
      const db = await openDatabaseAsync('splitbook-widgets.db');
      await db.execAsync(`PRAGMA secure_delete = ON;
      PRAGMA journal_mode = DELETE;
      CREATE TABLE IF NOT EXISTS widget_state (environment TEXT PRIMARY KEY, copy TEXT, session TEXT);
      CREATE TABLE IF NOT EXISTS widget_setup (environment TEXT, widget_id INTEGER, setup TEXT, PRIMARY KEY(environment, widget_id));`);
      const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if ((version?.user_version ?? 0) < 1) {
        try {
          await db.execAsync(`BEGIN IMMEDIATE;
        DROP TRIGGER IF EXISTS widget_recent_copy;
        DROP TRIGGER IF EXISTS widget_recent_setup_saved;
        DROP TRIGGER IF EXISTS widget_recent_setup_removed;
        CREATE TRIGGER widget_recent_copy AFTER UPDATE OF copy ON widget_state
        BEGIN ${pruneRecents} END;
        CREATE TRIGGER widget_recent_setup_saved AFTER INSERT ON widget_setup
        BEGIN
          DELETE FROM widget_setup WHERE widget_id = NEW.widget_id AND environment != NEW.environment
            AND json_valid(setup)
            AND json_type(setup, '$.showRecentExpenses') = 'true';
          ${pruneRecents}
        END;
        CREATE TRIGGER widget_recent_setup_removed AFTER DELETE ON widget_setup
        BEGIN ${pruneRecents} END;
        PRAGMA user_version = 1;
        COMMIT;`);
        } catch (error) {
          await db.execAsync('ROLLBACK').catch(() => undefined);
          throw error;
        }
      }
      await db.execAsync(pruneRecents);
      return db;
    })().catch((error: unknown) => {
      opening = undefined;
      throw error;
    }));
  const ensure = async () => {
    const db = await database();
    await db.runAsync('INSERT OR IGNORE INTO widget_state(environment) VALUES (?)', environment);
    return db;
  };
  const saveSetup = async (setup: WidgetSetupRecord, overwrite: boolean) => {
    await (
      await database()
    ).runAsync(
      `WITH incoming(environment, widget_id, setup) AS (VALUES (?, ?, ?))
       INSERT OR ${overwrite ? 'REPLACE' : 'IGNORE'} INTO widget_setup(environment, widget_id, setup)
       SELECT environment, widget_id,
         CASE WHEN json_extract(incoming.setup, '$.kind') = 'person' AND NOT EXISTS (
           SELECT 1 FROM widget_state WHERE widget_state.environment = incoming.environment
             AND json_extract(session, '$.status') = 'authenticated'
             AND json_extract(session, '$.accountId') = json_extract(incoming.setup, '$.accountId')
         ) THEN json_remove(incoming.setup, '$.person.firstName', '$.person.initials')
         ELSE incoming.setup END FROM incoming`,
      environment,
      setup.widgetId,
      JSON.stringify(setup),
    );
  };
  return {
    async recentGroups(accountId: string, activeIds: number[]) {
      const rows = await (
        await database()
      ).getAllAsync<{ widget_id: number; group_id: string }>(
        `SELECT widget_id, json_extract(setup, '$.groupId') AS group_id FROM widget_setup
        WHERE environment = ? AND json_valid(setup) AND json_extract(setup, '$.kind') = 'group'
          AND json_extract(setup, '$.accountId') = ?
          AND json_type(setup, '$.showRecentExpenses') = 'true'`,
        environment,
        accountId,
      );
      return [
        ...new Set(
          rows.filter((row) => activeIds.includes(row.widget_id)).map((row) => row.group_id),
        ),
      ];
    },
    async reconcileSetups(activeIds: number[]) {
      // An invalid/partial native result must never delete a live placement.
      if (activeIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
        throw new Error('Invalid native widget id');
      if (!opening) {
        const { File } = await import('expo-file-system');
        if (!new File(`file://${defaultDatabaseDirectory}`, 'splitbook-widgets.db').exists) return;
      }
      // Placements belong to Android, not an account or API environment. Preserve every live id.
      const placeholders = activeIds.map(() => '?').join(',');
      await (
        await database()
      ).runAsync(
        activeIds.length
          ? `DELETE FROM widget_setup WHERE widget_id NOT IN (${placeholders})`
          : 'DELETE FROM widget_setup',
        ...activeIds,
      );
    },
    async setup(widgetId: number): Promise<WidgetSetupRecord | null> {
      const row = await (
        await database()
      ).getFirstAsync<{ setup: string }>(
        'SELECT setup FROM widget_setup WHERE environment = ? AND widget_id = ?',
        environment,
        widgetId,
      );
      if (!row) return null;
      const setup: WidgetSetupRecord = JSON.parse(row.setup);
      return setup.kind === 'quick' && setup.tagIds !== undefined
        ? { ...setup, tagIds: readWidgetTagIds(setup.tagIds) }
        : setup;
    },
    saveSetup: (setup: WidgetSetupRecord) => saveSetup(setup, true),
    saveSetupIfAbsent: (setup: WidgetSetupRecord) => saveSetup(setup, false),
    async removeSetup(widgetId: number) {
      await (await database()).runAsync('DELETE FROM widget_setup WHERE widget_id = ?', widgetId);
    },
    async read(): Promise<{ copy: WidgetCopy | null; session: WidgetSession }> {
      const row = await (
        await database()
      ).getFirstAsync<{ copy: string | null; session: string | null }>(
        'SELECT copy, session FROM widget_state WHERE environment = ?',
        environment,
      );
      let copy: WidgetCopy | null = null;
      try {
        copy = row?.copy ? JSON.parse(row.copy) : null;
      } catch {
        // An unreadable copy is absent for this draw; do not wipe setup or block the next read.
      }
      return {
        copy,
        session: row?.session ? JSON.parse(row.session) : { status: 'signed-out' },
      };
    },
    async write(copy: WidgetCopy) {
      const db = await ensure();
      const previous = (await this.read()).copy;
      if (previous?.accountId === copy.accountId) {
        // App queries deliberately evict archived Groups. Their verified final widget balance
        // survives that eviction and a restart, until access is genuinely lost or the copy purged.
        const finalGroups = Object.fromEntries(
          Object.entries(previous.groups ?? {}).filter(
            ([id, group]) => group.archived && !copy.lostGroupIds?.includes(id),
          ),
        );
        const finalMonths = Object.fromEntries(
          Object.entries(previous.months ?? {}).filter(([id]) => finalGroups[id]),
        );
        copy = {
          ...copy,
          groups: { ...finalGroups, ...copy.groups },
          months: { ...finalMonths, ...copy.months },
          tags: Object.fromEntries(
            [...new Set([...Object.keys(previous.tags ?? {}), ...Object.keys(copy.tags ?? {})])]
              .filter((id) => !copy.lostGroupIds?.includes(id))
              .map((id) => {
                const old = previous.tags?.[id],
                  fresh = copy.tags?.[id];
                return [id, old && (!fresh || old.verifiedAt > fresh.verifiedAt) ? old : fresh!];
              }),
          ),
        };
        // To review has its own verification time. Offline Home restoration must not erase it.
        if (
          process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true' &&
          !copy.review &&
          previous.review
        )
          copy = { ...copy, review: previous.review };
      }
      await db.runAsync(
        'UPDATE widget_state SET copy = ? WHERE environment = ?',
        JSON.stringify(copy),
        environment,
      );
      // This write is admitted by the controller's account lease. Refill only this
      // environment/account's chosen people, from the trusted membership it knows.
      const people = new Map(
        widgetPeople(copy, copy.accountId).map((person) => [person.id, person]),
      );
      const setups = await db.getAllAsync<{ widget_id: number; person_id: string }>(
        `SELECT widget_id, json_extract(setup, '$.person.id') AS person_id FROM widget_setup
         WHERE environment = ? AND json_valid(setup) AND json_extract(setup, '$.kind') = 'person'
           AND json_extract(setup, '$.accountId') = ?`,
        environment,
        copy.accountId,
      );
      for (const setup of setups) {
        const person = people.get(setup.person_id);
        if (!person) continue;
        await db.runAsync(
          `UPDATE widget_setup SET setup = json_set(setup, '$.person.firstName', ?, '$.person.initials', ?)
           WHERE environment = ? AND widget_id = ? AND json_extract(setup, '$.accountId') = ?
             AND json_extract(setup, '$.person.id') = ?`,
          person.firstName,
          person.initials,
          environment,
          setup.widget_id,
          copy.accountId,
          person.id,
        );
      }
    },
    async clear() {
      if (!opening) {
        const { File } = await import('expo-file-system');
        if (!new File(`file://${defaultDatabaseDirectory}`, 'splitbook-widgets.db').exists) return;
      }
      await (
        await database()
      ).withExclusiveTransactionAsync(async (transaction) => {
        // Placement preferences survive a purge; personal labels do not, in any build.
        await transaction.runAsync(`UPDATE widget_setup
          SET setup = json_remove(setup, '$.person.firstName', '$.person.initials')
          WHERE json_valid(setup) AND json_extract(setup, '$.kind') = 'person'`);
        await transaction.runAsync('DELETE FROM widget_state WHERE environment = ?', environment);
      });
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

/** Android placement reconciliation spans every build's rows, not one API environment. */
export async function reconcileWidgetSetupsAcrossBuilds(activeIds: number[]) {
  await createWidgetsStore('').reconcileSetups(activeIds);
}

export function createWidgetsNative(environment: string): WidgetsNative {
  const store = createWidgetsStore(environment);
  let sessions: Promise<void> = Promise.resolve();
  return {
    readCopy: async () => (await store.read()).copy,
    recentSelections: async (accountId) => {
      const { getWidgetInfo } = await import('react-native-android-widget/src/api/get-widget-info');
      const activeIds = (await getWidgetInfo('Group')).map((widget) => widget.widgetId);
      const selected = await store.recentGroups(accountId, activeIds);
      if (!selected.length) return {};
      const { copy } = await store.read();
      return Object.fromEntries(
        selected.map((id) => [
          id,
          copy?.accountId === accountId ? (copy.recents?.[id] ?? null) : null,
        ]),
      );
    },
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
