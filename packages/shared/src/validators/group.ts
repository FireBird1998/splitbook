import { z } from 'zod/v4';
import { CURRENCY_CODES } from '../currency';
import { validateTripDates } from '../trip-setup';
import { calendarDate } from './calendar-date';

const optionalDate = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  calendarDate.nullable().optional(),
);

const tripDatesRefine = <T extends { startDate?: unknown; endDate?: unknown }>(
  data: T,
  ctx: z.RefinementCtx,
) => {
  const error = validateTripDates(
    data.startDate as string | Date | null | undefined,
    data.endDate as string | Date | null | undefined,
  );
  if (error) {
    ctx.addIssue({
      code: 'custom',
      message: error,
      path: ['endDate'],
    });
  }
};

export const createGroupSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long').trim(),
    description: z.string().max(500).trim().optional(),
    category: z.enum(['trip', 'home', 'couple', 'work', 'other']).default('trip'),
    defaultCurrency: z.string().refine((val) => CURRENCY_CODES.includes(val), {
      message: 'Invalid currency code',
    }),
    alternateCurrencies: z
      .array(z.string().refine((val) => CURRENCY_CODES.includes(val)))
      .max(2, 'Maximum 2 alternate currencies')
      .default([]),
    startDate: optionalDate,
    endDate: optionalDate,
  })
  .superRefine(tripDatesRefine);

export const updateGroupSchema = z
  .object({
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
    startDate: optionalDate,
    endDate: optionalDate,
  })
  .superRefine(tripDatesRefine);

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
