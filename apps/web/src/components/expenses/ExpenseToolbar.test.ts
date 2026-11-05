import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';

/*
 * The Expenses filter's amount range, opened. MUI's popover renders inline, since its portal
 * needs a browser. Fictional Group and people.
 */

vi.mock('@mui/material/Popover', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', { role: 'dialog' }, children) : null,
}));

const { default: ExpenseToolbar } = await import('./ExpenseToolbar');
const { DEFAULT_EXPENSE_LIST_QUERY } = await import('./expense-list-query');

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // MUI's theme looks for the page's head, and its menus listen to the window; there are none.
  vi.stubGlobal('document', { querySelector: () => null });
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

/** The node's text as read: the pieces of one run together, elements apart. */
const textOf = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : ` ${textOf(child)} `))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

/** What the lowest and highest amount fields show before what is typed, once the range opens. */
function amountPrefixes(currency: string) {
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(ExpenseToolbar, {
          query: DEFAULT_EXPENSE_LIST_QUERY,
          onChange: vi.fn(),
          groupName: 'Kraków',
          currency,
          members: [{ id: 'a00000000000000000000001', label: 'You' }],
          tags: [],
          dateWindows: true,
        }),
      ),
      { createNodeMock: () => ({ focus() {}, addEventListener() {}, removeEventListener() {} }) },
    );
  });
  const chip = renderer!.root.find(
    (node) =>
      node.type === 'button' &&
      node.props['aria-haspopup'] === 'dialog' &&
      textOf(node).startsWith('Amount'),
  );
  act(() => chip.props.onClick({ currentTarget: {} }));
  const dialog = renderer!.root.find((node) => node.props.role === 'dialog');
  return dialog
    .findAll((node) => node.type === 'span' && node.props['aria-hidden'] === true)
    .map(textOf);
}

// #884: the fields said "zł" where the range itself says "PLN 500.00 – PLN 1,000.00".
describe('the amount range’s fields (#884)', () => {
  it.each([
    ['PLN', 'PLN'],
    ['CZK', 'CZK'],
    ['EUR', '€'],
    ['INR', '₹'],
  ])('name %s as its amounts do: %s', (currency, prefix) => {
    expect(amountPrefixes(currency)).toEqual([prefix, prefix]);
  });
});
