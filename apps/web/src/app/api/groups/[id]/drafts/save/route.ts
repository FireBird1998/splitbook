import { draftBody } from '@/lib/draft-http';
import { getAuthUser, success, unauthorized } from '@/lib/utils/api-response';
import { expenseDraftService } from '@/lib/services/expense-draft.service';
import { draftError, privateDraftResponse } from '@/lib/draft-response';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getAuthUser();
    if (!actor) return privateDraftResponse(unauthorized());
    return privateDraftResponse(
      success(await expenseDraftService.save(actor, (await params).id, await draftBody(request))),
    );
  } catch (cause) {
    return privateDraftResponse(draftError(cause));
  }
}
