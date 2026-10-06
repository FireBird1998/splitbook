import useSWR from 'swr';
import {
  fetchGroupRead,
  groupReadKey,
  readWebGroupListResponse,
  readWebGroupResponse,
  type GroupReadKey,
} from '@/lib/group-read';

async function fetchGroups([, actorId, path]: GroupReadKey) {
  return fetchGroupRead(path, (payload) => readWebGroupListResponse(payload, actorId));
}

async function fetchGroup([, actorId, path]: GroupReadKey) {
  const groupId = path.slice('/api/groups/'.length);
  return fetchGroupRead(path, (payload) => readWebGroupResponse(payload, actorId, groupId));
}

const readOptions = { refreshInterval: 30_000, keepPreviousData: false };
const deniedError = new Error('Group access could not be verified. Please retry.');

/** Whether a read's error is a refusal (the account can't read the Group), not an outage. */
export function isGroupReadDenied(error: unknown): boolean {
  return error === deniedError;
}

export function useGroups(actorId: string) {
  // A response completing after an account switch remains confined to its original key.
  const result = useSWR(
    actorId ? groupReadKey(actorId, '/api/groups') : null,
    fetchGroups,
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
    actorId && groupId ? groupReadKey(actorId, `/api/groups/${groupId}`) : null,
    fetchGroup,
    readOptions,
  );
  return {
    ...result,
    data: result.data?.data,
    error: result.data?.denied ? deniedError : result.error,
  };
}
