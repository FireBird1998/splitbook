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
}
export interface McpConsent {
  id: string;
  userId: string;
  clientId: string;
  referenceId?: string;
  scopes: string[];
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
  adapter: Adapter,
  env: AuthEnv,
  userId: string,
  clientId: string,
  generation: unknown,
  scopes: readonly string[],
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
  return !!consent && scopes.every((scope) => consent.scopes.includes(scope));
}
