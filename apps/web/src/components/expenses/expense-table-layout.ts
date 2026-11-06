'use client';

import { useLayoutEffect, type RefObject } from 'react';

/**
 * How the Expense table lays its cells out, the first that fits its card (#942):
 * - `inline`: each cell's parts share a line, but for You's "lent" or "owe" above its figure in
 *   a table narrower than 760 px (#900), as before #942;
 * - `stacked`: also the Date's weekday above the day, the payer's initials above their name, and
 *   a currency code above its figure in Amount and You, at any width;
 * - `tight`: stacked, with less room between the columns.
 *
 * What fits depends on the rows (a long name, a split "By percentage", CHF 10,000,000.00), so it
 * is measured, not guessed from the card's width: at 1440 px a table of all three needs 802 px
 * inline in a 784 px card, and fits stacked; at 1280 a Group of short names fits inline, as it
 * did before #942, and keeps that look. Where none fits, the table is `tight` and scrolls.
 */
export const EXPENSE_TABLE_LAYOUTS = ['inline', 'stacked', 'tight'] as const;
export type ExpenseTableLayout = (typeof EXPENSE_TABLE_LAYOUTS)[number];

/** The first layout that fits, or the narrowest when none does. */
export function chooseExpenseTableLayout(
  fits: (layout: ExpenseTableLayout) => boolean,
): ExpenseTableLayout {
  return EXPENSE_TABLE_LAYOUTS.find(fits) ?? 'tight';
}

/**
 * Sets the table's `data-layout`, measured in its scroll box: each layout in turn, until its
 * columns fit the box. Measured again when the rows change (`rows`), the card's width changes or
 * the fonts load. Before it is measured, and where it can't be (no layout, as on the server), the
 * table has none, and is inline. The attribute is the hook's alone: React never renders it, so
 * measuring re-renders nothing.
 */
export function useExpenseTableLayout(
  scrollBox: RefObject<HTMLElement | null>,
  table: RefObject<HTMLElement | null>,
  rows: unknown,
): void {
  // Before the browser paints the rows, so a table never shows in a layout that doesn't fit.
  useLayoutEffect(() => {
    const box = scrollBox.current;
    const element = table.current;
    if (!box || !element) return;
    const measure = () => {
      if (box.clientWidth === 0) return;
      const chosen = chooseExpenseTableLayout((candidate) => {
        element.setAttribute('data-layout', candidate);
        return box.scrollWidth <= box.clientWidth;
      });
      element.setAttribute('data-layout', chosen);
    };
    measure();
    let frame = 0;
    // A frame later, so the layout it picks doesn't resize the box inside the observer's call.
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    let width = box.clientWidth;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (box.clientWidth === width) return;
            width = box.clientWidth;
            later();
          });
    observer?.observe(box);
    let live = true;
    void element.ownerDocument?.fonts?.ready.then(() => {
      if (live) later();
    });
    return () => {
      live = false;
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scrollBox, table, rows]);
}
