import { readGroupLedger } from '@/lib/group-ledger-read';
import {
  getAuthUser,
  unauthorized,
  success,
  serverError,
  routeIds,
} from '@/lib/utils/api-response';
import { expenseService } from '@/lib/services/expense.service';

// GET /api/groups/[id]/expenses/check-duplicate?description=...&amount=...&date=...
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);

    let query: Parameters<typeof expenseService.checkDuplicate>;
    return await readGroupLedger<Response>({
      actor: { kind: 'member', id: user.id! },
      groupId: id,
      validate: () => {
        const { searchParams } = new URL(req.url);
        const description = searchParams.get('description');
        const amount = searchParams.get('amount');
        const date = searchParams.get('date');
        const excludeId = searchParams.get('excludeId') || undefined;

        if (!description || !amount || !date) {
          return success({ isDuplicate: false });
        }

        query = [id, description, parseFloat(amount), new Date(date), excludeId];
      },
      read: async () => {
        return success(await expenseService.checkDuplicate(...query));
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
