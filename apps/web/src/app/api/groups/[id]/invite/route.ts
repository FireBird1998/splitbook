import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  error,
  serverError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { invitationService } from '@/lib/services/invitation.service';
import { z } from 'zod/v4';

const inviteSchema = z.object({
  email: z.email('Invalid email address'),
});

// POST /api/groups/[id]/invite — Send email invitation
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const body = await req.json();
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return error('Invalid email address', 422);
    }

    const invitation = await invitationService.create(id, parsed.data.email, user.id!);
    return success(invitation, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'ALREADY_INVITED') {
      return error('This person has already been invited', 409);
    }
    return serverError(err);
  }
}
