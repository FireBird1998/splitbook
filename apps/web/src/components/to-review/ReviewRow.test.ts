import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { buildToReview } from '@splitbook/shared/to-review';
import { toReviewQuickFixes, type QuickFixFact } from '@splitbook/shared/to-review-quick-fixes';
import type { ToReviewItem } from '@splitbook/shared/to-review-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';

const { default: ReviewRow } = await import('./ReviewRow');

const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const groupId = 'b00000000000000000000001';

/** A row as the To review page shows it, from a read naming the Group's currency. */
function row(values: Record<string, unknown>, missingFields: string[], problems: string[] = []) {
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
      groups: [{ groupId, groupName: 'Maple House', currency: 'INR', count: 1, items: [read] }],
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
    expect(shown).toMatch(/^Expense to review Sep 2, 2026 · You set this aside ₹12\.50 /);
    expect(shown).not.toMatch(/missing/i);
  });

  it('shows an amount without a currency in the Group’s currency, and never asks for it', () => {
    const shown = row({ description: 'Fare', amount: 12.5, date: '2026-09-02' }, [
      'paidBy',
      'splitMethod',
      'splitBetween',
      'tagId',
    ]);
    expect(shown).toMatch(/^Fare Sep 2, 2026 · You set this aside ₹12\.50 /);
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
      'Station dinner Sep 2, 2026 · You set this aside $30.00 Needs the Group currency Fix the rest',
    );
  });
});
