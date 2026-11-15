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

/** The Group's other admins, who'd stay if `userId` stepped down (#1254). */
export function otherAdmins(
  group: Pick<MobileGroup, 'members'>,
  userId: string | null | undefined,
) {
  return group.members.filter((member) => member.role === 'admin' && member.user.id !== userId);
}

/** Whether `userId` is an admin with another admin beside them, so they may step down (#1254). */
export function canStepDown(
  group: Pick<MobileGroup, 'members'> | null | undefined,
  userId: string | null | undefined,
) {
  return !!group && isGroupAdmin(group, userId) && otherAdmins(group, userId).length > 0;
}
