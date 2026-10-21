import {
  error,
  forbidden,
  getAuthUser,
  notFound,
  failedRead,
  success,
  unauthorized,
  routeIds,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { getGroupInsights } from '@/lib/services/group-insights.service';
import { readCompareMonths } from '@splitbook/shared/insights';
import { CURRENCY_CODES } from '@splitbook/shared/currency';
import { TimeZoneError, isMonthKey, readTimeZone } from '@splitbook/shared/zoned-calendar';

/**
 * GET /api/groups/[id]/insights?month=2026-09&compare=6&tz=Asia/Kolkata — a Group's Month
 * against the Months before it, for the Insights tab (#314): each Month's Spent, Expense count,
 * the member's share and what they paid (and, while recurring Expenses are on, how many they
 * added), the average of the earlier Months (never the Month itself), and the Month's biggest
 * Expense, in exact minor units of the Group's currency.
 *
 * - Members only, with the same refusal as the Group's other reads.
 * - `tz` is required: a Month is the viewer's, never the server's. Unknown zones are refused.
 * - `month` (`YYYY-MM`) defaults to the current Month in that zone.
 * - `compare` is how many Months before it to compare it with, 1–12; 6 by default.
 * - `currency` picks the currency the figures are in (#729). Without it the read opens on the
 *   currency with the most Expenses in the Month, a tie going to the Group's main currency.
 *   `currencies` lists what was spent in each, for the currency switch.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);
    const isMember = await groupService.isMember(id, user.id);
    if (!isMember) return forbidden();

    const { searchParams } = new URL(req.url);
    let timeZone: string;
    let compare: number;
    try {
      timeZone = readTimeZone(searchParams.get('tz'));
    } catch (err) {
      if (err instanceof TimeZoneError) return error(err.message, 400, 'INVALID_TIME_ZONE');
      throw err;
    }
    // Empty is unset, as for `compare`. Year 0 is refused so a year of earlier Months fits.
    const month = searchParams.get('month') || null;
    if (month !== null && (!isMonthKey(month) || month < '0001-01'))
      return error('Send a Month as YYYY-MM, such as 2026-09.', 400, 'INVALID_MONTH');
    try {
      compare = readCompareMonths(searchParams.get('compare'));
    } catch (err) {
      if (err instanceof RangeError) return error(err.message, 400, 'INVALID_COMPARE');
      throw err;
    }

    // Empty is unset. Any supported code is read, a currency nothing was spent in as zeros.
    const currency = searchParams.get('currency') || null;
    if (currency !== null && !CURRENCY_CODES.includes(currency))
      return error('Send a currency code, such as INR.', 400, 'INVALID_CURRENCY');

    const insights = await getGroupInsights(id, user.id, {
      month: month ?? undefined,
      compare,
      timeZone,
      currency: currency ?? undefined,
    });
    if (!insights) return notFound('Group');
    return success(insights);
  } catch (err) {
    return failedRead(err, req);
  }
}
