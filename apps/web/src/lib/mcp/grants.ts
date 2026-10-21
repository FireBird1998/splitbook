import { mcpIdleSeconds } from './config';
import type { AuthContext } from 'better-auth';
import { APIError } from 'better-auth/api';
import { isEmailAllowed } from '@/lib/auth/allowlist';
import { isDemoAuthAllowed } from '@/lib/auth-mode';
import type { AuthEnv } from '@/lib/auth/create-auth';

type Adapter = Pick<AuthContext['adapter'], 'findOne'>;
export interface McpConnection {
  id: string;
  key: string;
  userId: string;
  clientId: string;
  generation: string;
  createdAt: Date;
  name?: string;
  lastUsedAt?: Date | null;
  /** The Groups the member left out of this assistant's reach (#617). */
  excludedGroupIds?: string[] | null;
}
export interface McpConsent {
  createdAt?: Date;
  id: string;
  userId: string;
  clientId: string;
  referenceId?: string;
  scopes: string[];
}

/** A never-used authorization ages from consent, not the durable connection row. */
export function isMcpConnectionExpired(
  connection: McpConnection,
  consent: McpConsent,
  env: AuthEnv,
): boolean {
  const since = new Date(
    connection.lastUsedAt ?? consent.createdAt ?? connection.createdAt,
  ).getTime();
  return !Number.isFinite(since) || Date.now() - since >= mcpIdleSeconds(env) * 1000;
}

export async function requireMcpMember(adapter: Adapter, userId: string, env: AuthEnv) {
  const user = await adapter.findOne<{ id: string; email: string }>({
    model: 'user',
    where: [{ field: 'id', value: userId }],
  });
  // Demo access is limited to explicitly enabled non-production development.
  const demo = env.NODE_ENV !== 'production' && isDemoAuthAllowed(env);
  if (!user || (!demo && !isEmailAllowed(user.email, env))) {
    throw new APIError('FORBIDDEN', { message: 'This account cannot connect assistants.' });
  }
  return user;
}

/** Also used by token issuance: an old refresh token can never adopt a new generation. */
export async function currentMcpGrant(
  adapter: Adapter & Pick<AuthContext['adapter'], 'update'>,
  env: AuthEnv,
  userId: string,
  clientId: string,
  generation: unknown,
  scopes: readonly string[],
  recordUse = false,
): Promise<boolean> {
  if (typeof generation !== 'string') return false;
  try {
    await requireMcpMember(adapter, userId, env);
  } catch (error) {
    if (error instanceof APIError) return false;
    throw error;
  }
  const connection = await adapter.findOne<McpConnection>({
    model: 'mcpConnection',
    where: [
      { field: 'userId', value: userId },
      { field: 'clientId', value: clientId },
      { field: 'generation', value: generation },
    ],
  });
  if (!connection) return false;
  const consent = await adapter.findOne<McpConsent>({
    model: 'oauthConsent',
    where: [
      { field: 'userId', value: userId },
      { field: 'clientId', value: clientId },
      { field: 'referenceId', value: generation },
    ],
  });
  if (
    !consent ||
    !scopes.every((scope) => consent.scopes.includes(scope)) ||
    isMcpConnectionExpired(connection, consent, env)
  )
    return false;
  const now = new Date();
  const cutoff = new Date(now.getTime() - 60_000);
  if (recordUse && (!connection.lastUsedAt || connection.lastUsedAt <= cutoff)) {
    // A database predicate, not a process-local timer: concurrent instances write at most
    // once per minute, and an in-flight call cannot touch a newly revoked generation.
    try {
      await adapter.update({
        model: 'mcpConnection',
        where: [
          { field: 'id', value: connection.id },
          { field: 'generation', value: generation },
          connection.lastUsedAt
            ? { field: 'lastUsedAt', value: cutoff, operator: 'lte' }
            : { field: 'lastUsedAt', value: null },
        ],
        update: { lastUsedAt: now },
      });
    } catch {
      // Observability must not revoke access. The unchanged timestamp makes the next call retry.
      console.warn('Could not record assistant last use; the next authorized call will retry.');
    }
  }
  return true;
}
