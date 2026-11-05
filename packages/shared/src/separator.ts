/**
 * A no-break space (U+00A0). A line never breaks at it, so words it joins stay on one line:
 * "per €", "(4 Nov)" (#892) and "5 Nov 17:44" (#895). The app's font, Outfit, draws it; it has no
 * U+202F or U+2009.
 */
export const NO_BREAK_SPACE = ' ';

/**
 * The " · " between the parts of a line, with a no-break space before the dot, so a line that
 * wraps there ends with the dot and the next starts with the next part, never with "·" (#892).
 * Every UI text that joins its parts with " · " uses it; `separator.test.ts` finds a plain one.
 */
export const SEPARATOR = `${NO_BREAK_SPACE}· `;

/**
 * " · " with a no-break space on both sides, for a short pair that reads as one, such as
 * "Equally · 2": a line never breaks inside it (#895).
 */
export const NO_BREAK_SEPARATOR = `${NO_BREAK_SPACE}·${NO_BREAK_SPACE}`;

/**
 * A count and its noun, "2 members" or "1 currency", joined with a no-break space so a line
 * never breaks between them (#898). `many` defaults to the noun with an "s".
 */
export const counted = (count: number, one: string, many = `${one}s`) =>
  `${count}${NO_BREAK_SPACE}${count === 1 ? one : many}`;

/**
 * A word joiner (U+2060): no width, and no line break on either side. It keeps a sign with its
 * figure: "−€20.00" never breaks after the "−" (#899), though a line may break between two
 * prefixes such as "−" and "€". Neither Outfit nor IBM Plex Mono maps it, and nothing draws
 * it: browsers and Android leave out a character that is ignorable by default.
 */
export const WORD_JOINER = '\u2060';
