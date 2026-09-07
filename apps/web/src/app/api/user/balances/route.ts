import { getAuthUser, serverError, success, unauthorized } from '@/lib/utils/api-response';
import { balanceService } from '@/lib/services/balance.service';

// GET /api/user/balances — Get the signed-in user's cross-group balances by currency
export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const balances = await balanceService.getUserBalances(user.id!);
    return success(balances);
  } catch (err) {
    return serverError(err);
  }
}
