import { expenseDraftsPath } from './api-paths';
import { readDraft, readDrafts, readDraftReviews, readDraftOutcomes } from './draft-responses';
import { createExpenseDraftsSchema, saveExpenseDraftsSchema } from './validators/expense-draft';
import type {
  DraftReview,
  DraftSaveOutcome,
  ExpenseDraftValues,
  PersistedExpenseDraft,
} from './validators/expense-draft';
export interface DraftTransport {
  (
    path: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<unknown>;
}
export interface DraftAttemptStore {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
}
export type DraftRetryResult =
  | { kind: 'create'; drafts: PersistedExpenseDraft[] }
  | { kind: 'save'; outcomes: DraftSaveOutcome[] };
/** A saved request is retried verbatim, only after an explicit member action. */
export function draftCollectionClient(
  groupId: string,
  request: DraftTransport,
  store: DraftAttemptStore,
  uuid: () => string,
  onCreated?: (source: unknown) => Promise<void>,
) {
  const base = expenseDraftsPath(groupId);
  async function sendSaved(serialized: string, firstAttempt = false): Promise<DraftRetryResult> {
    const attempt = JSON.parse(serialized) as {
      path: string;
      method: string;
      body: string;
      headers: Record<string, string>;
      source?: unknown;
    };
    if (![base, `${base}/save`].includes(attempt.path))
      throw new Error('Invalid retained Draft request');
    let result: unknown;
    try {
      result = await request(attempt.path, attempt);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (firstAttempt && status && [400, 401, 403, 404, 409, 413, 419, 422, 428].includes(status))
        await store.clear();
      throw error;
    }
    if (attempt.path === `${base}/save`) {
      const command = saveExpenseDraftsSchema.parse(JSON.parse(attempt.body));
      const outcomes = readDraftOutcomes(
        result,
        command.drafts.map((row) => row.id),
      );
      if (!outcomes.some((outcome) => outcome.status === 'unresolved')) await store.clear();
      return { kind: 'save', outcomes };
    }
    const command = createExpenseDraftsSchema.parse(JSON.parse(attempt.body));
    const drafts = readDrafts(result, groupId);
    if (drafts.length !== command.drafts.length)
      throw new Error(
        'Draft response not confirmed. Retry the original request before making changes.',
      );
    if (attempt.source !== undefined) await onCreated?.(attempt.source);
    await store.clear();
    return { kind: 'create', drafts };
  }

  async function retain(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
    source?: unknown,
  ) {
    if (await store.load())
      throw new Error('Resolve the previous unconfirmed Draft request first.');
    const serialized = JSON.stringify({
      path,
      method: 'POST',
      body: JSON.stringify(body),
      headers,
      source,
    });
    await store.save(serialized);
    return sendSaved(serialized, true);
  }
  return {
    pending: () => store.load(),
    async retry() {
      const attempt = await store.load();
      return attempt ? sendSaved(attempt) : null;
    },
    list: async () => readDrafts(await request(base), groupId),
    async create(values: ExpenseDraftValues, source?: unknown) {
      const result = await retain(
        base,
        { drafts: [values] },
        { 'Idempotency-Key': uuid() },
        source,
      );
      if (result.kind !== 'create') throw new Error('Unexpected Draft response');
      return result.drafts;
    },
    replace: async (draft: PersistedExpenseDraft, values: ExpenseDraftValues) =>
      readDraft(
        await request(`${base}/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify({ values }),
          headers: { 'X-Splitbook-Revision': String(draft.revision) },
        }),
        groupId,
        draft.id,
      ),
    discard: async (draft: PersistedExpenseDraft) =>
      request(`${base}/${draft.id}`, {
        method: 'DELETE',
        headers: { 'X-Splitbook-Revision': String(draft.revision) },
      }),
    review: async (ids: string[]) =>
      readDraftReviews(
        await request(`${base}/review`, { method: 'POST', body: JSON.stringify({ ids }) }),
        groupId,
        ids,
      ),
    async save(reviews: DraftReview[], acknowledged: string[]) {
      const result = await retain(`${base}/save`, {
        drafts: reviews.map((row) => ({
          id: row.draft.id,
          revision: row.draft.revision,
          review: row.review,
          acknowledgeDuplicates: acknowledged.includes(row.draft.id),
        })),
      });
      if (result.kind !== 'save') throw new Error('Unexpected Draft response');
      return result.outcomes;
    },
  };
}
