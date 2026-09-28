import {
  getAuthUser,
  unauthorized,
  forbidden,
  notFound,
  success,
  serverError,
  validationError,
  error,
} from '@/lib/utils/api-response';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { updateExpenseSchema } from '@splitbook/shared/validators/expense';
import { requestRevision } from '@/lib/ledger-revision';

const expenseValidationMessages: Record<string, string> = {
  INVALID_MEMBERS: 'All payers and split participants must be group members',
  INVALID_TAG: 'Tag must be an active group tag',
  CURRENCY_MISMATCH: 'Currency must match the group default currency',
};

// GET /api/groups/[id]/expenses/[expenseId]
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; expenseId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id, expenseId } = await params;

    const expense = await expenseService.getById({ actorId: user.id!, groupId: id, expenseId });
    if (!expense) return notFound('Expense');

    return success(expense);
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
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

    const { id, expenseId } = await params;

    // Preserve forbidden-before-invalid-body response ordering. The expense
    // module independently enforces access; this preflight is not its guard.
    if (!(await groupService.isMember(id, user.id!))) return forbidden();

    const body = await req.json();
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
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    if (err instanceof Error && err.message in expenseValidationMessages) {
      return error(expenseValidationMessages[err.message], 422, err.message);
    }

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

    const { id, expenseId } = await params;

    const expense = await expenseService.delete(
      { actorId: user.id!, groupId: id, expenseId },
      requestRevision(req),
    );
    if (!expense) return notFound('Expense');

    return success({ message: 'Expense deleted', revision: expense.revision ?? 0 });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    return serverError(err);
  }
}
