import {
  getAuthUser,
  unauthorized,
  success,
  notFound,
  forbidden,
  serverError,
  routeIds,
} from '@/lib/utils/api-response';
import { auth } from '@/lib/auth';
import { isGroupAdmin } from '@/lib/group-member-emails';
import { mcpResource } from '@/lib/mcp/config';
import { groupReach } from '@/lib/mcp/group-reach';
import { groupService } from '@/lib/services/group.service';

// GET /api/groups/[id]/assistant-reach — Admins see whose assistants reach the Group (#621)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);
    const group = await groupService.getById(id);
    if (!group) return notFound('Group');
    if (!isGroupAdmin(group, user.id!)) return forbidden();

    // Where assistants are off, or the Group doesn't allow them, none reaches it.
    if (!mcpResource() || group.assistantRule === 'not_allowed') return success({ reach: [] });
    const members = group.members.map((member) => {
      const person = member.user as unknown as { _id: { toString(): string }; name?: string };
      return { id: person._id.toString(), name: person.name ?? '' };
    });
    return success({ reach: await groupReach((await auth.$context).adapter, id, members) });
  } catch (err) {
    return serverError(err);
  }
}
