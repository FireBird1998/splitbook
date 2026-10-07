/** Home's totals read contract (#210): the member's figures by currency and by Group, in wire shape. */
import { z } from 'zod';
import { amount, currencyCode, identity } from './wire-fields';

const homeBalances = z.looseObject({
  buckets: z.array(
    z.looseObject({
      currency: currencyCode,
      youOwe: amount.nonnegative(),
      youAreOwed: amount.nonnegative(),
    }),
  ),
  groups: z
    .array(
      z.looseObject({
        groupId: identity,
        balances: z.array(z.looseObject({ currency: currencyCode, balance: amount })),
      }),
    )
    .optional(),
});

export type HomeBalancesRead = z.infer<typeof homeBalances>;

/** Keep malformed remote data out of both apps' views and out of error messages. */
export class HomeBalancesReadError extends Error {
  constructor() {
    super('Unable to load your balances. Please retry.');
    this.name = 'HomeBalancesReadError';
  }
}

const response = z.object({ status: z.literal(200), data: homeBalances });

export function parseHomeBalancesResponse(value: unknown): HomeBalancesRead {
  const result = response.safeParse(value);
  if (!result.success) throw new HomeBalancesReadError();
  return result.data.data;
}

/**
 * The suggested payments the balances read adds for Home's "Needs you" (#306). The field is
 * additive: `parseHomeBalancesResponse` keeps it as an undeclared field and never checks it, so
 * Android's read of this endpoint is unchanged. The web reads it here, on its own, so a
 * malformed list fails Needs you without failing the balances beside it.
 */
const suggestedPayment = z.looseObject({
  groupId: identity,
  groupName: z.string(),
  currency: currencyCode,
  direction: z.enum(['pay', 'receive']),
  counterpartyId: identity,
  counterpartyName: z.string(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const suggestedPayments = z.array(suggestedPayment);

export type HomeSuggestedPaymentRead = z.infer<typeof suggestedPayment>;

/** Keep a malformed or missing list out of Needs you and out of error messages. */
export class HomeSuggestedPaymentsReadError extends Error {
  constructor() {
    super('Unable to load your suggested payments. Please retry.');
    this.name = 'HomeSuggestedPaymentsReadError';
  }
}

/**
 * The suggested payments of a decoded balances read. Throws when the read has none (a server
 * from before #306) or they are malformed: "no list" never reads as "nothing to pay".
 */
export function readHomeSuggestedPayments(home: HomeBalancesRead): HomeSuggestedPaymentRead[] {
  const result = suggestedPayments.safeParse(home.suggestedPayments);
  if (!result.success) throw new HomeSuggestedPaymentsReadError();
  return result.data;
}
