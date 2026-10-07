import { describe, expect, it } from 'vitest';
import {
  GROUP_TABS,
  groupLandingHref,
  groupSettingsHref,
  groupSummaryLine,
  groupTabFromPath,
  groupTabHref,
  memberRoster,
  membersLabel,
} from './group-tabs';

/*
 * #305: a Group's tabs are addresses. These are the rules the routes, the tab bar, the
 * sidebar and the redirect for old links share.
 */

const GROUP = 'c00000000000000000000001';
const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';

describe('the Group page’s tabs', () => {
  it('are Expenses, Balances, Insights, Activity and Members, in the canvas’s order', () => {
    expect(GROUP_TABS.map((tab) => tab.label)).toEqual([
      'Expenses',
      'Balances',
      'Insights',
      'Activity',
      'Members',
    ]);
  });

  it('each have their own address under the Group', () => {
    expect(GROUP_TABS.map((tab) => groupTabHref(GROUP, tab.slug))).toEqual([
      `/groups/${GROUP}/expenses`,
      `/groups/${GROUP}/balances`,
      `/groups/${GROUP}/insights`,
      `/groups/${GROUP}/activity`,
      `/groups/${GROUP}/members`,
    ]);
    expect(groupTabHref(GROUP, 'expenses', new URLSearchParams({ month: '2026-08' }))).toBe(
      `/groups/${GROUP}/expenses?month=2026-08`,
    );
    expect(groupSettingsHref(GROUP)).toBe(`/groups/${GROUP}/settings`);
  });

  it('are read back from a path, and nothing else is a tab', () => {
    expect(groupTabFromPath(`/groups/${GROUP}/expenses`)).toBe('expenses');
    expect(groupTabFromPath(`/groups/${GROUP}/members/`)).toBe('members');
    expect(groupTabFromPath(`/groups/${GROUP}/insights`)).toBe('insights');
    for (const path of [
      `/groups/${GROUP}`,
      `/groups/${GROUP}/settings`,
      `/groups/${GROUP}/expenses/extra`,
      '/groups/new',
      '/dashboard',
      '/expenses',
    ])
      expect(groupTabFromPath(path), path).toBeNull();
  });
});

describe('a link to the Group’s own address', () => {
  it('lands on Expenses', () => {
    expect(groupLandingHref(GROUP)).toBe(`/groups/${GROUP}/expenses`);
    expect(groupLandingHref(GROUP, {})).toBe(`/groups/${GROUP}/expenses`);
  });

  it('keeps the old ?tab=balances link working: it opens Balances, without the old parameter', () => {
    expect(groupLandingHref(GROUP, { tab: 'balances' })).toBe(`/groups/${GROUP}/balances`);
    expect(groupLandingHref(GROUP, { tab: 'activity' })).toBe(`/groups/${GROUP}/activity`);
  });

  it('opens Expenses for a tab it doesn’t know, or one that doesn’t exist yet', () => {
    for (const tab of ['Balances', 'settings', '', 'x'])
      expect(groupLandingHref(GROUP, { tab }), tab).toBe(`/groups/${GROUP}/expenses`);
    expect(groupLandingHref(GROUP, { tab: ['balances', 'activity'] })).toBe(
      `/groups/${GROUP}/balances`,
    );
  });

  it('keeps the old ?action=add-expense link working, with a Household’s Month', () => {
    expect(groupLandingHref(GROUP, { action: 'add-expense' })).toBe(
      `/groups/${GROUP}/expenses?action=add-expense`,
    );
    expect(groupLandingHref(GROUP, { month: '2026-08', action: 'add-expense' })).toBe(
      `/groups/${GROUP}/expenses?month=2026-08&action=add-expense`,
    );
    expect(groupLandingHref(GROUP, { tab: 'balances', action: 'add-expense' })).toBe(
      `/groups/${GROUP}/balances?action=add-expense`,
    );
  });

  it('carries every other parameter, repeated ones included, and encodes them', () => {
    expect(
      groupLandingHref(GROUP, { tab: 'balances', note: ['a b', 'c&d'], empty: undefined }),
    ).toBe(`/groups/${GROUP}/balances?note=a+b&note=c%26d`);
  });

  it('never leaves the Group’s own path, whatever the address holds', () => {
    expect(groupLandingHref('../../evil', {})).toBe('/groups/..%2F..%2Fevil/expenses');
    expect(groupLandingHref('//evil.example', {})).toBe('/groups/%2F%2Fevil.example/expenses');
  });
});

describe('the Group header’s words', () => {
  it('reads "Theme · N members · currency"', () => {
    expect(groupSummaryLine('Household', 3, 'INR')).toBe('Household · 3 members · INR');
    expect(groupSummaryLine('Trip', 1, 'EUR')).toBe('Trip · 1 member · EUR');
  });

  it('names the members behind the avatars, the viewer first as "you"', () => {
    const people = [
      { _id: SAM, name: 'Sam Chen' },
      { _id: ALEX, name: 'Alex Rivera' },
      { _id: PRIYA, name: 'Priya Shah' },
    ];
    expect(membersLabel(people, ALEX)).toBe('Members: you, Sam Chen and Priya Shah');
    expect(membersLabel(people.slice(0, 2), ALEX)).toBe('Members: you and Sam Chen');
    expect(membersLabel([people[1]], ALEX)).toBe('Members: you');
    expect(membersLabel(people, 'not-a-member')).toBe(
      'Members: Sam Chen, Alex Rivera and Priya Shah',
    );
  });
});

describe('the Members roster', () => {
  const members = [
    {
      user: { _id: SAM, name: 'Sam Chen', email: 'sam@example.test', image: null },
      role: 'member' as const,
    },
    {
      user: { _id: ALEX, name: 'Alex Rivera', email: 'alex@example.test', image: '/a.png' },
      role: 'admin' as const,
    },
    {
      user: { _id: PRIYA, name: 'Priya Shah', email: 'priya@example.test' },
      role: 'admin' as const,
    },
  ];

  it('lists every member by name with their role, the viewer first', () => {
    expect(memberRoster(members, ALEX)).toEqual([
      {
        id: ALEX,
        name: 'Alex Rivera',
        image: '/a.png',
        role: 'admin',
        roleLabel: 'Admin',
        isViewer: true,
      },
      {
        id: SAM,
        name: 'Sam Chen',
        image: undefined,
        role: 'member',
        roleLabel: 'Member',
        isViewer: false,
      },
      {
        id: PRIYA,
        name: 'Priya Shah',
        image: undefined,
        role: 'admin',
        roleLabel: 'Admin',
        isViewer: false,
      },
    ]);
  });

  it('carries nothing else the Group read holds about a member, so no email can reach the page', () => {
    expect(JSON.stringify(memberRoster(members, SAM))).not.toContain('@example.test');
  });
});
