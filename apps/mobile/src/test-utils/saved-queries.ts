import type { AccountGroupRecordStore } from '../data/account-record-storage';

/**
 * The persister's rows (ADR 0006, M3-1) for a fixture whose saved copies live in one map: each
 * row sits under the key the fixture's read cache gives the same path (`account + path`, or
 * with `separator` between them), so the fixture's own helpers find it there. `store` replaces
 * how a row is read or written, such as a fixture's slow device or a held write.
 */
export function savedQueriesIn(
  map: Map<string, unknown>,
  store: Partial<AccountGroupRecordStore> = {},
  separator = '',
): AccountGroupRecordStore {
  const key = (account: string, path: string) => account + separator + path;
  return {
    load: async (account, path) => structuredClone(map.get(key(account, path)) ?? null),
    save: async (account, path, value) => {
      map.set(key(account, path), structuredClone(value));
    },
    remove: async (account, path) => {
      map.delete(key(account, path));
    },
    clear: async () => map.clear(),
    ...store,
  };
}
