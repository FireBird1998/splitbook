import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import type { GroupRead } from '@splitbook/shared/group-read';
import { queryKeyPath, type QueryKey } from '@splitbook/shared/query-keys';
import { fixtureSWRRead } from '@/lib/test-utils/fixture-swr-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';

/*
 * #820: deleting an Expense from the list. One in a currency Splitbook no longer supports, such
 * as a legacy DEM row, can't be put back (the server refuses its restore), so the list offers no
 * Undo for it and the dialog promises none. The reads and the server are stand-ins; MUI's dialog
 * renders inline, since its portal needs a browser. Fictional Group and people.
 */

const GROUP = 'c00000000000000000000001';
const navigation = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => `/groups/${GROUP}/expenses`,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

/** What each read returns, by the start of its path, the longest first. */
const reads = vi.hoisted(() => new Map<string, unknown>());
vi.mock('swr', async (original) => {
  const actual = await original<typeof import('swr')>();
  return {
    ...actual,
    default: (queryKey: QueryKey | null) => {
      const key = queryKey ? queryKeyPath(queryKey) : null;
      const prefix = [...reads.keys()]
        .sort((a, b) => b.length - a.length)
        .find((path) => key?.startsWith(path));
      return {
        data: prefix ? fixtureSWRRead(reads.get(prefix)) : undefined,
        isValidating: false,
        isLoading: !prefix,
        mutate: vi.fn(),
      };
    },
  };
});
vi.mock('@mui/material/Dialog', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', { role: 'dialog' }, children) : null,
}));
const requests = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/utils/api-fetch', () => ({
  apiFetch: async (path: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? 'GET'} ${path}`);
    return Response.json({ status: 200, data: { message: 'Expense deleted', revision: 1 } });
  },
}));

const { default: ExpenseListView } = await import('./ExpenseListView');

const ALEX = { _id: 'a00000000000000000000001', name: 'Alex Rivera', image: null };
const SAM = { _id: 'a00000000000000000000002', name: 'Sam Chen', image: null };
const TIME = '2026-09-01T00:00:00.000Z';

/** Alex paid 40.00 for both of them, in `currency`. */
const rent = (currency: string): ExpenseRead => ({
  _id: 'e00000000000000000000001',
  group: GROUP,
  description: 'Old Berlin rent',
  currency,
  amount: 40,
  amountMinor: 4000,
  moneyVersion: 1,
  date: '2026-09-17T06:00:00.000Z',
  createdAt: TIME,
  updatedAt: TIME,
  category: 'housing',
  tag: 'Stay',
  tagId: null,
  paidBy: [{ user: ALEX, amount: 40, amountMinor: 4000 }],
  splitBetween: [
    { user: ALEX, amount: 20, amountMinor: 2000 },
    { user: SAM, amount: 20, amountMinor: 2000 },
  ],
  splitMethod: 'equal',
  recurringExpense: null,
});

const group = {
  _id: GROUP,
  name: 'Berlin Trip',
  description: '',
  createdBy: ALEX._id,
  defaultCurrency: 'INR',
  currencyLocked: true,
  alternateCurrencies: [],
  latestExpenseCurrency: null,
  category: 'trip',
  startDate: null,
  endDate: null,
  isArchived: false,
  tags: [],
  createdAt: TIME,
  updatedAt: TIME,
  members: [ALEX, SAM].map((user) => ({
    user: { ...user, image: undefined },
    role: user === ALEX ? 'admin' : 'member',
    joinedAt: TIME,
  })),
} as unknown as GroupRead;

/**
 * What MUI and the list reach for once mounted (their window and document), stubbed only after
 * every module has loaded, so Emotion and SWR still treat this as the server.
 */
const view = {
  setTimeout,
  clearTimeout,
  // The open Expense lives in the address; deleting it takes it out.
  history: { pushState() {}, replaceState() {} },
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle: () => ({}),
  requestAnimationFrame: (run: () => void) => setTimeout(run, 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
};
const page = {
  defaultView: view,
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
};
const node = () => ({
  style: {},
  focus() {},
  scrollIntoView() {},
  addEventListener() {},
  removeEventListener() {},
  ownerDocument: page,
});

let renderer: ReactTestRenderer;
const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
const buttons = (label: string, within: ReactTestInstance = renderer.root) =>
  within.findAllByType('button').filter((node) => textOf(node).trim() === label);
const dialog = () => renderer.root.find((node) => node.props.role === 'dialog');

/** The list with `expense` open, then deleted from its details through the dialog. */
async function deleteFromList(expense: ExpenseRead) {
  navigation.search = `expense=${expense._id}`;
  reads.set(`/api/groups/${GROUP}/expenses/${expense._id}`, expense);
  reads.set(`/api/groups/${GROUP}/expenses`, {
    expenses: [expense],
    pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    summary: {
      count: 1,
      totalAmount: 0,
      totalsByCurrency: [{ currency: expense.currency, totalAmount: 40 }],
      userOwes: 0,
      userGetsBack: 0,
    },
  });
  await act(async () => {
    renderer = create(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(ExpenseListView, {
          groupId: GROUP,
          userId: ALEX._id,
          group,
          onAddExpense: vi.fn(),
          monthCycle: false,
        }),
      ),
      { createNodeMock: node },
    );
  });
  await act(async () => buttons('Delete')[0].props.onClick());
  const promise = textOf(dialog());
  await act(async () => buttons('Delete', dialog())[0].props.onClick());
  return { promise };
}

const snackbar = () => renderer.root.findAll((node) => textOf(node) === 'Expense deleted');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', view);
  vi.stubGlobal('document', page);
  reads.clear();
  requests.length = 0;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

it('offers Undo after deleting an Expense in a supported currency', async () => {
  const { promise } = await deleteFromList(rent('INR'));
  expect(requests).toContain(`DELETE /api/groups/${GROUP}/expenses/e00000000000000000000001`);
  expect(promise).toContain('This can be undone shortly after deletion.');
  expect(snackbar().length).toBeGreaterThan(0);
  expect(buttons('Undo')).toHaveLength(1);
});

describe('an Expense in a currency Splitbook no longer supports', () => {
  it('offers no Undo once deleted', async () => {
    await deleteFromList(rent('DEM'));
    expect(requests).toContain(`DELETE /api/groups/${GROUP}/expenses/e00000000000000000000001`);
    expect(snackbar().length).toBeGreaterThan(0);
    expect(buttons('Undo')).toHaveLength(0);
  });

  it('isn’t promised one in the dialog', async () => {
    const { promise } = await deleteFromList(rent('DEM'));
    expect(promise).not.toContain('This can be undone');
    expect(promise).toContain('Splitbook no longer supports DEM, so this can’t be undone.');
  });
});
