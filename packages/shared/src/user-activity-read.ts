/**
 * The read contract of the latest Activity across the member's Groups (#309), returned in wire
 * shape. Home's "Latest changes" card reads it. Each event names its Group, and people by name
 * only: the actor as `{ _id, name }`, a payment's two sides by `paidByName` and `paidToName`.
 */
import { z } from 'zod';
import { amount, currencyCode, identity, timestamp } from './wire-fields';

/** How many events the read returns when the request doesn't say. */
export const USER_ACTIVITY_DEFAULT_LIMIT = 10;
/** The most events one read returns; a larger `limit` is cut to this. */
export const USER_ACTIVITY_MAX_LIMIT = 50;

/** An Expense edit's money fields, before and after. Other changes aren't sent. */
const change = z.looseObject({ old: z.unknown().optional(), new: z.unknown().optional() });
const metadata = z.looseObject({
  expenseId: identity.optional(),
  settlementId: identity.optional(),
  description: z.string().optional(),
  amount: amount.optional(),
  currency: currencyCode.optional(),
  paidByName: z.string().optional(),
  paidToName: z.string().optional(),
  action: z.string().optional(),
  method: z.string().optional(),
  changes: z
    .looseObject({
      amount: change.optional(),
      amountMinor: change.optional(),
      currency: change.optional(),
    })
    .optional(),
});
const event = z.looseObject({
  _id: identity,
  type: z.string().min(1),
  createdAt: timestamp,
  group: z.looseObject({ _id: identity, name: z.string() }),
  /** Always named; null when the person's account no longer exists. */
  actor: z.looseObject({ _id: identity, name: z.string().optional() }).nullable(),
  /** The currency of the event's amounts, when it has any. */
  currency: currencyCode.optional(),
  metadata,
});
const userActivity = z.looseObject({
  activities: z.array(event).max(USER_ACTIVITY_MAX_LIMIT),
  limit: z.number().int().positive().max(USER_ACTIVITY_MAX_LIMIT),
});

export type UserActivityRead = z.infer<typeof userActivity>;
export type UserActivityEventRead = UserActivityRead['activities'][number];

/** Keep malformed remote data out of the apps' views and out of error messages. */
export class UserActivityReadError extends Error {
  constructor() {
    super('Unable to load the latest changes. Please retry.');
    this.name = 'UserActivityReadError';
  }
}

const response = z.object({ status: z.literal(200), data: userActivity });

export function parseUserActivityResponse(value: unknown): UserActivityRead {
  const result = response.safeParse(value);
  if (!result.success) throw new UserActivityReadError();
  return result.data.data;
}
