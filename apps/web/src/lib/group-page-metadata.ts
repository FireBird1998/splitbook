import type { Metadata } from 'next';
import { GROUP_TABS, type GroupTab } from '@/components/groups/group-tabs';
import { Types } from 'mongoose';
import { getAuthUser } from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';

/** A private Group name belongs in metadata only for a current member. */
export async function groupPageMetadata(
  params: Promise<{ id: string }>,
  page?: string,
): Promise<Metadata> {
  const generic = { title: page ? `Group · ${page}` : 'Group' };
  try {
    const user = await getAuthUser();
    if (!user) return generic;
    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return generic;
    const group = await groupService.getMemberName(id, user.id);
    if (!group) return generic;
    return { title: page ? `${group.name} · ${page}` : group.name };
  } catch {
    return generic;
  }
}

/** Tab titles share the navigation's labels. Expenses is the Group's default page. */
export function groupTabMetadata(params: Promise<{ id: string }>, tab: GroupTab) {
  const label = tab === 'expenses' ? undefined : GROUP_TABS.find(({ slug }) => slug === tab)?.label;
  return groupPageMetadata(params, label);
}
