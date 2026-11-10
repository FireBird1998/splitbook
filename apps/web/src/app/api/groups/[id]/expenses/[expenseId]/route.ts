import {
  getAuthUser,
  unauthorized,
  forbidden,
  notFound,
  success,
  serverError,
  validationError,
  readJson,
  routeIds,
} from '@/lib/utils/api-response';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { updateExpenseSchema } from '@splitbook/shared/validators/expense';
import { requestRevision } from '@/lib/ledger-revision';

// GET /api/groups/[id]/expenses/[expenseId]
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; expenseId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id, expenseId } = await routeIds(params);

    const expense = await expenseService.getById({ actorId: user.id!, groupId: id, expenseId });
    if (!expense) return notFound('Expense');

    return success(expense);
  } catch (err) {
    return serverError(err);
  }
}

// PATCH /api/groups/[id]/expenses/[expenseId]
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; expenseId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id, expenseId } = await routeIds(params);

    // Preserve forbidden-before-invalid-body response ordering. The expense
    // module independently enforces access; this preflight is not its guard.
    if (!(await groupService.isMember(id, user.id!))) return forbidden();

    const body = await readJson(req);
    const parsed = updateExpenseSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const expense = await expenseService.update(
      { actorId: user.id!, groupId: id, expenseId },
      parsed.data,
      requestRevision(req),
    );
    if (!expense) return notFound('Expense');

    return success(expense);
  } catch (err) {
    return serverError(err);
  }
}

// DELETE /api/groups/[id]/expenses/[expenseId]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; expenseId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id, expenseId } = await routeIds(params);

    const expense = await expenseService.delete(
      { actorId: user.id!, groupId: id, expenseId },
      requestRevision(req),
    );
    if (!expense) return notFound('Expense');

    return success({ message: 'Expense deleted', revision: expense.revision ?? 0 });
  } catch (err) {
    return serverError(err);
  }
}
