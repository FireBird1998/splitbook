import {
  getAuthUser,
  unauthorized,
  notFound,
  success,
  error,
  serverError,
} from '@/lib/utils/api-response';
import { invitationService } from '@/lib/services/invitation.service';
import { z } from 'zod/v4';

const actionSchema = z.object({
  action: z.enum(['accept', 'decline']),
});

// POST /api/invitations/[id] — Accept or decline invitation
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const body = await req.json();
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) return error('Invalid action', 422);

    if (parsed.data.action === 'accept') {
      const invitation = await invitationService.accept(id, user.id!);
      if (!invitation) return notFound('Invitation');
      return success({ message: 'Invitation accepted' });
    } else {
      const invitation = await invitationService.decline(id);
      if (!invitation) return notFound('Invitation');
      return success({ message: 'Invitation declined' });
    }
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'INVITATION_NOT_PENDING')
        return error('Invitation is no longer pending', 400);
      if (err.message === 'INVITATION_EXPIRED') return error('Invitation has expired', 410);
    }
    return serverError(err);
  }
}
