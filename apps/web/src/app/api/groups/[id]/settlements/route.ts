import { readGroupLedger } from '@/lib/group-ledger-read';
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
import { settlementService } from '@/lib/services/settlement.service';
import { createSettlementSchema } from '@splitbook/shared/validators/settlement';
import { parseIdempotencyKey } from '@/lib/financial-write';

// POST /api/groups/[id]/settlements — Record settlement
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const body = await readJson(req);
    const parsed = createSettlementSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const settlement = await settlementService.create(
      id,
      parsed.data,
      user.id!,
      parseIdempotencyKey(req.headers.get('Idempotency-Key')),
    );
    return success(settlement, 201);
  } catch (err) {
    return serverError(err);
  }
}

// GET /api/groups/[id]/settlements — List settlements
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);

    return await readGroupLedger({
      actor: { kind: 'member', id: user.id! },
      groupId: id,
      read: async () => {
        const settlements = await settlementService.getGroupSettlements(id);
        return success(settlements);
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
