import type { MemberRole } from '@splitbook/shared/types';
import type { MemberRemovalState, MobileGroup } from './types';

/** Whether this account is one of the Group's admins, as the Group read shows it. */
export function isGroupAdmin(
  group: Pick<MobileGroup, 'members'> | null | undefined,
  userId: string | null | undefined,
) {
  return (
    !!userId &&
    !!group?.members.some((member) => member.user.id === userId && member.role === 'admin')
  );
}

/** A role as a sentence gives it: "Sam Chen is now an admin", "Couldn’t make Priya Shah a member". */
export const roleComplement: Record<MemberRole, string> = {
  admin: 'an admin',
  member: 'a member',
};

/**
 * Whether the Remove sheet can send the removal (#1253): once confirmed, after a failure, or after
 * the Group changed meanwhile. Every other refusal leaves nothing to send.
 */
export function removalSendable({ status, code }: Pick<MemberRemovalState, 'status' | 'code'>) {
  return (
    status === 'confirm' ||
    status === 'error' ||
    (status === 'refused' && code === 'REMOVAL_CONFLICT')
  );
}

/** People named in a sentence: "Sam Chen", "Priya Shah and Sam Chen", "A, B and C" (#1254). */
export function namesInSentence(names: string[]) {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? '');
}
