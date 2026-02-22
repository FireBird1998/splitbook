import {
  getAuthUser,
  unauthorized,
  notFound,
  error,
  success,
  serverError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';

// POST /api/join/[code] — Join group via invite link
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { code } = await params;

    const group = await groupService.findByInviteCode(code);
    if (!group) return notFound('Invite link is invalid or expired');

    // Check if already a member
    const isMember = group.members.some((m) => {
      const memberUser = m.user as unknown as { _id: { toString(): string } };
      return memberUser._id.toString() === user.id;
    });

    if (isMember) {
      return success({ message: 'Already a member', groupId: group._id });
    }

    await groupService.addMember(group._id.toString(), user.id!, 'member', undefined, 'link');

    return success({ message: 'Joined group', groupId: group._id }, 201);
  } catch (err) {
    return serverError(err);
  }
}

// GET /api/join/[code] — Get group info for invite link
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;

    const group = await groupService.findByInviteCode(code);
    if (!group) return notFound('Invite link is invalid or expired');

    return success({
      _id: group._id,
      name: group.name,
      category: group.category,
      memberCount: group.members.length,
    });
  } catch (err) {
    return serverError(err);
  }
}
