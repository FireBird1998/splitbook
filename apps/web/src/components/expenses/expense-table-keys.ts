'use client';

import type { KeyboardEvent } from 'react';
import { describeTarget, useShortcutSetting } from '@/lib/shortcuts/ShortcutsProvider';
import { shortcutFor, stepRow } from '@/lib/shortcuts/shortcuts';

/** A row of the table that is an Expense (not a heading between them), and its button. */
const ROW = 'tr[data-expense-id]';
const ROW_BUTTON = 'button[aria-expanded]';

/**
 * The Expense table's own shortcuts (#322), while it has focus: J and K move focus to the next
 * and previous Expense's button, and E edits the Expense whose row has focus (else the open
 * one). Enter is the focused button's own: it opens that Expense in the side panel. Every row
 * keeps its button in the Tab order, so no Expense is reachable only with J and K, and they
 * work only while single-key shortcuts are on.
 */
export function useExpenseTableKeys({
  openId,
  onEdit,
}: {
  openId: string | null;
  onEdit?: (expenseId: string) => void;
}) {
  const { singleKeys } = useShortcutSetting();

  return (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const match = shortcutFor(event.nativeEvent, 'table', {
      singleKeys,
      target: describeTarget(target),
      // Focus is in the table, so no dialog or menu holds it.
      overlayOpen: false,
    });
    if (!match) return;
    const row = target?.closest<HTMLElement>(ROW) ?? null;

    if (match.id === 'edit-expense') {
      const expenseId = row?.dataset.expenseId ?? openId;
      if (!expenseId || !onEdit) return;
      event.preventDefault();
      onEdit(expenseId);
      return;
    }

    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(ROW)];
    const next =
      rows[
        stepRow(row ? rows.indexOf(row) : -1, rows.length, match.id === 'next-expense' ? 1 : -1)
      ];
    const button = next?.querySelector<HTMLButtonElement>(ROW_BUTTON);
    if (!button) return;
    event.preventDefault();
    // The row's scroll margins keep it clear of the sticky top bar.
    button.focus({ preventScroll: true });
    button.scrollIntoView({ block: 'nearest' });
  };
}
