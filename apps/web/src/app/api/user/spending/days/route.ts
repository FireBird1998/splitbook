import { error, getAuthUser, failedRead, success, unauthorized } from '@/lib/utils/api-response';
import { getSpendingByDay } from '@/lib/services/spending-by-day.service';
import { readSpendingByDayMonth } from '@splitbook/shared/spending-by-day';
import { TimeZoneError, readTimeZone } from '@splitbook/shared/zoned-calendar';

/**
 * GET /api/user/spending/days?month=2026-11&tz=Asia/Kolkata — one Month of the signed-in
 * member's Spending by day across their Groups (#1273): per currency, their share of the Month,
 * each day's share and the Expenses they have a share in. The zone is required: it decides the
 * current Month, so a client may ask for that Month or one of the eleven before it. Days follow
 * the Expense day rule and never move with the zone.
 */
export async function GET(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(req.url);
    let timeZone: string;
    let month: string;
    try {
      timeZone = readTimeZone(searchParams.get('tz'));
    } catch (err) {
      if (err instanceof TimeZoneError) return error(err.message, 400, 'INVALID_TIME_ZONE');
      throw err;
    }
    try {
      month = readSpendingByDayMonth(searchParams.get('month'), { now: new Date(), timeZone });
    } catch (err) {
      if (err instanceof RangeError) return error(err.message, 400, 'INVALID_MONTH');
      throw err;
    }

    return success(await getSpendingByDay(user.id, { month, timeZone }));
  } catch (err) {
    return failedRead(err, req);
  }
}
