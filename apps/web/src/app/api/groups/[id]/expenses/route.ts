import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  serverError,
  validationError,
  error,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { createExpenseSchema } from '@splitbook/shared/validators/expense';
import type { ExpenseFilters } from '@splitbook/shared/types';
import { parseIdempotencyKey } from '@/lib/financial-write';

const expenseValidationMessages: Record<string, string> = {
  INVALID_MEMBERS: 'All payers and split participants must be group members',
  INVALID_TAG: 'Tag must be an active group tag',
  CURRENCY_MISMATCH: 'Currency must match the group default currency',
};

// POST /api/groups/[id]/expenses — Add expense
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    // Check membership
    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const body = await req.json();
    const parsed = createExpenseSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const expense = await expenseService.create(
      id,
      parsed.data,
      user.id!,
      parseIdempotencyKey(req.headers.get('Idempotency-Key')),
    );
    return success(expense, 201);
  } catch (err) {
    if (err instanceof Error && err.message in expenseValidationMessages) {
      return error(expenseValidationMessages[err.message], 422, err.message);
    }

    return serverError(err);
  }
}

// GET /api/groups/[id]/expenses — List expenses with filters
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    // Lazy-on-read: materialize due recurring expenses before listing, so the
    // response includes rows that fell due since the last read.
    await recurringExpenseService.generateDueExpenses(id);

    const { searchParams } = new URL(req.url);

    const filters: ExpenseFilters = {
      quickFilter: searchParams.get('quickFilter') || undefined,
      dateFrom: searchParams.get('dateFrom') || undefined,
      dateTo: searchParams.get('dateTo') || undefined,
      category: searchParams.get('category') || undefined,
      tag: searchParams.get('tag') || undefined,
      tagId: searchParams.get('tagId') || undefined,
      search: searchParams.get('search') || undefined,
      paidByUser: searchParams.get('paidByUser') || undefined,
      owedByUser: searchParams.get('owedByUser') || undefined,
      sortBy: (searchParams.get('sortBy') as 'date' | 'amount') || 'date',
      sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '20'),
      includeMemberBreakdown: searchParams.get('includeMemberBreakdown') === '1' || undefined,
    };

    const result = await expenseService.getGroupExpenses(id, filters, user.id!);
    return success(result);
  } catch (err) {
    return serverError(err);
  }
}
