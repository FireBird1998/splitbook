import type { GroupCategory } from '@/types';

/**
 * Trip-themed default tags. Kept as the canonical trip list — the demo seed
 * and existing tests reference it directly.
 */
export const DEFAULT_GROUP_TAGS = ['General', 'Food', 'Transport', 'Stay', 'Activities'] as const;

export type DefaultGroupTag = (typeof DEFAULT_GROUP_TAGS)[number];

/**
 * Active tags seeded on every new group so the first expense is never blocked,
 * scoped per group theme. `General` stays in every list.
 */
export const DEFAULT_GROUP_TAGS_BY_CATEGORY: Record<GroupCategory, readonly string[]> = {
  trip: DEFAULT_GROUP_TAGS,
  home: ['General', 'Rent', 'Utilities', 'Groceries', 'Internet', 'Household'],
  couple: ['General', 'Food', 'Dining', 'Travel', 'Gifts', 'Bills'],
  work: ['General', 'Travel', 'Meals', 'Supplies', 'Client'],
  other: ['General', 'Food', 'Transport', 'Other'],
};

/**
 * Default tag names for a category. Unknown values (old documents) fall back
 * to the General theme list.
 */
export function defaultTagsForCategory(category: GroupCategory): readonly string[] {
  return DEFAULT_GROUP_TAGS_BY_CATEGORY[category] ?? DEFAULT_GROUP_TAGS_BY_CATEGORY.other;
}

export interface DefaultTagSeed {
  name: string;
  isArchived: boolean;
  createdAt: Date;
}

/**
 * Build the default tag subdocuments for a brand-new group.
 */
export function buildDefaultGroupTags(
  category: GroupCategory,
  now: Date = new Date(),
): DefaultTagSeed[] {
  return defaultTagsForCategory(category).map((name) => ({
    name,
    isArchived: false,
    createdAt: now,
  }));
}

/**
 * Idempotently append any missing default tags (case-insensitive by name).
 * Does not unarchive or rename existing tags.
 */
export function mergeMissingDefaultTags<T extends { name: string }>(
  existing: T[],
  category: GroupCategory,
  now: Date = new Date(),
): { tags: Array<T | DefaultTagSeed>; added: string[] } {
  const existingNames = new Set(existing.map((tag) => tag.name.trim().toLowerCase()));
  const tags: Array<T | DefaultTagSeed> = [...existing];
  const added: string[] = [];

  for (const name of defaultTagsForCategory(category)) {
    const key = name.toLowerCase();
    if (existingNames.has(key)) continue;
    tags.push({ name, isArchived: false, createdAt: now });
    existingNames.add(key);
    added.push(name);
  }

  return { tags, added };
}
