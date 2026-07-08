import {
  getAuthUser,
  unauthorized,
  forbidden,
  notFound,
  success,
  serverError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';

// POST /api/groups/[id]/invite-link — Generate invite link
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const expiresInDays = body.expiresInDays || 7;

    const result = await groupService.generateInviteCode(id, user.id!, expiresInDays);
    if (!result) return notFound('Group');

    return success(result, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    return serverError(err);
  }
}

// GET /api/groups/[id]/invite-link — Get current invite link
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const group = await groupService.getById(id);
    if (!group) return notFound('Group');

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    if (!group.inviteCode || !group.inviteCodeExpiresAt || new Date() > group.inviteCodeExpiresAt) {
      return success({ inviteCode: null, inviteUrl: null, expiresAt: null });
    }

    return success({
      inviteCode: group.inviteCode,
      inviteUrl: `${process.env.NEXT_PUBLIC_APP_URL}/join/${group.inviteCode}`,
      expiresAt: group.inviteCodeExpiresAt,
    });
  } catch (err) {
    return serverError(err);
  }
}
