import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
export interface AccountGroupRecordStore {
  load(accountId: string, groupId: string): Promise<unknown | null>;
  save(accountId: string, groupId: string, value: unknown): Promise<void>;
  remove(accountId: string, groupId: string): Promise<void>;
  clear(): Promise<void>;
  /**
   * Every record this account has in this environment, such as Home's Expense drafts, or the
   * persister's rows, each by its query's path.
   */
  list?(accountId: string): Promise<{ groupId: string; value: unknown }[]>;
  /**
   * The keys of every record this account has in this environment, without reading any: one
   * that can't be read never stops a removal that only needs its key (#219).
   */
  keys?(accountId: string): Promise<string[]>;
}
/**
 * A store that finds its records without knowing their keys, by `keys`, `list` or both, as the
 * persister's rows must, to remove every row of a Group (#219).
 */
export type FindableRecordStore = Omit<AccountGroupRecordStore, 'keys' | 'list'> &
  (
    | (Required<Pick<AccountGroupRecordStore, 'keys'>> & Pick<AccountGroupRecordStore, 'list'>)
    | ({ keys?: undefined } & Required<Pick<AccountGroupRecordStore, 'list'>>)
  );

/**
 * Atomic account/Group JSON records. The two existing on-disk stores keep their identities.
 * `saved` holds the persister's saved copies, one row per query, keyed by the query's path
 * (ADR 0006, M3-1), beside the older saved-copy document in the same database.
 */
export function createAccountGroupRecordStore(
  environment: string,
  kind: 'expense' | 'settlement' | 'cache' | 'saved' | 'group-creation' | 'sign-out',
): AccountGroupRecordStore & Required<Pick<AccountGroupRecordStore, 'keys' | 'list'>> {
  const {
    file,
    table,
    column = 'group_id',
  } = {
    expense: { file: 'splitbook-drafts.db', table: 'expense_drafts' },
    settlement: { file: 'splitbook-settlements.db', table: 'settlement_attempts' },
    cache: { file: 'splitbook-read-cache.db', table: 'financial_reads' },
    saved: { file: 'splitbook-read-cache.db', table: 'saved_queries', column: 'query_key' },
    'group-creation': { file: 'splitbook-group-creations.db', table: 'group_creations' },
    'sign-out': { file: 'splitbook-sign-outs.db', table: 'pending_sign_outs' },
  }[kind];
  let opening: Promise<SQLiteDatabase> | undefined;
  const database = () => {
    opening ??= (async () => {
      const db = await openDatabaseAsync(file);
      await db.execAsync(`PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS ${table} (
          environment TEXT NOT NULL, account_id TEXT NOT NULL, ${column} TEXT NOT NULL,
          value TEXT NOT NULL, PRIMARY KEY (environment, account_id, ${column})
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
        `SELECT value FROM ${table} WHERE environment = ? AND account_id = ? AND ${column} = ?`,
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
        `INSERT INTO ${table} (environment, account_id, ${column}, value) VALUES (?, ?, ?, ?) ON CONFLICT(environment, account_id, ${column}) DO UPDATE SET value = excluded.value`,
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
        `DELETE FROM ${table} WHERE environment = ? AND account_id = ? AND ${column} = ?`,
        environment,
        accountId,
        groupId,
      );
    },
    async clear() {
      await (await database()).runAsync(`DELETE FROM ${table} WHERE environment = ?`, environment);
    },
    async list(accountId) {
      const rows = await (
        await database()
      ).getAllAsync<{ id: string; value: string }>(
        `SELECT ${column} AS id, value FROM ${table} WHERE environment = ? AND account_id = ?`,
        environment,
        accountId,
      );
      return rows.map((row) => ({ groupId: row.id, value: JSON.parse(row.value) }));
    },
    async keys(accountId) {
      const rows = await (
        await database()
      ).getAllAsync<{ id: string }>(
        `SELECT ${column} AS id FROM ${table} WHERE environment = ? AND account_id = ?`,
        environment,
        accountId,
      );
      return rows.map((row) => row.id);
    },
  };
}

/**
 * A sign-out this device hasn't finished, recorded outside SecureStore (`signOutRecord`): one
 * fixed row per environment, belonging to no account, so no account purge removes it.
 */
export function createSignOutRecord(environment: string) {
  const records = createAccountGroupRecordStore(environment, 'sign-out');
  return {
    load: async () => {
      const value: unknown = await records.load('', 'sign-out');
      if (value === null) return null;
      return {
        invitationCleared:
          typeof value === 'object' &&
          'invitationCleared' in value &&
          value.invitationCleared === true,
      };
    },
    mark: (record: { invitationCleared: boolean }) => records.save('', 'sign-out', record),
    clear: () => records.remove('', 'sign-out'),
  };
}
