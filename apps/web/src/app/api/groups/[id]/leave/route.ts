import { after } from 'next/server';
import { resumeRequestedGroupDeletions } from '@/lib/services/group-cleanup.service';
import { leaveOpenBalance, leaveRecurringProblem } from '@/lib/departure-refusals';
import {
  getAuthUser,
  unauthorized,
  success,
  notFound,
  forbidden,
  serverError,
  error,
  routeIds,
} from '@/lib/utils/api-response';
import { groupService, LeaveBlockedError } from '@/lib/services/group.service';

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
    if (err instanceof LeaveBlockedError && err.code === 'LAST_ADMIN') {
      return error('Make someone else an admin before you leave.', 409, 'LAST_ADMIN');
    }
    if (err instanceof LeaveBlockedError && err.code === 'OPEN_BALANCE') {
      return leaveOpenBalance(err.balances);
    }
    if (err instanceof LeaveBlockedError && err.code === 'RECURRING_EXPENSE_PROBLEM') {
      return leaveRecurringProblem(err.recurringExpenses, err.admin);
    }
    if (err instanceof Error && err.message === 'GROUP_DELETION_CONFIRMATION_REQUIRED') {
      return error(
        'You are the last member. Leaving will permanently delete this Group and its history. Confirm deletion to continue.',
        409,
        'GROUP_DELETION_CONFIRMATION_REQUIRED',
      );
    }
    if (err instanceof Error && err.message === 'GROUP_DELETION_UNAVAILABLE') {
      return error(
        'Permanent Group deletion is unavailable here. You are still a member; no history was deleted.',
        409,
        'GROUP_DELETION_UNAVAILABLE',
      );
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    if (err instanceof Error && err.message === 'LEAVE_CONFLICT') {
      return error('This Group changed while you were leaving. Try again.', 409, 'LEAVE_CONFLICT');
    }
    return serverError(err);
  }
}
