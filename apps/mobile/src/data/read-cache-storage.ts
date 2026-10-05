import { z } from 'zod';
import { createAccountGroupRecordStore } from './account-record-storage';
import type { FinancialReadStore } from './offline-cache';

const savedReads = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), z.unknown()),
  groupIds: z.array(z.string()).optional(),
});
/** The account-storage lease serializes read/modify/write; SQLite replaces the document atomically. */
export function createFinancialReadStore(environment: string): FinancialReadStore {
  const storage = createAccountGroupRecordStore(environment, 'cache');
  const load = async (accountId: string) => {
    const value = await storage.load(accountId, 'reads');
    return value === null
      ? { version: 1 as const, entries: {} as Record<string, unknown> }
      : savedReads.parse(value);
  };
  return {
    async load(accountId, path) {
      return (await load(accountId)).entries[path] ?? null;
    },
    async save(accountId, path, value) {
      const document = await load(accountId);
      document.entries[path] = value;
      await storage.save(accountId, 'reads', document);
    },
    async invalidateGroup(accountId, groupId) {
      const document = await load(accountId),
        entries = document.entries,
        prefix = `/api/groups/${groupId}`;
      for (const path of Object.keys(entries)) {
        if (
          path === prefix ||
          path.startsWith(`${prefix}/`) ||
          path.startsWith(`${prefix}?`) ||
          path === '/api/groups' ||
          path === '/api/user/balances'
        )
          delete entries[path];
      }
      await storage.save(accountId, 'reads', document);
    },
    async invalidateLedger(accountId, groupId) {
      const document = await load(accountId),
        entries = document.entries,
        prefix = `/api/groups/${groupId}`;
      let removed = false;
      for (const path of Object.keys(entries)) {
        if (
          path.startsWith(`${prefix}/`) ||
          path.startsWith(`${prefix}?`) ||
          path === '/api/user/balances'
        ) {
          delete entries[path];
          removed = true;
        }
      }
      if (removed) await storage.save(accountId, 'reads', document);
    },
    async retainGroups(accountId, groupIds) {
      const document = await load(accountId),
        entries = document.entries,
        allowed = new Set(groupIds);
      if (document.groupIds?.some((id) => !allowed.has(id))) delete entries['/api/user/balances'];
      document.groupIds = groupIds;
      for (const path of Object.keys(entries)) {
        const id = /^\/api\/groups\/([a-f\d]{24})(?:\/|\?|$)/i.exec(path)?.[1];
        if (id && !allowed.has(id)) {
          delete entries[path];
          delete entries['/api/user/balances'];
        }
      }
      await storage.save(accountId, 'reads', document);
    },
    clear: () => storage.clear(),
  };
}
