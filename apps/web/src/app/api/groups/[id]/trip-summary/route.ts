import {
  error,
  forbidden,
  getAuthUser,
  notFound,
  serverError,
  success,
  unauthorized,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { getTripSummary } from '@/lib/services/trip-summary.service';
import { TimeZoneError, readTimeZone } from '@splitbook/shared/zoned-calendar';

/**
 * GET /api/groups/[id]/trip-summary?tz=Asia/Kolkata — a Trip's whole-trip summary, for its
 * Insights tab (#316): Spent, the member's share and what they paid, per person per day, each
 * day with its two biggest Expenses and the daily average, Expenses outside the Trip's dates,
 * By Tag, and the payments Balances suggests for the wrap-up, in exact minor units of the
 * Group's currency.
 *
 * - Members only, with the same refusal as the Group's other reads (403 for a non-member, a
 *   member who has left, or a Group that isn't there), before the query is read.
 * - `tz` is required: a day is the viewer's, never the server's. Unknown zones are refused
 *   (400 `INVALID_TIME_ZONE`), as the insights and spending reads do.
 * - Only a Trip has one: a Group of another Theme gets 409 `NOT_A_TRIP`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const isMember = await groupService.isMember(id, user.id);
    if (!isMember) return forbidden();

    const { searchParams } = new URL(req.url);
    let timeZone: string;
    try {
      timeZone = readTimeZone(searchParams.get('tz'));
    } catch (err) {
      if (err instanceof TimeZoneError) return error(err.message, 400, 'INVALID_TIME_ZONE');
      throw err;
    }

    const result = await getTripSummary(id, user.id, { timeZone });
    if (result.kind === 'missing') return notFound('Group');
    if (result.kind === 'not-a-trip')
      return error('Only a Trip has a Trip summary.', 409, 'NOT_A_TRIP');
    return success(result.summary);
  } catch (err) {
    return serverError(err);
  }
}
