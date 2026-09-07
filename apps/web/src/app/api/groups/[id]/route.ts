import {
  getAuthUser,
  unauthorized,
  success,
  notFound,
  forbidden,
  serverError,
  validationError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { updateGroupSchema } from '@/lib/validators/group.validator';

// GET /api/groups/[id] — Get group detail
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const group = await groupService.getById(id);
    if (!group) return notFound('Group');

    // Check membership
    const isMember = group.members.some((m) => {
      const memberUser = m.user as unknown as { _id: { toString(): string } };
      return memberUser._id.toString() === user.id;
    });
    if (!isMember) return forbidden();

    // Lazy-on-read: materialize due recurring expenses (no-op for
    // non-Household themes and when nothing is due).
    await recurringExpenseService.generateDueExpenses(id);

    return success(group);
  } catch (err) {
    return serverError(err);
  }
}

// PATCH /api/groups/[id] — Update group
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const body = await req.json();
    const parsed = updateGroupSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const group = await groupService.update(id, parsed.data, user.id!);
    if (!group) return notFound('Group');

    return success(group);
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    return serverError(err);
  }
}

// DELETE /api/groups/[id] — Archive group
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const group = await groupService.archive(id, user.id!);
    if (!group) return notFound('Group');

    return success({ message: 'Group archived' });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    return serverError(err);
  }
}
