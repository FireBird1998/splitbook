import { getAuthUser, success, unauthorized } from '@/lib/utils/api-response';
import { tagManagementService } from '@/lib/services/tag-management.service';
import {
  invalidTagId,
  tagError,
  tagGroupIdSchema,
  tagRequestIdSchema,
} from '@/lib/tag-management-http';
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    const { id, requestId } = await params;
    if (!tagGroupIdSchema.safeParse(id).success || !tagRequestIdSchema.safeParse(requestId).success)
      return invalidTagId();
    return success(await tagManagementService.check(id, user.id, requestId));
  } catch (err) {
    return tagError(err);
  }
}
