import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { anchors, text } from '@/lib/test-utils/markup';
import type { ShortcutsValue } from '@/lib/shortcuts/ShortcutsProvider';

/*
 * Keyboard shortcut hints (#322) as the server renders them: the keys beside Add expense and
 * the Group's search, the Expenses tab's footer and the Settings switch, with single-key
 * shortcuts on, off, and not yet read on this device. A hint is hidden from screen readers,
 * which hear the key from the control's `aria-keyshortcuts` instead.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/groups/c00000000000000000000001/expenses',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
/** Every read is still loading: the hints don't depend on any. */
vi.mock('swr', async (original) => ({
  ...(await original<typeof import('swr')>()),
  default: () => ({ isLoading: true, isValidating: false, mutate: vi.fn() }),
}));

const { ShortcutsContext, ShortcutsProvider } = await import('@/lib/shortcuts/ShortcutsProvider');
const { ShortcutsFooter } = await import('./ShortcutHint');
const { default: ShortcutsSetting } = await import('./ShortcutsSetting');
const { default: AddExpenseLauncher } = await import('@/components/expenses/AddExpenseLauncher');
const { default: ExpenseToolbar } = await import('@/components/expenses/ExpenseToolbar');
const { default: ExpenseTable } = await import('@/components/expenses/ExpenseTable');
const { DEFAULT_EXPENSE_LIST_QUERY } = await import('@/components/expenses/expense-list-query');

const ALEX = 'a00000000000000000000001';

type Setting = boolean | null;

function render(element: ReactElement, singleKeys: Setting) {
  const value: ShortcutsValue = {
    singleKeys,
    setSingleKeys: vi.fn(),
    register: () => () => {},
    handOn: vi.fn(),
  };
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(ShortcutsContext.Provider, { value }, element),
    ),
  );
}

/** Each <kbd>: its text, and whether it is hidden from screen readers. */
const kbds = (html: string) =>
  [...html.matchAll(/<kbd\b([^>]*)>([\s\S]*?)<\/kbd>/g)].map(([, attributes, inner]) => ({
    text: text(inner),
    hidden: /\saria-hidden="true"/.test(attributes),
  }));

/** The markup's text that screen readers hear: aria-hidden elements removed (no nesting). */
const heard = (html: string) =>
  text(html.replace(/<(\w+)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, ' '));

const addExpense = (singleKeys: Setting) =>
  render(createElement(AddExpenseLauncher, { userId: ALEX }), singleKeys);

const toolbar = (singleKeys: Setting) =>
  render(
    createElement(ExpenseToolbar, {
      query: DEFAULT_EXPENSE_LIST_QUERY,
      onChange: vi.fn(),
      groupName: 'Maple House',
      currency: 'INR',
      members: [{ id: ALEX, label: 'You' }],
      tags: [],
      dateWindows: true,
    }),
    singleKeys,
  );

describe('the hint beside Add expense', () => {
  it('shows N while single-key shortcuts are on, and the button says so to screen readers', () => {
    const html = addExpense(true);
    const button = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/)![0];
    expect(button).toMatch(/<button\b[^>]*aria-keyshortcuts="N"/);
    expect(kbds(button)).toEqual([{ text: 'N', hidden: true }]);
    // The button's name stays "Add expense".
    expect(heard(button)).toBe('Add expense');
  });

  it('is gone while they are off, and before this device’s setting is read', () => {
    for (const singleKeys of [false, null]) {
      const html = addExpense(singleKeys);
      expect(kbds(html)).toEqual([]);
      expect(html).not.toContain('aria-keyshortcuts');
      expect(text(html)).toBe('Add expense');
    }
  });
});

describe('the hint in the Group’s search', () => {
  it('shows /, and the field says so to screen readers', () => {
    const html = toolbar(true);
    expect(html).toMatch(
      /<input\b(?=[^>]*aria-label="Search Expenses in Maple House")(?=[^>]*aria-keyshortcuts="\/")[^>]*>/,
    );
    expect(kbds(html)).toEqual([{ text: '/', hidden: true }]);
  });

  it('is gone while single-key shortcuts are off', () => {
    for (const singleKeys of [false, null]) {
      const html = toolbar(singleKeys);
      expect(kbds(html)).toEqual([]);
      expect(html).not.toContain('aria-keyshortcuts');
    }
  });
});

describe('the Expenses tab’s footer', () => {
  it('lists each shortcut with what it does, says they pause in fields, and links to Settings', () => {
    const html = render(createElement(ShortcutsFooter), true).replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/g,
      '',
    );
    expect(html).toMatch(/^<footer\b/);
    expect(html).toMatch(/<h2\b[^>]*>Keyboard shortcuts<\/h2>/);
    const terms = [...html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/g)];
    expect(terms.map(([, keys, hint]) => [text(keys), text(hint)])).toEqual([
      ['J K', 'Move'],
      ['Enter', 'Open'],
      ['E', 'Edit'],
      ['N', 'New expense'],
      ['/', 'Search'],
    ]);
    // Real text for screen readers, so its keys aren't hidden.
    expect(kbds(html).every(({ hidden }) => !hidden)).toBe(true);
    // (The markup's text puts a space where the link ends.)
    expect(text(html)).toMatch(
      /Shortcuts pause while you type in a field\. You can turn them off in Settings ?\.$/,
    );
    expect(anchors(html)).toEqual([{ href: '/settings', current: null, text: 'Settings' }]);
    // No X: there is no row selection for it to act on.
    expect(text(html)).not.toMatch(/\bX\b|Select/);
  });

  it('is gone while single-key shortcuts are off, and before this device’s setting is read', () => {
    expect(render(createElement(ShortcutsFooter), false)).toBe('');
    expect(render(createElement(ShortcutsFooter), null)).toBe('');
  });
});

describe('the Settings switch', () => {
  const settings = (singleKeys: Setting) => render(createElement(ShortcutsSetting), singleKeys);
  const switchInput = (html: string) => html.match(/<input\b[^>]*role="switch"[^>]*>/)?.[0] ?? '';

  it('is a named switch, on by default, described by what it turns off and what stays', () => {
    const html = settings(true);
    const input = switchInput(html);
    expect(input).toMatch(/type="checkbox"/);
    expect(input).toMatch(/\schecked=""/);
    expect(input).not.toMatch(/\sdisabled=""/);
    expect(text(html)).toContain('Keyboard shortcuts Single-key shortcuts');
    const describedBy = /aria-describedby="([^"]+)"/.exec(input)![1];
    const description = new RegExp(`id="${describedBy}"[^>]*>([^<]*)<`).exec(html)![1];
    expect(description).toContain('N adds an Expense, / searches the Group');
    expect(description).toContain('⌘K (Ctrl+K) search keeps working');
    expect(description).toContain('on this device');
  });

  it('shows off, and waits for this device’s setting before it can be changed', () => {
    expect(switchInput(settings(false))).not.toMatch(/\schecked=""/);
    const unread = switchInput(settings(null));
    expect(unread).toMatch(/\sdisabled=""/);
  });
});

describe('the provider', () => {
  it('never guesses the setting on the server: no hint until the browser has read it', () => {
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(
          ShortcutsProvider,
          { memberId: ALEX },
          createElement(AddExpenseLauncher, { userId: ALEX }),
          createElement(ShortcutsFooter),
        ),
      ),
    );
    expect(kbds(html)).toEqual([]);
    expect(html).not.toContain('aria-keyshortcuts');
  });
});

describe('the Expense table', () => {
  it('keeps every row’s button in the Tab order, so no Expense is reachable only with J and K', () => {
    const at = '2026-09-01T00:00:00.000Z';
    const person = { _id: ALEX, name: 'Alex Rivera', image: null };
    const expenses = [1, 2, 3].map(
      (n) =>
        ({
          _id: `e0000000000000000000000${n}`,
          group: 'c00000000000000000000001',
          description: `Expense ${n}`,
          currency: 'INR',
          amount: 10,
          amountMinor: 1000,
          date: at,
          createdAt: at,
          updatedAt: at,
          category: 'other',
          paidBy: [{ user: person, amount: 10, amountMinor: 1000 }],
          splitBetween: [{ user: person, amount: 10, amountMinor: 1000 }],
          splitMethod: 'equal',
        }) as ExpenseRead,
    );
    const html = render(
      createElement(ExpenseTable, {
        expenses,
        userId: ALEX,
        recurringExpensesEnabled: false,
        label: 'Expenses',
        caption: 'Expenses, newest first.',
        openId: null,
        onToggle: vi.fn(),
        panelId: 'expense-panel',
        onEdit: vi.fn(),
      }),
      true,
    );
    expect(html.match(/<button\b[^>]*aria-expanded=/g)).toHaveLength(3);
    expect(html).not.toContain('tabindex');
  });
});
