import { getAuthUser, success, unauthorized } from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { tagManagementService } from '@/lib/services/tag-management.service';
import {
  invalidTagId,
  readLegacyTagCommand,
  tagError,
  tagGroupIdSchema,
} from '@/lib/tag-management-http';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    const { id } = await params;
    if (!tagGroupIdSchema.safeParse(id).success) return invalidTagId();
    await tagManagementService.submit(id, user.id, await readLegacyTagCommand(req, 'create'));
    if (!(await groupService.isMember(id, user.id))) throw new Error('FORBIDDEN');
    return success(await groupService.getById(id));
  } catch (err) {
    return tagError(err);
  }
}
