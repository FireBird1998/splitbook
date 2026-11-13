/** A member-level preference, fenced with Group deletion and recorded with its Activity. */
import connectDB from '@/lib/db';
import { withGroupMutation } from '@/lib/group-mutation';
import Group from '@/lib/models/Group';
import { Refusal } from '@splitbook/shared/refusals';
import { readGroupHeader, type GroupHeader } from '@splitbook/shared/group-header';
import { activityService } from './activity.service';
import { headerScenesEnabled } from '@/lib/header-scenes';

export async function saveGroupHeader(groupId: string, header: GroupHeader, actorId: string) {
  if (!headerScenesEnabled()) throw new Refusal('HEADER_SCENES_DISABLED');
  await connectDB();
  await withGroupMutation(groupId, async (session) => {
    const group = await Group.findOne({ _id: groupId, 'members.user': actorId })
      .session(session ?? null)
      .lean();
    if (!group) throw new Refusal('FORBIDDEN');
    const old = readGroupHeader(group.header);
    if (old.style === header.style && old.scene === header.scene && old.time === header.time)
      return;
    await Group.updateOne({ _id: groupId }, { $set: { header } }).session(session ?? null);
    await activityService.log(groupId, 'group_updated', actorId, {
      changes: { header: { old, new: header } },
    });
  });
  return { header: readGroupHeader(header, headerScenesEnabled()) };
}
