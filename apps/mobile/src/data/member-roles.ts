import type { MemberRole } from '@splitbook/shared/types';
import type { MobileGroup } from './types';

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
