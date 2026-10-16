import { getAuthUser, success, unauthorized } from '@/lib/utils/api-response';
import { tagManagementService } from '@/lib/services/tag-management.service';
import {
  invalidTagId,
  readTagCommand,
  tagError,
  tagGroupIdSchema,
} from '@/lib/tag-management-http';
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Context) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    const { id } = await params;
    if (!tagGroupIdSchema.safeParse(id).success) return invalidTagId();
    return success(await tagManagementService.snapshot(id, user.id));
  } catch (err) {
    return tagError(err);
  }
}
export async function POST(req: Request, { params }: Context) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    const { id } = await params;
    if (!tagGroupIdSchema.safeParse(id).success) return invalidTagId();
    return success(await tagManagementService.submit(id, user.id, await readTagCommand(req)));
  } catch (err) {
    return tagError(err);
  }
}
