'use client';
import { useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { TO_REVIEW_KEY } from '@/components/to-review/use-to-review';
import { expenseDraftsKey } from '@splitbook/shared/query-keys';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import {
  ACTIVE_DRAFTS_PER_MEMBER,
  DRAFT_GROUP_LIMIT_MESSAGE,
} from '@splitbook/shared/validators/expense-draft';
import { Alert, Button, Link, Stack, Typography } from '@mui/material';
import type { ExpenseDraft } from '@splitbook/shared/expense-draft';
import { draftForExpenseEntry, fieldDraftEntryPolicy } from '@splitbook/shared/expense-entry-draft';
import { draftCollectionClient } from '@splitbook/shared/draft-collection-client';
import { toReviewHref } from '@splitbook/shared/api-paths';
import { apiFetch } from '@/lib/utils/api-fetch';
export function useKeepExpenseDraft({
  draft,
  groupId,
  accountId,
  onKept,
  enabled,
}: {
  draft: ExpenseDraft;
  groupId: string;
  accountId: string;
  onKept: () => void;
  enabled: boolean;
}) {
  const { mutate: refresh } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const attemptValues = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const client = useMemo(() => {
    const key = `splitbook.draft-request:${accountId}:${groupId}`;
    return draftCollectionClient(
      groupId,
      async (path, init) => {
        const response = await apiFetch(path, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            'X-Expected-Account': accountId,
            ...init?.headers,
          },
        });
        const value = await response.json();
        if (!response.ok)
          throw Object.assign(new Error(value.error), {
            status: response.status,
            code: value.code,
          });
        return value;
      },
      {
        load: async () => sessionStorage.getItem(key),
        save: async (value) => {
          sessionStorage.setItem(key, value);
        },
        clear: async () => {
          sessionStorage.removeItem(key);
        },
      },
      () => crypto.randomUUID(),
    );
  }, [accountId, groupId]);
  const { data: rows = [], mutate } = useSWR(
    enabled ? expenseDraftsKey({ ...WEB_QUERY_ACCOUNT, accountId }, groupId) : null,
    () => client.list(),
  );
  const full = rows.length >= ACTIVE_DRAFTS_PER_MEMBER;
  async function keep() {
    if (inFlight.current || !enabled || draft.loading || draft.hasSubmissionAttempt) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      if (await client.pending()) {
        if (!attemptValues.current) throw new Error('Could not confirm the earlier item.');
        const result = await client.retry();
        if (result?.kind !== 'create')
          throw new Error('Could not confirm this item. Your form is still here.');
        setPending(false);
        void mutate();
        void refresh(TO_REVIEW_KEY);
        if (attemptValues.current === JSON.stringify(draft.entry)) onKept();
        else
          setError(
            'The earlier version was kept in To review. Your newer changes are still in this form.',
          );
        attemptValues.current = null;
        return;
      }
      // Resolve a retained request first; a new local refusal is never an uncertain save.
      const amount = draft.reading().fields.amountReading;
      if (amount.status === 'invalid') {
        setError(amount.message);
        return;
      }
      attemptValues.current = JSON.stringify(draft.entry);
      await client.create(draftForExpenseEntry(draft.entry, fieldDraftEntryPolicy));
      attemptValues.current = null;
      void mutate();
      void refresh(TO_REVIEW_KEY);
      onKept();
    } catch (cause) {
      setPending(Boolean(await client.pending()));
      const code = (cause as { code?: string }).code;
      setError(
        code === 'DRAFT_GROUP_LIMIT'
          ? DRAFT_GROUP_LIMIT_MESSAGE
          : 'Could not confirm Finish later. Everything you typed is still here. Check again or open To review to confirm the earlier item.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return {
    keep,
    busy,
    pending,
    full,
    error,
    disabled: busy || draft.loading || draft.hasSubmissionAttempt || (full && !pending),
    groupId,
  };
}

export default function KeepExpenseDraft({
  state,
}: {
  state: ReturnType<typeof useKeepExpenseDraft>;
}) {
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      {(state.full || state.error) && (
        <Alert severity="warning">
          {state.full ? DRAFT_GROUP_LIMIT_MESSAGE : state.error}{' '}
          <Link href={toReviewHref(state.groupId)}>To review</Link>
        </Alert>
      )}
      <Button disabled={state.disabled} onClick={() => void state.keep()}>
        {state.pending ? 'Check again' : 'Finish later'}
      </Button>
      <Typography variant="caption" color="text.secondary">
        Keeps it in To review. Only you can see it.
      </Typography>
    </Stack>
  );
}
