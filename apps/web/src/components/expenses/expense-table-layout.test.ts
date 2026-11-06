import { createElement, createRef } from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it } from 'vitest';
import { useExpenseTableLayout, type ExpenseTableLayout } from './expense-table-layout';

/*
 * #942, the Designer's review: the Expense table stacked by a fixed 760 px breakpoint, so a
 * table of a long name, a split "By percentage" and two Expenses of CHF 10,000,000.00 stayed
 * inline at 1440 px (802 px of 784) and scrolled, You covering the end of Amount, and the same
 * rows overflowed stacked at 1280 (652 px of 624). The hook measures each layout in the table's
 * scroll box and keeps the first that fits. Widths here are the harness's, Chromium on macOS.
 */

/** A scroll box `clientWidth` wide, and a table as wide as its layout needs (or the box). */
function mockNodes(clientWidth: number, needs: Record<ExpenseTableLayout, number>) {
  const attributes = new Map<string, string>();
  const table = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
  };
  const box = {
    clientWidth,
    get scrollWidth() {
      const layout = (attributes.get('data-layout') ?? 'inline') as ExpenseTableLayout;
      return Math.max(clientWidth, needs[layout]);
    },
  };
  return { table, box, layout: () => attributes.get('data-layout') };
}

function layoutIn(clientWidth: number, needs: Record<ExpenseTableLayout, number>) {
  const nodes = mockNodes(clientWidth, needs);
  const box = createRef<HTMLDivElement>();
  const table = createRef<HTMLTableElement>();
  function Table() {
    useExpenseTableLayout(box, table, []);
    return createElement('div', { ref: box }, createElement('table', { ref: table }));
  }
  act(() => {
    create(createElement(Table), {
      createNodeMock: (element) => (element.type === 'table' ? nodes.table : nodes.box),
    });
  });
  return nodes.layout();
}

const triple = { inline: 742, stacked: 652, tight: 614 };

it('stacks a table whose rows don’t fit inline, though its card is wider than 760 px', () => {
  // 1440 px beside the side panel: inline (one line, 802 px) doesn't fit 784; stacked does.
  expect(layoutIn(784, { ...triple, inline: 802 })).toBe('stacked');
});

it('moves the columns closer where even the stacked ones need more than the card', () => {
  // 1280 px beside the side panel: stacked, 652 px of 624; tight, 614.
  expect(layoutIn(624, triple)).toBe('tight');
});

it('keeps a table of short names inline where it fits, as before #942', () => {
  // Banyan with "Sam Chen" and "Priya Shah" at 1280 px: 605 px of 624.
  expect(layoutIn(624, { inline: 605, stacked: 582, tight: 544 })).toBe('inline');
});

it('is tight, and scrolls, where nothing fits', () => {
  expect(layoutIn(560, triple)).toBe('tight');
});
