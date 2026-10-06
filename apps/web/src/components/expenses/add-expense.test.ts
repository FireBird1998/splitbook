import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig, unstable_serialize } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import type { GroupRead } from '@splitbook/shared/group-read';
import type { GroupCategory } from '@splitbook/shared/types';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { groupReadKey } from '@/lib/group-read-key';
import { isGroupReadDenied, useGroup } from '@/lib/hooks/use-groups';
import { anchors, text } from '@/lib/test-utils/markup';
import {
  activeGroups,
  addExpenseDefaultDate,
  addExpenseTarget,
  expenseAddedMessage,
  groupChoiceDetail,
} from './add-expense';

/*
 * Add expense from anywhere (#304): the top bar's button on every signed-in page, where it adds
 * from each kind of page, and the Group chooser it opens outside a Group. Rendered to static
 * markup, with the Groups read supplied through SWR's fallback.
 */

const navigation = vi.hoisted(() => ({ pathname: '/dashboard' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/auth-client', () => ({ signOutToHome: vi.fn() }));

const { default: AppShell } = await import('@/components/layout/AppShell');
const { GroupChooser } = await import('./GroupChooserDialog');

const USER = { id: 'a00000000000000000000001', name: 'Alex Rivera', email: 'alex@example.test' };
const id = (n: number) => `c0000000000000000000000${n}`;
const member = (n: number) => ({
  user: { _id: `a0000000000000000000000${n}`, name: `Member ${n}`, email: `m${n}@example.test` },
  role: n === 1 ? 'admin' : 'member',
  joinedAt: '2026-01-01T00:00:00.000Z',
});

function group(
  n: number,
  name: string,
  category: GroupCategory,
  { members = 3, currency = 'INR', archived = false } = {},
) {
  return {
    _id: id(n),
    name,
    category,
    defaultCurrency: currency,
    isArchived: archived,
    members: Array.from({ length: members }, (_, index) => member(index + 1)),
  } as GroupRead;
}

const GROUPS = [
  group(1, 'Maple House', 'home'),
  group(2, 'Goa Friends Trip', 'trip', { members: 4 }),
  group(3, 'Old Flat', 'home', { archived: true }),
  group(4, 'Lisbon Offsite', 'work', { members: 1, currency: 'EUR' }),
];

/** Render with the Groups read answered (`{ data }`), refused (`{ denied: true }`) or pending. */
function render(element: ReactElement, groupsRead?: unknown) {
  const fallback: Record<string, unknown> = {};
  if (groupsRead !== undefined)
    fallback[unstable_serialize(groupReadKey(USER.id, '/api/groups'))] = groupsRead;
  return renderToStaticMarkup(
    createElement(
      SWRConfig,
      { value: { fallback } },
      createElement(ThemeProvider, { theme: createAppTheme('light') }, element),
    ),
  );
}

const chooser = (groupsRead?: unknown) =>
  render(
    createElement(GroupChooser, { userId: USER.id, onChoose: vi.fn(), onCreateGroup: vi.fn() }),
    groupsRead,
  );

/** The chooser's choices: each row's button text. */
const choices = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(([, inner]) => text(inner));

describe('the top bar’s Add expense', () => {
  const header = (pathname: string) => {
    navigation.pathname = pathname;
    const html = render(
      createElement(AppShell, { user: USER, demoMode: true }, createElement('p', null, 'Page')),
      { data: GROUPS },
    );
    return /<header\b[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
  };

  it('is on every signed-in page: Home, Settings, the Groups list, a Group and inside a Group', () => {
    for (const pathname of [
      '/dashboard',
      '/settings',
      '/groups',
      '/groups/new',
      `/groups/${id(1)}`,
      `/groups/${id(1)}/settings`,
    ]) {
      const buttons = [...header(pathname).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
      const add = buttons.filter(([, , inner]) => text(inner) === 'Add expense');
      expect(add, pathname).toHaveLength(1);
      // It opens a dialog: the chooser or the form.
      expect(add[0][1]).toContain('aria-haspopup="dialog"');
      // A primary button, last in the bar, after the theme switch.
      expect(add[0][1]).toContain('MuiButton-contained');
      expect(buttons.at(-1)).toBe(add[0]);
    }
  });

  it('keeps its name on phones, where only its icon shows', () => {
    const html = header('/dashboard');
    const [, attributes, inner = ''] =
      [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].at(-1) ?? [];
    // Named by its own text, not a label that could drift from it.
    expect(attributes).not.toContain('aria-label');
    expect(inner).toContain('data-testid="AddIcon"');
    expect(text(inner)).toBe('Add expense');
    // Below the sm breakpoint the text is visually hidden, 1 px and clipped, but still read.
    const label = /<span class="[^"]*\b(css-\w+)">Add expense<\/span>/.exec(inner)?.[1];
    expect(inner).toMatch(
      new RegExp(
        `@media \\(max-width:599\\.95px\\)\\{\\.${label}\\{position:absolute;width:1px;height:1px;margin:-1px;[^}]*clip:rect\\(0 0 0 0\\)`,
      ),
    );
  });

  it('opens the form for the Group inside a Group, and asks which Group everywhere else', () => {
    expect(addExpenseTarget(`/groups/${id(2)}`)).toEqual({ kind: 'group', groupId: id(2) });
    expect(addExpenseTarget(`/groups/${id(2)}/settings`)).toEqual({
      kind: 'group',
      groupId: id(2),
    });
    for (const pathname of ['/dashboard', '/settings', '/groups', '/groups/new', '/export'])
      expect(addExpenseTarget(pathname), pathname).toEqual({ kind: 'choose' });
  });

  it('starts a Household Expense on the Month in view, as the Group page’s own button does', () => {
    const now = new Date(2026, 9, 7);
    const household = { category: 'home' } as const;
    expect(addExpenseDefaultDate(household, '2026-08', now)).toBe('2026-08-31');
    expect(addExpenseDefaultDate(household, '2026-02', now)).toBe('2026-02-28');
    // This Month, all time, or a malformed Month: today.
    expect(addExpenseDefaultDate(household, '2026-10', now)).toBeNull();
    expect(addExpenseDefaultDate(household, null, now)).toBeNull();
    expect(addExpenseDefaultDate(household, '2026-13', now)).toBeNull();
    // Only a Household has Months.
    expect(addExpenseDefaultDate({ category: 'trip' }, '2026-08', now)).toBeNull();
  });

  it('confirms a save by naming the Group', () => {
    expect(expenseAddedMessage('Maple House')).toBe('Expense added to Maple House');
  });
});

describe('the Group chooser', () => {
  it('lists the member’s active Groups only, each with its Theme, members and currency', () => {
    const html = chooser({ data: GROUPS });
    expect(choices(html)).toEqual([
      'Maple House Household · 3 members · INR',
      'Goa Friends Trip Trip · 4 members · INR',
      'Lisbon Offsite Work · 1 member · EUR',
    ]);
    expect(text(html)).not.toContain('Old Flat');
    expect(html).toMatch(/<ul\b[^>]*aria-label="Your Groups"/);
    // Each row shows its Theme's line icon, never the Theme's emoji.
    expect([...html.matchAll(/data-group-theme="(\w+)"/g)].map(([, theme]) => theme)).toEqual([
      'home',
      'trip',
      'work',
    ]);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('never offers an archived Group', () => {
    expect(activeGroups(GROUPS).map(({ name }) => name)).toEqual([
      'Maple House',
      'Goa Friends Trip',
      'Lisbon Offsite',
    ]);
    expect(groupChoiceDetail(GROUPS[0])).toBe('Household · 3 members · INR');
  });

  it('tells a member with no Groups to create one first, with a link to do so', () => {
    for (const groups of [[], [group(3, 'Old Flat', 'home', { archived: true })]]) {
      const html = chooser({ data: groups });
      expect(text(html)).toBe(
        'No Groups yet Create a Group first, then add expenses to it. Create a Group',
      );
      expect(anchors(html)).toEqual([
        { href: '/groups/new', current: null, text: 'Create a Group' },
      ]);
      expect(choices(html)).toEqual([]);
    }
  });

  it('announces the Groups loading', () => {
    const html = chooser();
    expect(html).toContain('role="status" aria-label="Loading your Groups"');
    expect(choices(html)).toEqual([]);
  });

  it('says when the Groups can’t be read, with Retry, and offers nothing', () => {
    const html = chooser({ denied: true });
    expect(html).toContain('role="alert"');
    expect(text(html)).toBe('Your Groups could not be loaded. Retry');
    expect(choices(html)).toEqual(['Retry']);
  });
});

describe('the form for a Group', () => {
  /** What `useGroup` reports for an answer already in SWR's cache: refused, failed or neither. */
  function groupRead(answer: unknown) {
    function Probe() {
      const { error } = useGroup(USER.id, id(1));
      return createElement(
        'output',
        null,
        isGroupReadDenied(error) ? 'refused' : error ? 'failed' : 'read',
      );
    }
    const key = unstable_serialize(groupReadKey(USER.id, `/api/groups/${id(1)}`));
    return text(
      renderToStaticMarkup(
        createElement(SWRConfig, { value: { fallback: { [key]: answer } } }, createElement(Probe)),
      ),
    );
  }

  it('closes on a refused Group read, and stays on the chosen Group through an outage', () => {
    // A refusal: the account can no longer read the Group.
    expect(groupRead({ denied: true })).toBe('refused');
    expect(groupRead({ data: GROUPS[0] })).toBe('read');
    // An outage is any other error, even one with the same words.
    expect(isGroupReadDenied(new Error('Group access could not be verified. Please retry.'))).toBe(
      false,
    );
  });
});
