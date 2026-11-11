import { readGroupLedger } from '@/lib/group-ledger-read';
import { getAuthUser, unauthorized, success, failedRead, routeIds } from '@/lib/utils/api-response';
import { balanceService } from '@/lib/services/balance.service';

// GET /api/groups/[id]/balances — Get group balances
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);

    return success(
      await readGroupLedger({
        actor: { kind: 'member', id: user.id! },
        groupId: id,
        deletionMarker: 'allow-retained-members',
        read: (group) => balanceService.getGroupBalances(group, { viewerId: user.id! }),
      }),
    );
  } catch (err) {
    return failedRead(err, req);
  }
}
