import { z } from 'zod';
import { readExpenseMoney } from '@splitbook/shared/expense-money-edit';
import { objectId } from './dto';

const person = z.union([
  objectId,
  z.object({ _id: objectId, name: z.string().optional() }),
  z.null(),
]);
const allocation = z
  .object({
    user: person,
    name: z.string().optional(),
    amount: z.number().finite(),
    amountMinor: z.number().int().optional(),
    percentage: z.number().optional(),
    shares: z.number().optional(),
  })
  .transform(({ user, name, ...row }) => ({
    ...row,
    user: typeof user === 'object' && user ? user._id : user,
    name:
      typeof user === 'object' && user ? (user.name ?? 'Former member') : (name ?? 'Former member'),
  }));
const timestamp = z.iso.datetime({ offset: true });
export const expenseRecordSchema = z.object({
  _id: objectId,
  group: objectId,
  revision: z.number().int().nonnegative(),
  description: z.string(),
  amount: z.number().finite(),
  currency: z.string(),
  amountMinor: z.number().int().optional(),
  moneyVersion: z.number().int().optional(),
  paidBy: z.array(allocation),
  splitBetween: z.array(allocation),
  splitMethod: z.enum(['equal', 'unequal', 'percentage', 'shares', 'exact']),
  date: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  category: z.string(),
  tag: z.string().default(''),
  tagId: objectId.nullish(),
  notes: z.string().default(''),
  isDeleted: z.boolean(),
  createdBy: person.optional().default(null),
  deletedAt: timestamp.nullish(),
  predefinedItem: z.string().nullish(),
  receiptUrl: z.string().nullish(),
  recurringExpense: objectId.nullish(),
  period: z.string().nullish(),
  editHistory: z
    .array(
      z.object({
        editedBy: person,
        editedAt: timestamp,
        changes: z.record(
          z.string(),
          z.object({ old: z.unknown().optional(), new: z.unknown().optional() }),
        ),
      }),
    )
    .default([]),
});
export type ExpenseRecord = z.infer<typeof expenseRecordSchema>;
export function storedExpenseMoney(record: ExpenseRecord) {
  return {
    ...record,
    paidBy: record.paidBy.map((row, index) => ({
      ...row,
      user: row.user ?? `former-payer-${index}`,
    })),
    splitBetween: record.splitBetween.map((row, index) => ({
      ...row,
      user: row.user ?? `former-participant-${index}`,
    })),
  };
}
export function parseExpenseRecord(value: unknown, groupId: string, expenseId: string) {
  const record = z.object({ status: z.literal(200), data: expenseRecordSchema }).parse(value).data;
  if (record.group !== groupId || record._id !== expenseId)
    throw new Error('Unexpected Expense identity');
  readExpenseMoney(storedExpenseMoney(record));
  return record;
}
