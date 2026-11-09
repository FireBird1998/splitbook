import { replaceEqualDeep, type InfiniteData } from '@tanstack/query-core';
import type { FindableRecordStore } from './account-record-storage';

/**
 * A display read as the query cache holds it (ADR 0006, AMEND-2): the server's JSON as received,
 * parsed only when used, and when it was verified. `saved` marks a copy restored from this
 * device, which is never fresh.
 */
export type Envelope = { source: 'network' | 'saved'; refreshedAt: number; value: unknown };

/** The server can't be reached, and this device has no saved copy of the view. */
export const notSaved = 'This view was not saved on this device. Connect to load it.';
export const notSavedHere =
  'Could not save this view for offline use. Online data is still available.';

/**
 * The saved-copy queue (ADR 0006, M3-2): saved copies are written one at a time, and the latest
 * write for a query wins, so an older one still waiting is dropped. Sign-out, an account change
 * and a 401 cancel what is waiting; the write already running finishes.
 */
export function createSavedCopyQueue() {
  const waiting = new Map<string, () => Promise<void>>();
  let tail = Promise.resolve();
  return {
    push(key: string, write: () => Promise<void>) {
      const queued = waiting.has(key);
      waiting.set(key, write);
      if (queued) return;
      tail = tail.then(async () => {
        const latest = waiting.get(key);
        waiting.delete(key);
        await latest?.().catch(() => undefined);
      });
    },
    cancel: () => waiting.clear(),
    /** A write for `key` still waiting is never made. */
    drop: (key: string) => void waiting.delete(key),
    /** Settles once the write running now, and every one still waiting, has. */
    idle: () => tail,
  };
}

/**
 * A page of a Group's Expenses as its query holds it: the server's page with its own time (a
 * saved copy keeps the time it was verified), or `failed`, a page that couldn't be read after the
 * ones before it, which ends the list there and is what Load more reads next.
 */
export type PageEnvelope =
  | (Envelope & { page: number })
  | { source: 'failed'; page: number; refreshedAt: number; value: null; message: string };

type Pages = InfiniteData<PageEnvelope, number>;
/**
 * A list read again keeps each page that answered the same, matched by its number, not its place:
 * after the window slides, the pages that stayed keep their rows, which then render as they were
 * (#219). TanStack shares by position, which a dropped page would shift.
 */
export const sharePages = (old: unknown, next: unknown): unknown => {
  const before = old as Pages | undefined,
    after = next as Pages;
  if (!before?.pages || !after?.pages) return next;
  const pages = after.pages.map((page, index) => {
    const at = before.pageParams.indexOf(after.pageParams[index]);
    return at < 0 ? page : (replaceEqualDeep(before.pages[at], page) as PageEnvelope);
  });
  const pageParams = replaceEqualDeep(before.pageParams, after.pageParams);
  return pageParams === before.pageParams &&
    pages.length === before.pages.length &&
    pages.every((page, index) => page === before.pages[index])
    ? before
    : { pages, pageParams };
};

export const MAX_PAGES = 5;
/** A stale time that is stale whatever the clock says, even moved back past a read. */
export const STALE = -Infinity;

/**
 * The paths of the persister's rows for this account: those it lists, so rows saved before this
 * session count too, and those named in `known`, for a store that can't list its rows. Only the
 * keys are read where the store can, so a row that can't be read never stops a removal.
 */
export const rowPaths = async (
  rows: FindableRecordStore,
  accountId: string,
  known: Iterable<string> = [],
) => {
  const paths = new Set(known);
  const listed = rows.keys
    ? await rows.keys(accountId)
    : (await rows.list(accountId)).map(({ groupId }) => groupId);
  for (const path of listed) paths.add(path);
  return paths;
};
