import { z } from 'zod/v4';
import { CURRENCY_CODES } from '../currency';
import { MAX_EXPENSE_AMOUNT, parseAmountMinor } from '../exact-money';

export const createSettlementSchema = z
  .object({
    /** Who paid. Defaults to the recording user when omitted. */
    paidBy: z.string().min(1).optional(),
    paidTo: z.string().min(1, 'Recipient is required'),
    amount: z.number().positive('Amount must be positive').max(MAX_EXPENSE_AMOUNT),
    currency: z.string().refine((val) => CURRENCY_CODES.includes(val), {
      message: 'Invalid currency code',
    }),
    note: z.string().max(500).trim().optional(),
  })
  .superRefine((data, context) => {
    if (!CURRENCY_CODES.includes(data.currency)) return;
    try {
      parseAmountMinor(data.amount, data.currency);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: error instanceof Error ? error.message : 'Invalid amount',
      });
    }
  });

export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;
