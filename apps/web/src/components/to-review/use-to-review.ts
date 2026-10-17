'use client';

import useSWR from 'swr';
import { toReviewKey } from '@splitbook/shared/query-keys';
import { parseReadableToReview } from '@splitbook/shared/to-review-read';
import { buildToReview } from '@splitbook/shared/to-review';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { fetchWebRead } from '@/lib/web-read';
import { HttpResponseError } from '@/lib/utils/fetcher';
import type { CardRead } from '@/components/dashboard/home-reads';

export const TO_REVIEW_KEY = toReviewKey(WEB_QUERY_ACCOUNT);
export const toReviewEnabled = process.env.NEXT_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true';
export function useToReview(groupId?: string) {
  const { data, error, mutate } = useSWR(toReviewEnabled ? TO_REVIEW_KEY : null, fetchWebRead, {
    refreshInterval: 30_000,
  });
  let read: CardRead<ReturnType<typeof buildToReview>>;
  let unreadable = 0;
  if (data === undefined) read = { status: error ? 'error' : 'loading' };
  else {
    try {
      const shown = modelFromResponse(data, groupId);
      read = { status: 'ready', value: shown.model };
      unreadable = shown.unreadable;
    } catch {
      read = { status: 'error' };
    }
  }
  // A request that never got an answer is the connection; a refusal or an answer that can't be
  // read is not (#513).
  const failure: 'connection' | 'other' | null = error
    ? error instanceof HttpResponseError
      ? 'other'
      : 'connection'
    : read.status === 'error'
      ? 'other'
      : null;
  async function reload() {
    const response = await fetchWebRead(TO_REVIEW_KEY);
    const { model } = modelFromResponse(response, groupId);
    await mutate(response, { revalidate: false });
    return model;
  }
  return { read, unreadable, failure, failed: !!error, retry: () => void mutate(), reload };
}

/** This page's To review, and how many of its items couldn't be read and are left out. */
function modelFromResponse(data: unknown, groupId?: string) {
  const { read: decoded, unreadable } = parseReadableToReview(data);
  const groups = groupId
    ? decoded.groups.filter((group) => group.groupId === groupId)
    : decoded.groups;
  return {
    model: buildToReview(
      { groups, total: groups.reduce((n, group) => n + group.count, 0) },
      [],
      new Date(),
    ),
    unreadable: groupId
      ? (unreadable[groupId] ?? 0)
      : Object.values(unreadable).reduce((n, count) => n + count, 0),
  };
}
