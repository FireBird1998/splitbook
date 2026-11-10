import { Refusal } from '@splitbook/shared/refusals';
import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  serverError,
  validationError,
  readJson,
  routeIds,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { createSettlementBatch } from '@/lib/services/settlement-batch.service';
import { createSettlementBatchSchema } from '@splitbook/shared/validators/settlement-batch';
import { parseIdempotencyKey } from '@/lib/financial-write';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();
    const { id } = await routeIds(params);
    if (!(await groupService.isMember(id, user.id!))) return forbidden();
    const key = parseIdempotencyKey(req.headers.get('Idempotency-Key'));
    if (!key) throw new Refusal('INVALID_IDEMPOTENCY_KEY');
    const parsed = createSettlementBatchSchema.safeParse(await readJson(req));
    if (!parsed.success) return validationError(parsed.error);
    return success(await createSettlementBatch(id, parsed.data, user.id!, key), 201);
  } catch (err) {
    return serverError(err);
  }
}
