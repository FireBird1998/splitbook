/**
 * Group theme registry — a pure, derived descriptor keyed by the persisted
 * `Group.category`. Nothing new is stored; every group already has a theme.
 *
 * Consumers read the theme and branch on its fields; they never switch on the
 * raw category string. "What does Household look like?" is answerable by
 * reading this one file.
 */

import type { GroupCategory } from '@/types';
import { DEFAULT_GROUP_TAGS_BY_CATEGORY } from '@/lib/constants/default-tags';

export interface GroupTheme {
  /** Stored `Group.category` value — unchanged. */
  id: GroupCategory;
  /** Display name. `home` → "Household". */
  label: string;
  /** One line shown in the creation-form theme picker. */
  tagline: string;
  /** One-line "what you get" shown under the tagline in the theme picker. */
  perk: string;
  icon: string;
  /** Which header component the group detail page and dashboard card render. */
  header: 'strip' | 'neutral';
  /** Whether the group is date-bounded or runs indefinitely. */
  dates: 'bounded' | 'openEnded';
  /** The one distinctive surface this theme adds. */
  signature: 'checklist' | 'monthCycle' | 'none';
  /** Whether the theme supports recurring expense templates (Household only). */
  recurringExpenses: boolean;
  /** Tags seeded on creation. */
  defaultTags: readonly string[];
  /** Nouns for generated copy, so no component hardcodes "trip". */
  nouns: { singular: string; plural: string };
  /** Placeholder for the name field in the creation form. */
  namePlaceholder: string;
}

export const GROUP_THEMES: Record<GroupCategory, GroupTheme> = {
  trip: {
    id: 'trip',
    label: 'Trip',
    tagline: 'A bounded getaway with a crew — travel, stays, and shared meals.',
    perk: 'Boarding-pass header, setup checklist, and a date range.',
    icon: '✈️',
    header: 'strip',
    dates: 'bounded',
    signature: 'checklist',
    recurringExpenses: false,
    defaultTags: DEFAULT_GROUP_TAGS_BY_CATEGORY.trip,
    nouns: { singular: 'trip', plural: 'trips' },
    namePlaceholder: 'e.g. Goa Weekend',
  },
  home: {
    id: 'home',
    label: 'Household',
    tagline: 'A long-running home ledger — rent, groceries, and utilities.',
    perk: 'Month-by-month totals and a running balance.',
    icon: '🏠',
    header: 'neutral',
    dates: 'openEnded',
    signature: 'monthCycle',
    recurringExpenses: true,
    defaultTags: DEFAULT_GROUP_TAGS_BY_CATEGORY.home,
    nouns: { singular: 'household', plural: 'households' },
    namePlaceholder: 'e.g. Flat 302',
  },
  couple: {
    id: 'couple',
    label: 'Couple',
    tagline: 'Shared spending for two — dinners, gifts, and everyday costs.',
    perk: 'A clean shared ledger with a running balance.',
    icon: '💑',
    header: 'neutral',
    dates: 'openEnded',
    signature: 'none',
    recurringExpenses: false,
    defaultTags: DEFAULT_GROUP_TAGS_BY_CATEGORY.couple,
    nouns: { singular: 'group', plural: 'groups' },
    namePlaceholder: 'e.g. Alex & Sam',
  },
  work: {
    id: 'work',
    label: 'Work',
    tagline: 'Team and project expenses — travel, meals, and supplies.',
    perk: 'A clean shared ledger with a running balance.',
    icon: '💼',
    header: 'neutral',
    dates: 'openEnded',
    signature: 'none',
    recurringExpenses: false,
    defaultTags: DEFAULT_GROUP_TAGS_BY_CATEGORY.work,
    nouns: { singular: 'group', plural: 'groups' },
    namePlaceholder: 'e.g. Q3 Offsite',
  },
  other: {
    id: 'other',
    label: 'General',
    tagline: 'Any shared pool of money that is not a trip, home, or team.',
    perk: 'A clean shared ledger with a running balance.',
    icon: '📋',
    header: 'neutral',
    dates: 'openEnded',
    signature: 'none',
    recurringExpenses: false,
    defaultTags: DEFAULT_GROUP_TAGS_BY_CATEGORY.other,
    nouns: { singular: 'group', plural: 'groups' },
    namePlaceholder: 'e.g. Sunday Football',
  },
};

/** All themes in picker display order. */
export const GROUP_THEME_LIST: readonly GroupTheme[] = Object.values(GROUP_THEMES);

/**
 * Resolve the theme for a stored category. Unknown values (defensive: old
 * documents) fall back to the General theme.
 */
export function getGroupTheme(category: GroupCategory): GroupTheme {
  return GROUP_THEMES[category] ?? GROUP_THEMES.other;
}
