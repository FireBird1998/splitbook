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
      /** The Group's Expense currency, which a Draft without one takes (#512). */
      currency: z.string().optional(),
      count: z.number().int().nonnegative(),
      items: z.array(toReviewItemSchema),
    }),
  ),
});
/** The read with each item still unread, so one bad item can't stop the rest. */
const toReviewResponseSchema = z.object({
  status: z.literal(200),
  data: toReviewReadSchema.extend({
    groups: z.array(
      toReviewReadSchema.shape.groups.element.extend({ items: z.array(z.unknown()) }),
    ),
  }),
});
export type ToReviewItem = z.infer<typeof toReviewItemSchema>;
export type ToReviewRead = z.infer<typeof toReviewReadSchema>;
export class ToReviewReadError extends Error {
  constructor() {
    super('Unable to load To review. Please retry.');
    this.name = 'ToReviewReadError';
  }
}

/**
 * To review without the items that can't be read, and how many those were in each Group, by its
 * id (#513): an item that fails the shared schema, isn't active or is filed under another Group
 * is left out, and so is a Group left with none. A read whose own totals don't add up is refused
 * whole.
 */
export function parseReadableToReview(value: unknown): {
  read: ToReviewRead;
  unreadable: Record<string, number>;
} {
  const result = toReviewResponseSchema.safeParse(value);
  if (!result.success) throw new ToReviewReadError();
  const data = result.data.data;
  if (
    data.total !== data.groups.reduce((n, group) => n + group.count, 0) ||
    data.groups.some((group) => group.count !== group.items.length)
  )
    throw new ToReviewReadError();
  const unreadable: Record<string, number> = {};
  const groups = data.groups.flatMap((group) => {
    const items = group.items.flatMap((entry) => {
      const item = toReviewItemSchema.safeParse(entry);
      if (
        item.success &&
        item.data.draft.state === 'active' &&
        item.data.draft.groupId === group.groupId
      )
        return [item.data];
      unreadable[group.groupId] = (unreadable[group.groupId] ?? 0) + 1;
      return [];
    });
    return items.length || !group.items.length ? [{ ...group, count: items.length, items }] : [];
  });
  return {
    read: { ...data, total: groups.reduce((n, group) => n + group.count, 0), groups },
    unreadable,
  };
}

/** To review whole, or not at all: Android's read. */
export function parseToReviewResponse(value: unknown): ToReviewRead {
  const { read, unreadable } = parseReadableToReview(value);
  if (Object.keys(unreadable).length) throw new ToReviewReadError();
  return read;
}
