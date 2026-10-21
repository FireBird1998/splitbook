import {
  getAuthUser,
  unauthorized,
  success,
  forbidden,
  serverError,
  validationError,
  readJson,
  routeIds,
} from '@/lib/utils/api-response';
import { groupCurrencyService } from '@/lib/services/group-currency.service';
import { addGroupCurrencySchema } from '@splitbook/shared/validators/group';

const refused = (err: unknown) =>
  err instanceof Error && err.message === 'FORBIDDEN' ? forbidden() : serverError(err);

// GET /api/groups/[id]/currencies — the Group's currencies and what uses each one (#721)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    const { id } = await routeIds(params);
    return success(await groupCurrencyService.settings(id, user.id!));
  } catch (err) {
    return refused(err);
  }
}

// POST /api/groups/[id]/currencies — any member adds an extra currency (#721)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    const { id } = await routeIds(params);
    const parsed = addGroupCurrencySchema.safeParse(await readJson(req));
    if (!parsed.success) return validationError(parsed.error);
    return success(await groupCurrencyService.add(id, parsed.data.currency, user.id!), 201);
  } catch (err) {
    return refused(err);
  }
}
