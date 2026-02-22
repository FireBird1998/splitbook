import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  serverError,
  validationError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { settlementService } from '@/lib/services/settlement.service';
import { createSettlementSchema } from '@/lib/validators/settlement.validator';

// POST /api/groups/[id]/settlements — Record settlement
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const body = await req.json();
    const parsed = createSettlementSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const settlement = await settlementService.create(id, parsed.data, user.id!);
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

    const { id } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const settlements = await settlementService.getGroupSettlements(id);
    return success(settlements);
  } catch (err) {
    return serverError(err);
  }
}
