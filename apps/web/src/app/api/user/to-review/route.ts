import { getAuthUser, success, unauthorized } from '@/lib/utils/api-response';
import { expenseDraftService } from '@/lib/services/expense-draft.service';
import { draftError, privateDraftResponse } from '@/lib/draft-response';

export const runtime = 'nodejs';
export async function GET() {
  try {
    const actor = await getAuthUser();
    if (!actor) return privateDraftResponse(unauthorized());
    return privateDraftResponse(success(await expenseDraftService.toReview(actor)));
  } catch (cause) {
    return privateDraftResponse(draftError(cause));
  }
}
