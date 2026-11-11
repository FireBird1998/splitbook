import { readGroupMetadata } from '@/lib/group-ledger-read';
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
import { createRecurringExpenseSchema } from '@splitbook/shared/validators/recurring-expense';
import { assertRecurringExpensesOn } from '@/lib/recurring-expenses-switch';

// POST /api/groups/[id]/recurring — Create a recurring template (admin only).
// While recurring Expenses are off: 409 RECURRING_EXPENSES_OFF, before the body is read.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    assertRecurringExpensesOn();

    const { id } = await routeIds(params);
    const body = await readJson(req);
    const parsed = createRecurringExpenseSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const template = await recurringExpenseService.create(id, parsed.data, user.id!);
    if (!template) return notFound('Group');

    return success(template, 201);
  } catch (err) {
    return serverError(err);
  }
}

// GET /api/groups/[id]/recurring — List recurring templates (any member).
// While recurring Expenses are off a member gets an empty list, never a refusal: a 403 from a
// read under a Group tells the web app the reader lost the Group.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);

    return await readGroupMetadata({
      actor: { kind: 'member', id: user.id! },
      groupId: id,
      deletionMarker: 'allow-retained-members',
      read: async (_group, storedGroup) => success(await recurringExpenseService.list(storedGroup)),
    });
  } catch (err) {
    return serverError(err);
  }
}
