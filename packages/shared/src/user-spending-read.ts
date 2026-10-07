/**
 * The member's spending read contract (#307): their share by Month and currency across their
 * Groups, in wire shape, as `insights.memberSpendingByMonth` builds it. Amounts are exact minor
 * units of their own currency.
 */
import { z } from 'zod';
import { currencyCode, identity } from './wire-fields';

const minor = z.number().int().nonnegative();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const groupShare = z.looseObject({ groupId: identity, shareMinor: minor });

const userSpending = z.looseObject({
  timeZone: z.string().min(1),
  months: z.array(month).min(1),
  window: z.looseObject({ from: day, to: day }),
  groups: z.array(z.looseObject({ groupId: identity, name: z.string() })),
  currencies: z.array(
    z.looseObject({
      currency: currencyCode,
      totalMinor: minor,
      expenseCount: z.number().int().nonnegative(),
      months: z.array(z.looseObject({ month, shareMinor: minor, byGroup: z.array(groupShare) })),
    }),
  ),
});

export type UserSpendingRead = z.infer<typeof userSpending>;

/** Keep malformed remote data out of the views and out of error messages. */
export class UserSpendingReadError extends Error {
  constructor() {
    super('Unable to load your spending. Please retry.');
    this.name = 'UserSpendingReadError';
  }
}

const response = z.object({ status: z.literal(200), data: userSpending });

export function parseUserSpendingResponse(value: unknown): UserSpendingRead {
  const result = response.safeParse(value);
  if (!result.success) throw new UserSpendingReadError();
  return result.data.data;
}

/*
 * Fields the read adds for Home's "Where it went" and Groups table (#308). They are additive:
 * `parseUserSpendingResponse` keeps them as undeclared fields and never checks them, so the
 * spending chart reads on whatever they hold. Each card reads its own here, so a malformed
 * field fails that card alone.
 */

const count = z.number().int().nonnegative();
const thisMonth = z.looseObject({
  month,
  byCategory: z.array(
    z.looseObject({
      currency: currencyCode,
      totalMinor: minor,
      expenseCount: count,
      categories: z.array(
        z.looseObject({ category: z.string().min(1), shareMinor: minor, expenseCount: count }),
      ),
    }),
  ),
  groups: z.array(
    z.looseObject({
      groupId: identity,
      spent: z.array(
        z.looseObject({ currency: currencyCode, totalMinor: minor, expenseCount: count }),
      ),
    }),
  ),
});

/** The current Month in detail: the member's share by Category, and what each Group spent. */
export type SpendingThisMonthRead = z.infer<typeof thisMonth>;

/** Keep a malformed or missing Month detail out of the views and out of error messages. */
export class SpendingThisMonthReadError extends Error {
  constructor() {
    super('Unable to load this month’s spending. Please retry.');
    this.name = 'SpendingThisMonthReadError';
  }
}

/**
 * The current Month in detail, from a decoded spending read. Throws when the read has none (a
 * server from before #308), when it is malformed, or when it isn't the read's current Month.
 */
export function readSpendingThisMonth(read: UserSpendingRead): SpendingThisMonthRead {
  const result = thisMonth.safeParse((read as { thisMonth?: unknown }).thisMonth);
  if (!result.success || result.data.month !== read.months[read.months.length - 1])
    throw new SpendingThisMonthReadError();
  return result.data;
}

const lastChanges = z.array(
  z.looseObject({ groupId: identity, at: z.iso.datetime({ offset: true }).nullable() }),
);

/** When each Group last changed: the time of its latest Activity, or null when it has none. */
export type GroupLastChangeRead = z.infer<typeof lastChanges>[number];

/** Keep a malformed or missing list out of the Groups table and out of error messages. */
export class GroupLastChangesReadError extends Error {
  constructor() {
    super('Unable to load when your Groups last changed. Please retry.');
    this.name = 'GroupLastChangesReadError';
  }
}

/** Each Group's last change, from a decoded spending read. Throws when missing or malformed. */
export function readGroupLastChanges(read: UserSpendingRead): GroupLastChangeRead[] {
  const result = lastChanges.safeParse((read as { lastChanges?: unknown }).lastChanges);
  if (!result.success) throw new GroupLastChangesReadError();
  return result.data;
}
