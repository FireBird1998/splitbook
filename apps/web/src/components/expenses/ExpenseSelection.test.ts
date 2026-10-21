import { createElement, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { ThemeProvider as EmotionThemeProvider } from '@emotion/react';
import { THEME_ID } from '@mui/material/styles';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import type { ExpenseTagChangeReply } from '@splitbook/shared/expense-tag-change';
import { exportPath } from '@splitbook/shared/api-paths';

/*
 * #610: selecting Expenses on a computer and moving them to one Tag: the selection, the table's
 * checkboxes, the panel and the request. Only the server behind `fetch` is a stand-in. The list
 * that joins them is checked in a browser (playwright-expense-access/expense-tag-change.spec.ts).
 */

const { default: ExpenseTable } = await import('./ExpenseTable');
const { default: ExpenseSelectionPanel } = await import('./ExpenseSelectionPanel');
const { useExpenseSelection } = await import('./expense-selection');
const { changeExpenseTags } = await import('./expense-tag-change');
const { exportSelectedExpenses } = await import('./expense-export');

const GROUP = 'c00000000000000000000001';
const ALEX = { _id: 'a00000000000000000000001', name: 'Alex Rivera', image: null };
const SAM = { _id: 'a00000000000000000000002', name: 'Sam Chen', image: null };
const PRIYA = { _id: 'a00000000000000000000003', name: 'Priya Shah', image: null };
const TIME = '2026-09-01T00:00:00.000Z';
const TAGS = {
  groceries: 'd00000000000000000000001',
  household: 'd00000000000000000000002',
  archived: 'd00000000000000000000003',
  deleted: 'd00000000000000000000004',
};

type Person = typeof ALEX;
function expense(
  id: number,
  description: string,
  day: number,
  paidBy: Person,
  shares: Array<[Person, number]>,
  revision: number,
): ExpenseRead {
  const total = shares.reduce((sum, [, minor]) => sum + minor, 0);
  return {
    _id: `e0000000000000000000000${id}`,
    group: GROUP,
    description,
    currency: 'INR',
    amount: total / 100,
    amountMinor: total,
    moneyVersion: 1,
    date: `2026-09-${String(day).padStart(2, '0')}T06:00:00.000Z`,
    createdAt: TIME,
    updatedAt: TIME,
    category: 'other',
    tag: 'Groceries',
    tagId: TAGS.groceries,
    paidBy: [{ user: paidBy, amount: total / 100, amountMinor: total }],
    splitBetween: shares.map(([user, minor]) => ({
      user,
      amount: minor / 100,
      amountMinor: minor,
    })),
    splitMethod: 'equal',
    recurringExpense: null,
    revision,
  } as ExpenseRead;
}

/** ₹1,240.50 Alex paid for three: Alex lent ₹827.00. */
const GROCERIES = expense(
  1,
  'Weekly groceries',
  16,
  ALEX,
  [
    [ALEX, 41350],
    [SAM, 41350],
    [PRIYA, 41350],
  ],
  2,
);
/** ₹320.00 Alex paid for three: Alex lent ₹213.32. */
const WATER = expense(
  2,
  'Water cans',
  14,
  ALEX,
  [
    [ALEX, 10668],
    [SAM, 10666],
    [PRIYA, 10666],
  ],
  0,
);
/** ₹2,860.00 Sam paid for three: Alex owes ₹953.33. */
const ELECTRICITY = expense(
  3,
  'Electricity bill',
  12,
  SAM,
  [
    [SAM, 95334],
    [ALEX, 95333],
    [PRIYA, 95333],
  ],
  5,
);
const EXPENSES = [GROCERIES, WATER, ELECTRICITY];

/** The Group's Tags as the page reads them: two active, one Archived, one deleted. */
const GROUP_TAGS = [
  { _id: TAGS.groceries, name: 'Groceries', isArchived: false, isDeleted: false },
  { _id: TAGS.household, name: 'Household', isArchived: false, isDeleted: false },
  { _id: TAGS.archived, name: 'Old bills', isArchived: true, isDeleted: false },
  { _id: TAGS.deleted, name: 'Gone', isArchived: false, isDeleted: true },
];

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

/**
 * The app's theme, through Emotion's provider: MUI's own reads the document's head on mount,
 * which this renderer has none of.
 */
const AppTheme = EmotionThemeProvider as ComponentType<{ theme: object; children?: ReactNode }>;
const themed = (element: ReactElement) =>
  createElement(AppTheme, { theme: { [THEME_ID]: createAppTheme('light') } }, element);
function show(element: ReactElement) {
  act(() => {
    renderer = create(themed(element));
  });
  return renderer!;
}
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');
const shown = () => textOf(renderer!.root).replace(/\s+/g, ' ');
const checkbox = (label: string) =>
  renderer!.root.find((node) => node.type === 'input' && node.props['aria-label'] === label);
const tick = (label: string) =>
  act(() => checkbox(label).props.onChange({ target: { checked: true }, nativeEvent: {} }));
const buttons = (label: string) =>
  renderer!.root.findAll(
    (node) =>
      node.type === 'button' &&
      (node.props['aria-label'] === label || textOf(node).trim() === label),
  );
const press = async (label: string) => {
  const [button] = buttons(label);
  expect(button, label).toBeDefined();
  await act(async () => {
    button.props.onClick({ preventDefault() {}, stopPropagation() {} });
  });
};

/** The table with a selection, as the list joins them, for a list known by `listKey`. */
function SelectingTable({
  listKey,
  expenses,
  onOpen,
}: {
  listKey: string;
  expenses: ExpenseRead[];
  onOpen: (expenseId: string) => void;
}) {
  const selection = useExpenseSelection(listKey, expenses);
  return createElement(
    'div',
    null,
    createElement(ExpenseTable, {
      expenses,
      userId: ALEX._id,
      recurringExpensesEnabled: false,
      label: 'Expenses, September 2026',
      caption: 'Expenses in September 2026.',
      openId: null,
      onToggle: onOpen,
      panelId: 'expense-panel',
      selection,
    }),
    createElement('output', null, `${selection.selected.size} selected`),
  );
}

describe('selecting Expenses on a computer (#610)', () => {
  it('ticks Expenses one at a time or every one the list shows', () => {
    show(
      createElement(SelectingTable, { listKey: 'September', expenses: EXPENSES, onOpen: vi.fn() }),
    );
    expect(checkbox('Select all 3 Expenses').props.checked).toBe(false);
    tick('Select Weekly groceries, 16 September');
    tick('Select Water cans, 14 September');
    expect(checkbox('Select Weekly groceries, 16 September').props.checked).toBe(true);
    expect(checkbox('Select Electricity bill, 12 September').props.checked).toBe(false);
    expect(shown()).toContain('2 selected');
    tick('Select all 3 Expenses');
    expect(checkbox('Select Electricity bill, 12 September').props.checked).toBe(true);
    expect(shown()).toContain('3 selected');
    // With every one selected, the header's box clears them all.
    tick('Select all 3 Expenses');
    expect(shown()).toContain('0 selected');
  });

  it('adds a clicked row to the selection while some are selected, and opens it otherwise', () => {
    const onOpen = vi.fn();
    show(createElement(SelectingTable, { listKey: 'September', expenses: EXPENSES, onOpen }));
    const row = (expense: ExpenseRead) =>
      renderer!.root.find(
        (node) => node.type === 'tr' && node.props['data-expense-id'] === expense._id,
      );
    act(() => row(WATER).props.onClick());
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(WATER._id);
    tick('Select Weekly groceries, 16 September');
    act(() => row(ELECTRICITY).props.onClick());
    expect(onOpen).toHaveBeenCalledOnce();
    expect(checkbox('Select Electricity bill, 12 September').props.checked).toBe(true);
    expect(shown()).toContain('2 selected');
  });

  it('clears the selection when the Month, the filters or the page change, and drops an Expense the list no longer shows', () => {
    const table = (listKey: string, expenses = EXPENSES) =>
      themed(createElement(SelectingTable, { listKey, expenses, onOpen: vi.fn() }));
    show(
      createElement(SelectingTable, { listKey: 'September', expenses: EXPENSES, onOpen: vi.fn() }),
    );
    tick('Select Weekly groceries, 16 September');
    tick('Select Water cans, 14 September');
    // A refresh that no longer lists Water cans keeps the rest selected.
    act(() => renderer!.update(table('September', [GROCERIES, ELECTRICITY])));
    expect(shown()).toContain('1 selected');
    act(() => renderer!.update(table('September · Groceries')));
    expect(checkbox('Select Weekly groceries, 16 September').props.checked).toBe(false);
    expect(shown()).toContain('0 selected');
    tick('Select Water cans, 14 September');
    act(() => renderer!.update(table('October')));
    expect(shown()).toContain('0 selected');
  });
});

describe('the selection panel (#610)', () => {
  const panel = (
    expenses: ExpenseRead[],
    onChangeTag = vi.fn<(tagId: string) => Promise<ExpenseTagChangeReply>>(),
    onOpen = vi.fn(),
    onExport = vi.fn<() => Promise<string>>(),
  ) =>
    show(
      createElement(ExpenseSelectionPanel, {
        expenses,
        userId: ALEX._id,
        tags: GROUP_TAGS,
        onClear: vi.fn(),
        onChangeTag,
        onOpen,
        onExport,
      }),
    );

  it('says how many are selected, their total and the member’s position on them', () => {
    panel([GROCERIES, WATER]);
    expect(shown()).toContain('2 selected · ₹1,560.50');
    expect(shown()).toContain('Weekly groceries');
    expect(shown()).toContain('Water cans');
    // In each row's own words, "you lent" and the amount.
    expect(shown()).toContain('Your position on theseyou lent₹1,040.32');
    panel(EXPENSES);
    expect(shown()).toContain('3 selected · ₹4,420.50');
    expect(shown()).toContain('Your position on theseyou lent₹86.99');
  });

  it('offers only the Group’s active Tags to move them to', async () => {
    panel([GROCERIES]);
    await press('Change Tag');
    const choices = renderer!.root
      .findAll((node) => node.type === 'button' && /^Move to /.test(node.props['aria-label'] ?? ''))
      .map((node) => node.props['aria-label']);
    expect(choices).toEqual(['Move to Groceries', 'Move to Household']);
  });

  it('marks the current Tag when every selected Expense already has it', async () => {
    const current = () =>
      renderer!.root
        .findAll((node) => node.type === 'button' && node.props['aria-current'] === 'true')
        .map((node) => node.props['aria-label']);
    panel([GROCERIES, WATER]);
    await press('Change Tag');
    expect(current()).toEqual(['Move to Groceries']);
    panel([GROCERIES, { ...ELECTRICITY, tag: 'Household', tagId: TAGS.household }]);
    await press('Change Tag');
    expect(current()).toEqual([]);
  });

  it('lists the Tags right under Change Tag, led by how many move, before Export selected', async () => {
    panel([GROCERIES, WATER]);
    await press('Change Tag');
    expect(shown()).toContain(
      'Change TagMove 2 Expenses to:GroceriesHouseholdCancelExport selected',
    );
  });

  it('moves them to the Tag, and lists what didn’t change, each with its reason and Open', async () => {
    const onOpen = vi.fn();
    const onChangeTag = vi.fn(async () => ({
      tagId: TAGS.household,
      results: [
        { expenseId: GROCERIES._id, outcome: 'changed' as const, revision: 3 },
        { expenseId: WATER._id, outcome: 'changed-elsewhere' as const },
        {
          expenseId: ELECTRICITY._id,
          outcome: 'refused' as const,
          code: 'GROUP_ARCHIVED',
          reason: 'This Group is archived.',
        },
      ],
    }));
    panel(EXPENSES, onChangeTag, onOpen);
    await press('Change Tag');
    await press('Move to Household');
    expect(onChangeTag).toHaveBeenCalledExactlyOnceWith(TAGS.household);
    expect(shown()).toContain('Moved 1 Expense to Household. 2 didn’t change:');
    expect(shown()).toContain('Someone changed it a moment ago. Open it to see the latest.');
    expect(shown()).toContain('This Group is archived.');
    await press('Open Electricity bill');
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(ELECTRICITY._id);
  });

  it('says why a whole request changed nothing', async () => {
    panel(
      [GROCERIES],
      vi.fn(async () => Promise.reject(new Error('This Group is archived.'))),
    );
    await press('Change Tag');
    await press('Move to Household');
    expect(shown()).toContain('This Group is archived.');
    expect(buttons('Change Tag')).toHaveLength(1);
  });
});

describe('Export selected (#613)', () => {
  it('exports the selected Expenses from the panel, and says the file is downloading', async () => {
    const onExport = vi.fn(async () => 'maple-house-2026-10-21-selected-expenses.csv');
    show(
      createElement(ExpenseSelectionPanel, {
        expenses: [GROCERIES, WATER],
        userId: ALEX._id,
        tags: GROUP_TAGS,
        onClear: vi.fn(),
        onChangeTag: vi.fn(),
        onOpen: vi.fn(),
        onExport,
      }),
    );
    await press('Export selected');
    expect(onExport).toHaveBeenCalledOnce();
    expect(shown()).toContain(
      'Downloading 2 Expenses as CSVmaple-house-2026-10-21-selected-expenses.csv',
    );
  });

  it('stops saying an earlier export is downloading once a Tag change starts', async () => {
    show(
      createElement(ExpenseSelectionPanel, {
        expenses: [GROCERIES, WATER],
        userId: ALEX._id,
        tags: GROUP_TAGS,
        onClear: vi.fn(),
        onChangeTag: vi.fn(async () => ({
          tagId: TAGS.household,
          results: [
            { expenseId: GROCERIES._id, outcome: 'changed' as const, revision: 3 },
            { expenseId: WATER._id, outcome: 'changed' as const, revision: 2 },
          ],
        })),
        onOpen: vi.fn(),
        onExport: vi.fn(async () => 'maple-house-2026-10-21-selected-expenses.csv'),
      }),
    );
    await press('Export selected');
    await press('Change Tag');
    await press('Move to Household');
    expect(shown()).toContain('Moved 2 Expenses to Household.');
    expect(shown()).not.toContain('Downloading');
  });

  it('downloads just their CSV with each member’s share, named for the Group and the day', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked.push(url);
        return new Response('\uFEFFDate,Description\r\n', {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition':
              'attachment; filename="maple-house-2026-10-21-selected-expenses.csv"',
          },
        });
      }),
    );
    const link = { href: '', download: '', style: {}, click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } });

    const fileName = await exportSelectedExpenses(GROUP, [GROCERIES, WATER], 'Asia/Kolkata');

    expect(asked).toEqual([
      exportPath({
        groupIds: [GROUP],
        expenseIds: [GROCERIES._id, WATER._id],
        include: ['shares'],
        format: 'csv',
        timeZone: 'Asia/Kolkata',
      }),
    ]);
    expect(fileName).toBe('maple-house-2026-10-21-selected-expenses.csv');
    expect(link.download).toBe('maple-house-2026-10-21-selected-expenses.csv');
    expect(link.click).toHaveBeenCalledOnce();
  });

  it('says why a refused export downloaded nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Forbidden', status: 403 }, { status: 403 })),
    );
    await expect(exportSelectedExpenses(GROUP, [GROCERIES], 'UTC')).rejects.toThrow(
      'You can only export Groups you’re in. Reload the page to see your Groups.',
    );
  });
});

describe('the Tag change request (#610)', () => {
  it('sends the Tag and each Expense’s revision in one request, and reads each outcome', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, init });
        return Response.json({
          status: 200,
          data: {
            tagId: TAGS.household,
            results: [
              { expenseId: GROCERIES._id, outcome: 'changed', revision: 3 },
              { expenseId: WATER._id, outcome: 'unavailable' },
              { expenseId: ELECTRICITY._id, outcome: 'something-new' },
            ],
          },
        });
      }),
    );
    const reply = await changeExpenseTags(GROUP, TAGS.household, EXPENSES);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`/api/groups/${GROUP}/expenses/tag-change`);
    expect(sent[0].init.method).toBe('POST');
    expect(JSON.parse(String(sent[0].init.body))).toEqual({
      tagId: TAGS.household,
      expenses: [
        { id: GROCERIES._id, revision: 2 },
        { id: WATER._id, revision: 0 },
        { id: ELECTRICITY._id, revision: 5 },
      ],
    });
    expect(reply.results.map(({ outcome }) => outcome)).toEqual([
      'changed',
      'unavailable',
      'refused',
    ]);
  });

  it('says in member words why a refused request changed nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: 'Tag must be an active group tag', code: 'INVALID_TAG', status: 422 },
          { status: 422 },
        ),
      ),
    );
    await expect(changeExpenseTags(GROUP, TAGS.archived, [GROCERIES])).rejects.toThrow(
      'That Tag isn’t active any more. Choose another.',
    );
  });
});
