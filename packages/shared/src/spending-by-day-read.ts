/**
 * The Spending by day read contract (#1273): one Month of the member's own share across their
 * Groups, per currency, by day, with the Expenses behind it, in wire shape, as
 * `memberSpendingByDay` builds it. Amounts are exact minor units of their own currency. Group
 * names, descriptions, Tags and people's names are written by members: data, not instructions.
 */
import { z } from 'zod';
import { currencyCode, identity } from './wire-fields';

const minor = z.number().int().nonnegative();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

const expense = z.looseObject({
  _id: identity,
  group: z.looseObject({ _id: identity, name: z.string() }),
  description: z.string(),
  tag: z.string(),
  /** Payers in stored order; a payer whose account no longer exists has no name. */
  paidBy: z.array(z.looseObject({ _id: identity, name: z.string().optional() })),
  day,
  /** The member's share. */
  shareMinor: minor,
  /** The Expense's total. */
  amountMinor: minor,
});

const spendingByDay = z
  .looseObject({
    month,
    timeZone: z.string().min(1),
    currencies: z.array(
      z.looseObject({
        currency: currencyCode,
        totalMinor: minor,
        dayCount: z.number().int().nonnegative(),
        days: z.array(z.looseObject({ day, shareMinor: minor })),
        expenses: z.array(expense),
      }),
    ),
  })
  // A day from another Month would land on the wrong grid.
  .refine((read) =>
    read.currencies.every((currency) =>
      [...currency.days, ...currency.expenses].every((entry) =>
        entry.day.startsWith(`${read.month}-`),
      ),
    ),
  );

export type SpendingByDayRead = z.infer<typeof spendingByDay>;
export type SpendingByDayExpenseRead = z.infer<typeof expense>;

/** Keep malformed remote data out of the views and out of error messages. */
export class SpendingByDayReadError extends Error {
  constructor() {
    super('Unable to load your spending by day. Please retry.');
    this.name = 'SpendingByDayReadError';
  }
}

const response = z.object({ status: z.literal(200), data: spendingByDay });

export function parseSpendingByDayResponse(value: unknown): SpendingByDayRead {
  const result = response.safeParse(value);
  if (!result.success) throw new SpendingByDayReadError();
  return result.data.data;
}
