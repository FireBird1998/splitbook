'use client';

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useSWRConfig } from 'swr';
import type { ExpenseDraft } from '@splitbook/shared/expense-draft';
import { isGroupReadKey } from '@/lib/group-read';
import { apiFetch } from '@/lib/utils/api-fetch';
import { buildDuplicateCheckUrl } from './expense-duplicate-check';

/** How one save ended, for a caller that says more than the draft's own error. */
export type ExpenseSaveOutcome =
  /** Recorded, and the reply said so. */
  | { status: 'saved' }
  /** Nothing went out: the draft was invalid, a save was already running, the duplicate
   * warning was declined, or the page went away. */
  | { status: 'not-sent' }
  /** The server answered and refused it. Nothing was recorded. */
  | { status: 'refused'; message: string; httpStatus: number }
  /**
   * The reply never arrived, so it may or may not be recorded: an unconfirmed save. The draft
   * keeps the request and its idempotency key, so sending the same draft again can never
   * record it twice.
   */
  | { status: 'unconfirmed'; message: string };

/**
 * The Expense form's save (#320 moved it here from `ExpenseFormDialog`, unchanged): the
 * advisory duplicate check, then the one create or edit request with its idempotency key or
 * revision, and the draft's record of the attempt, so a lost reply leaves an unconfirmed save
 * the member can retry. Quick add saves through the same path.
 */
export function useExpenseDraftSave(setDraft: Dispatch<SetStateAction<ExpenseDraft>>) {
  const { mutate } = useSWRConfig();
  const transportBusy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const save = useCallback(
    async (draft: ExpenseDraft, tagIds: string[]): Promise<ExpenseSaveOutcome> => {
      if (transportBusy.current) return { status: 'not-sent' };
      const { draft: prepared, submission } = draft.prepare(tagIds, crypto.randomUUID());
      setDraft(prepared);
      if (!submission) return { status: 'not-sent' };
      transportBusy.current = true;
      try {
        if (submission.checkDuplicate) {
          try {
            const response = await apiFetch(
              buildDuplicateCheckUrl({
                groupId: submission.groupId,
                description: submission.description,
                amount: submission.amount,
                date: submission.date,
                excludeId: submission.expenseId,
              }),
            );
            if (!mounted.current) return { status: 'not-sent' };
            if (response.ok) {
              const duplicate = await response.json();
              if (!mounted.current) return { status: 'not-sent' };
              if (
                duplicate.data?.isDuplicate &&
                !window.confirm(
                  'This looks like a duplicate expense with the same description, amount, and date. Save it anyway?',
                )
              ) {
                setDraft((current) => current.cancel(submission));
                return { status: 'not-sent' };
              }
            }
          } catch (error) {
            console.warn('Duplicate expense check failed', error);
          }
        }
        if (!mounted.current) return { status: 'not-sent' };
        setDraft((current) => current.attempt(submission));
        const url = `/api/groups/${submission.groupId}/expenses${submission.expenseId ? `/${submission.expenseId}` : ''}`;
        const response = await apiFetch(url, {
          method: submission.expenseId ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(submission.expenseId
              ? { 'X-Splitbook-Revision': String(submission.revision) }
              : { 'Idempotency-Key': submission.key }),
          },
          body: submission.body,
        });
        if (!mounted.current) return { status: 'not-sent' };
        if (!response.ok) {
          const result = await response.json();
          const message =
            result.error || `Failed to ${submission.expenseId ? 'update' : 'add'} expense`;
          if (mounted.current)
            setDraft((current) => current.fail(submission, message, response.status));
          return { status: 'refused', message, httpStatus: response.status };
        }
        setDraft((current) => current.complete(submission));
        void mutate(
          (key: unknown) =>
            (typeof key === 'string' && key.startsWith(`/api/groups/${submission.groupId}`)) ||
            isGroupReadKey(key, `/api/groups/${submission.groupId}`),
        );
        return { status: 'saved' };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Something went wrong. Please try again.';
        if (mounted.current) setDraft((current) => current.fail(submission, message));
        return { status: 'unconfirmed', message };
      } finally {
        transportBusy.current = false;
      }
    },
    [mutate, setDraft],
  );

  return { save, transportBusy, mounted };
}
