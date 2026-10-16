import { getAuthUser, success, unauthorized } from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { tagManagementService } from '@/lib/services/tag-management.service';
import {
  invalidTagId,
  readLegacyTagCommand,
  tagError,
  tagGroupIdSchema,
} from '@/lib/tag-management-http';
type Context = { params: Promise<{ id: string; tagId: string }> };
async function mutate(req: Request, { params }: Context, action: 'update' | 'delete') {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    const { id, tagId } = await params;
    if (!tagGroupIdSchema.safeParse(id).success || !tagGroupIdSchema.safeParse(tagId).success)
      return invalidTagId();
    await tagManagementService.submit(id, user.id, await readLegacyTagCommand(req, action, tagId));
    if (!(await groupService.isMember(id, user.id))) throw new Error('FORBIDDEN');
    return success(await groupService.getById(id));
  } catch (err) {
    return tagError(err);
  }
}
export async function PATCH(req: Request, context: Context) {
  return mutate(req, context, 'update');
}
export async function DELETE(req: Request, context: Context) {
  return mutate(req, context, 'delete');
}
