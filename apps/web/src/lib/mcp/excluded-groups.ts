import { randomUUID } from 'node:crypto';
import type { AuthContext } from 'better-auth';
import { z } from 'zod';
import type { McpConnection } from './grants';

type Adapter = Pick<AuthContext['adapter'], 'findOne' | 'create' | 'update'>;

/**
 * The Groups a member unticks on the approval page (#617): Group ids, each once. Exclusions
 * rather than an allowed list, so Groups the member joins later are included.
 */
export const excludedGroupsSchema = z
  .array(z.string().regex(/^[a-f\d]{24}$/i))
  .max(1000)
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

/** A member's connection to one assistant, created on its first approval. */
export async function findOrCreateMcpConnection(
  adapter: Adapter,
  userId: string,
  clientId: string,
): Promise<McpConnection> {
  const key = JSON.stringify([userId, clientId]);
  const find = () =>
    adapter.findOne<McpConnection>({
      model: 'mcpConnection',
      where: [{ field: 'key', value: key }],
    });
  const row = await find();
  if (row) return row;
  try {
    return await adapter.create<McpConnection>({
      model: 'mcpConnection',
      data: { key, userId, clientId, generation: randomUUID(), createdAt: new Date() },
    });
  } catch (error) {
    const created = await find();
    if (!created) throw error;
    return created;
  }
}

/**
 * Records the Groups a member leaves out of one assistant's reach, replacing the choice made at
 * any earlier approval. Written before consent, so no grant is issued without it.
 */
export async function recordExcludedGroups(
  adapter: Adapter,
  userId: string,
  clientId: string,
  excludedGroupIds: string[],
) {
  const connection = await findOrCreateMcpConnection(adapter, userId, clientId);
  await adapter.update({
    model: 'mcpConnection',
    where: [{ field: 'id', value: connection.id }],
    update: { excludedGroupIds },
  });
}

/**
 * The Groups a connection leaves out, read for each request so a change applies to the next
 * call. A connection that has since been disconnected reaches nothing.
 */
export async function connectionExcludedGroups(
  adapter: Pick<Adapter, 'findOne'>,
  userId: string,
  clientId: string,
  generation: unknown,
): Promise<string[]> {
  const connection =
    typeof generation === 'string'
      ? await adapter.findOne<{ excludedGroupIds?: string[] | null }>({
          model: 'mcpConnection',
          where: [
            { field: 'userId', value: userId },
            { field: 'clientId', value: clientId },
            { field: 'generation', value: generation },
          ],
        })
      : null;
  if (!connection) throw new Error('FORBIDDEN');
  return connection.excludedGroupIds ?? [];
}
