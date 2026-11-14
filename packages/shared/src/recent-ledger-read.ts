import { z } from 'zod';
import { expenseReadSchema } from './expense-page-read';
import { amount, currencyCode, financialPerson, identity, timestamp } from './wire-fields';

const recentLedger = z.object({
  expenses: z.array(expenseReadSchema).max(20),
  settlements: z
    .array(
      z.object({
        _id: identity,
        group: identity,
        paidBy: financialPerson,
        paidTo: financialPerson,
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
/** The optional Recent part of an Expense page; notes and activity/history never project. */
export function parseRecentLedgerRead(value: unknown) {
  return recentLedger.parse(value);
}
