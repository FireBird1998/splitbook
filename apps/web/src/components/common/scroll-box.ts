/**
 * A box that scrolls sideways, for MUI's `sx`: spread it into the box's styles. Use it for
 * every box that scrolls sideways, so the guard below is there by default.
 *
 * It is positioned, so the visually hidden text in its cells (`position: absolute`, see
 * `visually-hidden.ts`) is clipped here with its cell. Unpositioned, that text keeps its place
 * past the box's right edge in a table wider than the screen and widens the whole page: at
 * 390 px, an empty Note's hidden "No note" made Maple House's Balances scroll 478 px sideways
 * (#944, #946).
 */
export const scrollBox = {
  position: 'relative',
  overflowX: 'auto',
} as const;
