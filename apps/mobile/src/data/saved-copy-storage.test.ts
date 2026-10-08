import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createAccountGroupRecordStore } from './account-record-storage';
import { createMobileController } from './mobile-controller';

// The SQLite bridge is the adapter seam: real SQL, fictional records, no native runtime.
// Device QA separately exercises Expo's own adapter on emulator-5554.
const device = vi.hoisted(() => ({ databases: new Map<string, DatabaseSync>() }));
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return {
    openDatabaseAsync: async (file: string) => {
      let db = device.databases.get(file);
      if (!db) {
        db = new DatabaseSync(':memory:');
        device.databases.set(file, db);
      }
      return {
        execAsync: async (sql: string) => db.exec(sql),
        runAsync: async (sql: string, ...values: (string | number)[]) =>
          db.prepare(sql).run(...values),
        getFirstAsync: async (sql: string, ...values: (string | number)[]) =>
          db.prepare(sql).get(...values),
        getAllAsync: async (sql: string, ...values: (string | number)[]) =>
          db.prepare(sql).all(...values),
      };
    },
  };
});
afterEach(() => {
  for (const db of device.databases.values()) db.close();
  device.databases.clear();
  vi.restoreAllMocks();
});
const environment = 'http://localhost:4185',
  other = 'http://localhost:4285';
const alex = 'a00000000000000000000001',
  sam = 'a00000000000000000000002';
const path = '/api/groups';

describe('saved-copy SQLite adapter upgrade (#223)', () => {
  it('drops old documents for every account here on first startup, preserving other environments and separate records', async () => {
    const { openDatabaseAsync } = await import('expo-sqlite');
    const db = await openDatabaseAsync('splitbook-read-cache.db');
    await db.execAsync(`CREATE TABLE financial_reads (
      environment TEXT, account_id TEXT, group_id TEXT, value TEXT,
      PRIMARY KEY(environment, account_id, group_id));
      CREATE TABLE saved_queries (
      environment TEXT, account_id TEXT, query_key TEXT, value TEXT,
      PRIMARY KEY(environment, account_id, query_key));`);
    for (const [env, account] of [
      [environment, alex],
      [environment, sam],
      [other, alex],
    ])
      await db.runAsync(
        'INSERT INTO financial_reads VALUES (?, ?, ?, ?)',
        env,
        account,
        'reads',
        '{}',
      );
    const current = { version: 1, accountId: alex, path, refreshedAt: 123, value: { data: [] } };
    await db.runAsync(
      'INSERT INTO saved_queries VALUES (?, ?, ?, ?)',
      environment,
      alex,
      path,
      JSON.stringify(current),
    );
    const drafts = createAccountGroupRecordStore(environment, 'expense');
    const attempts = createAccountGroupRecordStore(environment, 'settlement');
    await drafts.save(alex, 'trip', { description: 'Unsaved dinner' });
    await attempts.save(alex, 'trip', { submissionKey: 'same-key', amount: 12 });
    const copies = createAccountGroupRecordStore(environment, 'saved');
    const fetch = vi.fn(async () => Response.json({}));
    const controller = createMobileController(
      { apiBaseUrl: environment, authOrigin: environment, developmentPersonaEnabled: true },
      {
        savedQueries: copies,
        credentials: {
          load: async () => null,
          save: async () => undefined,
          clear: async () => undefined,
        },
        fetch,
      },
    );
    await controller.restore();
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(fetch).not.toHaveBeenCalled();
    controller.dispose();
    expect(await db.getAllAsync('SELECT environment, account_id FROM financial_reads')).toEqual([
      { environment: other, account_id: alex },
    ]);
    expect(await copies.load(alex, path)).toEqual(current);
    expect(await drafts.load(alex, 'trip')).toEqual({ description: 'Unsaved dinner' });
    expect(await attempts.load(alex, 'trip')).toEqual({ submissionKey: 'same-key', amount: 12 });
    expect(await copies.usage?.(alex)).toEqual([expect.objectContaining({ path, lastUsed: 123 })]);
  });

  it('counts UTF-8 row bytes and persists last use separately from original verification', async () => {
    const copies = createAccountGroupRecordStore(environment, 'saved');
    const value = {
      version: 1,
      accountId: alex,
      path,
      refreshedAt: 123,
      value: { title: 'Café 😀' },
    };
    vi.spyOn(Date, 'now').mockReturnValue(456);
    await copies.save(alex, path, value);
    const [row] = await copies.usage!(alex);
    expect(row).toEqual({
      path,
      bytes: Buffer.byteLength(environment + alex + path + JSON.stringify(value), 'utf8') + 8,
      lastUsed: 456,
    });
    await copies.touch!(alex, path, 789);
    expect(await copies.load(alex, path)).toEqual(value);
    expect(await copies.usage!(alex)).toEqual([{ ...row, lastUsed: 789 }]);
    const restarted = createAccountGroupRecordStore(environment, 'saved');
    await restarted.prepare!();
    expect(await restarted.usage!(alex)).toEqual([{ ...row, lastUsed: 789 }]);
    await copies.remove(alex, path);
    await copies.touch!(alex, path, 999);
    expect(await copies.load(alex, path)).toBeNull();
  });
});
