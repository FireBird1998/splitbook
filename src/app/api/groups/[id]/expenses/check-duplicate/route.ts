import {
  getAuthUser,
  unauthorized,
  forbidden,
  success,
  serverError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';

// GET /api/groups/[id]/expenses/check-duplicate?description=...&amount=...&date=...
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const { searchParams } = new URL(req.url);
    const description = searchParams.get('description');
    const amount = searchParams.get('amount');
    const date = searchParams.get('date');
    const excludeId = searchParams.get('excludeId') || undefined;

    if (!description || !amount || !date) {
      return success({ isDuplicate: false });
    }

    const result = await expenseService.checkDuplicate(
      id,
      description,
      parseFloat(amount),
      new Date(date),
      excludeId,
    );

    return success(result);
  } catch (err) {
    return serverError(err);
  }
}
