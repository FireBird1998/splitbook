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

// --- The Month in detail (#315) ---------------------------------------------------------------

/*
 * The read gained three fields after `hasExpenses`: `byTag`, `whoPaid` and, only while
 * recurring Expenses are switched on (#289), `recurring`. `parseGroupInsightsResponse` keeps
 * them as it keeps any field it doesn't declare, and each is decoded here on its own, so a
 * malformed one fails only the card that shows it, never the tab.
 */

const direction = z.enum(['up', 'down', 'level']);
const namedPerson = z.looseObject({ id: identity, name: z.string() });

const byTag = z.looseObject({
  /** The Months averaged: the read's earlier Months, never the Month itself. */
  earlierMonths: z.array(month),
  tags: z.array(
    z.looseObject({
      /** Null for Untagged: Expenses whose Tag isn't one of the Group's. */
      tagId: identity.nullable(),
      /** The Tag's name now, written by a Group member; null for Untagged. */
      name: z.string().nullable(),
      spentMinor: minor,
      expenseCount: count,
      averageMinor: minor.nullable(),
      differenceMinor: z.number().int().nullable(),
      direction: direction.nullable(),
      changePercent: z.number().nullable(),
    }),
  ),
});

const whoPaid = z.looseObject({
  members: z.array(
    namedPerson.extend({
      /** False for someone who has left but paid or shares something in the Month. */
      isMember: z.boolean(),
      paidMinor: minor,
      shareMinor: minor,
      netMinor: z.number().int(),
    }),
  ),
});

const recurring = z.looseObject({
  addedInMonth: z.looseObject({ count, spentMinor: minor }),
  templates: z.array(
    z.looseObject({
      id: identity,
      description: z.string(),
      amountMinor: minor,
      dayOfMonth: z.number().int().min(1).max(31),
      paused: z.boolean(),
      /** Null while paused or once it has ended. */
      nextDate: day.nullable(),
      /** The day of the Expense it added in the Month; null when it added none. */
      addedOn: day.nullable(),
      paidBy: z.array(namedPerson),
    }),
  ),
});

export type GroupInsightsByTagRead = z.infer<typeof byTag>;
export type GroupInsightsTagRead = GroupInsightsByTagRead['tags'][number];
export type GroupInsightsWhoPaidRead = z.infer<typeof whoPaid>;
export type GroupInsightsPaidShareRead = GroupInsightsWhoPaidRead['members'][number];
export type GroupInsightsRecurringRead = z.infer<typeof recurring>;
export type GroupInsightsTemplateRead = GroupInsightsRecurringRead['templates'][number];

/** One field of the read, decoded on its own: `ok: false` fails only the card that shows it. */
export type GroupInsightsPart<T> = { ok: true; value: T } | { ok: false };

function decodePart<T>(
  schema: z.ZodType<T>,
  value: unknown,
  consistent: (decoded: T) => boolean,
): GroupInsightsPart<T> {
  const result = schema.safeParse(value);
  return result.success && consistent(result.data)
    ? { ok: true, value: result.data }
    : { ok: false };
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** Spending by Tag: averaged over the read's own earlier Months, with one Untagged row at most. */
export function readGroupInsightsByTag(
  read: GroupInsightsRead,
): GroupInsightsPart<GroupInsightsByTagRead> {
  const earlier = read.months.slice(0, -1).map((entry) => entry.month);
  return decodePart(
    byTag,
    read.byTag,
    (decoded) =>
      decoded.earlierMonths.join() === earlier.join() &&
      decoded.tags.filter((tag) => tag.tagId === null).length <= 1,
  );
}

/** Who paid in the Month: the Paids and the Shares each add up to the Month's Spent. */
export function readGroupInsightsWhoPaid(
  read: GroupInsightsRead,
): GroupInsightsPart<GroupInsightsWhoPaidRead> {
  const spent = read.months[read.months.length - 1].spentMinor;
  return decodePart(
    whoPaid,
    read.whoPaid,
    ({ members }) =>
      sum(members.map((member) => member.paidMinor)) === spent &&
      sum(members.map((member) => member.shareMinor)) === spent,
  );
}

/**
 * The recurring Expenses card's data, or null while recurring Expenses are switched off: the
 * read sends none then, and the card isn't shown at all.
 */
export function readGroupInsightsRecurring(
  read: GroupInsightsRead,
): GroupInsightsPart<GroupInsightsRecurringRead> | null {
  if (!read.recurringExpenses) return null;
  const counted = read.months[read.months.length - 1].recurringCount;
  return decodePart(
    recurring,
    read.recurring,
    (decoded) => counted === undefined || decoded.addedInMonth.count === counted,
  );
}
