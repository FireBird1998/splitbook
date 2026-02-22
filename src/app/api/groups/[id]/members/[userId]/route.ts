import {
  getAuthUser,
  unauthorized,
  success,
  notFound,
  forbidden,
  serverError,
  validationError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
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

    const { id, userId: targetUserId } = await params;
    const body = await req.json();
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
      return serverError(new Error('Cannot demote the last admin. Promote another member first.'));
    return serverError(err);
  }
}

// DELETE /api/groups/[id]/members/[userId] — Remove member from group
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id, userId: targetUserId } = await params;

    const result = await groupService.removeMember(id, targetUserId, user.id!);
    if (!result) return notFound('Group');

    return success({ message: 'Member removed' });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    if (err instanceof Error && err.message === 'LAST_ADMIN')
      return serverError(new Error('Cannot remove the last admin.'));
    if (err instanceof Error && err.message === 'SELF_REMOVE')
      return serverError(new Error('You cannot remove yourself. Use leave group instead.'));
    return serverError(err);
  }
}
