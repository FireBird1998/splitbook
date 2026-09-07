import { formatCurrency } from './currency';

export type MoneyTone = 'positive' | 'negative' | 'neutral';

/** Signed amounts below this absolute value render as neutral/settled. */
export const MONEY_ZERO_EPSILON = 0.005;

/**
 * Tone for a signed balance: positive → owed to you (mint),
 * negative → you owe (coral), ~zero → neutral.
 */
export function getMoneyTone(amount: number, epsilon = MONEY_ZERO_EPSILON): MoneyTone {
  if (amount > epsilon) return 'positive';
  if (amount < -epsilon) return 'negative';
  return 'neutral';
}

/**
 * Format a signed amount with an explicit sign prefix:
 * +₹2,450.00 · −$18.00 · $0.00 (no sign at zero).
 */
export function formatSignedCurrency(amount: number, currency: string): string {
  const tone = getMoneyTone(amount);
  if (tone === 'neutral') return formatCurrency(0, currency);
  const formatted = formatCurrency(Math.abs(amount), currency);
  return tone === 'positive' ? `+${formatted}` : `−${formatted}`;
}
