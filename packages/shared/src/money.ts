import { formatCurrency } from './currency';
import { WORD_JOINER } from './separator';

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
 * A figure with its sign, "−€20.00" or "+₹620.00", joined so a line never breaks between them
 * (#899): a line may otherwise break between the "−" and a currency's symbol.
 */
export const withSign = (sign: '+' | '−' | '', figure: string) =>
  sign ? `${sign}${WORD_JOINER}${figure}` : figure;

/**
 * Format a signed amount with an explicit sign prefix:
 * +₹2,450.00 · −$18.00 · $0.00 (no sign at zero).
 */
export function formatSignedCurrency(amount: number, currency: string): string {
  const tone = getMoneyTone(amount);
  if (tone === 'neutral') return formatCurrency(0, currency);
  return withSign(tone === 'positive' ? '+' : '−', formatCurrency(Math.abs(amount), currency));
}
