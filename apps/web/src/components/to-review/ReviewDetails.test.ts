import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ToReviewItem } from '@splitbook/shared/to-review-read';
import { text } from '@/lib/test-utils/markup';
import { ReviewFacts, reviewAmount } from './ReviewDetails';

const groupId = 'b00000000000000000000001';

describe('a To review item’s amount (#537)', () => {
  const values = { description: 'Chai', amount: 10.555, currency: 'INR', date: '2026-10-18' };
  it('shows three decimals as entered in the row, beside the line that says they’re too many', () => {
    expect(reviewAmount(values)).toBe('₹10.555');
  });
  it('shows them as entered in the item’s facts, too', () => {
    const item = {
      draft: {
        id: 'd00000000000000000000001',
        groupId,
        revision: 0,
        state: 'active',
        preparedBy: { kind: 'member' },
        changedBy: { kind: 'member' },
        createdAt: '2026-10-18T00:00:00.000Z',
        updatedAt: '2026-10-18T00:00:00.000Z',
        missingFields: [],
        values,
      },
      problems: ['amount: Enter an amount with at most 2 decimal places.'],
      duplicates: [],
    } as ToReviewItem;
    const shown = text(renderToStaticMarkup(createElement(ReviewFacts, { item, names: {} })));
    expect(shown).toContain('Chai · ₹10.555');
    expect(shown).not.toContain('₹10.56');
  });
});
