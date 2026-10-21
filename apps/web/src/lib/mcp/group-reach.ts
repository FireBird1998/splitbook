import type { AuthContext } from 'better-auth';
import { connectionName } from './assistant-name';
import type { AuthEnv } from '@/lib/auth/create-auth';
import { liveMcpConsent, type McpConnection } from './grants';

type Adapter = Pick<AuthContext['adapter'], 'findMany' | 'findOne'>;

/** A member's Connected assistant that reaches a Group, as its admins see it (#621). */
export interface AssistantReach {
  member: { id: string; name: string };
  assistant: string;
  lastUsedAt: Date | null;
}

const PAGE = 100;

/**
 * The members' Connected assistants that reach a Group: each live connection (its consent is for
 * the connection's current generation, and it hasn't expired, #618) whose member didn't leave the
 * Group out (#617). The caller checks the Group's own rule.
 */
export async function groupReach(
  adapter: Adapter,
  groupId: string,
  members: { id: string; name: string }[],
  env: AuthEnv,
): Promise<AssistantReach[]> {
  // Stored exclusions are lower case; the route also accepts an id in capitals.
  const id = groupId.toLowerCase();
  const names = new Map(members.map((member) => [member.id, member.name]));
  const reach: AssistantReach[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await adapter.findMany<McpConnection>({
      model: 'mcpConnection',
      where: [{ field: 'userId', operator: 'in', value: [...names.keys()] }],
      limit: PAGE,
      offset,
      sortBy: { field: 'createdAt', direction: 'asc' },
    });
    for (const row of rows) {
      if (row.excludedGroupIds?.includes(id)) continue;
      if (!(await liveMcpConsent(adapter, row, env))) continue;
      reach.push({
        member: { id: row.userId, name: names.get(row.userId) ?? '' },
        // Named as Settings names it (#747).
        assistant: await connectionName(adapter, row),
        lastUsedAt: row.lastUsedAt ?? null,
      });
    }
    if (rows.length < PAGE) break;
  }
  return reach.sort(
    (a, b) => a.member.name.localeCompare(b.member.name) || a.assistant.localeCompare(b.assistant),
  );
}
