import { describe, expect, it } from 'vitest';
import {
  getDefaultExpenseTag,
  getSelectableExpenseTags,
  isAdvancedSplit,
  resolveExpenseCategory,
  resolvePredefinedTag,
} from './expense-form-helpers';

const tags = [
  { _id: '1', name: 'General', isArchived: false },
  { _id: '2', name: 'Food', isArchived: false },
  { _id: '3', name: 'OldTag', isArchived: true },
];

describe('expense form helpers', () => {
  it('defaults to General when present', () => {
    expect(getDefaultExpenseTag(tags)).toBe('General');
  });

  it('falls back to the first active tag', () => {
    expect(
      getDefaultExpenseTag([
        { name: 'Food', isArchived: false },
        { name: 'Stay', isArchived: false },
      ]),
    ).toBe('Food');
  });

  it('keeps an archived current tag selectable for edit', () => {
    const options = getSelectableExpenseTags(tags, 'OldTag');
    expect(options.map((tag) => tag.name)).toEqual(['General', 'Food', 'OldTag']);
  });

  it('keeps an unknown current tag selectable when unchanged', () => {
    const options = getSelectableExpenseTags(tags, 'RenamedAway');
    expect(options.some((tag) => tag.name === 'RenamedAway')).toBe(true);
  });

  it('detects advanced split vs fast-path defaults', () => {
    expect(
      isAdvancedSplit({
        splitMethod: 'equal',
        selectedMemberCount: 3,
        memberCount: 3,
        multiPayerMode: false,
        primaryPayerId: 'u1',
        currentUserId: 'u1',
      }),
    ).toBe(false);

    expect(
      isAdvancedSplit({
        splitMethod: 'unequal',
        selectedMemberCount: 3,
        memberCount: 3,
        multiPayerMode: false,
        primaryPayerId: 'u1',
        currentUserId: 'u1',
      }),
    ).toBe(true);
  });

  it('resolves predefined item tags against active group tags', () => {
    expect(resolvePredefinedTag(tags, 'food')).toBe('Food');
    expect(resolvePredefinedTag(tags, 'taxi')).toBeNull();
  });

  it('derives the category from a quick-pick id', () => {
    expect(resolveExpenseCategory('restaurant')).toBe('food');
    expect(resolveExpenseCategory('flight')).toBe('travel');
    expect(resolveExpenseCategory('rent')).toBe('housing');
  });

  it("falls back to 'other' when no quick-pick is selected", () => {
    expect(resolveExpenseCategory(null)).toBe('other');
  });

  it("falls back to 'other' for an unknown quick-pick id", () => {
    expect(resolveExpenseCategory('not-a-real-item')).toBe('other');
  });
});
