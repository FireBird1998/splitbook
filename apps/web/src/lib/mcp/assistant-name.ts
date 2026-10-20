import type { AuthContext } from 'better-auth';
import {
  cleanAssistantName,
  cleanPublishedAssistantName,
} from '@splitbook/shared/draft-attribution';

type ClientAdapter = Pick<AuthContext['adapter'], 'findOne'>;

/** An assistant as the approval page shows it: its name, and its address when it has one. */
export type AssistantDisplay = { name: string; address: string | null };

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
 * is that host. A registered client's id is not an address, so it has none.
 */
export function assistantDisplay(
  clientId: string,
  name: string | null | undefined,
): AssistantDisplay {
  let address: string | null = null;
  try {
    const url = new URL(clientId);
    if (url.protocol === 'https:' || url.protocol === 'http:') address = url.host;
  } catch {
    // A registered client's id, not a metadata document address.
  }
  return { name: cleanPublishedAssistantName(name ?? '') ?? address ?? 'Assistant', address };
}

/** The assistant a connection request comes from, as the approval page shows it (#614). */
export async function assistantForApproval(adapter: ClientAdapter, clientId: string) {
  return assistantDisplay(clientId, await publishedName(adapter, clientId));
}
