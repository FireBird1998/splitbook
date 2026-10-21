import { createHash } from 'node:crypto';
import type { AuthContext } from 'better-auth';
import { z } from 'zod';
import type { AuthEnv } from '@/lib/auth/create-auth';
import { isMcpConnectionExpired, type McpConnection, type McpConsent } from './grants';

type Adapter = Pick<
  AuthContext['adapter'],
  'findOne' | 'create' | 'update' | 'delete' | 'deleteMany'
>;

/**
 * The Groups a member unticks on the approval page (#617): Group ids, each once. Exclusions
 * rather than an allowed list, so Groups the member joins later are included.
 */
export const excludedGroupsSchema = z
  .array(z.string().regex(/^[a-f\d]{24}$/i))
  .max(1000)
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

/**
 * One member's consent to one authorization request, from parameters that both the signed query
 * the approval page sends and the provider's own copy of it carry, so the choice made on one page
 * can only be applied to that request's grant. The member is part of the key: an assistant
 * controls the request's parameters and can sign in as another account, whose hold for the same
 * parameters must never find, displace or stand in for the member's.
 */
export function consentRequestKey(query: string, userId: string): string {
  const params = new URLSearchParams(query);
  const request = ['client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'resource'].map(
    (name) => params.getAll(name),
  );
  return createHash('sha256')
    .update(JSON.stringify([userId, request]))
    .digest('hex');
}

type HeldExclusion = {
  id: string;
  key: string;
  userId: string;
  clientId: string;
  excludedGroupIds: string[];
  createdAt: Date;
};

/** A held choice not committed within an hour belongs to a consent that never succeeded. */
const HOLD_MS = 60 * 60 * 1000;

/**
 * Holds the Groups a member left out until the consent they belong to is granted (#617), so a
 * consent the provider then refuses (a scope never requested, a login prompt) changes nothing.
 */
export async function holdExcludedGroups(
  adapter: Adapter,
  request: { key: string; userId: string; clientId: string },
  excludedGroupIds: string[],
) {
  await adapter.deleteMany({
    model: 'mcpPendingExclusion',
    where: [{ field: 'createdAt', value: new Date(Date.now() - HOLD_MS), operator: 'lt' }],
  });
  const held = await adapter.findOne<HeldExclusion>({
    model: 'mcpPendingExclusion',
    where: [{ field: 'key', value: request.key }],
  });
  const record = { ...request, excludedGroupIds, createdAt: new Date() };
  if (held)
    await adapter.update({
      model: 'mcpPendingExclusion',
      where: [{ field: 'id', value: held.id }],
      update: record,
    });
  else await adapter.create({ model: 'mcpPendingExclusion', data: record });
}

/**
 * Applies the choice held for this consent's request to the connection being granted. Called
 * from consentReferenceId while the grant is made, so a failed write fails the consent: no grant
 * is ever issued without the member's choice.
 */
export async function commitExcludedGroups(
  adapter: Adapter,
  connection: McpConnection,
  query: string | undefined,
) {
  if (!query) return;
  const held = await adapter.findOne<HeldExclusion>({
    model: 'mcpPendingExclusion',
    where: [{ field: 'key', value: consentRequestKey(query, connection.userId) }],
  });
  if (!held) return;
  await adapter.update({
    model: 'mcpConnection',
    where: [{ field: 'id', value: connection.id }],
    update: { excludedGroupIds: held.excludedGroupIds },
  });
  await adapter.delete({ model: 'mcpPendingExclusion', where: [{ field: 'id', value: held.id }] });
}

/**
 * The Groups a member's live connection to one assistant leaves out, for the approval page to
 * start from, so asking for approval again never clears them. A disconnected or expired (#618)
 * connection starts again with every Group ticked.
 */
export async function liveExcludedGroups(
  adapter: Pick<Adapter, 'findOne'>,
  userId: string,
  clientId: string,
  env: AuthEnv,
): Promise<string[]> {
  const connection = await adapter.findOne<McpConnection>({
    model: 'mcpConnection',
    where: [{ field: 'key', value: JSON.stringify([userId, clientId]) }],
  });
  const consent =
    connection &&
    (await adapter.findOne<McpConsent>({
      model: 'oauthConsent',
      where: [
        { field: 'userId', value: userId },
        { field: 'clientId', value: clientId },
        { field: 'referenceId', value: connection.generation },
      ],
    }));
  return consent && !isMcpConnectionExpired(connection, consent, env)
    ? (connection.excludedGroupIds ?? [])
    : [];
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
      ? await adapter.findOne<Pick<McpConnection, 'excludedGroupIds'>>({
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
