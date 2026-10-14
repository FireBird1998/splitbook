import { describe, expect, it } from 'vitest';
import { reviewFormChange } from './review-form';
const member = 'a00000000000000000000001';
describe('review picker changes', () => {
  it('keeps unknown facts omitted when a member chooses a date', () => {
    expect(reviewFormChange({ description: 'Lunch' }, { date: '2026-10-14' }, 'INR')).toEqual({
      description: 'Lunch',
      date: '2026-10-14',
    });
  });
  it('keeps an exact single-payer allocation when the amount changes', () => {
    expect(
      reviewFormChange(
        { amount: 12.34, currency: 'INR', paidBy: [{ user: member, amount: 12.34 }] },
        { amount: '23.45' },
        'INR',
      ),
    ).toEqual({ amount: 23.45, currency: 'INR', paidBy: [{ user: member, amount: 23.45 }] });
  });
  it('clears the name representation when choosing a Tag', () => {
    expect(
      reviewFormChange({ tag: 'General' }, { tagId: 'b00000000000000000000001' }, 'INR'),
    ).toEqual({ tagId: 'b00000000000000000000001' });
  });
});
