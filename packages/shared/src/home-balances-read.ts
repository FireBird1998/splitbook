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
