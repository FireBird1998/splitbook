import {
  getAuthUser,
  unauthorized,
  success,
  notFound,
  serverError,
} from '@/lib/utils/api-response';
import { whatsLive } from '@/lib/landing/whats-live';
import { assistantLedgerService } from '@/lib/services/assistant-ledger.service';

// GET /api/user/assistant-groups — The member's Groups as an assistant's page lists them (#620)
export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    if (!whatsLive().assistants.available) return notFound('Assistants');
    return success({ groups: await assistantLedgerService.approvalGroups(user.id!) });
  } catch (err) {
    return serverError(err);
  }
}
