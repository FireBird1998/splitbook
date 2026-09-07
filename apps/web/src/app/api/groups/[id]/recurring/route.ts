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
import { groupService } from '@/lib/services/group.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { createRecurringExpenseSchema } from '@/lib/validators/recurring-expense.validator';

const recurringValidationMessages: Record<string, string> = {
  INVALID_MEMBERS: 'All payers and split participants must be group members',
  INVALID_TAG: 'Tag must be an active group tag',
  CURRENCY_MISMATCH: 'Currency must match the group default currency',
  INVALID_WINDOW: 'End date must be on or after the start date',
  NOT_HOUSEHOLD: 'Recurring expenses are only available in Household groups',
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

// POST /api/groups/[id]/recurring — Create a recurring template (admin only)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const body = await req.json();
    const parsed = createRecurringExpenseSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const template = await recurringExpenseService.create(id, parsed.data, user.id!);
    if (!template) return notFound('Group');

    return success(template, 201);
  } catch (err) {
    return mapServiceError(err);
  }
}

// GET /api/groups/[id]/recurring — List recurring templates (any member)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const templates = await recurringExpenseService.list(id);
    return success(templates);
  } catch (err) {
    return serverError(err);
  }
}
