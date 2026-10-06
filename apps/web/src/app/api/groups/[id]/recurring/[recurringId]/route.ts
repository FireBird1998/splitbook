import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  notFound,
  serverError,
  validationError,
  error,
} from '@/lib/utils/api-response';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { updateRecurringExpenseSchema } from '@splitbook/shared/validators/recurring-expense';
import { requestRevision } from '@/lib/ledger-revision';
import { assertRecurringExpensesOn } from '@/lib/recurring-expenses-switch';

const recurringValidationMessages: Record<string, string> = {
  INVALID_MEMBERS: 'All payers and split participants must be group members',
  INVALID_TAG: 'Tag must be an active group tag',
  CURRENCY_MISMATCH: 'Currency must match the group default currency',
  INVALID_WINDOW: 'End date must be on or after the start date',
};

function mapServiceError(err: unknown) {
  if (err instanceof Error) {
    if (err.message === 'FORBIDDEN') return forbidden();
    if (err.message in recurringValidationMessages) {
      return error(recurringValidationMessages[err.message], 422);
    }
  }
  return serverError(err);
}

// PATCH /api/groups/[id]/recurring/[recurringId] — Edit, pause or resume a template (admin
// only). While recurring Expenses are off: 409 RECURRING_EXPENSES_OFF, before the body is read.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; recurringId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    assertRecurringExpensesOn();

    const { id, recurringId } = await params;
    const body = await req.json();
    const parsed = updateRecurringExpenseSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const template = await recurringExpenseService.update(
      id,
      recurringId,
      parsed.data,
      user.id!,
      requestRevision(req),
    );
    if (!template) return notFound('Recurring expense');

    return success(template);
  } catch (err) {
    return mapServiceError(err);
  }
}

// DELETE /api/groups/[id]/recurring/[recurringId] — Delete a template (admin only).
// Expenses the template already generated are never touched. While recurring Expenses are
// off: 409 RECURRING_EXPENSES_OFF, and the template stays.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; recurringId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    assertRecurringExpensesOn();

    const { id, recurringId } = await params;

    const template = await recurringExpenseService.remove(
      id,
      recurringId,
      user.id!,
      requestRevision(req),
    );
    if (!template) return notFound('Recurring expense');

    return success({ message: 'Recurring expense deleted' });
  } catch (err) {
    return mapServiceError(err);
  }
}
