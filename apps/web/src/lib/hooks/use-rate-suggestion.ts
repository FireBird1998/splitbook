'use client';

import useSWR from 'swr';
import { groupRatesKey, type QueryKey } from '@splitbook/shared/query-keys';
import {
  parseRateSuggestionResponse,
  type RateSuggestion,
} from '@splitbook/shared/cross-currency-payment';
import { fetchWebRead } from '@/lib/web-read';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';

/** What Record payment knows of a suggested rate between two currencies (#726, #727). */
export type RateSuggestionState =
  | { status: 'loading' }
  | { status: 'none'; reason: string | null }
  | { status: 'ready'; suggestion: RateSuggestion };

const readSuggestion = async (key: QueryKey) =>
  parseRateSuggestionResponse(await fetchWebRead(key));

/**
 * The Group's suggested rate for paying a Debt in `currency` with `paidCurrency`, or nothing to
 * read while they are the same. A read that fails counts as no suggestion: the payer can still
 * record the payment with the rate they agreed.
 */
export function useRateSuggestion(
  groupId: string,
  currency: string,
  paidCurrency: string,
): RateSuggestionState {
  const { data, error } = useSWR(
    currency !== paidCurrency
      ? groupRatesKey(WEB_QUERY_ACCOUNT, groupId, { from: currency, to: paidCurrency })
      : null,
    readSuggestion,
    { revalidateOnFocus: false },
  );
  if (error) return { status: 'none', reason: null };
  if (!data) return { status: 'loading' };
  return data.suggestion
    ? { status: 'ready', suggestion: data.suggestion }
    : { status: 'none', reason: data.reason };
}
