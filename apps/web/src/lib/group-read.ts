import { fetcher, HttpResponseError } from '@/lib/utils/fetcher';
import {
  parseGroupListResponse,
  parseGroupResponse,
  type GroupRead,
} from '@splitbook/shared/group-read';

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

function belongsToActor(group: GroupRead, actorId: string) {
  return Boolean(actorId) && group.members.some((member) => member.user._id === actorId);
}

export function readWebGroupListResponse(payload: unknown, actorId: string): GroupRead[] {
  try {
    const groups = parseGroupListResponse(payload);
    if (!actorId || groups.some((group) => !belongsToActor(group, actorId))) throw new Error();
    return groups;
  } catch {
    throw new Error('Groups could not be loaded. Please retry.');
  }
}

export function readWebGroupResponse(
  payload: unknown,
  actorId: string,
  groupId: string,
): GroupRead {
  try {
    const group = parseGroupResponse(payload);
    if (group._id !== groupId || !belongsToActor(group, actorId)) throw new Error();
    return group;
  } catch {
    throw new Error('Group could not be loaded. Please retry.');
  }
}

export type GroupReadResult<T> = { data: T; denied?: never } | { denied: true; data?: never };

/** Denials replace cached success; later transient failures cannot revive revoked data. */
export async function fetchGroupRead<T>(
  path: string,
  decode: (payload: unknown) => T,
): Promise<GroupReadResult<T>> {
  try {
    return { data: decode(await fetcher(path)) };
  } catch (error) {
    if (error instanceof HttpResponseError && [401, 403, 404].includes(error.status)) {
      return { denied: true };
    }
    throw error;
  }
}
