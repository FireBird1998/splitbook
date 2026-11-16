import { failedRead } from '@/lib/utils/api-response';
import { getSpendingByDay } from '@/lib/services/spending-by-day.service';

/** GET /api/user/spending/days?month=2026-11&tz=Asia/Kolkata (#1273). */
export async function GET(req: Request) {
  try {
    return Response.json(await getSpendingByDay('', { month: '', timeZone: '' }));
  } catch (err) {
    return failedRead(err, req);
  }
}
