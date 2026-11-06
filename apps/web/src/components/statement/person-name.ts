/**
 * How many characters make a line of a statement's Paid by or Share, a person's name and the
 * amount written beside it, long enough to wrap (#928).
 *
 * An everyday line, "Alex Rivera ₹54,000.00", stays on one line, as the statement has always set
 * it (#646): a table squeezes a column that may wrap down to its longest word, so a long
 * Description beside it would otherwise break "Alex / Rivera". A longer line may wrap: the name
 * between its words and after a hyphen, never inside a word, and its amount under it. The
 * amount counts as well as the name: at A4 width "Venkataraghavans ₹51,333.50" in three payers'
 * lines already pushed Share past the page, where a 21-character name alone was the rule.
 */
export const LONG_LINE_LENGTH = 25;

/** Whether a Paid by or Share line, a name and its written amount if any, may wrap (#928). */
export function lineMayWrap(name: string, amount = ''): boolean {
  return name.length + amount.length >= LONG_LINE_LENGTH;
}
