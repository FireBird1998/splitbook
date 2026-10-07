import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig, unstable_serialize } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import type { GroupRead } from '@splitbook/shared/group-read';
import type { GroupCategory } from '@splitbook/shared/types';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { groupReadKey } from '@/lib/group-read-key';
import { anchors, text } from '@/lib/test-utils/markup';
import { sidebarBalanceLine } from './sidebar-balance';
import { GROUP_THEME_ICONS, groupThemeIcon } from './group-theme-icons';
import { groupCurrent, groupsListCurrent, navCurrent } from './shell-nav';

/*
 * The shell from the design canvas (#303): the sidebar's links and which one is current, the
 * Group list's Theme icons and balance lines, and the frame's landmarks. Rendered to static
 * markup, with the Group and balance reads supplied through SWR's fallback.
 */

const navigation = vi.hoisted(() => ({ pathname: '/dashboard' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/auth-client', () => ({ signOutToHome: vi.fn() }));

const { default: Sidebar } = await import('./Sidebar');
const { default: AppShell } = await import('./AppShell');

const USER = {
  id: 'a00000000000000000000001',
  name: 'Alex Rivera',
  email: 'alex@example.test',
  image: null,
};
const id = (n: number) => `c0000000000000000000000${n}`;

function group(n: number, name: string, category: GroupCategory, currency = 'INR') {
  return { _id: id(n), name, category, defaultCurrency: currency } as GroupRead;
}

const GROUPS = [
  group(1, 'Maple House', 'home'),
  group(2, 'Goa Friends Trip', 'trip'),
  group(3, 'Lisbon Offsite', 'work', 'EUR'),
  group(4, 'Sunday Football', 'other'),
  group(5, 'Anniversary weekend', 'couple'),
  group(6, 'Brand new Group', 'other'),
];

/** The balances read's wire answer: Goa is a legacy Group with a EUR balance too. */
const BALANCES = {
  status: 200,
  data: {
    buckets: [],
    groups: [
      { groupId: id(1), balances: [{ currency: 'INR', balance: -1480 }] },
      {
        groupId: id(2),
        balances: [
          { currency: 'EUR', balance: 12.5 },
          { currency: 'INR', balance: 620 },
        ],
      },
      { groupId: id(3), balances: [{ currency: 'EUR', balance: 30 }] },
      { groupId: id(4), balances: [] },
      { groupId: id(5), balances: [] },
    ],
  },
};

interface Reads {
  groups?: GroupRead[];
  balances?: unknown;
}

function render(element: ReactElement, reads: Reads = {}, mode: 'light' | 'dark' = 'light') {
  const fallback: Record<string, unknown> = {};
  if (reads.groups)
    fallback[unstable_serialize(groupReadKey(USER.id, '/api/groups'))] = { data: reads.groups };
  if (reads.balances) fallback['/api/user/balances'] = reads.balances;
  return renderToStaticMarkup(
    createElement(
      SWRConfig,
      { value: { fallback } },
      createElement(ThemeProvider, { theme: createAppTheme(mode) }, element),
    ),
  );
}

const sidebar = (pathname: string, reads: Reads = { groups: GROUPS, balances: BALANCES }) =>
  render(createElement(Sidebar, { user: USER, pathname }), reads);

/** The sidebar's Group rows: each link's text, and what it marks current. */
const groupRows = (html: string) =>
  anchors(html).filter(({ href }) => /^\/groups\/[a-f\d]{24}$/.test(href));

describe('a Group’s balance line', () => {
  it('says what the member owes, in the negative wording', () => {
    expect(sidebarBalanceLine([{ currency: 'INR', balance: -1480 }], 'INR')).toEqual({
      tone: 'negative',
      text: 'you owe ₹1,480.00',
      more: 0,
    });
  });

  it('says what the member is owed, in the positive wording', () => {
    expect(sidebarBalanceLine([{ currency: 'INR', balance: 620 }], 'INR')).toEqual({
      tone: 'positive',
      text: 'owed ₹620.00',
      more: 0,
    });
  });

  it('is Settled up when nothing is open, or what is open is exactly zero', () => {
    for (const balances of [[], [{ currency: 'INR', balance: 0 }]])
      expect(sidebarBalanceLine(balances, 'INR')).toEqual({
        tone: 'settled',
        text: 'Settled up',
        more: 0,
      });
  });

  it('shows one currency of a legacy Group, its own first, and counts the rest without adding them', () => {
    expect(
      sidebarBalanceLine(
        [
          { currency: 'EUR', balance: -12.5 },
          { currency: 'INR', balance: 620 },
          { currency: 'USD', balance: 3 },
        ],
        'INR',
      ),
    ).toEqual({ tone: 'positive', text: 'owed ₹620.00', more: 2 });
    // Without the Group's own currency among them, the read's order decides.
    expect(
      sidebarBalanceLine(
        [
          { currency: 'EUR', balance: 5 },
          { currency: 'USD', balance: -3 },
        ],
        'INR',
      ),
    ).toEqual({ tone: 'positive', text: 'owed €5.00', more: 1 });
  });

  it('reads exact minor units: binary tails are restored, and each currency keeps its precision', () => {
    expect(sidebarBalanceLine([{ currency: 'INR', balance: -(0.1 + 0.2) }], 'INR')?.text).toBe(
      'you owe ₹0.30',
    );
    expect(sidebarBalanceLine([{ currency: 'INR', balance: 1480.1 }], 'INR')?.text).toBe(
      'owed ₹1,480.10',
    );
    expect(sidebarBalanceLine([{ currency: 'JPY', balance: -1500 }], 'JPY')?.text).toBe(
      'you owe ¥1,500',
    );
  });

  it('claims nothing when an amount can’t be read exactly', () => {
    // A third decimal in rupees is not a binary tail: rounding it would invent a figure.
    expect(sidebarBalanceLine([{ currency: 'INR', balance: -1.005 }], 'INR')).toBeNull();
    expect(sidebarBalanceLine([{ currency: 'XYZ', balance: 10 }], 'XYZ')).toBeNull();
  });
});

describe('the Theme icons', () => {
  it('maps every Theme to its own line icon', () => {
    const icons = Object.fromEntries(
      Object.entries(GROUP_THEME_ICONS).map(([theme, Icon]) => [
        theme,
        /data-testid="(\w+)Icon"/.exec(renderToStaticMarkup(createElement(Icon)))?.[1],
      ]),
    );
    expect(icons).toEqual({
      home: 'HomeOutlined',
      trip: 'LuggageOutlined',
      work: 'WorkOutlineOutlined',
      couple: 'FavoriteBorderOutlined',
      other: 'PeopleOutlined',
    });
  });

  it('gives a category it doesn’t know (an old document) the General icon', () => {
    expect(groupThemeIcon('legacy' as GroupCategory)).toBe(GROUP_THEME_ICONS.other);
  });

  it('draws each Group in the sidebar with its Theme’s icon, never the Theme’s emoji', () => {
    const html = sidebar('/dashboard');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    const rows = [...html.matchAll(/<a\b[^>]*href="\/groups\/[a-f\d]{24}"[^>]*>([\s\S]*?)<\/a>/g)];
    expect(rows.map(([, row]) => /data-testid="(\w+)Icon"/.exec(row)?.[1])).toEqual([
      'HomeOutlined',
      'LuggageOutlined',
      'WorkOutlineOutlined',
      'PeopleOutlined',
      'FavoriteBorderOutlined',
      'PeopleOutlined',
    ]);
  });
});

describe('the sidebar', () => {
  it('leads with the logo linking Home, then Home; no Receipts and, until #317, no Export', () => {
    const html = sidebar('/dashboard');
    const [logo, home] = anchors(html);
    expect(logo).toMatchObject({ href: '/dashboard', text: '' });
    expect(home).toMatchObject({ href: '/dashboard', text: 'Home' });
    expect(text(html)).not.toMatch(/Dashboard|Receipts|receipts read|Export/);
  });

  it('lists every Group with the member’s balance line, and how many more currencies a legacy Group has', () => {
    expect(groupRows(sidebar('/dashboard')).map(({ text }) => text)).toEqual([
      'Maple House you owe ₹1,480.00',
      'Goa Friends Trip owed ₹620.00 · +1 , and 1 more currency',
      'Lisbon Offsite owed €30.00',
      'Sunday Football Settled up',
      'Anniversary weekend Settled up',
      // Not in the balances read yet: no figure is claimed for it.
      'Brand new Group',
    ]);
  });

  it('keeps Groups, New Group (today’s create flow), Settings and the account in reach', () => {
    const html = sidebar('/dashboard');
    expect(anchors(html).map(({ href }) => href)).toEqual(
      expect.arrayContaining(['/groups', '/groups/new', '/settings']),
    );
    expect(html).toContain('aria-label="New Group"');
    expect(html).toContain('aria-label="Alex Rivera, account menu"');
    expect(text(html)).toMatch(/Settings AR Alex Rivera$/);
  });

  it('marks Home current on Home', () => {
    const current = anchors(sidebar('/dashboard')).filter(({ current }) => current);
    expect(current).toEqual([{ href: '/dashboard', current: 'page', text: 'Home' }]);
  });

  it('marks the open Group current on its page, and as the current Group inside it', () => {
    // A Group's page is any of its tabs (#305).
    for (const path of [
      `/groups/${id(2)}`,
      `/groups/${id(2)}/expenses`,
      `/groups/${id(2)}/members`,
    ])
      expect(groupRows(sidebar(path)).map(({ current }) => current)).toEqual([
        null,
        'page',
        null,
        null,
        null,
        null,
      ]);
    const inside = anchors(sidebar(`/groups/${id(2)}/settings`)).filter(({ current }) => current);
    expect(inside).toEqual([
      expect.objectContaining({ href: `/groups/${id(2)}`, current: 'true' }),
    ]);
  });

  it('marks Settings, or the Groups list, current on their own pages only', () => {
    expect(anchors(sidebar('/settings')).filter(({ current }) => current)).toEqual([
      expect.objectContaining({ href: '/settings', text: 'Settings' }),
    ]);
    expect(anchors(sidebar('/groups')).filter(({ current }) => current)).toEqual([
      expect.objectContaining({ href: '/groups', text: 'Groups' }),
    ]);
    expect(anchors(sidebar('/groups/new')).filter(({ current }) => current)).toEqual([]);
  });

  it('announces its Group list loading without holding up anything else', () => {
    const html = sidebar('/dashboard', {});
    expect(html).toContain('role="status" aria-label="Loading your Groups"');
    expect(anchors(html).map(({ text }) => text)).toEqual(
      expect.arrayContaining(['Home', 'Groups', 'Settings']),
    );
  });

  it('shows the Groups while their balances load, with no figure yet', () => {
    const rows = groupRows(sidebar('/dashboard', { groups: GROUPS }));
    expect(rows.map(({ text }) => text)).toEqual(GROUPS.map(({ name }) => name));
  });

  it('when the balances can’t be read, keeps the Groups, claims no balance and offers Retry', () => {
    const html = sidebar('/dashboard', {
      groups: GROUPS,
      balances: { status: 200, data: { groups: 'unexpected' } },
    });
    expect(groupRows(html).map(({ text }) => text)).toEqual(GROUPS.map(({ name }) => name));
    expect(text(html)).toContain('Balances unavailable. Retry');
    expect(text(html)).not.toContain('Settled up');
    expect(html).not.toContain('role="alert"');
  });

  it('invites a member with no Groups to create one', () => {
    const html = sidebar('/dashboard', { groups: [], balances: BALANCES });
    expect(text(html)).toContain('Create or join a Group to see it here.');
    expect(groupRows(html)).toEqual([]);
  });
});

describe('the theme switch on a narrow phone', () => {
  /** The opening tags of the sidebar's buttons named for the theme. */
  const themeSwitches = (html: string) =>
    [...html.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<\/button>/g)]
      .map(([button]) => button)
      .filter((button) => /Switch to (dark|light) mode/.test(text(button)));

  it('sits at the drawer’s foot, after Settings and before the account, named for the mode it moves to', () => {
    const html = render(
      createElement(Sidebar, { user: USER, pathname: '/dashboard', variant: 'drawer' }),
      { groups: GROUPS, balances: BALANCES },
    );
    const [button] = themeSwitches(html);
    // The theme context starts light.
    expect(text(button)).toBe('Switch to dark mode');
    expect(button).toMatch(/^<button\b[^>]*type="button"/);
    const foot = text(html).slice(text(html).indexOf('Settings'));
    expect(foot).toMatch(/^Settings Switch to dark mode .*Alex Rivera/);
  });

  it('is not in the desktop sidebar, where the top bar always has it', () => {
    expect(themeSwitches(sidebar('/dashboard'))).toEqual([]);
  });
});

describe('the frame', () => {
  const shell = (demoMode: boolean, mode: 'light' | 'dark' = 'light') =>
    render(
      createElement(AppShell, { user: USER, demoMode }, createElement('p', null, 'Page content')),
      { groups: GROUPS, balances: BALANCES },
      mode,
    );

  it('has one main landmark holding the page, beside a labelled sidebar and its navigation', () => {
    const html = shell(false);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toMatch(
      /<main\b[^>]*>(?:<style\b[^>]*>[^<]*<\/style>)*<p>Page content<\/p><\/main>/,
    );
    expect(html).toMatch(/<aside\b[^>]*aria-label="Splitbook"/);
    expect(html).toMatch(/<nav\b[^>]*aria-label="Main"/);
    expect(html).toMatch(/<nav\b[^>]*aria-label="Your Groups"/);
  });

  it('puts the menu button, the theme switch and, in demo mode, the demo badge in the top bar', () => {
    for (const mode of ['light', 'dark'] as const) {
      const html = shell(true, mode);
      const header = /<header\b[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
      expect(header).toContain('aria-label="Open navigation menu"');
      // The switch names the mode it moves to; the theme context starts light.
      expect(header).toContain('aria-label="Switch to dark mode"');
      expect(text(header)).toContain('Demo');
      // On phones the logo shows in the top bar too, linking Home; below 360 px, the mark.
      expect(anchors(header)).toEqual([
        { href: '/dashboard', current: null, text: '' },
        { href: '/dashboard', current: null, text: '' },
      ]);
    }
    expect(text(/<header\b[\s\S]*?<\/header>/.exec(shell(false))?.[0] ?? '')).not.toContain('Demo');
  });
});

describe('which link is current', () => {
  it('matches a top-level page and the pages below it', () => {
    expect(navCurrent('/dashboard', '/dashboard')).toBe('page');
    expect(navCurrent('/settings/profile', '/settings')).toBe('page');
    expect(navCurrent('/groups/abc/settings', '/settings')).toBeUndefined();
    expect(navCurrent('/dashboards', '/dashboard')).toBeUndefined();
  });

  it('matches the Groups list itself, and a Group by its id', () => {
    expect(groupsListCurrent('/groups')).toBe('page');
    expect(groupsListCurrent(`/groups/${id(1)}`)).toBeUndefined();
    expect(groupCurrent(`/groups/${id(1)}`, id(1))).toBe('page');
    expect(groupCurrent(`/groups/${id(1)}/balances`, id(1))).toBe('page');
    expect(groupCurrent(`/groups/${id(1)}/settings`, id(1))).toBe('true');
    expect(groupCurrent(`/groups/${id(1)}`, id(2))).toBeUndefined();
    expect(groupCurrent('/groups/new', id(1))).toBeUndefined();
  });
});
