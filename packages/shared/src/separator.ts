/**
 * A no-break space (U+00A0). A line never breaks at it, so words it joins stay on one line:
 * "per €" and "(4 Nov)" (#892). The app's font, Outfit, draws it; it has no U+202F or U+2009.
 */
export const NO_BREAK_SPACE = ' ';

/**
 * The " · " between the parts of a line, with a no-break space before the dot, so a line that
 * wraps there ends with the dot and the next starts with the next part, never with "·" (#892).
 */
export const SEPARATOR = `${NO_BREAK_SPACE}· `;
