import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  serverError,
  validationError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { z } from 'zod/v4';

const createTagSchema = z.object({
  name: z.string().trim().min(1, 'Tag name is required').max(50),
});

// POST /api/groups/[id]/tags — Create a new tag
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const body = await req.json();
    const parsed = createTagSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const group = await groupService.addTag(id, parsed.data.name, user.id!);
    if (!group)
      return new Response(JSON.stringify({ error: 'Group not found' }), {
        status: 404,
      });

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
