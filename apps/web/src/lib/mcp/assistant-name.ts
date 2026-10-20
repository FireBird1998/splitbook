import type { AuthContext } from 'better-auth';
import { cleanAssistantName } from '@splitbook/shared/draft-attribution';

type ClientAdapter = Pick<AuthContext['adapter'], 'findOne'>;

/** CIMD and registered clients both persist their metadata name in oauthClient. */
async function publishedName(adapter: ClientAdapter, clientId: string) {
  const client = await adapter.findOne<{ name?: string | null }>({
    model: 'oauthClient',
    where: [{ field: 'clientId', value: clientId }],
  });
  return client?.name ?? '';
}

export async function connectedAssistantName(
  adapter: ClientAdapter,
  clientId: string,
): Promise<string> {
  return cleanAssistantName(await publishedName(adapter, clientId));
}

/**
 * How the approval page names an assistant (#614): by the name its metadata document publishes,
 * cleaned as Draft attribution cleans it, else by its address's host. The address shown beside it
 * is that host, or a registered client's id.
 */
export function assistantDisplay(clientId: string, name: string | null | undefined) {
  let host: string | null = null;
  try {
    const url = new URL(clientId);
    if (url.protocol === 'https:' || url.protocol === 'http:') host = url.host;
  } catch {
    // A registered client's id is not an address.
  }
  const published = (name ?? '').replace(/[\s\p{Cc}\p{Cf}]/gu, '')
    ? cleanAssistantName(name!)
    : null;
  return { name: published ?? host ?? 'Assistant', address: host ?? clientId };
}

/** The assistant a connection request comes from, as the approval page shows it (#614). */
export async function approvingAssistant(adapter: ClientAdapter, clientId: string) {
  return assistantDisplay(clientId, await publishedName(adapter, clientId));
}
