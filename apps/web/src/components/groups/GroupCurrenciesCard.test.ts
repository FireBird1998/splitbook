import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GroupCurrencySettings } from '@splitbook/shared/group-currency-settings';
import GroupCurrenciesCard from './GroupCurrenciesCard';
import { listItems, text } from '@/lib/test-utils/markup';

/*
 * #721: a Group's Currencies section in its settings, as the boards "Group currencies, as an
 * admin" and "A member adds a currency" show it. The dialogs it opens are covered in the browser.
 */

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
// Local noon, so the day each row shows holds in every time zone the suite runs in.
const localNoon = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12).toISOString();
};
const now = new Date(localNoon('2026-10-21'));

const unused = {
  expenses: { count: 0, items: [] },
  settlements: 0,
  toReview: { yours: 0, others: 0 },
};

/** Lisbon & Tokyo once money is recorded: rupees, with euros, yen and pounds as extras. */
const lisbonAndTokyo: GroupCurrencySettings = {
  mainCurrency: { code: 'INR', locked: true },
  extraCurrencies: [
    {
      code: 'EUR',
      use: { ...unused, expenses: { count: 11, items: [] }, settlements: 1 },
      added: { by: { _id: SAM, name: 'Sam' }, at: localNoon('2026-10-01') },
    },
    {
      code: 'JPY',
      use: { ...unused, expenses: { count: 24, items: [] } },
      added: { by: { _id: SAM, name: 'Sam' }, at: localNoon('2026-10-05') },
    },
    {
      code: 'GBP',
      use: unused,
      added: { by: { _id: PRIYA, name: 'Priya' }, at: localNoon('2026-10-02') },
    },
  ],
};

function render(
  settings: GroupCurrencySettings,
  viewer: { id: string; isAdmin: boolean; adminNames?: string[] },
) {
  return renderToStaticMarkup(
    createElement(GroupCurrenciesCard, {
      groupName: 'Lisbon & Tokyo',
      settings,
      viewerId: viewer.id,
      isAdmin: viewer.isAdmin,
      adminNames: viewer.adminNames ?? ['Alex'],
      now,
      busy: false,
      onAdd: () => {},
      onRemove: () => {},
      onChangeMainCurrency: () => {},
    }),
  );
}

const removeButtons = (html: string) =>
  [...html.matchAll(/aria-label="(Remove [A-Z]{3})"/g)].map(([, label]) => label);

describe('a Group’s currencies in its settings (#721)', () => {
  it('shows an admin the locked main currency and each extra with what uses it', () => {
    const html = render(lisbonAndTokyo, { id: ALEX, isAdmin: true });
    const page = text(html);

    expect(page).toContain(
      'Currencies Expenses and payments in Lisbon & Tokyo can use any of these. Nothing is converted.',
    );
    expect(page).toContain(
      'Main currency INR Indian Rupee Locked Money is already recorded in INR, so the main currency can’t change.',
    );
    expect(page).toContain('Extra currencies 3 of 4');
    expect(listItems(html, 'Extra currencies').map((row) => text(row.html))).toEqual([
      'EUR Euro In use 11 Expenses · 1 Settlement · added by Sam, 1 Oct Remove',
      'JPY Japanese Yen In use 24 Expenses · whole amounts only · added by Sam, 5 Oct Remove',
      'GBP British Pound Nothing uses it · added by Priya, 2 Oct Remove',
    ]);
    expect(removeButtons(html)).toEqual(['Remove EUR', 'Remove JPY', 'Remove GBP']);
    expect(page).toContain('Currency to add Choose a currency Add 1 more can be added');
    expect(page).toContain(
      'Who can change them Anyone in the Group can add a currency, up to 4 extra. Only admins can remove one, and only while no Expense, Settlement or To review item uses it. Nobody can change the main currency once money is recorded. Activity shows who added or removed which currency.',
    );
    expect(page).not.toContain('Only admins can remove a currency.');
  });

  it('names its Add button for the currency, apart from Recurring’s Add on the same page', () => {
    const html = render(lisbonAndTokyo, { id: SAM, isAdmin: false, adminNames: ['Sam', 'Priya'] });

    expect(html).toContain('aria-label="Add a currency"');
  });

  it('lets a member add but not remove, and names the admins to ask', () => {
    const html = render(lisbonAndTokyo, { id: SAM, isAdmin: false, adminNames: ['Sam', 'Priya'] });

    expect(removeButtons(html)).toEqual([]);
    expect(text(html)).toContain('Currency to add Choose a currency Add 1 more can be added');
    expect(text(html)).toContain('Only admins can remove a currency. Ask Sam or Priya.');
    expect(text(listItems(html, 'Extra currencies')[0].html)).toBe(
      'EUR Euro In use 11 Expenses · 1 Settlement · added by you, 1 Oct',
    );
  });

  it('offers no more once the Group has 4', () => {
    const html = render(
      {
        ...lisbonAndTokyo,
        extraCurrencies: [
          ...lisbonAndTokyo.extraCurrencies,
          { code: 'CHF', use: unused, added: null },
        ],
      },
      { id: ALEX, isAdmin: true },
    );

    expect(text(html)).toContain('Extra currencies 4 of 4');
    expect(text(html)).not.toContain('Currency to add');
    expect(text(html)).toContain('4 extra currencies is the most a Group can have.');
    expect(text(listItems(html, 'Extra currencies')[3].html)).toBe(
      'CHF Swiss Franc Nothing uses it Remove',
    );
  });

  it('lets an admin change the main currency until money is recorded', () => {
    const empty: GroupCurrencySettings = {
      mainCurrency: { code: 'INR', locked: false },
      extraCurrencies: [],
    };

    const admin = render(empty, { id: ALEX, isAdmin: true });
    const member = render(empty, { id: SAM, isAdmin: false });

    expect(text(admin)).not.toContain('Locked');
    expect(text(admin)).toContain(
      'Nothing is recorded yet, so the main currency can still change.',
    );
    expect(admin).toMatch(/<label[^>]*>Main currency<\/label>/);
    expect(text(admin)).toContain('Change main currency');
    expect(text(admin)).toContain('Extra currencies 0 of 4 None yet.');
    expect(text(admin)).toContain('4 more can be added');
    expect(text(member)).toContain(
      'Nothing is recorded yet, so an admin can still change the main currency.',
    );
    expect(member).not.toMatch(/<label[^>]*>Main currency<\/label>/);
  });
});
