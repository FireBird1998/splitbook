import { describe, expect, it } from 'vitest';
import { getGroupTheme, GROUP_THEMES, GROUP_THEME_LIST } from './group-themes';
import type { GroupCategory } from './types';

const ALL_CATEGORIES: GroupCategory[] = ['trip', 'home', 'couple', 'work', 'other'];

describe('getGroupTheme', () => {
  it('resolves every stored category to a theme with a matching id', () => {
    for (const category of ALL_CATEGORIES) {
      expect(getGroupTheme(category).id).toBe(category);
    }
  });

  it('labels the stored `home` value as "Household"', () => {
    const theme = getGroupTheme('home');
    expect(theme.label).toBe('Household');
    expect(theme.nouns).toEqual({ singular: 'household', plural: 'households' });
  });

  it('keeps trip chrome trip-only', () => {
    expect(getGroupTheme('trip').header).toBe('strip');
    expect(getGroupTheme('trip').signature).toBe('checklist');
    expect(getGroupTheme('trip').dates).toBe('bounded');

    for (const category of ALL_CATEGORIES.filter((c) => c !== 'trip')) {
      expect(getGroupTheme(category).header).toBe('neutral');
      expect(getGroupTheme(category).signature).not.toBe('checklist');
      expect(getGroupTheme(category).dates).toBe('openEnded');
    }
  });

  it('gives Household the month-cycle signature', () => {
    expect(getGroupTheme('home').signature).toBe('monthCycle');
  });

  it('gates recurring expense templates to Household only', () => {
    expect(getGroupTheme('home').recurringExpenses).toBe(true);
    for (const category of ALL_CATEGORIES.filter((c) => c !== 'home')) {
      expect(getGroupTheme(category).recurringExpenses).toBe(false);
    }
  });

  it('keeps "General" in every theme’s default tags so the first expense is never blocked', () => {
    for (const category of ALL_CATEGORIES) {
      expect(getGroupTheme(category).defaultTags).toContain('General');
    }
  });

  it('falls back to the General theme for unknown stored values', () => {
    expect(getGroupTheme('castle' as GroupCategory).id).toBe('other');
  });

  it('exposes the five themes in picker order', () => {
    expect(GROUP_THEME_LIST.map((theme) => theme.id)).toEqual(ALL_CATEGORIES);
    expect(Object.keys(GROUP_THEMES)).toHaveLength(5);
  });
});
