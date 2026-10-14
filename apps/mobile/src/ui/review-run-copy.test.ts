import { describe, expect, it } from 'vitest';
import { joinGroupNames, reviewedItemsLine } from './review-run-copy';

describe('the end-of-run line', () => {
  it('says item for one and items for more', () => {
    expect(reviewedItemsLine(1, ['Maple House'])).toBe('You went through 1 item in Maple House');
    expect(reviewedItemsLine(5, ['Maple House', 'Goa Friends Trip'])).toBe(
      'You went through 5 items in Maple House and Goa Friends Trip',
    );
  });
  it('lists three or more Groups with commas and a final and', () => {
    expect(joinGroupNames(['Maple House', 'Goa Friends Trip', 'Flat 4B'])).toBe(
      'Maple House, Goa Friends Trip and Flat 4B',
    );
    expect(joinGroupNames([])).toBe('');
  });
});
