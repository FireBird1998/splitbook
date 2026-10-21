import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { buildToReview } from '@splitbook/shared/to-review';
import { toReviewQuickFixes, type QuickFixFact } from '@splitbook/shared/to-review-quick-fixes';
import type { ToReviewItem } from '@splitbook/shared/to-review-read';
import { unlistedCurrencyFix } from '@splitbook/shared/group-currencies';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';

const { default: ReviewRow } = await import('./ReviewRow');

const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const groupId = 'b00000000000000000000001';

/** A row as the To review page shows it, from a read naming the Group's currency. */
function row(
  values: Record<string, unknown>,
  missingFields: string[],
  problems: string[] = [],
  category?: 'trip' | 'home',
  extra: Partial<Parameters<typeof ReviewRow>[0]> = {},
) {
  const read = {
    draft: {
      id: 'd00000000000000000000001',
      groupId,
      revision: 0,
      state: 'active',
      preparedBy: { kind: 'member' },
      changedBy: { kind: 'member' },
      createdAt: '2026-10-16T00:00:00.000Z',
      updatedAt: '2026-10-16T00:00:00.000Z',
      missingFields,
      values,
    },
    review: 'a'.repeat(64),
    problems,
    duplicates: [],
  } as ToReviewItem;
  const [item] = buildToReview(
    {
      total: 1,
      groups: [
        {
          groupId,
          groupName: 'Maple House',
          currency: 'INR',
          ...(category ? { category } : {}),
          count: 1,
          items: [read],
        },
      ],
    },
    [],
    new Date('2026-10-16T12:00:00.000Z'),
  ).items;
  const members = [
    { id: alex, name: 'Alex' },
    { id: sam, name: 'Sam' },
  ];
  return text(
    renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(ReviewRow, {
          item,
          quick: toReviewQuickFixes(item, { viewerId: alex, members, tags: [] }),
          currency: 'INR',
          open: false,
          selected: false,
          disabled: false,
          openDisabled: false,
          showAll: new Set<QuickFixFact>(),
          registerOpen: vi.fn(),
          onOpen: vi.fn(),
          onFocus: vi.fn(),
          onPick: vi.fn(),
          onMore: vi.fn(),
          onSave: vi.fn(),
          onDelete: vi.fn(),
          ...extra,
        }),
      ),
    ),
  );
}

describe('a row in the web To review page (#512)', () => {
  it('names each missing fact once, in its Needs line', () => {
    const shown = row({ description: 'Station dinner' }, [
      'amount',
      'date',
      'paidBy',
      'splitMethod',
      'splitBetween',
      'tagId',
    ]);
    expect(shown).not.toMatch(/missing/i);
    expect(shown.match(/amount/gi)).toEqual(['amount']);
    expect(shown.match(/date/gi)).toEqual(['date']);
    expect(shown).toContain('Still needs: the amount, the date, how to split it, who shared it');
  });

  it('names an item without a description as an expense to review, not a missing one', () => {
    const shown = row({ amount: 12.5, currency: 'INR', date: '2026-09-02' }, [
      'description',
      'paidBy',
      'splitMethod',
      'splitBetween',
      'tagId',
    ]);
    expect(shown).toMatch(/^Expense to review 2 Sep 2026 · You set this aside ₹12\.50 /);
    expect(shown).not.toMatch(/missing/i);
  });

  it('shows an amount without a currency in the Group’s currency, and never asks for it', () => {
    const shown = row({ description: 'Fare', amount: 12.5, date: '2026-09-02' }, [
      'paidBy',
      'splitMethod',
      'splitBetween',
      'tagId',
    ]);
    expect(shown).toMatch(/^Fare 2 Sep 2026 · You set this aside ₹12\.50 /);
    expect(shown).not.toContain('currency');
  });
});

describe('a row whose item is in another currency than its Group’s (#567)', () => {
  it('says it needs the Group currency, not the expense details', () => {
    const shown = row(
      {
        description: 'Station dinner',
        amount: 30,
        currency: 'USD',
        date: '2026-09-02',
        category: 'food',
        paidBy: [{ user: alex, amount: 30 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
        tag: 'Food',
      },
      [],
      ['CURRENCY_MISMATCH'],
    );
    expect(shown).toBe(
      'Station dinner 2 Sep 2026 · You set this aside $30.00 Needs the Group currency Fix the rest',
    );
  });
});

describe('a row whose item is in another currency, in a Trip (#596)', () => {
  it('says it needs the Trip currency', () => {
    const shown = row(
      {
        description: 'Station dinner',
        amount: 30,
        currency: 'USD',
        date: '2026-09-02',
        category: 'food',
        paidBy: [{ user: alex, amount: 30 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
        tag: 'Food',
      },
      [],
      ['CURRENCY_MISMATCH'],
      'trip',
    );
    expect(shown).toBe(
      'Station dinner 2 Sep 2026 · You set this aside $30.00 Needs the Trip currency Fix the rest',
    );
  });
});

describe('a row in a currency its Group doesn’t list (#732)', () => {
  // Lisbon & Tokyo, a fictional Trip: main currency INR, extra currencies EUR and JPY.
  const lisbon = {
    name: 'Lisbon & Tokyo',
    defaultCurrency: 'INR',
    alternateCurrencies: ['EUR', 'JPY'],
  };
  const dinner = {
    description: 'Dinner in Zürich',
    amount: 86,
    currency: 'CHF',
    date: '2026-10-12',
    category: 'food',
    paidBy: [{ user: alex, amount: 86 }],
    splitMethod: 'equal',
    splitBetween: [{ user: alex }, { user: sam }],
    tag: 'Food',
  };

  it('explains the currency once and offers both fixes, as the board does', () => {
    const shown = row(dinner, [], ['CURRENCY_NOT_LISTED'], 'trip', {
      currencyFix: { currency: 'CHF', ...unlistedCurrencyFix(lisbon, 'CHF', 86) },
      onAddCurrency: vi.fn(),
      onChangeCurrency: vi.fn(),
    });
    expect(shown).toMatch(
      /^Dinner in Zürich Currency not listed 12 Oct 2026 · You set this aside /,
    );
    expect(shown).toContain(
      'CHF isn’t one of Lisbon & Tokyo’s currencies. Add it, or change this Expense’s currency.',
    );
    expect(shown).toContain('Add CHF to Lisbon & Tokyo');
    expect(shown).toContain('Change currency to Change to… INR EUR JPY');
    expect(shown).toContain(
      'Adding lets everyone use CHF, the 3rd of 4 extra currencies. Changing keeps 86.00 and changes only the currency; nothing is converted.',
    );
    expect(shown).toContain('CHF 86.00');
    expect(shown).not.toContain('a currency listed by the Group');
    expect(shown).not.toContain('Fix the rest');
  });

  it('offers only a change once the Group has 4 extra currencies', () => {
    const full = { ...lisbon, alternateCurrencies: ['EUR', 'JPY', 'USD', 'GBP'] };
    const shown = row(dinner, [], ['CURRENCY_NOT_LISTED'], 'trip', {
      currencyFix: { currency: 'CHF', ...unlistedCurrencyFix(full, 'CHF', 86) },
      onAddCurrency: vi.fn(),
      onChangeCurrency: vi.fn(),
    });
    expect(shown).toContain(
      'CHF isn’t one of Lisbon & Tokyo’s currencies. Change this Expense’s currency.',
    );
    expect(shown).not.toContain('Add CHF');
    expect(shown).toContain(
      'Lisbon & Tokyo already has 4 extra currencies, the most a Group can have.',
    );
  });
});
