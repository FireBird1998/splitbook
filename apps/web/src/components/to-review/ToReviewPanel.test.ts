import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { buildToReview } from '@splitbook/shared/to-review';
import type { ToReviewItem } from '@splitbook/shared/to-review-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import type { WebReviewClient } from './review-client';

const { default: ToReviewPanel } = await import('./ToReviewPanel');

const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const groupId = 'b00000000000000000000001';

/** The panel's markup for an item in a Group whose currency is INR, as the read names it. */
function markup(problems: string[], values: Record<string, unknown>, missingFields: string[]) {
  const read: ToReviewItem = {
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
  return renderToStaticMarkup(
    createElement(
      SWRConfig,
      { value: { fallback: {}, provider: () => new Map() } },
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(ToReviewPanel, {
          item,
          items: [read],
          context: {
            currency: 'INR',
            members: [
              { id: alex, name: 'Alex' },
              { id: sam, name: 'Sam' },
            ],
            tags: [],
          },
          names: { [alex]: 'Alex', [sam]: 'Sam' },
          groupName: 'Maple House',
          client: {} as WebReviewClient,
          refresh: vi.fn(),
          available: true,
          savingBlocked: false,
          onClose: vi.fn(),
          onSave: vi.fn(),
          onDelete: vi.fn(),
        }),
      ),
    ),
  );
}
const panel = (...args: Parameters<typeof markup>) => text(markup(...args));
/** Each select's shown value, and whether the member can change it. */
const selects = (html: string) =>
  [...html.matchAll(/<div\b([^>]*role="combobox"[^>]*)>([^<]*)<\/div>/g)].map(
    ([, attributes, shown]) => ({
      shown: text(shown),
      locked: attributes.includes('aria-disabled="true"'),
    }),
  );
/** The Save expense button's disabled state. */
function saveDisabled(html: string) {
  const label = html.indexOf('>Save expense</button>');
  return /\sdisabled=""/.test(html.slice(html.lastIndexOf('<button', label), label));
}

describe('saving an item whose amount can’t be read (#528)', () => {
  it('keeps Save off while the amount can’t be read, whatever the server says', () => {
    const item = (amount: number) => ({
      description: 'Station dinner',
      amount,
      currency: 'INR',
      date: '2026-10-16',
      category: 'food',
      paidBy: [{ user: alex, amount }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }, { user: sam }],
      tag: 'Food',
    });
    for (const [amount, reason] of [
      [0, 'Enter an amount above ₹0.00.'],
      [-5, 'Enter an amount above ₹0.00.'],
      [1.234, 'Use at most 2 decimal places.'],
      [20_000_000, 'Enter at most ₹10,000,000.00.'],
    ] as const) {
      const html = markup([], item(amount), []);
      expect(text(html), String(amount)).toContain(reason);
      expect(saveDisabled(html), String(amount)).toBe(true);
    }
    // The same item with an amount that can be read can be saved.
    expect(saveDisabled(markup([], item(1.23), []))).toBe(false);
  });
});

describe('an item in the web To review panel (#441)', () => {
  it('says each missing fact once, in its Needs line, with no repeated problem lines', () => {
    const shown = panel(
      [
        'paidBy: Choose who paid.',
        'splitMethod: Choose a split method.',
        'splitBetween: Choose who shared this Expense.',
        'tagId: Choose a Tag.',
      ],
      { description: 'Station dinner', amount: 30, currency: 'INR', date: '2026-10-16' },
      ['paidBy', 'splitMethod', 'splitBetween', 'tagId'],
    );
    // Below the fields: whether changes are kept, the problems, then the Needs line.
    const below = shown.slice(shown.indexOf('Changes kept in To review'));
    expect(below).toBe(
      'Changes kept in To review Still needs who paid, how to split it, who shared it, the tag. Save expense Delete',
    );
  });

  it('still says, once, a problem the Needs line doesn’t name', () => {
    const shown = panel(
      ['paidBy.0.amount: Enter the amount paid.', 'paidBy.0.amount: Enter the amount paid.'],
      {
        description: 'Station dinner',
        amount: 30,
        currency: 'INR',
        date: '2026-10-16',
        paidBy: [{ user: sam }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
        tag: 'Food',
      },
      [],
    );
    expect(shown.split('The amount paid by Sam?')).toHaveLength(2);
  });
});

describe('the currency of an item in the web To review panel (#512)', () => {
  const values = {
    description: 'Station dinner',
    amount: 30,
    date: '2026-09-02',
    paidBy: [{ user: sam, amount: 30 }],
    splitMethod: 'equal',
    splitBetween: [{ user: alex }, { user: sam }],
    tag: 'Food',
  };

  it('shows an item without a currency in the Group’s, locked as on Add expense', () => {
    const html = markup([], values, []);
    expect(selects(html)).toContainEqual({ shown: '🇮🇳 INR', locked: true });
    // The label, the value, the outline's copy of the label, then the helper.
    expect(text(html)).toContain('Currency 🇮🇳 INR Currency Group currency');
    expect(text(html)).not.toContain('the currency');
  });

  it('lets the member change a different currency, to the Group’s', () => {
    const html = markup(['Choose the Group currency.'], { ...values, currency: 'USD' }, []);
    expect(selects(html)).toContainEqual({ shown: '🇺🇸 USD', locked: false });
  });
});
