import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import type { GroupRead } from '@splitbook/shared/group-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { anchors, text } from '@/lib/test-utils/markup';

/*
 * #305: the Group page, as the server renders it: the header from the design canvas, the tabs
 * as links, the Members roster, and the same refusal on every tab when the Group can't be
 * shown. The Group read is a stand-in; everything it feeds is the real page.
 */

const navigation = vi.hoisted(() => ({ pathname: '/groups', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const read = vi.hoisted(() => ({
  group: undefined as unknown,
  error: undefined as Error | undefined,
}));
vi.mock('@/lib/hooks/use-groups', () => ({
  useGroup: () => ({ data: read.group, error: read.error, isLoading: false, mutate: vi.fn() }),
  useGroups: () => ({ data: [], error: undefined, isLoading: false, mutate: vi.fn() }),
}));

const { default: GroupDetailView } = await import('./GroupDetailView');
const { default: GroupPageHeader } = await import('./GroupPageHeader');
const { default: GroupTabs } = await import('./GroupTabs');
const { default: GroupMembersView } = await import('./GroupMembersView');
const { default: GroupExpensesTab } = await import('./GroupExpensesTab');
const { GroupActivityTab, GroupBalancesTab, GroupMembersTab } = await import('./GroupTabPanels');

const GROUP = 'c00000000000000000000001';
const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const TIME = '2026-09-01T00:00:00.000Z';

const person = (id: string, name: string) => ({
  _id: id,
  name,
  email: `${name.split(' ')[0].toLowerCase()}@example.test`,
  image: undefined,
});

function groupRead(category: GroupRead['category'], name: string): GroupRead {
  return {
    _id: GROUP,
    name,
    description: '',
    image: undefined,
    createdBy: ALEX,
    defaultCurrency: 'INR',
    currencyLocked: false,
    alternateCurrencies: [],
    category,
    startDate: category === 'trip' ? TIME : null,
    endDate: category === 'trip' ? '2026-09-05T00:00:00.000Z' : null,
    isArchived: false,
    inviteCode: 'synthetic-code',
    tags: [],
    createdAt: TIME,
    updatedAt: TIME,
    members: [
      { user: person(SAM, 'Sam Chen'), role: 'member', joinedAt: TIME },
      { user: person(ALEX, 'Alex Rivera'), role: 'admin', joinedAt: TIME },
      { user: person(PRIYA, 'Priya Shah'), role: 'member', joinedAt: TIME },
    ],
  } as GroupRead;
}

const EMAILS = /[\w.]+@example\.test/;

function render(element: ReactElement, mode: 'light' | 'dark' = 'light') {
  return renderToStaticMarkup(
    createElement(
      SWRConfig,
      { value: { fallback: {}, provider: () => new Map() } },
      createElement(ThemeProvider, { theme: createAppTheme(mode) }, element),
    ),
  );
}

/** The Group page at a path, signed in as `userId`, with the given tab's route below it. */
function groupPage(path: string, tab: () => ReactElement, userId = ALEX) {
  navigation.pathname = path;
  return render(createElement(GroupDetailView, { groupId: GROUP, userId }, tab()));
}

describe('the Group header', () => {
  const header = (members = groupRead('home', 'Maple House').members.map((m) => m.user)) =>
    render(
      createElement(GroupPageHeader, {
        name: 'Maple House',
        category: 'home',
        themeLabel: 'Household',
        currency: 'INR',
        members,
        userId: ALEX,
        settingsHref: `/groups/${GROUP}/settings`,
        onInvite: vi.fn(),
      }),
    );

  it('shows the Theme’s line icon, the name, "Theme · N members · currency", the avatars, Invite and settings', () => {
    const html = header();
    expect(html).toMatch(/<h1\b[^>]*>Maple House<\/h1>/);
    expect(text(html)).toContain('Household · 3 members · INR');
    expect(html).toMatch(/data-group-theme="home"[^>]*>[\s\S]*?data-testid="HomeOutlinedIcon"/);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html).toContain('role="img" aria-label="Members: you, Sam Chen and Priya Shah"');
    expect(text(html)).toMatch(/AR SC PS Invite/);
    expect(anchors(html)).toEqual([{ href: `/groups/${GROUP}/settings`, current: null, text: '' }]);
    expect(html).toContain('aria-label="Maple House settings"');
  });

  it('has no back link: the shell’s sidebar does the navigating', () => {
    expect(text(header())).not.toMatch(/Dashboard|Back/);
  });

  it('never shows a member’s email', () => {
    expect(header()).not.toMatch(EMAILS);
  });

  it('shows four avatars and "+N" for a large Group, while still naming everyone', () => {
    const many = ['Ann Lee', 'Ben Ito', 'Cal Roy', 'Dee Fox', 'Eve Kim', 'Fay Ng'].map((name, n) =>
      person(`b0000000000000000000000${n}`, name),
    );
    const html = header([person(ALEX, 'Alex Rivera'), ...many]);
    expect(text(html)).toMatch(/AR AL BI CR \+3 Invite/);
    expect(html).toContain(
      'aria-label="Members: you, Ann Lee, Ben Ito, Cal Roy, Dee Fox, Eve Kim and Fay Ng"',
    );
    expect(text(html)).toContain('Household · 7 members · INR');
  });
});

describe('the tabs', () => {
  const tabs = (path: string) => {
    navigation.pathname = path;
    return render(createElement(GroupTabs, { groupId: GROUP, label: 'Maple House sections' }));
  };

  it('are links to each tab’s address, in a labelled navigation, with Insights hidden until #314', () => {
    const html = tabs(`/groups/${GROUP}/expenses`);
    expect(html).toMatch(/<nav\b[^>]*aria-label="Maple House sections"/);
    expect(html).not.toContain('role="tab');
    expect(anchors(html).map(({ href, text }) => [text, href])).toEqual([
      ['Expenses', `/groups/${GROUP}/expenses`],
      ['Balances', `/groups/${GROUP}/balances`],
      ['Activity', `/groups/${GROUP}/activity`],
      ['Members', `/groups/${GROUP}/members`],
    ]);
  });

  it('mark the open tab, and only it, as the current page', () => {
    for (const tab of ['expenses', 'balances', 'activity', 'members'])
      expect(
        anchors(tabs(`/groups/${GROUP}/${tab}`))
          .filter(({ current }) => current)
          .map(({ href, current }) => [href, current]),
      ).toEqual([[`/groups/${GROUP}/${tab}`, 'page']]);
    expect(anchors(tabs(`/groups/${GROUP}/settings`)).filter(({ current }) => current)).toEqual([]);
  });
});

describe('the Members tab', () => {
  const roster = (userId: string) =>
    render(
      createElement(GroupMembersView, {
        members: groupRead('home', 'Maple House').members,
        userId,
        settingsHref: `/groups/${GROUP}/settings`,
        onInvite: vi.fn(),
      }),
    );
  const rows = (html: string) =>
    [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, row]) => text(row));

  it('lists every member by name with their role, the viewer first, and offers Invite', () => {
    const html = roster(ALEX);
    expect(html).toMatch(/<h2\b[^>]*id="group-members-heading"[^>]*>Members/);
    expect(rows(html)).toEqual([
      'AR Alex Rivera (you) Admin',
      'SC Sam Chen Member',
      'PS Priya Shah Member',
    ]);
    expect(text(html)).toMatch(/^Members 3 Invite/);
  });

  it('never shows an email, its own or another member’s', () => {
    for (const viewer of [ALEX, SAM]) expect(roster(viewer)).not.toMatch(EMAILS);
  });

  it('points an admin to Group settings for roles and leaving, and nobody else', () => {
    expect(anchors(roster(ALEX))).toEqual([
      { href: `/groups/${GROUP}/settings`, current: null, text: 'Group settings' },
    ]);
    expect(text(roster(ALEX))).toMatch(
      /Change roles, remove members or leave the Group in Group settings ?\.$/,
    );
    const member = roster(SAM);
    expect(anchors(member)).toEqual([]);
    expect(rows(member)[0]).toBe('SC Sam Chen (you) Member');
    // No role controls here: they stay in Group settings.
    expect(member).not.toMatch(/<(button|select|input)\b[^>]*(promote|demote|remove|role)/i);
  });
});

describe('the Group page around its tabs', () => {
  it('shows the header, the tabs and the open tab for a Household', () => {
    read.group = groupRead('home', 'Maple House');
    read.error = undefined;
    const html = groupPage(`/groups/${GROUP}/members`, () => createElement(GroupMembersTab));
    expect(html).toMatch(/<h1\b[^>]*>Maple House<\/h1>/);
    expect(html).toMatch(/<nav\b[^>]*aria-label="Maple House sections"/);
    expect(
      anchors(html)
        .filter(({ current }) => current)
        .map(({ text }) => text),
    ).toEqual(['Members']);
    expect(text(html)).toContain('Alex Rivera (you) Admin');
    // The canvas header replaces the old back link and the neutral header card.
    expect(text(html)).not.toMatch(/Dashboard|Your balance/);
    expect(html).not.toMatch(EMAILS);
    // The top bar's Add expense adds to this Group (#304): no header button, no phone bar.
    expect(text(html)).not.toContain('Add expense');
  });

  it('keeps a Trip’s strip and setup checklist above the tabs', () => {
    read.group = groupRead('trip', 'Goa Friends Trip');
    read.error = undefined;
    const html = groupPage(`/groups/${GROUP}/activity`, () => createElement(GroupActivityTab));
    const strip = html.indexOf('aria-label="Goa Friends Trip trip,');
    const checklist = html.indexOf('Get this trip going');
    const tabs = html.indexOf('aria-label="Goa Friends Trip sections"');
    expect(html.indexOf('<h1')).toBeLessThan(strip);
    expect(strip).toBeGreaterThan(-1);
    expect(checklist).toBeGreaterThan(strip);
    expect(tabs).toBeGreaterThan(checklist);
    expect(text(html)).toContain('Trip · 3 members · INR');
    // The checklist keeps its own Add expense for the first Expense, and it is the page's only
    // one: the top bar has Add expense for every tab (#304).
    expect(text(html)).toContain('Add the first expense');
    const adds = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].filter(
      ([, inner]) => text(inner) === 'Add expense',
    );
    expect(adds).toHaveLength(1);
    expect(html.indexOf(adds[0][0])).toBeGreaterThan(checklist);
    expect(html.indexOf(adds[0][0])).toBeLessThan(tabs);
  });

  it('puts a Household’s Month bar on the Expenses tab only', () => {
    read.group = groupRead('home', 'Maple House');
    read.error = undefined;
    navigation.search = 'month=2026-08';
    try {
      const expenses = groupPage(`/groups/${GROUP}/expenses`, () =>
        createElement(GroupExpensesTab),
      );
      expect(expenses).toContain('aria-label="August 2026 summary"');
      expect(expenses.indexOf('aria-label="August 2026 summary"')).toBeGreaterThan(
        expenses.indexOf('aria-label="Maple House sections"'),
      );
      const balances = groupPage(`/groups/${GROUP}/balances`, () =>
        createElement(GroupBalancesTab),
      );
      expect(balances).not.toContain('aria-label="August 2026 summary"');
    } finally {
      navigation.search = '';
    }
  });

  it('gives a non-member, or a member who has left, the same refusal on every tab, and none of the tab', () => {
    read.group = undefined;
    read.error = new Error('Group access could not be verified. Please retry.');
    const pages = [
      ['expenses', GroupExpensesTab],
      ['balances', GroupBalancesTab],
      ['activity', GroupActivityTab],
      ['members', GroupMembersTab],
    ] as const;
    const refused = pages.map(([tab, Tab]) =>
      groupPage(`/groups/${GROUP}/${tab}`, () => createElement(Tab), SAM),
    );
    for (const html of refused) {
      expect(html).toBe(refused[0]);
      expect(text(html)).toBe('Group could not be loaded. Retry');
      expect(html).toContain('role="alert"');
    }
  });
});
