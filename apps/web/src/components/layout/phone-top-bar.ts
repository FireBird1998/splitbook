/**
 * How the top bar fits a phone (#321, #304). Below the desktop breakpoint the bar holds the
 * menu button, the logo, search (an icon below 900 px), the demo badge in demo mode, the theme
 * switch and Add expense, and it stays on one line from 320 px up, in demo mode or not:
 * - below 430 px the theme switch leaves the bar for the drawer, at its foot by Settings. At
 *   400–429 px the demo badge would otherwise push Add expense onto a second line;
 * - below 375 px the bar's gaps tighten;
 * - below 360 px the logo gives way to the brand mark, as the brand standard has it for tight
 *   navigation.
 * From 430 px up the bar keeps its theme switch and the drawer shows none.
 */
export const THEME_IN_DRAWER = '@media (max-width: 429.95px)';
export const THEME_IN_BAR = '@media (min-width: 430px)';
export const TIGHT_BAR = '@media (max-width: 374.95px)';
export const MARK_ONLY = '@media (max-width: 359.95px)';

/** The theme switch's name, which says the mode it moves to, in the bar and in the drawer. */
export const themeSwitchLabel = (mode: 'light' | 'dark') =>
  mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
