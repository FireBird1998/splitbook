import User from '@/lib/models/User';

interface GroupWithMembers {
  members: Array<{ user: unknown; role?: string }>;
}

/**
 * A Group read with the email addresses its viewer may see (#517). Members come from the
 * services with their name and photo only (`person-fields.ts`); the Group's admin gets every
 * member's address back, as Settings shows them, and anyone else only their own.
 */
export async function withMemberEmails<G extends GroupWithMembers>(
  group: G,
  viewer: { id: string; email?: string | null },
  everyone: boolean,
): Promise<G> {
  const idOf = (user: unknown) => String((user as { _id: unknown })._id);
  const emails = new Map<string, string>();
  if (everyone) {
    const users = await User.find({ _id: { $in: group.members.map(({ user }) => idOf(user)) } })
      .select('email')
      .lean();
    for (const user of users) if (user.email) emails.set(String(user._id), user.email);
  } else if (viewer.email) emails.set(viewer.id, viewer.email);
  return {
    ...group,
    members: group.members.map((member) => {
      const email = emails.get(idOf(member.user));
      return email ? { ...member, user: { ...(member.user as object), email } } : member;
    }),
  };
}

/** Whether the viewer is an admin of the Group. */
export const isGroupAdmin = (group: GroupWithMembers, viewerId: string) =>
  group.members.some(
    (member) =>
      String((member.user as { _id: unknown })._id) === viewerId && member.role === 'admin',
  );
