/**
 * Keyboard shortcuts (#322): one table of every shortcut, which drives both what a key press
 * does and the hints that show it, so the two can't drift apart. Pure, so the rules are
 * unit-tested without a browser.
 *
 * - **Single-key shortcuts** (N, /, J, K, E) are one character with no modifier. A Settings
 *   switch turns them off (WCAG 2.1.4). They never fire while the member types in a field,
 *   while a dialog or menu is open, or with Ctrl, Alt or ⌘ held.
 * - **⌘K** (Ctrl+K off Apple devices) opens search (#321), whatever the switch says.
 * - **Enter** is the open row's own button: listed for the footer, never dispatched here.
 */

export interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** An input method is composing text, so the keys belong to it. */
  isComposing?: boolean;
  /** The key is held down. */
  repeat?: boolean;
}

export interface ShortcutTarget {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  /** The element's ARIA role, when it has one. */
  role?: string | null;
}

export type ShortcutId =
  | 'add-expense'
  | 'search-group'
  | 'search'
  | 'next-expense'
  | 'previous-expense'
  | 'open-expense'
  | 'edit-expense';

/** Where a shortcut works: anywhere on a page, or only while the Expense table has focus. */
export type ShortcutScope = 'page' | 'table';

/** The keys as hints show them, and for `aria-keyshortcuts`, on Apple devices and elsewhere. */
interface DeviceKeys {
  apple: readonly string[];
  other: readonly string[];
}

export interface Shortcut {
  id: ShortcutId;
  scope: ShortcutScope;
  /** What a hint says it does. Shortcuts with the same words share one hint (J and K: Move). */
  hint: string;
  keys: DeviceKeys;
  aria: { apple: string; other: string };
  /** One character with no modifier: off with the Settings switch (WCAG 2.1.4). */
  singleKey: boolean;
  /** Handled by the focused control itself (Enter on a row's button): listed, never dispatched. */
  native?: boolean;
  /** Keeps working while the key is held (moving through the table). */
  repeats?: boolean;
  matches: (event: ShortcutKeyEvent) => boolean;
}

const same = (key: string) => ({
  keys: { apple: [key], other: [key] },
  aria: { apple: key, other: key },
});

/** A letter, either case (Shift is allowed; the guard turns away Ctrl, Alt and ⌘). */
const letter = (key: string) => (event: ShortcutKeyEvent) => event.key.toLowerCase() === key;

/**
 * The search shortcut: K with ⌘ or Ctrl, not both. Either is taken on any device, since a
 * browser may not say truly which device it runs on (automated browsers often claim another).
 * In a text field other than search it is never taken (see `isTypingTarget`), so a Mac's
 * Ctrl+K, "delete to the end of the line", still works there.
 */
export function isSearchShortcut(event: ShortcutKeyEvent): boolean {
  if (event.isComposing || event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== 'k') return false;
  return event.metaKey !== event.ctrlKey;
}

/**
 * Every shortcut, in the order the Expenses tab's footer lists them. X ("select") from the
 * design canvas is left out: the table has no row selection, since bulk actions are deferred
 * (#300), so there is nothing for it to act on.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'next-expense',
    scope: 'table',
    hint: 'Move',
    ...same('J'),
    singleKey: true,
    repeats: true,
    matches: letter('j'),
  },
  {
    id: 'previous-expense',
    scope: 'table',
    hint: 'Move',
    ...same('K'),
    singleKey: true,
    repeats: true,
    matches: letter('k'),
  },
  {
    id: 'open-expense',
    scope: 'table',
    hint: 'Open',
    ...same('Enter'),
    singleKey: false,
    native: true,
    matches: (event) => event.key === 'Enter',
  },
  {
    id: 'edit-expense',
    scope: 'table',
    hint: 'Edit',
    ...same('E'),
    singleKey: true,
    matches: letter('e'),
  },
  {
    id: 'add-expense',
    scope: 'page',
    hint: 'New expense',
    ...same('N'),
    singleKey: true,
    matches: letter('n'),
  },
  {
    id: 'search-group',
    scope: 'page',
    hint: 'Search',
    ...same('/'),
    singleKey: true,
    matches: (event) => event.key === '/',
  },
  {
    id: 'search',
    scope: 'page',
    hint: 'Search everything',
    keys: { apple: ['⌘K'], other: ['Ctrl K'] },
    aria: { apple: 'Meta+K', other: 'Control+K' },
    singleKey: false,
    matches: isSearchShortcut,
  },
];

const BY_ID = new Map(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

export function shortcut(id: ShortcutId): Shortcut {
  return BY_ID.get(id)!;
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

/** Whether a key press on `target` is typing in a field: text inputs, text areas, selects, editable text. */
export function isTypingTarget(target: ShortcutTarget | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !NON_TEXT_INPUTS.has((target.type ?? 'text').toLowerCase());
}

/** Widgets that take letters themselves: a custom select (MUI's), a text box, a spin button. */
const TYPING_ROLES = new Set(['combobox', 'listbox', 'searchbox', 'spinbutton', 'textbox']);

/** Whether a single key pressed on `target` belongs to the field: a typing target or a widget like one. */
export function isFieldTarget(target: ShortcutTarget | null | undefined): boolean {
  return isTypingTarget(target) || TYPING_ROLES.has(target?.role?.toLowerCase() ?? '');
}

export interface ShortcutContext {
  /** Whether single-key shortcuts are on; null, not yet read from the device, counts as off. */
  singleKeys: boolean | null;
  /** The element the key was pressed on. */
  target: ShortcutTarget | null;
  /** The key was pressed in the search dialog's own field, where ⌘K closes the search. */
  inSearchField?: boolean;
  /** A dialog or a menu is open. */
  overlayOpen: boolean;
}

/** Whether `shortcut`, whose key this is, may act on the key press. */
function allowed(shortcut: Shortcut, event: ShortcutKeyEvent, context: ShortcutContext): boolean {
  if (event.isComposing) return false;
  // ⌘K as #321 built it: in the search field it closes the search; in any other field it types.
  if (!shortcut.singleKey) return Boolean(context.inSearchField) || !isTypingTarget(context.target);
  if (context.singleKeys !== true) return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  if (event.repeat && !shortcut.repeats) return false;
  if (isFieldTarget(context.target)) return false;
  return !context.overlayOpen;
}

/**
 * The shortcut a key press asks for in `scope`, or null when there is none or it may not act
 * now. The page's listener asks for `page`; the Expense table asks for `table` while it has
 * focus, and a table key it doesn't take still reaches the page's listener.
 */
export function shortcutFor(
  event: ShortcutKeyEvent,
  scope: ShortcutScope,
  context: ShortcutContext,
): Shortcut | null {
  const match = SHORTCUTS.find(
    (candidate) => candidate.scope === scope && !candidate.native && candidate.matches(event),
  );
  return match && allowed(match, event, context) ? match : null;
}

/** Whether a hint for `shortcut` shows: always for ⌘K, and for a single key only while they are on. */
export function hintShows(shortcut: Shortcut, singleKeys: boolean | null): boolean {
  return !shortcut.singleKey || singleKeys === true;
}

export interface ShortcutHintLine {
  keys: string[];
  hint: string;
}

/**
 * The Expenses tab's footer: every shortcut but ⌘K (the top bar shows its own), with those
 * that share words on one line ("J K Move"). Empty while single-key shortcuts are off, since
 * then the footer would list keys that do nothing.
 */
export function footerLines(singleKeys: boolean | null): ShortcutHintLine[] {
  if (singleKeys !== true) return [];
  const lines: ShortcutHintLine[] = [];
  for (const entry of SHORTCUTS) {
    if (entry.id === 'search') continue;
    const last = lines.at(-1);
    if (last && last.hint === entry.hint) last.keys.push(...entry.keys.other);
    else lines.push({ keys: [...entry.keys.other], hint: entry.hint });
  }
  return lines;
}

/** The keys as a hint shows them on this device. */
export const hintKeys = (shortcut: Shortcut, apple: boolean) =>
  apple ? shortcut.keys.apple : shortcut.keys.other;

/** The keys for `aria-keyshortcuts` on this device. */
export const ariaKeys = (shortcut: Shortcut, apple: boolean) =>
  apple ? shortcut.aria.apple : shortcut.aria.other;

/** Whether this browser runs on an Apple device, where the search shortcut uses ⌘. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const browser = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = browser.userAgentData?.platform || browser.platform || browser.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Where the next row is when J (+1) or K (−1) moves from row `index` of `count`: the first
 * row when none has focus yet, and no further than either end.
 */
export function stepRow(index: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (index < 0) return 0;
  return Math.min(count - 1, Math.max(0, index + step));
}
