import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { queryKeyPath, searchKey, type AccountQueryKey } from '@splitbook/shared/query-keys';
import { parseSearchResponse } from '@splitbook/shared/search-read';
import { fetcher } from '@/lib/utils/fetcher';

/**
 * The web's one fixed environment and account for shared query keys (#210 point 4, #235): a tab
 * reads only its own origin, and only for the account it was rendered for, since a tab whose
 * session moves to another account reloads (#199).
 */
export { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';

/** How long typing pauses before the search read is made. */
export const SEARCH_DEBOUNCE_MS = 200;

async function fetchSearch(key: AccountQueryKey) {
  // A response the shared decoder rejects is a failed read, never shown.
  return parseSearchResponse(await fetcher(queryKeyPath(key)));
}

/** `value`, once it has stopped changing for `delay` ms. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * Search the member's Groups for a normalized query; no read for an empty one. The previous
 * results stay while the next ones load, so the list doesn't blink as the member types.
 */
export function useSearch(query: string) {
  return useSWR(query ? searchKey(WEB_QUERY_ACCOUNT, query) : null, fetchSearch, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
}
