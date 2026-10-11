'use client';
import { useState } from 'react';
import { Alert, Button, Stack } from '@mui/material';
import { useRouter } from 'next/navigation';
import type { ExpenseDraft } from '@splitbook/shared/expense-draft';
import { draftValues, type DraftEntries } from '@splitbook/shared/persistent-draft-editor';
import { draftCollectionClient } from '@splitbook/shared/draft-collection-client';
import { apiFetch } from '@/lib/utils/api-fetch';
export default function KeepExpenseDraft({
  draft,
  groupId,
  accountId,
  onKept,
}: {
  draft: ExpenseDraft;
  groupId: string;
  accountId: string;
  onKept: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function keep() {
    setBusy(true);
    setError('');
    try {
      const key = `splitbook.draft-request:${accountId}:${groupId}`;
      const client = draftCollectionClient(
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
            throw Object.assign(new Error(value.error), { status: response.status });
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
      if (await client.pending())
        throw new Error(
          'Resolve the previous request in this Group’s Drafts before uploading this form.',
        );
      const v = draft.values;
      const entries: DraftEntries = {
        description: v.description,
        amount: v.amount,
        currency: v.currency,
        date: v.date,
        category: v.category,
        notes: v.notes,
        splitMethod: v.splitMethod,
        ...(/^[a-f0-9]{24}$/i.test(v.tag) ? { tagId: v.tag } : { tag: v.tag }),
      };
      for (const payer of v.payers) {
        entries[`paidBy.${payer.user}`] = 'yes';
        entries[`paidBy.${payer.user}.amount`] = v.multiPayerMode ? payer.amount : v.amount;
      }
      for (const id of v.selectedMembers) {
        entries[`splitBetween.${id}`] = 'yes';
        if (v.splitMethod !== 'equal') {
          const field =
            v.splitMethod === 'percentage'
              ? 'percentage'
              : v.splitMethod === 'shares'
                ? 'shares'
                : 'amount';
          entries[`splitBetween.${id}.${field}`] =
            (v.splitMethod === 'percentage'
              ? v.customPercentages
              : v.splitMethod === 'shares'
                ? v.customShares
                : v.customAmounts)[id] ?? '';
        }
      }
      await client.create(draftValues(entries));
      onKept();
      router.push(`/groups/${groupId}/drafts`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Draft upload not confirmed. Open Drafts to retry the original request.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      {error && <Alert severity="warning">{error}</Alert>}
      <Button
        disabled={busy || draft.loading || draft.hasSubmissionAttempt}
        onClick={() => void keep()}
      >
        Keep as Draft
      </Button>
    </Stack>
  );
}
