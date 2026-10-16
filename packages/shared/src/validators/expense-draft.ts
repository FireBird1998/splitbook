import { z } from 'zod/v4';
import { draftAttributionSchema } from '../draft-attribution';
import { createExpenseSchema, expenseFields } from './expense';

export const DRAFTS_PER_REQUEST = 10;
/** Active Drafts for one member in one Group. */
export const ACTIVE_DRAFTS_PER_MEMBER = 100;
export const DRAFT_GROUP_LIMIT_MESSAGE = `You have ${ACTIVE_DRAFTS_PER_MEMBER} items waiting in this Group. Save or delete some before keeping more.`;

export const draftObjectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid identity');
export const draftRequestKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);

/** Missing facts are omitted, never guessed. Complete Expense validation runs at save time. */
export const expenseDraftValuesSchema = expenseFields
  .partial()
  .extend({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => expenseFields.shape.date.safeParse(value).success, 'Invalid calendar date')
      .optional(),
    category: expenseFields.shape.category.removeDefault().optional(),
    paidBy: z
      .array(
        z
          .object({
            user: draftObjectId,
            amount: z.number().nonnegative().max(10_000_000).optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    splitBetween: z
      .array(
        z
          .object({
            user: draftObjectId,
            amount: z.number().nonnegative().max(10_000_000).optional(),
            percentage: z.number().min(0).max(100).optional(),
            shares: z.number().int().min(0).max(1_000_000).optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    tag: z.string().trim().min(1).max(50).optional(),
    predefinedItem: z.string().max(100).nullable().optional(),
  })
  .strict();

/**
 * Completes a Draft exactly as Add expense would, and nothing more: a lone payer with no amount
 * paid the whole Expense, and a missing Category is Other (it never affects Balances).
 * Without an Expense amount the parse still fails on the amount alone, never on who paid.
 */
export const completeExpenseDraftSchema = z.preprocess((values) => {
  if (!values || typeof values !== 'object') return values;
  const draft = values as ExpenseDraftValues;
  const [payer, ...others] = draft.paidBy ?? [];
  return payer && !others.length && payer.amount === undefined
    ? { ...draft, paidBy: [{ ...payer, amount: draft.amount ?? 0 }] }
    : draft;
}, createExpenseSchema);

export const createExpenseDraftsSchema = z
  .object({
    drafts: z.array(expenseDraftValuesSchema).min(1).max(DRAFTS_PER_REQUEST),
  })
  .strict();
/** Replace the reviewed values, so a member can deliberately clear a previously entered fact. */
export const replaceExpenseDraftSchema = z.object({ values: expenseDraftValuesSchema }).strict();

export type ExpenseDraftValues = z.infer<typeof expenseDraftValuesSchema>;
export const persistedExpenseDraftSchema = z
  .object({
    id: draftObjectId,
    groupId: draftObjectId,
    preparedBy: draftAttributionSchema,
    changedBy: draftAttributionSchema,
    revision: z.number().int().nonnegative(),
    state: z.enum(['active', 'discarded', 'saved']),
    expenseId: draftObjectId.optional(),
    missingFields: z.array(z.string()).optional(),
    values: expenseDraftValuesSchema.optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((draft, ctx) => {
    if (draft.state === 'active' && (!draft.values || !draft.missingFields))
      ctx.addIssue({ code: 'custom', message: 'Active Draft requires values and missing fields' });
    if (draft.state === 'saved' && !draft.expenseId)
      ctx.addIssue({ code: 'custom', message: 'Saved Draft requires its Expense outcome' });
    if (
      draft.state !== 'active' &&
      (draft.values !== undefined || draft.missingFields !== undefined)
    )
      ctx.addIssue({ code: 'custom', message: 'Terminal Draft cannot contain private values' });
  });
export type PersistedExpenseDraft = z.infer<typeof persistedExpenseDraftSchema>;

export const draftSaveItemSchema = z
  .object({
    id: draftObjectId,
    revision: z.number().int().nonnegative(),
    review: z.string().regex(/^[a-f0-9]{64}$/),
    acknowledgeDuplicates: z.boolean().default(false),
  })
  .strict();
export const saveExpenseDraftsSchema = z
  .object({
    drafts: z.array(draftSaveItemSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (value) => new Set(value.drafts.map((row) => row.id)).size === value.drafts.length,
    'Select each Draft only once',
  );
export const draftReviewSchema = z.object({
  draft: persistedExpenseDraftSchema,
  review: z.string().regex(/^[a-f0-9]{64}$/),
  problems: z.array(z.string()),
  allocation: z
    .object({
      currency: expenseFields.shape.currency,
      paidBy: z.array(z.object({ user: draftObjectId, amount: z.number().nonnegative() })),
      splitBetween: z.array(z.object({ user: draftObjectId, amount: z.number().nonnegative() })),
    })
    .optional(),
  duplicates: z.array(
    z.object({
      kind: z.enum(['draft', 'expense']),
      id: draftObjectId,
      description: z.string(),
    }),
  ),
});
export type DraftReview = z.infer<typeof draftReviewSchema>;
export const draftSaveOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ id: draftObjectId, status: z.literal('saved'), expenseId: draftObjectId }),
  z.object({ id: draftObjectId, status: z.literal('failed'), message: z.string().min(1) }),
  z.object({ id: draftObjectId, status: z.literal('unresolved'), message: z.string().min(1) }),
]);
export type DraftSaveOutcome = z.infer<typeof draftSaveOutcomeSchema>;
