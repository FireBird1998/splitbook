import { queryKeyPath, type QueryKey } from '@splitbook/shared/query-keys';
import type { FindableRecordStore } from './account-record-storage';
import type { AccountStorageLease } from './types';

/** SI megabytes, measured as stored UTF-8 row bytes; drafts and attempts are in other stores. */
export const SAVED_COPY_LIMIT_BYTES = 20_000_000;
export interface SavedCopyUsage {
  path: string;
  bytes: number;
  lastUsed: number;
}
export type SavedQueryRecords = FindableRecordStore & {
  /** Native adapters measure rows without reading their potentially large JSON values. */
  usage?(accountId: string): Promise<SavedCopyUsage[]>;
  /** Updates an existing row's usage time, never its verification time or a removed row. */
  touch?(accountId: string, path: string, time: number): Promise<void>;
  /** Removes pre-persister rows in this environment before the first restore or sign-in. */
  prepare?(): Promise<void>;
  /** Optional adapter trim; controller cleanup still discovers every Group row. */
  retainGroups?(accountId: string, groupIds: string[]): Promise<void>;
};

/** UTF-8 bytes, including astral characters; JavaScript string length counts UTF-16 units. */
export function utf8Bytes(value: string) {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/**
 * One saved-copy lane for every view. It never uses the strict money queue. The captured lease
 * checks each write at execution time; usage inspection cannot authorize a later eviction.
 * Home and the route's Group are checked anew immediately before each removal.
 */
export function savedCopyBudget({
  rows,
  lease,
  openGroup,
  now,
}: {
  rows?: SavedQueryRecords;
  lease(): AccountStorageLease | null;
  openGroup(): string | null;
  now(): number;
}) {
  let tail: Promise<unknown> = Promise.resolve();
  const shownAt = new Map<string, number>();
  const queued = <T>(operation: () => Promise<T>) => {
    const result = tail.catch(() => undefined).then(operation);
    tail = result;
    return result;
  };
  const usage = async (accountId: string): Promise<SavedCopyUsage[]> => {
    if (rows!.usage) return rows!.usage(accountId);
    const records = rows!.list
      ? await rows!.list(accountId)
      : await Promise.all(
          (await rows!.keys!(accountId)).map(async (path) => ({
            groupId: path,
            value: await rows!.load(accountId, path),
          })),
        );
    return records.map(({ groupId: path, value }) => ({
      path,
      bytes: utf8Bytes(accountId) + utf8Bytes(path) + utf8Bytes(JSON.stringify(value)),
      lastUsed:
        shownAt.get(accountId + path) ??
        (value &&
        typeof value === 'object' &&
        'refreshedAt' in value &&
        typeof value.refreshedAt === 'number'
          ? value.refreshedAt
          : 0),
    }));
  };
  const protectedRow = (path: string) => {
    if (path === '/api/groups' || path === '/api/user/balances') return true;
    const group = /^\/api\/groups\/([a-f\d]{24})(?:\/|\?|$)/i.exec(path)?.[1];
    return !!group && group === openGroup();
  };
  const trim = async (held: AccountStorageLease) => {
    const stored = await held.writeSavedCopy(() => usage(held.accountId));
    let bytes = stored.reduce((sum, row) => sum + row.bytes, 0);
    const candidates = [...stored];
    const lastUsed = (row: SavedCopyUsage) =>
      Math.max(row.lastUsed, shownAt.get(held.accountId + row.path) ?? 0);
    while (bytes > SAVED_COPY_LIMIT_BYTES && candidates.length) {
      candidates.sort((a, b) => lastUsed(a) - lastUsed(b) || a.path.localeCompare(b.path));
      const row = candidates.shift()!;
      await held.writeSavedCopy(async () => {
        if (protectedRow(row.path)) return;
        await rows!.remove(held.accountId, row.path);
        bytes -= row.bytes;
      });
    }
  };
  const touch = (accountId: string, paths: string[]) => {
    const held = lease();
    if (!rows || held?.accountId !== accountId) return;
    const time = now();
    for (const path of paths) shownAt.set(accountId + path, time);
    if (!rows.touch) return;
    void queued(async () => {
      for (const path of paths) await held.writeSavedCopy(() => rows.touch!(accountId, path, time));
    }).catch(() => undefined);
  };
  return {
    rows: rows && {
      ...rows,
      load: async (accountId: string, path: string) => {
        const value = await rows.load(accountId, path);
        if (value !== null) touch(accountId, [path]);
        return value;
      },
      save: async (accountId: string, path: string, value: unknown) => {
        const held = lease();
        if (held?.accountId !== accountId) return Promise.resolve();
        shownAt.set(accountId + path, now());
        await held.writeSavedCopy(() => rows.save(accountId, path, value));
        // A cap inspection must not hold the view's next row behind this save. Its own lane
        // still drains before account purge, and every eviction checks the captured lease.
        void queued(() => trim(held)).catch(() => undefined);
      },
    },
    /** Old persister rows must be capped even if this restored account only reads offline. */
    adopted() {
      const held = lease();
      if (rows && held) void queued(() => trim(held)).catch(() => undefined);
    },
    /** A query already in memory has just become visible again, without a network read. */
    shown(key: QueryKey, data: unknown) {
      const held = lease();
      if (!held || !data) return;
      const paths =
        typeof data === 'object' && 'pageParams' in data && Array.isArray(data.pageParams)
          ? data.pageParams.map((page: number) => {
              const path = queryKeyPath(key);
              return path.includes('/expenses?')
                ? path.replace('/expenses?', `/expenses?page=${page}&`)
                : path.replace('/activity?', `/activity?page=${page}&`);
            })
          : [queryKeyPath(key)];
      touch(held.accountId, paths);
    },
    retire: () => shownAt.clear(),
    idle: () => tail.catch(() => undefined),
  };
}
