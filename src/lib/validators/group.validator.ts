import { z } from 'zod/v4';
import { CURRENCY_CODES } from '@/lib/utils/currency';

export const createGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').trim(),
  description: z.string().max(500).trim().optional(),
  category: z.enum(['trip', 'home', 'couple', 'work', 'other']).default('other'),
  defaultCurrency: z.string().refine((val) => CURRENCY_CODES.includes(val), {
    message: 'Invalid currency code',
  }),
  alternateCurrencies: z
    .array(z.string().refine((val) => CURRENCY_CODES.includes(val)))
    .max(2, 'Maximum 2 alternate currencies')
    .default([]),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).trim().optional(),
  category: z.enum(['trip', 'home', 'couple', 'work', 'other']).optional(),
  defaultCurrency: z
    .string()
    .refine((val) => CURRENCY_CODES.includes(val))
    .optional(),
  alternateCurrencies: z
    .array(z.string().refine((val) => CURRENCY_CODES.includes(val)))
    .max(2)
    .optional(),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
