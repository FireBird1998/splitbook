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
