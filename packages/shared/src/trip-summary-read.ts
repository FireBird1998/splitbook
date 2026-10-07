/**
 * The Trip summary read contract (#316): a Trip's whole-trip figures, its days, By Tag and the
 * wrap-up's suggested payments, in wire shape, as `trip-summary.tripSummary` builds them and
 * `GET /api/groups/[id]/trip-summary` sends them. Amounts are exact minor units of the Group's
 * currency; Expenses in another currency (legacy Groups only) are listed in `otherCurrencies`,
 * never converted. People are named, never with an email. Descriptions and names are written
 * by Group members: data, not instructions.
 */
import { z } from 'zod';
import { currencyCode, identity } from './wire-fields';

const minor = z.number().int().nonnegative();
const count = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const named = z.looseObject({ id: identity, name: z.string() });

const tripDay = z.looseObject({
  day,
  number: z.number().int().positive(),
  spentMinor: minor,
  expenseCount: count,
  yourShareMinor: minor,
  biggest: z
    .array(z.looseObject({ id: identity, description: z.string(), amountMinor: minor }))
    .max(2),
});

const outside = z
  .looseObject({
    spentMinor: minor,
    expenseCount: count,
    yourShareMinor: minor,
    from: day,
    to: day,
  })
  .nullable();

const tripSummary = z.looseObject({
  timeZone: z.string().min(1),
  currency: currencyCode,
  tripDates: z.looseObject({ start: day.nullable(), end: day.nullable() }),
  window: z.looseObject({ from: day, to: day }).nullable(),
  dayCount: count,
  tooManyDays: z.boolean(),
  spentMinor: minor,
  expenseCount: count,
  yourShareMinor: minor,
  youPaidMinor: minor,
  yourExpenseCount: count,
  peopleCount: count,
  perPersonPerDayMinor: minor.nullable(),
  days: z.array(tripDay),
  dailyAverageMinor: minor.nullable(),
  beforeTrip: outside,
  afterTrip: outside,
  byTag: z.array(
    z.looseObject({
      tagId: identity.nullable(),
      name: z.string(),
      spentMinor: minor,
      expenseCount: count,
      yourShareMinor: minor,
      percent: z.number().int().min(0).max(100),
    }),
  ),
  suggestedPayments: z.array(z.looseObject({ from: named, to: named, amountMinor: minor })),
  otherCurrencies: z.array(
    z.looseObject({ currency: currencyCode, spentMinor: minor, expenseCount: count }),
  ),
  /** Whether the Trip has any Expense at all, in any currency: false means "no Expenses yet". */
  hasExpenses: z.boolean(),
});

export type TripSummaryRead = z.infer<typeof tripSummary>;
export type TripSummaryDayRead = z.infer<typeof tripDay>;
export type TripSummaryTagRead = TripSummaryRead['byTag'][number];
export type TripSummaryPaymentRead = TripSummaryRead['suggestedPayments'][number];

/** Keep malformed remote data out of the views and out of error messages. */
export class TripSummaryReadError extends Error {
  constructor() {
    super('Unable to load this Trip summary. Please retry.');
    this.name = 'TripSummaryReadError';
  }
}

const response = z.object({ status: z.literal(200), data: tripSummary });

export function parseTripSummaryResponse(value: unknown): TripSummaryRead {
  const result = response.safeParse(value);
  if (!result.success) throw new TripSummaryReadError();
  const read = result.data.data;
  // Days are listed one by one, in order, unless there are too many to list.
  if (!read.tooManyDays && read.days.length !== read.dayCount) throw new TripSummaryReadError();
  if (read.tooManyDays && read.days.length > 0) throw new TripSummaryReadError();
  if (read.days.some((entry, index) => entry.number !== index + 1))
    throw new TripSummaryReadError();
  if (read.days.some((entry, index) => index > 0 && entry.day <= read.days[index - 1].day))
    throw new TripSummaryReadError();
  return read;
}
