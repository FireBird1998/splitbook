import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  notFound,
  serverError,
  validationError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { z } from 'zod/v4';

const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  isArchived: z.boolean().optional(),
});

// PATCH /api/groups/[id]/tags/[tagId] — Archive/unarchive or rename a tag
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id, tagId } = await params;
    const body = await req.json();
    const parsed = updateTagSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const group = await groupService.updateTag(id, tagId, parsed.data, user.id!);
    if (!group) return notFound('Tag');

    return success(group);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'FORBIDDEN') return forbidden();
      if (err.message === 'TAG_CHANGED' || err.message === 'AMBIGUOUS_TAG') {
        return new Response(
          JSON.stringify({
            error: 'Tag changed or has ambiguous legacy references. Reload and try again.',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (err.message === 'TAG_EXISTS') {
        return new Response(JSON.stringify({ error: 'A tag with this name already exists' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return serverError(err);
  }
}

// DELETE /api/groups/[id]/tags/[tagId] — Delete a tag (only if unused)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id, tagId } = await params;

    const group = await groupService.deleteTag(id, tagId, user.id!);
    if (!group) return notFound('Tag');

    return success(group);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'FORBIDDEN') return forbidden();
      if (err.message.startsWith('TAG_IN_USE:')) {
        const [, expenseCount, templateCount = '0'] = err.message.split(':');
        return new Response(
          JSON.stringify({
            error: `Cannot delete tag — it is used by ${expenseCount} expense(s) and ${templateCount} recurring template(s)`,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }
    return serverError(err);
  }
}
