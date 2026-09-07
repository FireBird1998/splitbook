import { z } from 'zod/v4';
import { CURRENCY_CODES } from '../currency';
import { CATEGORY_IDS } from '../categories';

export const createRecurringExpenseSchema = z.object({
  description: z.string().min(1, 'Description is required').max(200).trim(),
  amount: z.number().positive('Amount must be positive').max(10_000_000),
  currency: z.string().refine((val) => CURRENCY_CODES.includes(val), {
    message: 'Invalid currency code',
  }),
  category: z
    .string()
    .refine((val) => CATEGORY_IDS.includes(val), { message: 'Invalid category' })
    .default('other'),
  tag: z.string().min(1, 'Tag is required').trim(),
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
  /** 1–31; clamped to the last day of short months at generation time. */
  dayOfMonth: z.number().int().min(1).max(31),
  startsOn: z.coerce.date(),
  endsOn: z.coerce.date().nullable().optional(),
});

export const updateRecurringExpenseSchema = createRecurringExpenseSchema.partial().extend({
  isPaused: z.boolean().optional(),
});

export type CreateRecurringExpenseInput = z.infer<typeof createRecurringExpenseSchema>;
export type UpdateRecurringExpenseInput = z.infer<typeof updateRecurringExpenseSchema>;
