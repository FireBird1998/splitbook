import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  serverError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { activityService } from '@/lib/services/activity.service';

// GET /api/groups/[id]/activity — Get activity feed
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const result = await activityService.getGroupActivity(id, page, limit);
    return success(result);
  } catch (err) {
    return serverError(err);
  }
}
