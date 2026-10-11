import { draftBody, assertDraftOrigin } from '@/lib/draft-http';
import { replaceExpenseDraftSchema } from '@splitbook/shared/validators/expense-draft';
import { getAuthUser, success, unauthorized } from '@/lib/utils/api-response';
import { expenseDraftService } from '@/lib/services/expense-draft.service';
import { draftError, privateDraftResponse } from '@/lib/draft-response';
import { requestRevision } from '@/lib/ledger-revision';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string; draftId: string }> };

export async function PUT(request: Request, { params }: Context) {
  try {
    const actor = await getAuthUser();
    if (!actor) return privateDraftResponse(unauthorized());
    const { id, draftId } = await params;
    const { values } = replaceExpenseDraftSchema.parse(await draftBody(request));
    return privateDraftResponse(
      success(
        await expenseDraftService.replace(actor, id, draftId, values, requestRevision(request)),
      ),
    );
  } catch (cause) {
    return privateDraftResponse(draftError(cause));
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertDraftOrigin(request);
    const actor = await getAuthUser();
    if (!actor) return privateDraftResponse(unauthorized());
    const { id, draftId } = await params;
    return privateDraftResponse(
      success(await expenseDraftService.discard(actor, id, draftId, requestRevision(request))),
    );
  } catch (cause) {
    return privateDraftResponse(draftError(cause));
  }
}
