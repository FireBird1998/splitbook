import type { AuthContext } from 'better-auth';
import { connectedAssistantName } from './assistant-name';
import type { McpConnection, McpConsent } from './grants';

type Adapter = Pick<AuthContext['adapter'], 'findMany' | 'findOne'>;
type Connection = McpConnection & { excludedGroupIds?: string[] | null };

/** A member's Connected assistant that reaches a Group, as its admins see it (#621). */
export interface AssistantReach {
  member: { id: string; name: string };
  assistant: string;
  lastUsedAt: Date | null;
}

const PAGE = 100;

/**
 * The members' Connected assistants that reach a Group: each live connection (its consent is for
 * the connection's current generation) whose member didn't leave the Group out (#617). The
 * caller checks the Group's own rule.
 */
export async function groupReach(
  adapter: Adapter,
  groupId: string,
  members: { id: string; name: string }[],
): Promise<AssistantReach[]> {
  // Stored exclusions are lower case; the route also accepts an id in capitals.
  const id = groupId.toLowerCase();
  const names = new Map(members.map((member) => [member.id, member.name]));
  const reach: AssistantReach[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await adapter.findMany<Connection>({
      model: 'mcpConnection',
      where: [{ field: 'userId', operator: 'in', value: [...names.keys()] }],
      limit: PAGE,
      offset,
      sortBy: { field: 'createdAt', direction: 'asc' },
    });
    for (const row of rows) {
      if (row.excludedGroupIds?.includes(id)) continue;
      const live = await adapter.findOne<McpConsent>({
        model: 'oauthConsent',
        where: [
          { field: 'userId', value: row.userId },
          { field: 'clientId', value: row.clientId },
          { field: 'referenceId', value: row.generation },
        ],
      });
      if (!live) continue;
      reach.push({
        member: { id: row.userId, name: names.get(row.userId) ?? '' },
        assistant: row.name ?? (await connectedAssistantName(adapter, row.clientId)),
        lastUsedAt: row.lastUsedAt ?? null,
      });
    }
    if (rows.length < PAGE) break;
  }
  return reach.sort(
    (a, b) => a.member.name.localeCompare(b.member.name) || a.assistant.localeCompare(b.assistant),
  );
}
