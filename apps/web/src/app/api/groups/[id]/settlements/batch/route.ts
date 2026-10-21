import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  serverError,
  validationError,
  error,
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
    if (!key) throw new Error('INVALID_IDEMPOTENCY_KEY');
    const parsed = createSettlementBatchSchema.safeParse(await readJson(req));
    if (!parsed.success) return validationError(parsed.error);
    return success(await createSettlementBatch(id, parsed.data, user.id!, key), 201);
  } catch (err) {
    const messages: Record<string, string> = {
      INVALID_MEMBERS: 'Both payer and recipient must be group members',
      SAME_PARTY: 'Payer and recipient must be different people',
      FORBIDDEN_SETTLEMENT: 'Only the payer or recipient can record this payment',
      CURRENCY_MISMATCH: 'Currency is not one of this Group’s currencies',
      NO_SETTLEMENT_DEBT:
        'This pair no longer has a Debt or Suggested payment in one of these currencies. Reload before recording the payment.',
    };
    if (err instanceof Error && messages[err.message])
      return error(messages[err.message], 422, err.message);
    if (err instanceof Error && err.message === 'SETTLEMENT_TRANSACTIONS_REQUIRED')
      return error(
        'Payments across several currencies need a transactional database. Nothing was recorded.',
        503,
        err.message,
      );
    return serverError(err);
  }
}
