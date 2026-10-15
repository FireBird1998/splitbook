import { draftCollectionClient } from '@splitbook/shared/draft-collection-client';
import { apiFetch } from '@/lib/utils/api-fetch';

/** Same retained save identity as Finish later and the former Drafts screen. */
export function webReviewClient(accountId: string, groupId: string) {
  const key = `splitbook.draft-request:${accountId}:${groupId}`;
  return draftCollectionClient(
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
}
export type WebReviewClient = ReturnType<typeof webReviewClient>;
export { reviewProblem } from '@splitbook/shared/to-review';
