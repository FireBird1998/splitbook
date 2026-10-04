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
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';

// GET /api/groups/[id]/balances — Get group balances
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    // Lazy-on-read: materialize due recurring expenses before computing, so
    // Balances agree with the Group and Expense reads a client starts beside it.
    await recurringExpenseService.generateDueExpenses(id);

    const balances = await balanceService.getGroupBalances(id);
    if (!balances) return notFound('Group');

    return success(balances);
  } catch (err) {
    return serverError(err);
  }
}
