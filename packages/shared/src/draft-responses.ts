import { z } from 'zod/v4';
import {
  persistedExpenseDraftSchema,
  draftSaveOutcomeSchema as outcomeSchema,
  draftReviewSchema as reviewSchema,
} from './validators/expense-draft';

const draftSchema = persistedExpenseDraftSchema
  .refine((draft) => draft.state !== 'active' || draft.values !== undefined)
  .refine((draft) => draft.state !== 'saved' || draft.expenseId !== undefined);

function decode<T>(schema: z.ZodType<T>, response: unknown): T {
  const parsed = z.object({ data: schema }).safeParse(response);
  if (!parsed.success)
    throw new Error(
      'Draft response not confirmed. Retry the original request before making changes.',
    );
  return parsed.data.data;
}
export function readDrafts(response: unknown, groupId: string) {
  return decode(
    z
      .array(draftSchema)
      .max(100)
      .refine(
        (rows) =>
          rows.every((row) => row.groupId === groupId) &&
          new Set(rows.map((row) => row.id)).size === rows.length,
      ),
    response,
  );
}
export function readDraft(response: unknown, groupId: string, id: string) {
  return decode(
    draftSchema.refine((row) => row.groupId === groupId && row.id === id),
    response,
  );
}
export function readDraftReviews(response: unknown, groupId: string, ids: string[]) {
  return decode(
    z
      .array(reviewSchema)
      .refine(
        (rows) =>
          rows.length === ids.length &&
          new Set(rows.map((row) => row.draft.id)).size === ids.length &&
          rows.every((row) => row.draft.groupId === groupId && ids.includes(row.draft.id)),
      ),
    response,
  );
}
export function readDraftOutcomes(response: unknown, ids: string[]) {
  return decode(
    z
      .array(outcomeSchema)
      .refine(
        (rows) =>
          rows.length === ids.length &&
          new Set(rows.map((row) => row.id)).size === ids.length &&
          rows.every((row) => ids.includes(row.id)),
      ),
    response,
  );
}
