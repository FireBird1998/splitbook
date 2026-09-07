import {
  getAuthUser,
  unauthorized,
  forbidden,
  notFound,
  success,
  serverError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { balanceService } from '@/lib/services/balance.service';

// GET /api/groups/[id]/balances — Get group balances
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const balances = await balanceService.getGroupBalances(id);
    if (!balances) return notFound('Group');

    return success(balances);
  } catch (err) {
    return serverError(err);
  }
}
