import { z } from 'zod/v4';
import { CURRENCY_CODES } from '../currency';

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long').optional(),
  preferredCurrency: z
    .string()
    .refine((value) => CURRENCY_CODES.includes(value), 'Choose a supported currency')
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
