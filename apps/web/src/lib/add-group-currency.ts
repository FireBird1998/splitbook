import { groupCurrenciesPath } from '@splitbook/shared/api-paths';
import { apiFetch } from '@/lib/utils/api-fetch';

/**
 * Add a currency to a Group's list (#721's request), as Quick add and To review offer it for a
 * line or item in a currency the Group doesn't list (#732). Any member may. Resolves to null once
 * it's added, or to why it wasn't, in a member's words.
 */
export async function addGroupCurrency(groupId: string, code: string): Promise<string | null> {
  try {
    const res = await apiFetch(groupCurrenciesPath(groupId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: code }),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return typeof body?.error === 'string' && body.error ? body.error : 'Something went wrong.';
  } catch {
    return 'Couldn’t add the currency. Check your connection and try again.';
  }
}
