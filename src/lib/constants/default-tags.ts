/**
 * Active tags seeded on every new group so the first expense is never blocked.
 */
export const DEFAULT_GROUP_TAGS = ['General', 'Food', 'Transport', 'Stay', 'Activities'] as const;

export type DefaultGroupTag = (typeof DEFAULT_GROUP_TAGS)[number];

export interface DefaultTagSeed {
  name: string;
  isArchived: boolean;
  createdAt: Date;
}

/**
 * Build the default tag subdocuments for a brand-new group.
 */
export function buildDefaultGroupTags(now: Date = new Date()): DefaultTagSeed[] {
  return DEFAULT_GROUP_TAGS.map((name) => ({
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
  now: Date = new Date(),
): { tags: Array<T | DefaultTagSeed>; added: string[] } {
  const existingNames = new Set(existing.map((tag) => tag.name.trim().toLowerCase()));
  const tags: Array<T | DefaultTagSeed> = [...existing];
  const added: string[] = [];

  for (const name of DEFAULT_GROUP_TAGS) {
    const key = name.toLowerCase();
    if (existingNames.has(key)) continue;
    tags.push({ name, isArchived: false, createdAt: now });
    existingNames.add(key);
    added.push(name);
  }

  return { tags, added };
}
