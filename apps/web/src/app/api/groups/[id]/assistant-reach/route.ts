import { readGroupMetadata } from '@/lib/group-ledger-read';
import { assistantReachesGroup } from '@splitbook/shared/assistant-reach';
import {
  getAuthUser,
  unauthorized,
  success,
  serverError,
  routeIds,
} from '@/lib/utils/api-response';
import { auth } from '@/lib/auth';
import { whatsLive } from '@/lib/landing/whats-live';
import { groupReach } from '@/lib/mcp/group-reach';

// GET /api/groups/[id]/assistant-reach — Admins see whose assistants reach the Group (#621)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);
    return await readGroupMetadata({
      actor: { kind: 'member', id: user.id! },
      groupId: id,
      requiredRole: 'admin',
      read: async (group) => {
        // Where assistants are off, or the Group doesn't allow them, none reaches it.
        const reachGroup = { id, assistantRule: group.assistantRule };
        if (!whatsLive().assistants.available || !assistantReachesGroup(reachGroup))
          return success({ reach: [] });
        const members = group.members.map((member) => {
          const person = member.user as unknown as { _id: { toString(): string }; name?: string };
          return { id: person._id.toString(), name: person.name ?? '' };
        });
        return success({
          reach: await groupReach((await auth.$context).adapter, reachGroup, members, process.env),
        });
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
