/**
 * Changing several Expenses' Tag in one request (#610): the request names one active Tag and
 * the Expenses, each with the revision the member last saw, and the reply says what happened to
 * each, in the order asked.
 */
import { z } from 'zod';

/** The most Expenses one request may list: two pages of the web list (50 rows each). */
export const EXPENSE_TAG_CHANGE_MAX = 100;

const id = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid identity');
const revision = z.number().int().nonnegative();

export const expenseTagChangeRequestSchema = z.object({
  tagId: id,
  expenses: z
    .array(z.object({ id, revision }))
    .min(1)
    .max(EXPENSE_TAG_CHANGE_MAX)
    .refine((expenses) => new Set(expenses.map((expense) => expense.id)).size === expenses.length, {
      message: 'List each Expense once',
    }),
});
export type ExpenseTagChangeRequest = z.infer<typeof expenseTagChangeRequestSchema>;

/**
 * What happened to one Expense:
 * - `changed`: it is on the Tag now, at `revision`;
 * - `unchanged`: it was already on the Tag, so nothing was edited (a retry says this);
 * - `changed-elsewhere`: someone changed it since the member saw it, so it was left as it is;
 * - `unavailable`: it was deleted, or isn't in the Group;
 * - `refused`: it couldn't change, for the `reason` given in member words.
 */
export const EXPENSE_TAG_CHANGE_OUTCOMES = [
  'changed',
  'unchanged',
  'changed-elsewhere',
  'unavailable',
  'refused',
] as const;
export type ExpenseTagChangeOutcome = (typeof EXPENSE_TAG_CHANGE_OUTCOMES)[number];

export const expenseTagChangeResultSchema = z.object({
  expenseId: id,
  // An outcome a later server names is one this client can't act on: it reads as refused.
  outcome: z.enum(EXPENSE_TAG_CHANGE_OUTCOMES).catch('refused'),
  revision: revision.optional(),
  code: z.string().optional(),
  reason: z.string().optional(),
});
export type ExpenseTagChangeResult = z.infer<typeof expenseTagChangeResultSchema>;

export const expenseTagChangeReplySchema = z.object({
  tagId: id,
  results: z.array(expenseTagChangeResultSchema),
});
export type ExpenseTagChangeReply = z.infer<typeof expenseTagChangeReplySchema>;
