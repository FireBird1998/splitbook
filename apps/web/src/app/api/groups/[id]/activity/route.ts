import { Types } from 'mongoose';
import { readGroupLedger } from '@/lib/group-ledger-read';
import {
  getAuthUser,
  unauthorized,
  success,
  serverError,
  routeIds,
} from '@/lib/utils/api-response';
import { activityService } from '@/lib/services/activity.service';

// GET /api/groups/[id]/activity — Get activity feed; `expenseId` narrows it to one Expense
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);

    let query: Parameters<typeof activityService.getGroupActivity>;
    return await readGroupLedger({
      actor: { kind: 'member', id: user.id! },
      groupId: id,
      validate: async () => {
        const { searchParams } = new URL(req.url);
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '20');
        const expenseId = searchParams.get('expenseId') ?? undefined;

        query = [id, page, limit, expenseId];
        const skip = (page - 1) * limit;
        // Keep legacy selectors and pagination answers, including driver faults, before generation.
        if (
          (expenseId !== undefined && !Types.ObjectId.isValid(expenseId)) ||
          // Mongoose accepts NaN pagination by ignoring it. Keep that successful read path.
          [limit, skip].some((value) => !Number.isNaN(value) && !Number.isFinite(value)) ||
          skip < 0
        )
          return success(await activityService.getGroupActivity(...query));
      },
      read: async () => {
        const result = await activityService.getGroupActivity(...query);
        return success(result);
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
