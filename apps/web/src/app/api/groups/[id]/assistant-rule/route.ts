import {
  getAuthUser,
  unauthorized,
  success,
  forbidden,
  serverError,
  validationError,
  readJson,
  routeIds,
} from '@/lib/utils/api-response';
import { groupService } from '@/lib/services/group.service';
import { assistantRuleChangeSchema } from '@splitbook/shared/validators/group';

// PUT /api/groups/[id]/assistant-rule — An admin allows or stops members' assistants (#621)
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await routeIds(params);
    const parsed = assistantRuleChangeSchema.safeParse(await readJson(req));
    if (!parsed.success) return validationError(parsed.error);

    return success(await groupService.setAssistantRule(id, parsed.data.rule, user.id!));
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    return serverError(err);
  }
}
