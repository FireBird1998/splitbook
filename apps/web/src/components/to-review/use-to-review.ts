'use client';

import useSWR from 'swr';
import { toReviewKey } from '@splitbook/shared/query-keys';
import { parseToReviewResponse } from '@splitbook/shared/to-review-read';
import { buildToReview } from '@splitbook/shared/to-review';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { fetchWebRead } from '@/lib/web-read';
import type { CardRead } from '@/components/dashboard/home-reads';

export const TO_REVIEW_KEY = toReviewKey(WEB_QUERY_ACCOUNT);
export const toReviewEnabled = process.env.NEXT_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true';
export function useToReview() {
  const { data, error, mutate } = useSWR(toReviewEnabled ? TO_REVIEW_KEY : null, fetchWebRead, {
    refreshInterval: 30_000,
  });
  let read: CardRead<ReturnType<typeof buildToReview>>;
  if (data === undefined) read = { status: error ? 'error' : 'loading' };
  else {
    try {
      read = { status: 'ready', value: buildToReview(parseToReviewResponse(data), [], new Date()) };
    } catch {
      read = { status: 'error' };
    }
  }
  return { read, retry: () => void mutate() };
}
