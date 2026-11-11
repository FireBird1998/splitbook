import { describe, expect, it } from 'vitest';
import { reviewForm, reviewFormChange } from './review-form';
const member = 'a00000000000000000000001';
describe('review picker changes', () => {
  it('keeps unknown facts omitted when a member chooses a date', () => {
    expect(reviewFormChange({ description: 'Lunch' }, { date: '2026-10-14' })).toEqual({
      description: 'Lunch',
      date: '2026-10-14',
    });
  });
  it('keeps an exact single-payer allocation when the amount changes', () => {
    expect(
      reviewFormChange(
        { amount: 12.34, currency: 'INR', paidBy: [{ user: member, amount: 12.34 }] },
        { amount: '23.45' },
      ),
    ).toEqual({ amount: 23.45, currency: 'INR', paidBy: [{ user: member, amount: 23.45 }] });
  });
  it('shows a missing Category as Other, as Add expense saves it, without storing it', () => {
    const claude = { amount: 1200, currency: 'INR', paidBy: [{ user: member }] };
    expect(reviewForm(claude, 'INR')).toMatchObject({
      category: 'other',
      payerId: member,
      multiPayer: false,
    });
    expect(reviewFormChange(claude, { date: '2026-10-16' })).not.toHaveProperty('category');
    expect(reviewFormChange(claude, { category: 'food' })).toMatchObject({
      category: 'food',
    });
  });
  it('clears the name representation when choosing a Tag', () => {
    expect(reviewFormChange({ tag: 'General' }, { tagId: 'b00000000000000000000001' })).toEqual({
      tagId: 'b00000000000000000000001',
    });
  });
});

it('keeps the shown Equal choice when a member edits an otherwise unspecified split', () => {
  expect(
    reviewFormChange({ description: 'Lunch' }, { participantIds: ['a00000000000000000000001'] }),
  ).toEqual({
    description: 'Lunch',
    splitMethod: 'equal',
    splitBetween: [{ user: 'a00000000000000000000001' }],
  });
});

it('keeps the assistant’s unedited amounts and percentages when changing shares (#1117 decision 10)', () => {
  const from = {
    splitMethod: 'shares' as const,
    splitBetween: [{ user: member, amount: 50, percentage: 50, shares: 1 }],
  };
  expect(reviewFormChange(from, { splitValues: { [member]: '2' } }).splitBetween).toEqual([
    { user: member, amount: 50, percentage: 50, shares: 2 },
  ]);
});
