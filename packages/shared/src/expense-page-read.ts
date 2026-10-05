/**
 * The Expense page read contract (#210), returned in wire shape. Fields it doesn't declare,
 * such as the summary's `totalAmount` the web shows, pass through unchecked.
 */
import { z } from 'zod';
import {
  amount,
  currencyCode,
  financialPerson,
  identity,
  pagination,
  splitMethod,
  timestamp,
} from './wire-fields';

const allocation = z.looseObject({
  user: financialPerson,
  amount,
  amountMinor: z.number().int().optional(),
});
const expense = z.looseObject({
  _id: identity,
  group: identity,
  description: z.string(),
  currency: currencyCode,
  amount,
  amountMinor: z.number().int().optional(),
  moneyVersion: z.number().int().optional(),
  date: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  category: z.string(),
  tag: z.string().optional(),
  tagId: identity.nullish(),
  paidBy: z.array(allocation),
  splitBetween: z.array(allocation),
  splitMethod,
});
const summary = z.looseObject({
  count: z.number().int().nonnegative(),
  totalsByCurrency: z.array(
    z.looseObject({ currency: currencyCode, totalAmount: amount.nonnegative() }),
  ),
  userOwes: amount.nonnegative(),
  userGetsBack: amount.nonnegative(),
  byMember: z
    .array(
      z.looseObject({
        user: financialPerson,
        paid: amount.nonnegative(),
        share: amount.nonnegative(),
        net: amount,
      }),
    )
    .optional(),
});
const expensePage = z.looseObject({ expenses: z.array(expense), pagination, summary });

export type ExpensePageRead = z.infer<typeof expensePage>;
export type ExpenseRead = ExpensePageRead['expenses'][number];
export type ExpenseAllocationRead = ExpenseRead['paidBy'][number];

/** Keep malformed remote data out of both apps' views and out of error messages. */
export class ExpensePageReadError extends Error {
  constructor() {
    super('Unable to load Expenses. Please retry.');
    this.name = 'ExpensePageReadError';
  }
}

const response = z.object({ status: z.literal(200), data: expensePage });

export function parseExpensePageResponse(value: unknown): ExpensePageRead {
  const result = response.safeParse(value);
  if (!result.success) throw new ExpensePageReadError();
  return result.data.data;
}
