import { z } from 'zod/v4';
import { CURRENCY_CODES } from '../currency';

export const createSettlementSchema = z.object({
  /** Who paid. Defaults to the recording user when omitted. */
  paidBy: z.string().min(1).optional(),
  paidTo: z.string().min(1, 'Recipient is required'),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().refine((val) => CURRENCY_CODES.includes(val), {
    message: 'Invalid currency code',
  }),
  note: z.string().max(500).trim().optional(),
});

export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;
