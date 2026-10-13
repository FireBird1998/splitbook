import { z } from 'zod';
import { draftReviewSchema } from './validators/expense-draft';
import { identity } from './wire-fields';

/** Additive read contract, shared by the web and Android. No save authorization token. */
export const toReviewItemSchema = z.looseObject({
  draft: draftReviewSchema.shape.draft,
  problems: draftReviewSchema.shape.problems,
  duplicates: draftReviewSchema.shape.duplicates,
});
const toReviewReadSchema = z.looseObject({
  total: z.number().int().nonnegative(),
  groups: z.array(
    z.looseObject({
      groupId: identity,
      groupName: z.string(),
      count: z.number().int().nonnegative(),
      items: z.array(toReviewItemSchema),
    }),
  ),
});
export type ToReviewItem = z.infer<typeof toReviewItemSchema>;
export type ToReviewRead = z.infer<typeof toReviewReadSchema>;
export class ToReviewReadError extends Error {
  constructor() {
    super('Unable to load To review. Please retry.');
    this.name = 'ToReviewReadError';
  }
}
export function parseToReviewResponse(value: unknown): ToReviewRead {
  const result = z.object({ status: z.literal(200), data: toReviewReadSchema }).safeParse(value);
  if (!result.success) throw new ToReviewReadError();
  const read = result.data.data;
  if (
    read.total !== read.groups.reduce((n, group) => n + group.count, 0) ||
    read.groups.some(
      (group) =>
        group.count !== group.items.length ||
        group.items.some(
          (item) => item.draft.state !== 'active' || item.draft.groupId !== group.groupId,
        ),
    )
  )
    throw new ToReviewReadError();
  return read;
}
