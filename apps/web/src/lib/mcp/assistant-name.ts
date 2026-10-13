import type { AuthContext } from 'better-auth';
import { cleanAssistantName } from '@splitbook/shared/draft-attribution';

/** CIMD and registered clients both persist their metadata name in oauthClient. */
export async function connectedAssistantName(
  adapter: Pick<AuthContext['adapter'], 'findOne'>,
  clientId: string,
): Promise<string> {
  const client = await adapter.findOne<{ name?: string | null }>({
    model: 'oauthClient',
    where: [{ field: 'clientId', value: clientId }],
  });
  return cleanAssistantName(client?.name ?? '');
}
