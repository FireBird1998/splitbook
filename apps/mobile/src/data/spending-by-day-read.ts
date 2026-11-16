import { z } from 'zod';

/**
 * The Spending by day read's reply (#1273), as this phone reads and keeps it: one Month of the
 * member's own share, per currency, in exact minor units. Days and Expenses follow the Expense day
 * rule (a calendar day, no time zone shift). A Month with nothing has no currencies.
 *
 * Until #1273's shared parser lands, this reads the reply shape agreed for it; it then reads the
 * reply through that parser instead.
 */
const minor = z.number().int();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const expenseSchema = z.object({
  _id: z.string().min(1),
  group: z.object({ _id: z.string().min(1), name: z.string() }),
  description: z.string(),
  tag: z.string().nullable(),
  /** A payer's name is left out when their account no longer exists. */
  paidBy: z.array(z.object({ _id: z.string().min(1), name: z.string().optional() })),
  day,
  shareMinor: minor.positive(),
  amountMinor: minor,
});
const currencySchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  totalMinor: minor,
  dayCount: z.number().int().nonnegative(),
  days: z.array(z.object({ day, shareMinor: minor.positive() })),
  expenses: z.array(expenseSchema),
});
const dataSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  timeZone: z.string().min(1),
  currencies: z.array(currencySchema),
});
const replySchema = z.object({ data: dataSchema });

export type SpendingByDay = z.infer<typeof dataSchema>;
export type SpendingCurrency = SpendingByDay['currencies'][number];
export type SpendingExpense = SpendingCurrency['expenses'][number];

/** The reply's Month, or a throw for a reply this phone can't read. */
export function parseSpendingByDay(value: unknown): SpendingByDay {
  return replySchema.parse(value).data;
}
