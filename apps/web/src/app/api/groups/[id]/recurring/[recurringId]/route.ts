import {
  getAuthUser,
  unauthorized,
  success,
  notFound,
  serverError,
  validationError,
  readJson,
  routeIds,
} from '@/lib/utils/api-response';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { updateRecurringExpenseSchema } from '@splitbook/shared/validators/recurring-expense';
import { requestRevision } from '@/lib/ledger-revision';
import { assertRecurringExpensesOn } from '@/lib/recurring-expenses-switch';

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

    const { id, recurringId } = await routeIds(params);
    const body = await readJson(req);
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
    return serverError(err);
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

    const { id, recurringId } = await routeIds(params);

    const template = await recurringExpenseService.remove(
      id,
      recurringId,
      user.id!,
      requestRevision(req),
    );
    if (!template) return notFound('Recurring expense');

    return success({ message: 'Recurring expense deleted' });
  } catch (err) {
    return serverError(err);
  }
}
