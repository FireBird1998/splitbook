import { readGroupLedger } from '@/lib/group-ledger-read';
import {
  getAuthUser,
  unauthorized,
  success,
  notFound,
  serverError,
  validationError,
  readJson,
  routeIds,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { updateGroupSchema } from '@splitbook/shared/validators/group';

// GET /api/groups/[id] — Get group detail
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);
    return success(
      await readGroupLedger({
        actor: { kind: 'member', id: user.id! },
        groupId: id,
        missingGroup: 'not-found',
        deletionMarker: 'allow-retained-members',
        read: (group) => groupService.readForMember(group, { id: user.id!, email: user.email }),
      }),
    );
  } catch (err) {
    return serverError(err);
  }
}

// PATCH /api/groups/[id] — Update group
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);
    const body = await readJson(req);
    const parsed = updateGroupSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const group = await groupService.update(id, parsed.data, user.id!);
    if (!group) return notFound('Group');

    return success(group);
  } catch (err) {
    return serverError(err);
  }
}

// DELETE /api/groups/[id] — Archive group
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);
    const group = await groupService.archive(id, user.id!);
    if (!group) return notFound('Group');

    return success({ message: 'Group archived' });
  } catch (err) {
    return serverError(err);
  }
}
