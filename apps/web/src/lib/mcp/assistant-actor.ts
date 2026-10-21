import type { AuthContext } from 'better-auth';
import type { DraftActor } from '@/lib/services/expense-draft.service';
import { assistantForApproval } from './assistant-name';
import { connectionExcludedGroups } from './excluded-groups';

/**
 * The member an MCP request acts for: the assistant as the approval page names it, for Draft
 * attribution (#745), the recheck of the grant before each write, and the Groups the connection
 * leaves out (#617), read once per request so a change applies to the next call.
 */
export async function connectedAssistantActor(
  adapter: Pick<AuthContext['adapter'], 'findOne'>,
  connection: { userId: string; clientId: string; generation: unknown },
  authorize: () => Promise<void>,
): Promise<DraftActor> {
  const { userId, clientId, generation } = connection;
  return {
    id: userId,
    authorize,
    assistant: { name: (await assistantForApproval(adapter, clientId)).name },
    excludedGroupIds: await connectionExcludedGroups(adapter, userId, clientId, generation),
  };
}
