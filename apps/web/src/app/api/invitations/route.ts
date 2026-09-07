import { getAuthUser, unauthorized, success, serverError } from '@/lib/utils/api-response';
import { invitationService } from '@/lib/services/invitation.service';

// GET /api/invitations — Get my pending invitations
export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const invitations = await invitationService.getPendingByEmail(user.email!);
    return success(invitations);
  } catch (err) {
    return serverError(err);
  }
}
