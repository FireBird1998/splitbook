import {
  getAuthUser,
  unauthorized,
  success,
  forbidden,
  serverError,
  routeIds,
} from '@/lib/utils/api-response';
import { groupCurrencyService } from '@/lib/services/group-currency.service';

// DELETE /api/groups/[id]/currencies/[code] — an admin removes an extra currency nothing uses (#721)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    const { code } = await params;
    // Only the Group's id is an id; the code is checked against the Group's list.
    const { id } = await routeIds(params.then(({ id }) => ({ id })));
    return success(await groupCurrencyService.remove(id, code, user.id!));
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    return serverError(err);
  }
}
