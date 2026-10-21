import { z } from 'zod/v4';
import { CURRENCY_CODES } from '../currency';
import { extraCurrenciesProblem } from '../group-currencies';
import { validateTripDates } from '../trip-setup';
import { calendarDate } from './calendar-date';

const optionalDate = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  calendarDate.nullable().optional(),
);

/**
 * The Group's currency rule on the extra currencies sent (#719). An update that leaves the main
 * currency out is checked against the stored one by the service.
 */
const extraCurrenciesRefine = (
  data: { defaultCurrency?: string; alternateCurrencies?: string[] },
  ctx: z.RefinementCtx,
) => {
  if (!data.alternateCurrencies) return;
  const problem = extraCurrenciesProblem(data.defaultCurrency ?? '', data.alternateCurrencies);
  if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['alternateCurrencies'] });
};

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
    alternateCurrencies: z.array(z.string()).default([]),
    startDate: optionalDate,
    endDate: optionalDate,
  })
  .superRefine(tripDatesRefine)
  .superRefine(extraCurrenciesRefine);

export const updateGroupSchema = z
  .object({
    name: z.string().min(1).max(100).trim().optional(),
    description: z.string().max(500).trim().optional(),
    category: z.enum(['trip', 'home', 'couple', 'work', 'other']).optional(),
    defaultCurrency: z
      .string()
      .refine((val) => CURRENCY_CODES.includes(val))
      .optional(),
    alternateCurrencies: z.array(z.string()).optional(),
    startDate: optionalDate,
    endDate: optionalDate,
  })
  .superRefine(tripDatesRefine)
  .superRefine(extraCurrenciesRefine);

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
