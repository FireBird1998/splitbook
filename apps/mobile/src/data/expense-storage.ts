import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { ExpenseDraftStore } from './expense-draft';

/** One atomic row contains both the editable draft and its immutable submission. */
export function createExpenseDraftStore(environment: string): ExpenseDraftStore {
  let opening: Promise<SQLiteDatabase> | undefined;
  const database = () => {
    opening ??= (async () => {
      const db = await openDatabaseAsync('splitbook-drafts.db');
      await db.execAsync(`PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS expense_drafts (
          environment TEXT NOT NULL, account_id TEXT NOT NULL, group_id TEXT NOT NULL,
          value TEXT NOT NULL, PRIMARY KEY (environment, account_id, group_id)
        );`);
      return db;
    })().catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
    return opening;
  };
  return {
    async load(accountId, groupId) {
      const row = await (
        await database()
      ).getFirstAsync<{ value: string }>(
        'SELECT value FROM expense_drafts WHERE environment = ? AND account_id = ? AND group_id = ?',
        environment,
        accountId,
        groupId,
      );
      return row ? JSON.parse(row.value) : null;
    },
    async save(accountId, groupId, value) {
      await (
        await database()
      ).runAsync(
        'INSERT INTO expense_drafts (environment, account_id, group_id, value) VALUES (?, ?, ?, ?) ON CONFLICT(environment, account_id, group_id) DO UPDATE SET value = excluded.value',
        environment,
        accountId,
        groupId,
        JSON.stringify(value),
      );
    },
    async remove(accountId, groupId) {
      await (
        await database()
      ).runAsync(
        'DELETE FROM expense_drafts WHERE environment = ? AND account_id = ? AND group_id = ?',
        environment,
        accountId,
        groupId,
      );
    },
    async clear() {
      await (
        await database()
      ).runAsync('DELETE FROM expense_drafts WHERE environment = ?', environment);
    },
  };
}
