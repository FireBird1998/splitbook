import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  footerLines,
  hintShows,
  isFieldTarget,
  shortcut,
  shortcutFor,
  stepRow,
  type ShortcutContext,
  type ShortcutKeyEvent,
  type ShortcutScope,
  type ShortcutTarget,
} from './shortcuts';
import {
  readSingleKeys,
  singleKeysStorageKey,
  writeSingleKeys,
  type SettingStorage,
} from './shortcut-setting';

/*
 * Keyboard shortcuts (#322): the one table that drives both the keys and their hints, the
 * guard that keeps single keys out of fields, dialogs and chords, the Settings switch that
 * turns single keys off while ⌘K keeps working, and how the switch is kept per member.
 */

const press = (key: string, extra: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});

const PAGE: ShortcutTarget = { tagName: 'BODY' };
const on = (extra: Partial<ShortcutContext> = {}): ShortcutContext => ({
  singleKeys: true,
  target: PAGE,
  overlayOpen: false,
  ...extra,
});

/** The shortcut a key press runs, by id, or null. */
const run = (
  event: ShortcutKeyEvent,
  scope: ShortcutScope = 'page',
  context: ShortcutContext = on(),
) => shortcutFor(event, scope, context)?.id ?? null;

describe('the shortcut table', () => {
  it('lists every shortcut once, with the keys its hints show', () => {
    expect(SHORTCUTS.map(({ id, keys, scope }) => [id, keys.other.join(' '), scope])).toEqual([
      ['next-expense', 'J', 'table'],
      ['previous-expense', 'K', 'table'],
      ['open-expense', 'Enter', 'table'],
      ['edit-expense', 'E', 'table'],
      ['add-expense', 'N', 'page'],
      ['search-group', '/', 'page'],
      ['search', 'Ctrl K', 'page'],
    ]);
    expect(shortcut('search').keys.apple).toEqual(['⌘K']);
    expect(shortcut('search').aria).toEqual({ apple: 'Meta+K', other: 'Control+K' });
  });

  it('has no X: the table has no row selection while bulk actions are deferred', () => {
    expect(SHORTCUTS.flatMap(({ keys }) => keys.other)).not.toContain('X');
    expect(run(press('x'), 'table')).toBeNull();
  });

  it('marks the single keys, which the switch turns off, and leaves Enter to the row’s button', () => {
    expect(SHORTCUTS.filter((entry) => entry.singleKey).map(({ id }) => id)).toEqual([
      'next-expense',
      'previous-expense',
      'edit-expense',
      'add-expense',
      'search-group',
    ]);
    expect(shortcut('open-expense').native).toBe(true);
    expect(run(press('Enter'), 'table')).toBeNull();
  });

  it('gives the footer each shortcut but ⌘K, J and K on one line, and nothing while off', () => {
    expect(footerLines(true)).toEqual([
      { keys: ['J', 'K'], hint: 'Move' },
      { keys: ['Enter'], hint: 'Open' },
      { keys: ['E'], hint: 'Edit' },
      { keys: ['N'], hint: 'New expense' },
      { keys: ['/'], hint: 'Search' },
    ]);
    expect(footerLines(false)).toEqual([]);
    expect(footerLines(null)).toEqual([]);
  });

  it('shows a single key’s hint only while single keys are on, and ⌘K’s always', () => {
    expect(hintShows(shortcut('add-expense'), true)).toBe(true);
    expect(hintShows(shortcut('add-expense'), false)).toBe(false);
    expect(hintShows(shortcut('add-expense'), null)).toBe(false);
    expect(hintShows(shortcut('search'), false)).toBe(true);
    expect(hintShows(shortcut('search'), null)).toBe(true);
  });
});

describe('the page’s shortcuts', () => {
  it('N adds an Expense and / searches the Group, in either case of the letter', () => {
    expect(run(press('n'))).toBe('add-expense');
    expect(run(press('N', { shiftKey: true }))).toBe('add-expense');
    expect(run(press('/'))).toBe('search-group');
    expect(run(press('?', { shiftKey: true }))).toBeNull();
  });

  it('⌘K or Ctrl+K opens search, never both at once or with Shift or Alt', () => {
    expect(run(press('k', { metaKey: true }))).toBe('search');
    expect(run(press('K', { ctrlKey: true }))).toBe('search');
    expect(run(press('k', { metaKey: true, ctrlKey: true }))).toBeNull();
    expect(run(press('k', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(run(press('k', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(run(press('k'))).toBeNull();
  });

  it('leaves the table’s keys to the table', () => {
    for (const key of ['j', 'k', 'e', 'Enter']) expect(run(press(key))).toBeNull();
    expect(run(press('n'), 'table')).toBeNull();
    expect(run(press('/'), 'table')).toBeNull();
  });
});

describe('the guard on single keys', () => {
  const fields: ShortcutTarget[] = [
    { tagName: 'INPUT', type: 'text' },
    { tagName: 'INPUT', type: 'search' },
    { tagName: 'INPUT', type: 'number' },
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
    // MUI's Select and other widgets that take letters themselves.
    { tagName: 'DIV', role: 'combobox' },
    { tagName: 'DIV', role: 'textbox' },
    { tagName: 'DIV', role: 'spinbutton' },
  ];

  it('never fires while the member types in a field', () => {
    for (const target of fields) {
      expect(isFieldTarget(target)).toBe(true);
      for (const [key, scope] of [
        ['n', 'page'],
        ['/', 'page'],
        ['j', 'table'],
        ['e', 'table'],
      ] as const)
        expect(run(press(key), scope, on({ target }))).toBeNull();
    }
  });

  it('fires from a button, a checkbox, a link or the page itself', () => {
    for (const target of [
      PAGE,
      { tagName: 'BUTTON' },
      { tagName: 'INPUT', type: 'checkbox' },
      { tagName: 'A' },
      null,
    ]) {
      expect(isFieldTarget(target)).toBe(false);
      expect(run(press('n'), 'page', on({ target }))).toBe('add-expense');
    }
    expect(run(press('j'), 'table', on({ target: { tagName: 'BUTTON' } }))).toBe('next-expense');
  });

  it('never fires while a dialog or menu is open', () => {
    expect(run(press('n'), 'page', on({ overlayOpen: true }))).toBeNull();
    expect(run(press('/'), 'page', on({ overlayOpen: true }))).toBeNull();
  });

  it('ignores Ctrl, Alt and ⌘, and keys an input method is composing', () => {
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      expect(run(press('n', { [modifier]: true }))).toBeNull();
      expect(run(press('/', { [modifier]: true }))).toBeNull();
      expect(run(press('e', { [modifier]: true }), 'table')).toBeNull();
    }
    expect(run(press('j', { metaKey: true }), 'table')).toBeNull();
    expect(run(press('n', { isComposing: true }))).toBeNull();
  });

  it('moves through the table while J or K is held, but adds or edits only once', () => {
    expect(run(press('j', { repeat: true }), 'table')).toBe('next-expense');
    expect(run(press('k', { repeat: true }), 'table')).toBe('previous-expense');
    expect(run(press('n', { repeat: true }))).toBeNull();
    expect(run(press('e', { repeat: true }), 'table')).toBeNull();
  });
});

describe('the Settings switch', () => {
  it('turns every single key off, and they stay off until the device’s setting is read', () => {
    for (const singleKeys of [false, null]) {
      const context = on({ singleKeys });
      expect(run(press('n'), 'page', context)).toBeNull();
      expect(run(press('/'), 'page', context)).toBeNull();
      expect(run(press('j'), 'table', context)).toBeNull();
      expect(run(press('k'), 'table', context)).toBeNull();
      expect(run(press('e'), 'table', context)).toBeNull();
    }
  });

  it('leaves ⌘K working, with #321’s rule for fields: it closes search from its own field', () => {
    const off = on({ singleKeys: false });
    expect(run(press('k', { metaKey: true }), 'page', off)).toBe('search');
    expect(run(press('k', { ctrlKey: true }), 'page', { ...off, overlayOpen: true })).toBe(
      'search',
    );
    const field: ShortcutTarget = { tagName: 'INPUT', type: 'text' };
    expect(run(press('k', { metaKey: true }), 'page', { ...off, target: field })).toBeNull();
    expect(
      run(press('k', { metaKey: true }), 'page', { ...off, target: field, inSearchField: true }),
    ).toBe('search');
  });
});

describe('moving through the table', () => {
  it('goes to the next or previous row, the first when none has focus, and stops at the ends', () => {
    expect(stepRow(0, 3, 1)).toBe(1);
    expect(stepRow(1, 3, -1)).toBe(0);
    expect(stepRow(2, 3, 1)).toBe(2);
    expect(stepRow(0, 3, -1)).toBe(0);
    expect(stepRow(-1, 3, 1)).toBe(0);
    expect(stepRow(-1, 3, -1)).toBe(0);
    expect(stepRow(-1, 0, 1)).toBe(-1);
  });
});

describe('the setting on this device', () => {
  /** A stand-in for localStorage. */
  function memory(
    entries: Record<string, string> = {},
  ): SettingStorage & { entries: typeof entries } {
    return {
      entries,
      getItem: (key) => entries[key] ?? null,
      setItem: (key, value) => {
        entries[key] = value;
      },
    };
  }
  const refusing: SettingStorage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  const ALEX = 'a00000000000000000000001';
  const SAM = 'a00000000000000000000002';

  it('is on until the member turns it off', () => {
    expect(readSingleKeys(memory(), ALEX)).toBe(true);
    expect(readSingleKeys(null, ALEX)).toBe(true);
  });

  it('is kept per member, so members sharing a browser each keep their own', () => {
    const storage = memory();
    expect(writeSingleKeys(storage, ALEX, false)).toBe(true);
    expect(storage.entries).toEqual({ [singleKeysStorageKey(ALEX)]: 'off' });
    expect(readSingleKeys(storage, ALEX)).toBe(false);
    expect(readSingleKeys(storage, SAM)).toBe(true);
    writeSingleKeys(storage, ALEX, true);
    expect(readSingleKeys(storage, ALEX)).toBe(true);
    expect(singleKeysStorageKey(ALEX)).not.toBe(singleKeysStorageKey(SAM));
  });

  it('counts as on when storage can’t be read, and says when it couldn’t keep a choice', () => {
    expect(readSingleKeys(refusing, ALEX)).toBe(true);
    expect(writeSingleKeys(refusing, ALEX, false)).toBe(false);
    expect(writeSingleKeys(null, ALEX, false)).toBe(false);
  });
});
