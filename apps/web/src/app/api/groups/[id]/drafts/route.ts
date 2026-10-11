import { draftBody } from '@/lib/draft-http';
import { getAuthUser, success, unauthorized } from '@/lib/utils/api-response';
import { expenseDraftService } from '@/lib/services/expense-draft.service';
import { draftError, privateDraftResponse } from '@/lib/draft-response';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await getAuthUser();
    if (!actor) return privateDraftResponse(unauthorized());
    return privateDraftResponse(success(await expenseDraftService.list(actor, (await params).id)));
  } catch (cause) {
    return privateDraftResponse(draftError(cause));
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await getAuthUser();
    if (!actor) return privateDraftResponse(unauthorized());
    const result = await expenseDraftService.create(
      actor,
      (await params).id,
      await draftBody(request),
      request.headers.get('Idempotency-Key') ?? '',
    );
    return privateDraftResponse(success(result, 201));
  } catch (cause) {
    return privateDraftResponse(draftError(cause));
  }
}
