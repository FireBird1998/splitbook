/**
 * Pure helpers for the expense form fast path and progressive split UI.
 */

import { getPredefinedItem } from '@splitbook/shared/predefined-items';
import {
  assertStoredExpenseMoney,
  readStoredAmountMinor,
  toMajorAmount,
} from '@splitbook/shared/exact-money';

/** Stored amounts may carry legacy binary tails; new user input remains strict. */
export function getStoredExpenseMoneyFields(
  expense: Parameters<typeof assertStoredExpenseMoney>[0],
): { amount: string; paidBy: string[]; splitBetween: string[] } {
  assertStoredExpenseMoney(expense);
  const inputAmount = (value: { amount?: number; amountMinor?: number }): string =>
    String(
      toMajorAmount(
        readStoredAmountMinor({
          ...value,
          currency: expense.currency,
          moneyVersion: expense.moneyVersion,
        }),
        expense.currency,
      ),
    );
  return {
    amount: inputAmount(expense),
    paidBy: expense.paidBy.map(inputAmount),
    splitBetween: expense.splitBetween.map(inputAmount),
  };
}

export interface GroupTagOption {
  _id?: string;
  name: string;
  isArchived: boolean;
  isDeleted?: boolean;
}

export const tagOptionValue = (tag: GroupTagOption): string => tag._id ?? tag.name;

export function getDefaultExpenseTag(tags: GroupTagOption[]): string {
  const active = tags.filter((tag) => !tag.isArchived && !tag.isDeleted);
  const general = active.find((tag) => tag.name.toLowerCase() === 'general');
  const selected = general ?? active[0];
  return selected ? tagOptionValue(selected) : '';
}

/**
 * Active tags for create/edit, plus the current expense tag when it is
 * archived/renamed away — so editing still works if the tag is unchanged.
 */
export function getSelectableExpenseTags(
  tags: GroupTagOption[],
  currentTag?: string | null,
  currentTagId?: string | null,
): GroupTagOption[] {
  const active = tags.filter((tag) => !tag.isArchived && !tag.isDeleted);
  if (!currentTag && !currentTagId) return active;

  const matches = (tag: GroupTagOption) =>
    currentTagId ? tag._id === currentTagId : tag.name === currentTag;
  const hasCurrent = active.some(matches);
  if (hasCurrent) return active;

  const archivedMatch = tags.find(matches);
  if (archivedMatch) {
    return [...active, archivedMatch];
  }

  return [
    ...active,
    { _id: currentTagId ?? undefined, name: currentTag ?? 'Unavailable Tag', isArchived: true },
  ];
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

export function resolvePredefinedTag(tags: GroupTagOption[], preferredTag: string): string | null {
  const active = tags.filter((tag) => !tag.isArchived && !tag.isDeleted);
  const exact = active.find((tag) => tag.name.toLowerCase() === preferredTag.toLowerCase());
  return exact ? tagOptionValue(exact) : null;
}

/**
 * Category is derived, never asked for: a quick-pick sets it, anything else
 * (custom description, unknown id) falls back to 'other'.
 */
export function resolveExpenseCategory(predefinedItemId: string | null): string {
  if (!predefinedItemId) return 'other';
  return getPredefinedItem(predefinedItemId)?.category ?? 'other';
}
