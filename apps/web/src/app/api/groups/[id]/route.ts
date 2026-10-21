import {
  getAuthUser,
  unauthorized,
  success,
  notFound,
  forbidden,
  serverError,
  validationError,
  readJson,
  routeIds,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { isGroupAdmin, withMemberEmails } from '@/lib/group-member-emails';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { updateGroupSchema } from '@splitbook/shared/validators/group';

// GET /api/groups/[id] — Get group detail
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);
    const group = await groupService.getById(id, user.id!);
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

    // Its admin gets every member's address, for Settings; any other member only their own (#517).
    return success(
      await withMemberEmails(
        group,
        { id: user.id!, email: user.email },
        isGroupAdmin(group, user.id!),
      ),
    );
  } catch (err) {
    return serverError(err);
  }
}

// PATCH /api/groups/[id] — Update group
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);
    const body = await readJson(req);
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

    const { id } = await routeIds(params);
    const group = await groupService.archive(id, user.id!);
    if (!group) return notFound('Group');

    return success({ message: 'Group archived' });
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    return serverError(err);
  }
}
