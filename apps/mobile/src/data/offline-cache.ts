import { z } from 'zod';
export interface OfflineIdentityStore {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
  clear(): Promise<void>;
}
const cached = z.object({
  version: z.literal(1),
  accountId: z.string(),
  path: z.string(),
  refreshedAt: z.number().finite().nonnegative(),
  value: z.unknown(),
});
export function cachedRead(value: unknown, accountId: string, path: string, now: number) {
  const result = cached.safeParse(value);
  return result.success &&
    result.data.accountId === accountId &&
    result.data.path === path &&
    result.data.refreshedAt <= now
    ? result.data
    : null;
}
