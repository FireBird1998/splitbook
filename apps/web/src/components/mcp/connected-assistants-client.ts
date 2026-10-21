import { EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';
import type { ApprovalGroup } from '@/lib/services/assistant-ledger.service';
import { apiFetch } from '@/lib/utils/api-fetch';

/** What Settings and an assistant's page say when Disconnect isn't confirmed (#615, #620). */
export const DISCONNECT_FAILED = 'Could not confirm disconnection. Reload and try again.';

/** Disconnect one of the member's assistants; false when the server didn't confirm it. */
export async function revokeAssistant(id: string, accountId: string): Promise<boolean> {
  try {
    const response = await apiFetch('/api/auth/mcp/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [EXPECTED_ACCOUNT_HEADER]: accountId },
      body: JSON.stringify({ id }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** The member's Groups as an assistant's page lists them (#620); null when they can't be read. */
export async function readAssistantGroups(
  accountId: string,
  signal?: AbortSignal,
): Promise<ApprovalGroup[] | null> {
  const response = await apiFetch('/api/user/assistant-groups', {
    signal,
    headers: { [EXPECTED_ACCOUNT_HEADER]: accountId },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const groups = (await response.json())?.data?.groups;
  return Array.isArray(groups) ? groups : null;
}
