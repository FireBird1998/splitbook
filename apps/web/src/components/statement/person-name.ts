/**
 * How many characters make a name long enough to wrap in a statement's Paid by and Share (#928).
 *
 * An everyday name, "Alex Rivera", stays on one line beside its amount, as the statement has
 * always set it (#646): a table squeezes a column that may wrap down to its longest word, so a
 * long Description beside it would otherwise break "Alex / Rivera". A long one, "Priyamvada
 * Venkataraghavan-Subramaniam", wraps between its words and after a hyphen, never inside a word,
 * so it can't push Share out of the Export preview's card or past the A4 page.
 */
export const LONG_NAME_LENGTH = 21;

/** Whether a person's name may wrap in Paid by and Share: only a long one (#928). */
export function nameMayWrap(name: string): boolean {
  return name.length >= LONG_NAME_LENGTH;
}
