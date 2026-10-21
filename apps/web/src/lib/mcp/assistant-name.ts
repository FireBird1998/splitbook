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

/** A metadata document's address: https only, as Client ID Metadata Documents require. */
function metadataDocumentUrl(clientId: string) {
  try {
    const url = new URL(clientId);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null; // A registered client's id, not an address.
  }
}

/**
 * An assistant's address as the approval page and Settings show it: host and path, never a query,
 * so publishers on one host can be told apart. A registered client's id is not an address, and an
 * http one isn't a metadata document, so neither has one.
 */
export function assistantAddress(clientId: string): string | null {
  const url = metadataDocumentUrl(clientId);
  return url ? `${url.host}${url.pathname}` : null;
}

/**
 * What reads as a dot in a hostname once NFKC has folded the compatibility forms (U+2024, U+FF0E,
 * U+FE52 and the like): ideographic and Syriac full stops, and bracketed dots such as "[.]".
 */
const DOT_LOOKALIKE = /[\u3002\uff61\u0701\u0702\u2e33]|[[(]\s*\.\s*[\])]/gu;

/**
 * A name that carries a scheme, or a hostname other than the assistant's own, once look-alike
 * characters are read as what they look like. The name shown stays as cleaned.
 */
function posesAsAddress(name: string, hostname: string | undefined) {
  const plain = name.normalize('NFKC').replace(DOT_LOOKALIKE, '.').toLowerCase();
  if (plain.includes('://')) return true;
  const named = plain.match(/(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}/gu) ?? [];
  return named.some((host) => !hostname || (host !== hostname && !hostname.endsWith(`.${host}`)));
}

/**
 * How the approval page names an assistant (#614): by the name its metadata document publishes,
 * cleaned as Draft attribution cleans it, else by its address's host. A name with no letter or
 * number, or one posing as another address, is no name. Settings names a connection the same way
 * (#615), with the same address beside it.
 */
export function assistantDisplay(
  clientId: string,
  name: string | null | undefined,
): AssistantDisplay {
  const url = metadataDocumentUrl(clientId);
  const published = cleanPublishedAssistantName(name ?? '');
  const trusted =
    published && /[\p{L}\p{N}]/u.test(published) && !posesAsAddress(published, url?.hostname)
      ? published
      : null;
  return { name: trusted ?? url?.host ?? 'Assistant', address: assistantAddress(clientId) };
}

/** The assistant a connection request comes from, as the approval page shows it (#614). */
export async function assistantForApproval(adapter: ClientAdapter, clientId: string) {
  return assistantDisplay(clientId, await publishedName(adapter, clientId));
}
