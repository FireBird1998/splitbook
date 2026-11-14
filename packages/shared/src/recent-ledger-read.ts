import { z } from 'zod';
import { amount, currencyCode, identity, timestamp } from './wire-fields';

const recentPerson = z.union([
  identity,
  z.strictObject({ _id: identity, name: z.string().optional(), image: z.string().nullish() }),
  z.null(),
]);
const allocation = z.strictObject({
  user: recentPerson,
  amount,
  amountMinor: z.number().int().optional(),
});
const recentExpense = z.strictObject({
  _id: identity,
  group: identity,
  description: z.string(),
  amount,
  amountMinor: z.number().int().optional(),
  moneyVersion: z.number().int().optional(),
  currency: currencyCode,
  date: timestamp,
  createdAt: timestamp,
  paidBy: z.array(allocation),
});
const recentLedger = z.strictObject({
  expenses: z.array(recentExpense).max(20),
  settlements: z
    .array(
      z.strictObject({
        _id: identity,
        group: identity,
        paidBy: recentPerson,
        paidTo: recentPerson,
        amount,
        amountMinor: z.number().int().optional(),
        moneyVersion: z.number().int().optional(),
        currency: currencyCode,
        paidCurrency: currencyCode.optional(),
        amountPaidMinor: z.number().int().optional(),
        createdAt: timestamp,
      }),
    )
    .max(20),
});
/** The bounded Recent wire fields, excluding notes, creator, allocations to recipients and history. */
export function parseRecentLedgerRead(value: unknown) {
  return recentLedger.parse(value);
}
