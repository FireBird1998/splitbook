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
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { updateExpenseSchema } from '@/lib/validators/expense.validator';

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

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const expense = await expenseService.getById(expenseId);
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

    const { id, expenseId } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const body = await req.json();
    const parsed = updateExpenseSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const expense = await expenseService.update(expenseId, parsed.data, user.id!);
    if (!expense) return notFound('Expense');

    return success(expense);
  } catch (err) {
    if (err instanceof Error && err.message in expenseValidationMessages) {
      return error(expenseValidationMessages[err.message], 422);
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

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const expense = await expenseService.delete(expenseId, user.id!);
    if (!expense) return notFound('Expense');

    return success({ message: 'Expense deleted' });
  } catch (err) {
    return serverError(err);
  }
}
