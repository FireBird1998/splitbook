import { z } from 'zod';
import {
  getAuthUser,
  serverError,
  success,
  unauthorized,
  validationError,
} from '@/lib/utils/api-response';
import { userActivityService } from '@/lib/services/user-activity.service';
import {
  USER_ACTIVITY_DEFAULT_LIMIT,
  USER_ACTIVITY_MAX_LIMIT,
} from '@splitbook/shared/user-activity-read';

/** `limit` is a whole number of at least 1; a larger one than the cap is cut to the cap. */
const activityQuery = z.object({
  limit: z.coerce.number().int().min(1).default(USER_ACTIVITY_DEFAULT_LIMIT),
});

// GET /api/user/activity?limit=10 — the latest Activity across the signed-in member's Groups
export async function GET(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(req.url);
    const parsed = activityQuery.safeParse({ limit: searchParams.get('limit') ?? undefined });
    if (!parsed.success) return validationError(parsed.error);

    const limit = Math.min(parsed.data.limit, USER_ACTIVITY_MAX_LIMIT);
    return success(await userActivityService.getUserActivity(user.id, limit));
  } catch (err) {
    return serverError(err);
  }
}
