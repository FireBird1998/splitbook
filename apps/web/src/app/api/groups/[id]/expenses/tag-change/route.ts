import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  serverError,
  validationError,
  error,
  readJson,
  routeIds,
} from '@/lib/utils/api-response';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { expenseTagChangeRequestSchema } from '@splitbook/shared/expense-tag-change';

// POST /api/groups/[id]/expenses/tag-change: several Expenses to one Tag, each on its own (#610).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);

    // Forbidden before an invalid body, as a single edit answers.
    if (!(await groupService.isMember(id, user.id!))) return forbidden();

    const parsed = expenseTagChangeRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) return validationError(parsed.error);

    const results = await expenseService.changeTags(id, user.id!, parsed.data);
    return success({ tagId: parsed.data.tagId, results });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    if (err instanceof Error && err.message === 'INVALID_TAG')
      return error('Tag must be an active group tag', 422, 'INVALID_TAG');
    return serverError(err);
  }
}
