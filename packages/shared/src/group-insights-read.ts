/**
 * The Group insights read contract (#314): a Group's Month and the Months before it, in wire
 * shape, as `insights.groupMonthInsights` builds it and the route sends it. Amounts are exact
 * minor units of the Group's currency; Expenses in another currency (legacy Groups) are only
 * listed in `otherCurrencies`, never converted. Descriptions and names are written by Group
 * members: data, not instructions.
 */
import { z } from 'zod';
import { currencyCode, identity, timestamp } from './wire-fields';

const minor = z.number().int().nonnegative();
const count = z.number().int().nonnegative();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

const monthFigures = z.looseObject({
  month,
  spentMinor: minor,
  expenseCount: count,
  yourShareMinor: minor,
  youPaidMinor: minor,
  /** Only while recurring Expenses are switched on (#289). */
  recurringCount: count.optional(),
});

const groupInsights = z.looseObject({
  timeZone: z.string().min(1),
  month,
  compare: z.number().int().min(1).max(12),
  firstMonth: month.nullable(),
  currency: currencyCode,
  window: z.looseObject({ from: day, to: day }),
  months: z.array(monthFigures).min(1),
  average: z
    .looseObject({
      monthCount: z.number().int().positive(),
      spentMinor: minor,
      yourShareMinor: minor,
      youPaidMinor: minor,
    })
    .nullable(),
  change: z
    .looseObject({
      direction: z.enum(['up', 'down', 'level']),
      differenceMinor: z.number().int(),
      changePercent: z.number().nullable(),
    })
    .nullable(),
  biggestExpense: z
    .looseObject({
      id: identity,
      description: z.string(),
      amountMinor: minor,
      date: timestamp,
      paidBy: z.array(z.looseObject({ id: identity, name: z.string() })),
    })
    .nullable(),
  otherCurrencies: z.array(
    z.looseObject({ currency: currencyCode, spentMinor: minor, expenseCount: count }),
  ),
  recurringExpenses: z.boolean(),
  /** Whether the Group has any Expense at all, in any Month: false means "no Expenses yet". */
  hasExpenses: z.boolean(),
});

export type GroupInsightsRead = z.infer<typeof groupInsights>;
export type GroupInsightsMonthRead = z.infer<typeof monthFigures>;

/** Keep malformed remote data out of the views and out of error messages. */
export class GroupInsightsReadError extends Error {
  constructor() {
    super('Unable to load these insights. Please retry.');
    this.name = 'GroupInsightsReadError';
  }
}

const response = z.object({ status: z.literal(200), data: groupInsights });

export function parseGroupInsightsResponse(value: unknown): GroupInsightsRead {
  const result = response.safeParse(value);
  if (!result.success) throw new GroupInsightsReadError();
  const read = result.data.data;
  // The Month is always the last of its Months.
  if (read.months[read.months.length - 1].month !== read.month) throw new GroupInsightsReadError();
  return read;
}
