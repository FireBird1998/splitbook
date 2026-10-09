/**
 * The search shortcut (#321): ⌘K on Apple devices, Ctrl+K everywhere else, and the top bar
 * shows the one for the device. Its rules live in the one table of shortcuts (#322).
 */

import {
  ariaKeys,
  hintKeys,
  isApplePlatform,
  isSearchShortcut,
  isTypingTarget,
  shortcut,
  type ShortcutKeyEvent,
  type ShortcutTarget,
} from '@/lib/shortcuts/shortcuts';

export { isApplePlatform, isSearchShortcut, isTypingTarget };
export type { ShortcutKeyEvent, ShortcutTarget };

/** The shortcut as the top bar shows it. */
export const searchShortcutLabel = (apple: boolean) =>
  hintKeys(shortcut('search'), apple).join(' ');

/** The shortcut for `aria-keyshortcuts`. */
export const searchShortcutKeys = (apple: boolean) => ariaKeys(shortcut('search'), apple);
