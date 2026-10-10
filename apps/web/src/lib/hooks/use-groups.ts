import useSWR from 'swr';
import { groupsKey, groupKey } from '@splitbook/shared/query-keys';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { fetchWebGroups, fetchWebGroup } from '@/lib/web-read';

const readOptions = { refreshInterval: 30_000, keepPreviousData: false };
const deniedError = new Error('Group access could not be verified. Please retry.');

/** Whether a read's error is a refusal (the account can't read the Group), not an outage. */
export function isGroupReadDenied(error: unknown): boolean {
  return error === deniedError;
}

export function useGroups(actorId: string) {
  // The expected-account header and 419 reload pin this document to actorId (#199).
  const result = useSWR(
    actorId ? groupsKey(WEB_QUERY_ACCOUNT) : null,
    (key) => fetchWebGroups(key, actorId),
    readOptions,
  );
  return {
    ...result,
    data: result.data?.data,
    error: result.data?.denied ? deniedError : result.error,
  };
}

export function useGroup(actorId: string, groupId: string) {
  const result = useSWR(
    actorId && groupId ? groupKey(WEB_QUERY_ACCOUNT, groupId) : null,
    (key) => fetchWebGroup(key, actorId),
    readOptions,
  );
  return {
    ...result,
    data: result.data?.data,
    error: result.data?.denied ? deniedError : result.error,
  };
}
