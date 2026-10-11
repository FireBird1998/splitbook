import { draftBody } from '@/lib/draft-http';
import { z } from 'zod/v4';
import { draftObjectId } from '@splitbook/shared/validators/expense-draft';
import { getAuthUser, success, unauthorized } from '@/lib/utils/api-response';
import { expenseDraftService } from '@/lib/services/expense-draft.service';
import { draftError, privateDraftResponse } from '@/lib/draft-response';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getAuthUser();
    if (!actor) return privateDraftResponse(unauthorized());
    const { ids } = z
      .object({ ids: z.array(draftObjectId).min(1).max(100) })
      .strict()
      .parse(await draftBody(request));
    const { id } = await params;
    const reviews = [];
    for (const draftId of ids) reviews.push(await expenseDraftService.review(actor, id, draftId));
    return privateDraftResponse(success(reviews));
  } catch (cause) {
    return privateDraftResponse(draftError(cause));
  }
}
