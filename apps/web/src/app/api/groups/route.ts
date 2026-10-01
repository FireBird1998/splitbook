import {
  getAuthUser,
  unauthorized,
  success,
  serverError,
  validationError,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { createGroupSchema } from '@splitbook/shared/validators/group';
import { parseIdempotencyKey } from '@/lib/financial-write';

// POST /api/groups — Create a new group
export async function POST(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const body = await req.json();
    const parsed = createGroupSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    // A keyed replay returns the Group the first request created instead of a duplicate.
    const group = await groupService.create(
      parsed.data,
      user.id!,
      parseIdempotencyKey(req.headers.get('Idempotency-Key')),
    );
    return success(group, 201);
  } catch (err) {
    return serverError(err);
  }
}

// GET /api/groups — List user's groups
export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const groups = await groupService.getUserGroups(user.id!);
    return success(groups);
  } catch (err) {
    return serverError(err);
  }
}
