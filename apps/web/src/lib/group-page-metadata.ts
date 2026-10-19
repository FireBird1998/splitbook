import type { Metadata } from 'next';
import { Types } from 'mongoose';
import { getAuthUser } from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';

/** A private Group name belongs in metadata only for a current member. */
export async function groupPageMetadata(
  params: Promise<{ id: string }>,
  page?: string,
): Promise<Metadata> {
  const generic = { title: page ? `Group · ${page}` : 'Group' };
  const user = await getAuthUser();
  if (!user) return generic;
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return generic;
  if (!(await groupService.isMember(id, user.id))) return generic;
  const group = await groupService.getById(id);
  // Recheck the returned read too: membership may have changed between the two reads.
  if (!group?.members.some((member) => String(member.user._id) === user.id)) return generic;
  return { title: page ? `${group.name} · ${page}` : group.name };
}
