import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
export interface AccountGroupRecordStore {
  load(accountId: string, groupId: string): Promise<unknown | null>;
  save(accountId: string, groupId: string, value: unknown): Promise<void>;
  remove(accountId: string, groupId: string): Promise<void>;
  clear(): Promise<void>;
}

/** Atomic account/Group JSON records. The two existing on-disk stores keep their identities. */
export function createAccountGroupRecordStore(
  environment: string,
  kind: 'expense' | 'settlement',
): AccountGroupRecordStore {
  const { file, table } =
    kind === 'expense'
      ? { file: 'splitbook-drafts.db', table: 'expense_drafts' }
      : { file: 'splitbook-settlements.db', table: 'settlement_attempts' };
  let opening: Promise<SQLiteDatabase> | undefined;
  const database = () => {
    opening ??= (async () => {
      const db = await openDatabaseAsync(file);
      await db.execAsync(`PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS ${table} (
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
        `SELECT value FROM ${table} WHERE environment = ? AND account_id = ? AND group_id = ?`,
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
        `INSERT INTO ${table} (environment, account_id, group_id, value) VALUES (?, ?, ?, ?) ON CONFLICT(environment, account_id, group_id) DO UPDATE SET value = excluded.value`,
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
        `DELETE FROM ${table} WHERE environment = ? AND account_id = ? AND group_id = ?`,
        environment,
        accountId,
        groupId,
      );
    },
    async clear() {
      await (await database()).runAsync(`DELETE FROM ${table} WHERE environment = ?`, environment);
    },
  };
}
