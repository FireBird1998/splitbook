import { error, getAuthUser, serverError, success, unauthorized } from '@/lib/utils/api-response';
import { getMemberSpending } from '@/lib/services/spending.service';
import { readSpendingMonths } from '@splitbook/shared/insights';
import { TimeZoneError, readTimeZone } from '@splitbook/shared/zoned-calendar';

/**
 * GET /api/user/spending?months=6&tz=Asia/Kolkata — the signed-in member's share of spending
 * across their Groups, by calendar Month in the time zone they send, per currency, with each
 * Group's part (#307). The zone is required: a Month is the viewer's, never the server's.
 */
export async function GET(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(req.url);
    let timeZone: string;
    let months: number;
    try {
      timeZone = readTimeZone(searchParams.get('tz'));
    } catch (err) {
      if (err instanceof TimeZoneError) return error(err.message, 400, 'INVALID_TIME_ZONE');
      throw err;
    }
    try {
      months = readSpendingMonths(searchParams.get('months'));
    } catch (err) {
      if (err instanceof RangeError) return error(err.message, 400, 'INVALID_MONTHS');
      throw err;
    }

    return success(await getMemberSpending(user.id, { months, timeZone }));
  } catch (err) {
    return serverError(err);
  }
}
