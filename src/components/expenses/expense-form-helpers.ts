/**
 * Pure helpers for the expense form fast path and progressive split UI.
 */

export interface GroupTagOption {
  _id?: string;
  name: string;
  isArchived: boolean;
}

export function getDefaultExpenseTag(tags: GroupTagOption[]): string {
  const active = tags.filter((tag) => !tag.isArchived);
  const general = active.find((tag) => tag.name.toLowerCase() === 'general');
  return general?.name ?? active[0]?.name ?? '';
}

/**
 * Active tags for create/edit, plus the current expense tag when it is
 * archived/renamed away — so editing still works if the tag is unchanged.
 */
export function getSelectableExpenseTags(
  tags: GroupTagOption[],
  currentTag?: string | null,
): GroupTagOption[] {
  const active = tags.filter((tag) => !tag.isArchived);
  if (!currentTag) return active;

  const hasCurrent = active.some((tag) => tag.name === currentTag);
  if (hasCurrent) return active;

  const archivedMatch = tags.find((tag) => tag.name === currentTag);
  if (archivedMatch) {
    return [...active, archivedMatch];
  }

  return [...active, { name: currentTag, isArchived: true }];
}

export function isAdvancedSplit(input: {
  splitMethod: string;
  selectedMemberCount: number;
  memberCount: number;
  multiPayerMode: boolean;
  primaryPayerId: string;
  currentUserId: string;
}): boolean {
  return (
    input.splitMethod !== 'equal' ||
    input.selectedMemberCount !== input.memberCount ||
    input.multiPayerMode ||
    input.primaryPayerId !== input.currentUserId
  );
}

export function resolvePredefinedTag(
  tags: GroupTagOption[],
  preferredTag: string,
): string | null {
  const active = tags.filter((tag) => !tag.isArchived);
  const exact = active.find((tag) => tag.name.toLowerCase() === preferredTag.toLowerCase());
  return exact?.name ?? null;
}
