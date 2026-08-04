import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_TAGS,
  buildDefaultGroupTags,
  mergeMissingDefaultTags,
} from './default-tags';

describe('default group tags', () => {
  it('exposes the five trip-ready default tags', () => {
    expect(DEFAULT_GROUP_TAGS).toEqual([
      'General',
      'Food',
      'Transport',
      'Stay',
      'Activities',
    ]);
  });

  it('builds active default tag seeds', () => {
    const now = new Date('2026-03-14T00:00:00.000Z');
    expect(buildDefaultGroupTags(now)).toEqual(
      DEFAULT_GROUP_TAGS.map((name) => ({
        name,
        isArchived: false,
        createdAt: now,
      })),
    );
  });

  it('does not duplicate existing tags (case-insensitive)', () => {
    const now = new Date('2026-03-14T00:00:00.000Z');
    const existing = [
      { name: 'food', isArchived: false },
      { name: 'Custom', isArchived: false },
    ];

    const { tags, added } = mergeMissingDefaultTags(existing, now);

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

  it('is a no-op when all defaults already exist', () => {
    const existing = DEFAULT_GROUP_TAGS.map((name) => ({ name, isArchived: false }));
    const { tags, added } = mergeMissingDefaultTags(existing);
    expect(added).toEqual([]);
    expect(tags).toHaveLength(DEFAULT_GROUP_TAGS.length);
  });
});
