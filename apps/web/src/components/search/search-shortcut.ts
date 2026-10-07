/**
 * The search shortcut (#321): ⌘K on Apple devices, Ctrl+K everywhere else, and the top bar
 * shows the one for the device. Pure, so the rules are unit-tested without a browser.
 */

export interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** An input method is composing text, so the keys belong to it. */
  isComposing?: boolean;
}

/**
 * Whether the key press is the search shortcut: K with ⌘ or Ctrl, not both. Either is taken on
 * any device, since a browser may not say truly which device it runs on (automated browsers
 * often claim another). In a text field other than search it is never taken (see
 * `isTypingTarget`), so a Mac's Ctrl+K, "delete to the end of the line", still works there.
 */
export function isSearchShortcut(event: ShortcutKeyEvent): boolean {
  if (event.isComposing || event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== 'k') return false;
  return event.metaKey !== event.ctrlKey;
}

/** Inputs that take no typing: a key press on one is never typing in a field. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

export interface ShortcutTarget {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

/** Whether a key press on `target` is typing in a field: text inputs, text areas, selects, editable text. */
export function isTypingTarget(target: ShortcutTarget | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !NON_TEXT_INPUTS.has((target.type ?? 'text').toLowerCase());
}

/** The shortcut as the top bar shows it. */
export const searchShortcutLabel = (apple: boolean) => (apple ? '⌘K' : 'Ctrl K');

/** The shortcut for `aria-keyshortcuts`. */
export const searchShortcutKeys = (apple: boolean) => (apple ? 'Meta+K' : 'Control+K');

/** Whether this browser runs on an Apple device, where the shortcut uses ⌘. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const browser = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = browser.userAgentData?.platform || browser.platform || browser.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}
