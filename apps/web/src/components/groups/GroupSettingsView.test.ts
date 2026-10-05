import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import GroupSettingsView from './GroupSettingsView';

/*
 * #289: the Group settings page, rendered as the server renders it for the Group's admin, shows
 * the recurring section only when recurring Expenses are switched on and the Group's theme
 * supports them. The page's Group read is a stand-in; the recurring section is the real one.
 */

const ADMIN = 'b00000000000000000000001';
const MEMBER = 'b00000000000000000000002';
const GROUP = 'b00000000000000000000010';

const read = vi.hoisted(() => ({ category: 'home' }));

vi.mock('@/lib/hooks/use-groups', () => ({
  useGroup: () => ({
    data: {
      _id: GROUP,
      name: 'Synthetic Lakeview Flat',
      description: '',
      category: read.category,
      defaultCurrency: 'INR',
      alternateCurrencies: [],
      startDate: null,
      endDate: null,
      isArchived: false,
      createdBy: ADMIN,
      members: [
        {
          user: { _id: ADMIN, name: 'Alex', email: 'alex@example.test', image: null },
          role: 'admin',
          joinedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          user: { _id: MEMBER, name: 'Sam', email: 'sam@example.test', image: null },
          role: 'member',
          joinedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      tags: [{ _id: 'c00000000000000000000001', name: 'Rent', isArchived: false }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
  }),
}));

/** What the page shows, by its text: Members, and the recurring section's own description. */
function settingsPage(category: string, recurringExpensesEnabled: boolean) {
  read.category = category;
  const html = renderToStaticMarkup(
    createElement(GroupSettingsView, { groupId: GROUP, userId: ADMIN, recurringExpensesEnabled }),
  );
  return {
    members: html.includes('Members (2)'),
    recurring: html.includes('Expenses that log themselves every month'),
  };
}

describe('the Group settings page’s recurring section', () => {
  it('is absent from a Household while recurring Expenses are off', () => {
    expect(settingsPage('home', false)).toEqual({ members: true, recurring: false });
  });

  it('shows in a Household once recurring Expenses are on', () => {
    expect(settingsPage('home', true)).toEqual({ members: true, recurring: true });
  });

  it('stays absent from a theme without recurring Expenses, even when they are on', () => {
    for (const category of ['trip', 'couple', 'work', 'other']) {
      expect(settingsPage(category, true), category).toEqual({ members: true, recurring: false });
    }
  });
});
