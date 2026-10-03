import { payerEntryProblem } from '@splitbook/shared/payer-remainder';
import { amountError } from './field-feedback';

/**
 * Why one person's entry in Who paid can't count yet, in words for the row beside it. The
 * arithmetic and the problem itself come from the shared payer rules. Blank entries and 0 are
 * simply empty: that person isn't a payer.
 */
export function payerEntryError(amount: string, currency: string): string | undefined {
  const problem = payerEntryProblem(amount, currency);
  if (!problem) return undefined;
  // 0 is allowed, as blank, so this isn't the Amount field's "greater than 0".
  if (problem === 'negative') return 'Enter an amount of 0 or more.';
  // Unreadable text, the wrong precision and amounts over the limit read as on the Amount field.
  return amountError(amount, currency);
}
