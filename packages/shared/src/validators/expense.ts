import { z } from 'zod/v4';
import { CURRENCY_CODES } from '../currency';
import { CATEGORY_IDS } from '../categories';
import { normalizeExpenseMoney } from '../exact-money';
import { calendarDate } from './calendar-date';

const expenseFields = z.object({
  description: z.string().trim().min(1, 'Description is required').max(200),
  amount: z.number().positive('Amount must be positive').max(10_000_000),
  currency: z.string().refine((val) => CURRENCY_CODES.includes(val), {
    message: 'Invalid currency code',
  }),
  category: z
    .string()
    .refine((val) => CATEGORY_IDS.includes(val), { message: 'Invalid category' })
    .default('other'),
  date: calendarDate,
  paidBy: z
    .array(
      z.object({
        user: z.string().min(1),
        amount: z.number().nonnegative(),
      }),
    )
    .min(1, 'At least one payer is required'),
  splitMethod: z.enum(['equal', 'unequal', 'percentage', 'shares', 'exact']),
  splitBetween: z
    .array(
      z.object({
        user: z.string().min(1),
        amount: z.number().nonnegative().optional(),
        percentage: z.number().min(0).max(100).optional(),
        shares: z.number().int().min(0).optional(),
      }),
    )
    .min(1, 'At least one person must be in the split'),
  tag: z.string().trim().min(1, 'Tag is required').optional(),
  tagId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/, 'Invalid Tag identity')
    .optional(),
  predefinedItem: z.string().nullable().optional(),
  notes: z.string().max(500).trim().optional(),
});

export const createExpenseSchema = expenseFields
  .refine((data) => Boolean(data.tagId || data.tag), {
    message: 'Tag is required',
    path: ['tagId'],
  })
  .superRefine((data, context) => {
    try {
      normalizeExpenseMoney(data);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid Expense allocation',
        path: ['amount'],
      });
    }
  });

export const updateExpenseSchema = expenseFields.partial().extend({
  category: expenseFields.shape.category.removeDefault().optional(),
  isDeleted: z.literal(false).optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
