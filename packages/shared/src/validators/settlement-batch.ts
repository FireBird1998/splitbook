import { z } from 'zod/v4';
import { CURRENCY_CODES } from '../currency';
import { createSettlementSchema } from './settlement';

/** The people and paying currency belong to the payment, not to independently editable rows. */
export const createSettlementBatchSchema = z
  .object({
    paidBy: z.string().min(1).optional(),
    paidTo: z.string().min(1),
    paidCurrency: z.enum(CURRENCY_CODES as [string, ...string[]]),
    settlements: z
      .array(
        z
          .object(createSettlementSchema.shape)
          .omit({ paidBy: true, paidTo: true, paidCurrency: true }),
      )
      .min(1)
      .max(32),
  })
  .superRefine((data, context) => {
    const currencies = new Set<string>();
    data.settlements.forEach((row, index) => {
      if (currencies.has(row.currency))
        context.addIssue({
          code: 'custom',
          path: ['settlements', index, 'currency'],
          message: 'Choose each cleared currency once',
        });
      currencies.add(row.currency);
      const parsed = createSettlementSchema.safeParse({
        ...row,
        paidBy: data.paidBy,
        paidTo: data.paidTo,
        ...(row.currency !== data.paidCurrency ? { paidCurrency: data.paidCurrency } : {}),
      });
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          context.addIssue({ ...issue, path: ['settlements', index, ...issue.path] });
    });
  });
export type CreateSettlementBatchInput = z.infer<typeof createSettlementBatchSchema>;
