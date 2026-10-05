/** One Expense's read contract (#210), returned in wire shape. */
import { z } from 'zod';
import {
  amount,
  changes,
  currencyCode,
  identity,
  person,
  splitMethod,
  timestamp,
} from './wire-fields';

const allocation = z.looseObject({
  user: person,
  name: z.string().optional(),
  amount,
  amountMinor: z.number().int().optional(),
  percentage: z.number().optional(),
  shares: z.number().optional(),
});
const expenseRecord = z.looseObject({
  _id: identity,
  group: identity,
  revision: z.number().int().nonnegative(),
  description: z.string(),
  amount,
  currency: currencyCode,
  amountMinor: z.number().int().optional(),
  moneyVersion: z.number().int().optional(),
  paidBy: z.array(allocation),
  splitBetween: z.array(allocation),
  splitMethod,
  date: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  category: z.string(),
  tag: z.string().optional(),
  tagId: identity.nullish(),
  notes: z.string().optional(),
  isDeleted: z.boolean(),
  createdBy: person.optional(),
  deletedAt: timestamp.nullish(),
  predefinedItem: z.string().nullish(),
  receiptUrl: z.string().nullish(),
  recurringExpense: identity.nullish(),
  period: z.string().nullish(),
  editHistory: z
    .array(z.looseObject({ editedBy: person, editedAt: timestamp, changes }))
    .optional(),
});

export type ExpenseRecordRead = z.infer<typeof expenseRecord>;

/** Keep malformed remote data out of both apps' views and out of error messages. */
export class ExpenseRecordReadError extends Error {
  constructor() {
    super('Unable to load this Expense. Please retry.');
    this.name = 'ExpenseRecordReadError';
  }
}

const response = z.object({ status: z.literal(200), data: expenseRecord });

export function parseExpenseRecordResponse(value: unknown): ExpenseRecordRead {
  const result = response.safeParse(value);
  if (!result.success) throw new ExpenseRecordReadError();
  return result.data.data;
}
