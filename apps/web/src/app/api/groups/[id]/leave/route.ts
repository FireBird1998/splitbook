import { after } from 'next/server';
import { resumeRequestedGroupDeletions } from '@/lib/services/group-cleanup.service';
import {
  getAuthUser,
  unauthorized,
  success,
  notFound,
  serverError,
  routeIds,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';

// POST /api/groups/[id]/leave — The signed-in member leaves the Group
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);
    const body: unknown = await req.json().catch(() => null);
    const acknowledgement =
      typeof body === 'object' &&
      body !== null &&
      'deleteIfLastMember' in body &&
      body.deleteIfLastMember === true;
    const result = await groupService.leave(id, user.id, acknowledgement);
    if (!result) return notFound('Group');
    if ('deletionPending' in result && result.deletionPending)
      after(() =>
        resumeRequestedGroupDeletions()
          .then(() => undefined)
          .catch(() => undefined),
      );

    return success({
      message: 'Left group',
      archived: result.archived,
      ...('deleted' in result
        ? { deleted: result.deleted, deletionPending: result.deletionPending }
        : {}),
    });
  } catch (err) {
    return serverError(err, 'membership');
  }
}
