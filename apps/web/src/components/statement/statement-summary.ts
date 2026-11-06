import type { Statement } from '@splitbook/shared/statement';
import { counted } from '@splitbook/shared/separator';

/** One figure in a currency's summary row: an amount in exact minor units, or a count. */
export type SummaryFigure =
  | { label: 'Spent'; amountMinor: number }
  | { label: 'Expenses'; count: number }
  | { label: 'Payments'; amountMinor: number; note: string };

/**
 * A currency's summary on the printed statement (#646, W2), as a row of figures: Spent, the
 * Expense count, and the payments' total with how many there are. Every figure comes from the
 * statement as built; nothing is added up here.
 */
export function statementSummary(bucket: Statement['currencies'][number]): SummaryFigure[] {
  const payments = bucket.payments.length;
  return [
    { label: 'Spent', amountMinor: bucket.spentMinor },
    { label: 'Expenses', count: bucket.expenseCount },
    {
      label: 'Payments',
      amountMinor: bucket.paymentTotalMinor,
      note: payments === 0 ? 'No payments' : counted(payments, 'payment'),
    },
  ];
}
