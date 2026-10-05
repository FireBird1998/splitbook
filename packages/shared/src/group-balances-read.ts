/** A Group's Balances read contract (#210), returned in wire shape. */
import { z } from 'zod';
import { amount, currencyCode, financialPerson } from './wire-fields';

const currencyBalances = z.looseObject({
  currency: currencyCode,
  balances: z.array(z.looseObject({ user: financialPerson, balance: amount })),
  debts: z.array(
    z.looseObject({ from: financialPerson, to: financialPerson, amount: amount.positive() }),
  ),
});
const groupBalances = z.looseObject({ byCurrency: z.array(currencyBalances) });

export type GroupBalancesRead = z.infer<typeof groupBalances>;
export type GroupCurrencyBalancesRead = GroupBalancesRead['byCurrency'][number];

/** Keep malformed remote data out of both apps' views and out of error messages. */
export class GroupBalancesReadError extends Error {
  constructor() {
    super('Unable to load Balances. Please retry.');
    this.name = 'GroupBalancesReadError';
  }
}

const response = z.object({ status: z.literal(200), data: groupBalances });

export function parseGroupBalancesResponse(value: unknown): GroupBalancesRead {
  const result = response.safeParse(value);
  if (!result.success) throw new GroupBalancesReadError();
  return result.data.data;
}
