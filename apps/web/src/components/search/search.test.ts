import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { formatDate } from '@splitbook/shared/date';
import type { SearchRead } from '@splitbook/shared/search-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { anchors, text } from '@/lib/test-utils/markup';
import { readOpenExpense } from '@/components/expenses/expense-list-query';
import {
  expenseHref,
  initialsOf,
  resultsSummary,
  searchSections,
  type SearchSection,
} from './search-options';
import {
  isSearchShortcut,
  isTypingTarget,
  searchShortcutKeys,
  searchShortcutLabel,
  type ShortcutKeyEvent,
} from './search-shortcut';
import type { SearchPanelProps, SearchPanelState } from './SearchPanel';

/*
 * Search across the member's Groups (#321): the dialog's states rendered to static markup, the
 * results and where each goes, and the shortcut's rules. The dialog itself renders in a portal
 * after mounting, so its content, SearchPanel, is rendered directly.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { default: SearchPanel } = await import('./SearchPanel');
const { default: SearchLauncher } = await import('./SearchLauncher');

const goa = 'b00000000000000000000001';
const flat = 'b00000000000000000000002';
const sam = 'a00000000000000000000002';
const dinner = 'c00000000000000000000001';
const ferry = 'c00000000000000000000002';

/** A search read for "goa", fictional throughout. */
const READ: SearchRead = {
  query: 'goa',
  groups: [{ id: goa, name: 'Goa Friends Trip', category: 'trip', memberCount: 3 }],
  people: [
    { id: sam, name: 'Sam Goa Chen', groupId: flat, groupName: 'Banyan Court', groupCount: 3 },
  ],
  expenses: [
    {
      id: dinner,
      groupId: goa,
      groupName: 'Goa Friends Trip',
      description: 'Goa beach shack dinner & drinks',
      amountMinor: 240050,
      currency: 'INR',
      date: '2026-09-12T00:00:00.000Z',
    },
    {
      id: ferry,
      groupId: goa,
      groupName: 'Goa Friends Trip',
      description: 'Goa ferry',
      amountMinor: null,
      currency: 'INR',
      date: '2026-09-11T00:00:00.000Z',
    },
  ],
  more: { groups: false, people: false, expenses: true },
};

/**
 * An Expense's date as the dialog shows it: the Expense list's formatter, in the zone the tests
 * run in, so the expected labels hold in every zone the CI matrix runs (#227).
 */
const shownDate = (index: number) => formatDate(READ.expenses[index].date);

const ids: SearchPanelProps['ids'] = {
  title: 'search-title',
  listbox: 'search-results',
  option: (index) => `search-option-${index}`,
};

/** The markup without its style tags, whose selectors would read as attributes. */
function render(element: ReactElement, mode: 'light' | 'dark' = 'light') {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: createAppTheme(mode) }, element),
  ).replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
}

function panel(state: SearchPanelState, extra: Partial<SearchPanelProps> = {}) {
  return render(
    createElement(SearchPanel, {
      ids,
      query: 'goa',
      onQueryChange: () => {},
      state,
      activeIndex: 0,
      announcement: '',
      ...extra,
    }),
  );
}

const results = (sections: SearchSection[] = searchSections(READ)): SearchPanelState => ({
  status: 'results',
  sections,
  terms: ['goa'],
});

/** The search field's opening tag. */
const field = (html: string) => /<input\b[^>]*>/.exec(html)?.[0] ?? '';
const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

describe('the search dialog’s states', () => {
  it('empty: invites a search, with the field named and nothing to point at', () => {
    const html = panel({ status: 'empty' }, { query: '' });
    expect(text(html)).toContain('Search your Groups');
    expect(text(html)).toContain(
      'Find a Group, someone in your Groups, or an Expense by what it was for.',
    );
    const input = field(html);
    expect(attribute(input, 'role')).toBe('combobox');
    expect(attribute(input, 'aria-label')).toBe('Search Expenses, Groups and people');
    expect(attribute(input, 'placeholder')).toBe('Search Expenses, Groups and people');
    expect(attribute(input, 'aria-expanded')).toBe('false');
    expect(attribute(input, 'aria-controls')).toBeNull();
    expect(attribute(input, 'aria-activedescendant')).toBeNull();
    expect(html).not.toContain('role="listbox"');
    expect(html).toContain('aria-label="Close search"');
  });

  it('loading: placeholders only, hidden from screen readers', () => {
    const html = panel({ status: 'loading' }, { busy: true });
    expect(html).toContain('MuiSkeleton');
    expect(html).not.toContain('role="listbox"');
    expect(text(html)).not.toContain('No results');
  });

  it('error: says the search failed, without the server’s words, and offers Try again', () => {
    const html = panel({ status: 'error' }, { announcement: 'Search didn’t load.' });
    expect(text(html)).toContain('Search didn’t load');
    expect(text(html)).toContain('Check your connection, then try again.');
    expect(html).toMatch(/<button[^>]*>Try again/);
    expect(html).toMatch(/role="status"[^>]*>Search didn’t load\.</);
    expect(html).not.toContain('role="listbox"');
  });

  it('no results: names the search and says what is searched', () => {
    const html = panel({ status: 'none', query: 'zzz' }, { query: 'zzz' });
    expect(text(html)).toContain('No results for “zzz”');
    expect(text(html)).toContain(
      'Search finds Group names, people’s names and Expense descriptions with words that start with what you type.',
    );
    expect(attribute(field(html), 'aria-expanded')).toBe('false');
  });

  it('results: one listbox in sections, the active option pointed at from the field', () => {
    const html = panel(results(), {
      activeIndex: 1,
      announcement: resultsSummary(searchSections(READ)),
    });
    expect(html).toContain('role="listbox" id="search-results" aria-label="Search results"');
    const headings = [...html.matchAll(/role="group" aria-labelledby="([^"]+)"/g)].map(([, id]) =>
      text(new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? ''),
    );
    expect(headings).toEqual(['Groups', 'People', 'Expenses']);

    const options = [...html.matchAll(/<a\b([^>]*role="option"[^>]*)>/g)].map(([, a]) => ({
      id: attribute(a, 'id'),
      name: attribute(a, 'aria-label'),
      selected: attribute(a, 'aria-selected'),
      tabIndex: attribute(a, 'tabindex'),
    }));
    expect(options).toEqual([
      {
        id: 'search-option-0',
        name: 'Goa Friends Trip, Trip · 3 members',
        selected: 'false',
        tabIndex: '-1',
      },
      {
        id: 'search-option-1',
        name: 'Sam Goa Chen, In Banyan Court and 2 other Groups',
        selected: 'true',
        tabIndex: '-1',
      },
      {
        id: 'search-option-2',
        name: `Goa beach shack dinner &amp; drinks, Goa Friends Trip · ${shownDate(0)}, ₹2,400.50`,
        selected: 'false',
        tabIndex: '-1',
      },
      {
        id: 'search-option-3',
        name: `Goa ferry, Goa Friends Trip · ${shownDate(1)}`,
        selected: 'false',
        tabIndex: '-1',
      },
    ]);
    const input = field(html);
    expect(attribute(input, 'aria-expanded')).toBe('true');
    expect(attribute(input, 'aria-controls')).toBe('search-results');
    expect(attribute(input, 'aria-activedescendant')).toBe('search-option-1');
    expect(html).toMatch(/role="status"[^>]*>1 Group, 1 person and 2 Expenses</);
  });

  it('results: each one links where it opens, with its details', () => {
    const html = panel(results());
    // Markup writes an address's `&` as `&amp;`; the link itself has a plain `&`.
    const links = anchors(html).map((link) => ({
      ...link,
      href: link.href.replaceAll('&amp;', '&'),
    }));
    expect(links).toEqual([
      { href: `/groups/${goa}`, current: null, text: 'Goa Friends Trip Trip · 3 members' },
      {
        href: `/groups/${flat}`,
        current: null,
        text: 'SC Sam Goa Chen In Banyan Court and 2 other Groups',
      },
      {
        href: `/groups/${goa}/expenses?expense=${dinner}&search=Goa%20beach%20shack%20dinner%20%26%20drinks`,
        current: null,
        text: `Goa beach shack dinner & drinks Goa Friends Trip · ${shownDate(0)} ₹2,400.50`,
      },
      {
        href: `/groups/${goa}/expenses?expense=${ferry}&search=Goa%20ferry`,
        current: null,
        text: `Goa ferry Goa Friends Trip · ${shownDate(1)}`,
      },
    ]);
  });

  it('results: highlights the words that matched', () => {
    const html = panel(results());
    expect([...html.matchAll(/<mark[^>]*>([^<]*)<\/mark>/g)].map(([, word]) => word)).toEqual([
      'Goa',
      'Goa',
      'Goa',
      'Goa',
    ]);
  });

  it('results: says when a section holds only the first matches', () => {
    expect(text(panel(results()))).toContain('Showing the newest. Type more to narrow the search.');
  });

  it('older results shown while newer ones load can’t be chosen', () => {
    const html = panel({ ...results(), stale: true } as SearchPanelState, { busy: true });
    expect(html).toContain('role="listbox"');
    expect(html).not.toContain('aria-selected="true"');
    expect(attribute(field(html), 'aria-expanded')).toBe('false');
    expect(attribute(field(html), 'aria-activedescendant')).toBeNull();
  });

  it.each(['light', 'dark'] as const)('never shows an email address (%s)', (mode) => {
    const html = render(
      createElement(SearchPanel, {
        ids,
        query: 'goa',
        onQueryChange: () => {},
        state: results(),
        activeIndex: 0,
        announcement: '',
      }),
      mode,
    );
    expect(html).not.toContain('@');
  });
});

describe('results and where they go', () => {
  it('a Group opens its page, a person the first Group shared, an Expense open in its Group, searched for it', () => {
    const [groups, people, expenses] = searchSections(READ);
    expect(groups.options.map((option) => option.href)).toEqual([`/groups/${goa}`]);
    expect(people.options.map((option) => option.href)).toEqual([`/groups/${flat}`]);
    expect(expenses.options.map((option) => option.href)).toEqual([
      `/groups/${goa}/expenses?expense=${dinner}&search=Goa%20beach%20shack%20dinner%20%26%20drinks`,
      `/groups/${goa}/expenses?expense=${ferry}&search=Goa%20ferry`,
    ]);
    // The Expenses tab reads both: the open Expense (#311) and the search (#310).
    const link = new URL(expenses.options[0].href, 'https://splitbook.test');
    expect(readOpenExpense(link.searchParams)).toBe(dinner);
    expect(link.searchParams.get('search')).toBe('Goa beach shack dinner & drinks');
  });

  it('leaves out empty sections', () => {
    const read = { ...READ, groups: [], people: [] };
    expect(searchSections(read).map((section) => section.key)).toEqual(['expenses']);
    expect(searchSections({ ...read, expenses: [] })).toEqual([]);
  });

  it('words a person in one Group, and a Group of one member', () => {
    const [group, person] = searchSections({
      ...READ,
      groups: [{ ...READ.groups[0], memberCount: 1, category: 'unknown' }],
      people: [{ ...READ.people[0], groupCount: 1 }],
    });
    expect(group.options[0].detail).toBe('General · 1 member');
    expect(person.options[0].detail).toBe('In Banyan Court');
  });

  it('encodes a description so it never changes the address', () => {
    expect(expenseHref({ id: ferry, groupId: goa, description: 'Rent?tab=balances#x' })).toBe(
      `/groups/${goa}/expenses?expense=${ferry}&search=Rent%3Ftab%3Dbalances%23x`,
    );
  });

  it('shows an amount only when it can be read exactly, in its own currency', () => {
    const [, , expenses] = searchSections({
      ...READ,
      expenses: [
        { ...READ.expenses[0], amountMinor: 1250, currency: 'EUR' },
        { ...READ.expenses[0], amountMinor: 5, currency: 'XXX' },
      ],
    });
    expect(expenses.options.map((option) => option.kind === 'expense' && option.amount)).toEqual([
      '€12.50',
      null,
    ]);
  });

  it('takes initials from the first and last name', () => {
    expect(initialsOf('Priya Shah')).toBe('PS');
    expect(initialsOf('Sam Goa Chen')).toBe('SC');
    expect(initialsOf('Ölaf')).toBe('Ö');
    expect(initialsOf('  ')).toBe('?');
  });

  it('sums up the results for screen readers', () => {
    expect(resultsSummary(searchSections(READ))).toBe('1 Group, 1 person and 2 Expenses');
    expect(resultsSummary(searchSections({ ...READ, groups: [], people: [] }))).toBe('2 Expenses');
    expect(resultsSummary([])).toBe('No results');
  });
});

describe('the shortcut', () => {
  const key = (event: Partial<ShortcutKeyEvent>): ShortcutKeyEvent => ({
    key: 'k',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...event,
  });

  it('is ⌘K or Ctrl+K, whichever the device has', () => {
    expect(isSearchShortcut(key({ metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ ctrlKey: true }))).toBe(true);
    // Caps Lock on.
    expect(isSearchShortcut(key({ key: 'K', metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ metaKey: true, ctrlKey: true }))).toBe(false);
  });

  it('shows the device’s own shortcut', () => {
    expect([searchShortcutLabel(true), searchShortcutKeys(true)]).toEqual(['⌘K', 'Meta+K']);
    expect([searchShortcutLabel(false), searchShortcutKeys(false)]).toEqual([
      'Ctrl K',
      'Control+K',
    ]);
  });

  it('is never another key, a chord with Shift or Alt, or a key an input method is composing', () => {
    expect(isSearchShortcut(key({ key: 'j', ctrlKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ metaKey: true, altKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ ctrlKey: true, isComposing: true }))).toBe(false);
    expect(isSearchShortcut(key({}))).toBe(false);
  });

  it('counts a key press in a text field, a text area, a select or editable text as typing', () => {
    for (const target of [
      { tagName: 'INPUT', type: 'text' },
      { tagName: 'INPUT', type: 'search' },
      { tagName: 'INPUT', type: 'number' },
      { tagName: 'INPUT' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
    ])
      expect(isTypingTarget(target)).toBe(true);
  });

  it('never counts a button, a checkbox or the page itself as typing', () => {
    for (const target of [
      { tagName: 'BUTTON' },
      { tagName: 'INPUT', type: 'checkbox' },
      { tagName: 'INPUT', type: 'radio' },
      { tagName: 'A' },
      { tagName: 'BODY' },
      null,
    ])
      expect(isTypingTarget(target)).toBe(false);
  });
});

describe('the top bar’s search', () => {
  it('is a field that opens the search dialog, and an icon button on phones', () => {
    const html = render(createElement(SearchLauncher));
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(
      ([, attributes, inner]) => ({
        label: attribute(attributes, 'aria-label'),
        haspopup: attribute(attributes, 'aria-haspopup'),
        expanded: attribute(attributes, 'aria-expanded'),
        text: text(inner),
      }),
    );
    expect(buttons).toEqual([
      {
        label: null,
        haspopup: 'dialog',
        expanded: 'false',
        text: 'Search Expenses, Groups and people',
      },
      {
        label: 'Search Expenses, Groups and people',
        haspopup: 'dialog',
        expanded: 'false',
        text: '',
      },
    ]);
  });

  it('shows the shortcut only once the browser is known, so the server never guesses it', () => {
    const html = render(createElement(SearchLauncher));
    expect(html).not.toContain('<kbd');
    expect(html).not.toContain('aria-keyshortcuts');
  });
});
