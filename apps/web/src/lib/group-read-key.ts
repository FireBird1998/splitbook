/**
 * SWR keys for Group reads, scoped to the account that made them. Kept apart
 * from `group-read.ts` so the request helper can recognise them without
 * importing the fetcher it is part of.
 */
export const groupReadKey = (actorId: string, path: string) =>
  ['group-read', actorId, path] as const;
export type GroupReadKey = ReturnType<typeof groupReadKey>;

/** Also used by mutation callers when invalidating account-scoped reads. */
export function isGroupReadKey(key: unknown, pathPrefix = '/api/groups'): key is GroupReadKey {
  return (
    Array.isArray(key) &&
    key.length === 3 &&
    key[0] === 'group-read' &&
    typeof key[1] === 'string' &&
    typeof key[2] === 'string' &&
    key[2].startsWith(pathPrefix)
  );
}
