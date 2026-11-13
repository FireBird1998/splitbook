import {
  getAuthUser,
  unauthorized,
  success,
  serverError,
  validationError,
  readJson,
  routeIds,
} from '@/lib/utils/api-response';
import { groupHeaderSchema } from '@splitbook/shared/group-header';
import { saveGroupHeader } from '@/lib/services/group-header.service';

/** Any current member sets the Group's header; the ordinary Group PATCH stays admin-only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    const { id } = await routeIds(params);
    const parsed = groupHeaderSchema.safeParse(await readJson(req));
    if (!parsed.success) return validationError(parsed.error);
    return success(await saveGroupHeader(id, parsed.data, user.id!));
  } catch (err) {
    return serverError(err);
  }
}
