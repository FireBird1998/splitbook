import { z } from 'zod';

const tagId = z.string().regex(/^[a-f\d]{24}$/i);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const name = z.string().trim().min(1, 'Enter a Tag name.').max(50);
const existing = { tagId, expectedRevision: revision };

/** Immutable intent: retries must retain the reviewed revision and the original name. */
export const tagIntentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name }).strict(),
  z.object({ action: z.literal('rename'), ...existing, name }).strict(),
  z.object({ action: z.literal('archive'), ...existing }).strict(),
  z.object({ action: z.literal('restore'), ...existing }).strict(),
  z.object({ action: z.literal('delete'), ...existing }).strict(),
]);
export const tagCommandSchema = z
  .object({
    requestId: z.string().uuid(),
    intent: tagIntentSchema,
  })
  .strict();
export type TagIntent = z.infer<typeof tagIntentSchema>;
export type TagCommand = z.infer<typeof tagCommandSchema>;
export const managedTagSchema = z.object({
  id: tagId,
  name: z.string(),
  revision,
  isArchived: z.boolean(),
  isDeleted: z.boolean(),
});
export type ManagedTag = z.infer<typeof managedTagSchema>;
export const tagSnapshotSchema = z.object({
  canManage: z.boolean(),
  tags: z.array(managedTagSchema),
});
export type TagSnapshot = z.infer<typeof tagSnapshotSchema>;
export const tagActionResultSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('not-applied'),
    requestId: z.string().uuid(),
    snapshot: tagSnapshotSchema,
  }),
  z.object({
    state: z.literal('applied'),
    requestId: z.string().uuid(),
    receipt: z.object({ intent: tagIntentSchema, tagId, appliedAt: z.string().datetime() }),
    snapshot: tagSnapshotSchema,
  }),
]);
export type TagActionResult = z.infer<typeof tagActionResultSchema>;

export const tagArchiveExplanation =
  'Saved Expenses keep this Tag and their history. Unfinished Drafts need an active Tag before saving. Recurring Expenses using this Tag stop generating until an active Tag is selected.';

/** Only these post-receipt-lookup conflicts prove this exact action had no effect. */
export function isDefinitiveTagRejection(status: number, code: string | null | undefined) {
  return (
    status === 409 &&
    ['TAG_CHANGED', 'TAG_EXISTS', 'LAST_ACTIVE_TAG', 'TAG_IN_USE', 'AMBIGUOUS_TAG'].includes(
      code ?? '',
    )
  );
}
