import { expenseDraftsPath } from '@splitbook/shared/api-paths';
import { draftCollectionClient } from '@splitbook/shared/draft-collection-client';
import type {
  ExpenseDraftValues,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import { apiFetch } from '@/lib/utils/api-fetch';

/** Same retained save identity as Finish later and the former Drafts screen. */
export function webReviewClient(accountId: string, groupId: string) {
  const key = `splitbook.draft-request:${accountId}:${groupId}`;
  const client = draftCollectionClient(
    groupId,
    async (path, init) => {
      const response = await apiFetch(path, {
        ...init,
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-Expected-Account': accountId,
          ...init?.headers,
        },
      });
      const value = await response.json();
      if (!response.ok)
        throw Object.assign(new Error(value.error || 'Could not keep this change.'), {
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
  return {
    ...client,
    /**
     * Send typing as the page goes (reload, closing the tab): a keepalive request outlives the
     * page, so no reply is read (#500). It carries the shown revision, so a stale edit still fails.
     */
    replaceAsPageGoes(draft: PersistedExpenseDraft, values: ExpenseDraftValues) {
      void apiFetch(`${expenseDraftsPath(groupId)}/${draft.id}`, {
        method: 'PUT',
        keepalive: true,
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-Expected-Account': accountId,
          'X-Splitbook-Revision': String(draft.revision),
        },
        body: JSON.stringify({ values }),
      }).catch(() => {});
    },
  };
}
export type WebReviewClient = ReturnType<typeof webReviewClient>;
export { reviewProblem } from '@splitbook/shared/to-review';
