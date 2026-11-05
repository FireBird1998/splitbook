import {
  getAuthUser,
  unauthorized,
  success,
  notFound,
  forbidden,
  serverError,
  validationError,
  error,
  readJson,
  routeIds,
} from '@/lib/utils/api-response';
import { removalOpenBalance } from '@/lib/departure-refusals';
import { groupService, RemovalBlockedError } from '@/lib/services/group.service';
import { z } from 'zod/v4';

const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']),
});

// PATCH /api/groups/[id]/members/[userId] — Update member role
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id, userId: targetUserId } = await routeIds(params);
    const body = await readJson(req);
    const parsed = updateMemberSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const result = await groupService.updateMemberRole(
      id,
      targetUserId,
      parsed.data.role,
      user.id!,
    );
    if (!result) return notFound('Group');

    return success(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    if (err instanceof Error && err.message === 'LAST_ADMIN')
      return error('Cannot demote the last admin. Promote another member first.', 409);
    return serverError(err);
  }
}

// DELETE /api/groups/[id]/members/[userId] — Remove member from group. A member who owes or is
// owed stays until they're settled up, as they would to leave (#875).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id, userId: targetUserId } = await routeIds(params);

    const result = await groupService.removeMember(id, targetUserId, user.id!);
    if (!result) return notFound('Group');

    return success({ message: 'Member removed' });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    if (err instanceof Error && err.message === 'LAST_ADMIN')
      return error('Cannot remove the last admin.', 409);
    if (err instanceof Error && err.message === 'SELF_REMOVE')
      return error('You cannot remove yourself. Use leave group instead.', 400);
    if (err instanceof RemovalBlockedError) return removalOpenBalance(err.memberName, err.balances);
    if (err instanceof Error && err.message === 'REMOVAL_CONFLICT')
      return error(
        'This Group changed while you were removing this member. Try again.',
        409,
        'REMOVAL_CONFLICT',
      );
    return serverError(err);
  }
}
