import { after } from 'next/server';
import { resumeRequestedGroupDeletions } from '@/lib/services/group-cleanup.service';
import {
  getAuthUser,
  unauthorized,
  success,
  serverError,
  validationError,
  readJson,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { createGroupSchema } from '@splitbook/shared/validators/group';
import { parseIdempotencyKey } from '@/lib/financial-write';
import { withMemberEmails } from '@/lib/group-member-emails';

// POST /api/groups — Create a new group
export async function POST(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const body = await readJson(req);
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
    // Recovery runs after the response; only explicit recorded requests are eligible.
    after(() =>
      resumeRequestedGroupDeletions()
        .then(() => undefined)
        .catch(() => undefined),
    );
    // Each member gets their own address in the list, and nobody else's (#517).
    const viewer = { id: user.id!, email: user.email };
    return success(
      await Promise.all(groups.map((group) => withMemberEmails(group, viewer, false))),
    );
  } catch (err) {
    return serverError(err);
  }
}
