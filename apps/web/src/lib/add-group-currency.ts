import { groupCurrenciesPath, groupPath } from '@splitbook/shared/api-paths';
import { groupCurrencies } from '@splitbook/shared/group-currencies';
import { parseGroupResponse } from '@splitbook/shared/group-read';
import { apiFetch } from '@/lib/utils/api-fetch';

/**
 * Add a currency to a Group's list (#721's request), as Quick add and To review offer it for a
 * line or item in a currency the Group doesn't list (#732). Any member may. Resolves to null once
 * it's added, or to why it wasn't, in a member's words.
 *
 * A failure may hide a currency added all the same: its reply lost on the way back, or another
 * member adding it first ("already one of this Group's currencies"). So after any failure the
 * Group is read again, and a currency it now lists counts as added, as on the Expense form (#722).
 */
export async function addGroupCurrency(groupId: string, code: string): Promise<string | null> {
  let refused: string;
  try {
    const res = await apiFetch(groupCurrenciesPath(groupId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: code }),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    refused = typeof body?.error === 'string' && body.error ? body.error : 'Something went wrong.';
  } catch {
    refused = 'Couldn’t add the currency. Check your connection and try again.';
  }
  return (await listedNow(groupId, code)) ? null : refused;
}

/** Whether the Group, read again, lists the currency. A read that fails says nothing new. */
async function listedNow(groupId: string, code: string): Promise<boolean> {
  try {
    const res = await apiFetch(groupPath(groupId));
    if (!res.ok) return false;
    return groupCurrencies(parseGroupResponse(await res.json())).includes(code);
  } catch {
    return false;
  }
}
