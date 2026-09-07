import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_TAGS,
  DEFAULT_GROUP_TAGS_BY_CATEGORY,
  buildDefaultGroupTags,
  defaultTagsForCategory,
  mergeMissingDefaultTags,
} from './default-tags';
import type { GroupCategory } from './types';

describe('default group tags', () => {
  it('keeps the five trip-ready default tags as the canonical trip list', () => {
    expect(DEFAULT_GROUP_TAGS).toEqual(['General', 'Food', 'Transport', 'Stay', 'Activities']);
    expect(DEFAULT_GROUP_TAGS_BY_CATEGORY.trip).toEqual(DEFAULT_GROUP_TAGS);
  });

  it('scopes default tags per theme, with General in every list', () => {
    expect(defaultTagsForCategory('home')).toEqual([
      'General',
      'Rent',
      'Utilities',
      'Groceries',
      'Internet',
      'Household',
    ]);
    expect(defaultTagsForCategory('couple')).toContain('Dining');
    expect(defaultTagsForCategory('work')).toContain('Client');
    expect(defaultTagsForCategory('other')).toEqual(['General', 'Food', 'Transport', 'Other']);

    for (const category of Object.keys(DEFAULT_GROUP_TAGS_BY_CATEGORY) as GroupCategory[]) {
      expect(defaultTagsForCategory(category)).toContain('General');
    }
  });

  it('falls back to the General theme list for unknown categories', () => {
    expect(defaultTagsForCategory('castle' as GroupCategory)).toEqual(
      DEFAULT_GROUP_TAGS_BY_CATEGORY.other,
    );
  });

  it('builds active default tag seeds for the given category', () => {
    const now = new Date('2026-03-14T00:00:00.000Z');
    expect(buildDefaultGroupTags('trip', now)).toEqual(
      DEFAULT_GROUP_TAGS.map((name) => ({
        name,
        isArchived: false,
        createdAt: now,
      })),
    );
    expect(buildDefaultGroupTags('home', now).map((tag) => tag.name)).toEqual([
      'General',
      'Rent',
      'Utilities',
      'Groceries',
      'Internet',
      'Household',
    ]);
  });

  it('does not duplicate existing tags (case-insensitive)', () => {
    const now = new Date('2026-03-14T00:00:00.000Z');
    const existing = [
      { name: 'food', isArchived: false },
      { name: 'Custom', isArchived: false },
    ];

    const { tags, added } = mergeMissingDefaultTags(existing, 'trip', now);

    expect(added).toEqual(['General', 'Transport', 'Stay', 'Activities']);
    expect(tags.map((tag) => tag.name)).toEqual([
      'food',
      'Custom',
      'General',
      'Transport',
      'Stay',
      'Activities',
    ]);
    expect(tags.filter((tag) => tag.name.toLowerCase() === 'food')).toHaveLength(1);
  });

  it('merges the category’s own list, not the trip list', () => {
    const { added } = mergeMissingDefaultTags([], 'home');
    expect(added).toEqual(['General', 'Rent', 'Utilities', 'Groceries', 'Internet', 'Household']);
    expect(added).not.toContain('Stay');
  });

  it('is a no-op when all defaults already exist', () => {
    const existing = DEFAULT_GROUP_TAGS.map((name) => ({ name, isArchived: false }));
    const { tags, added } = mergeMissingDefaultTags(existing, 'trip');
    expect(added).toEqual([]);
    expect(tags).toHaveLength(DEFAULT_GROUP_TAGS.length);
  });
});
