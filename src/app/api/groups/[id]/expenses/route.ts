import { getAuthUser, unauthorized, forbidden, success, serverError, validationError } from "@/lib/utils/api-response";
import { groupService } from "@/lib/services/group.service";
import { expenseService } from "@/lib/services/expense.service";
import { createExpenseSchema } from "@/lib/validators/expense.validator";
import type { ExpenseFilters } from "@/types";

// POST /api/groups/[id]/expenses — Add expense
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const expense = await expenseService.create(id, parsed.data, user.id!);
    return success(expense, 201);
  } catch (err) {
    return serverError(err);
  }
}

// GET /api/groups/[id]/expenses — List expenses with filters
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const { searchParams } = new URL(req.url);

    const filters: ExpenseFilters = {
      quickFilter: searchParams.get("quickFilter") || undefined,
      dateFrom: searchParams.get("dateFrom") || undefined,
      dateTo: searchParams.get("dateTo") || undefined,
      category: searchParams.get("category") || undefined,
      tag: searchParams.get("tag") || undefined,
      search: searchParams.get("search") || undefined,
      paidByUser: searchParams.get("paidByUser") || undefined,
      owedByUser: searchParams.get("owedByUser") || undefined,
      sortBy: (searchParams.get("sortBy") as "date" | "amount") || "date",
      sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
      page: parseInt(searchParams.get("page") || "1"),
      limit: parseInt(searchParams.get("limit") || "20"),
    };

    const result = await expenseService.getGroupExpenses(id, filters, user.id!);
    return success(result);
  } catch (err) {
    return serverError(err);
  }
}

