import { describe, expect, it } from 'vitest';
import {
  CLEARED_FILTERS,
  DEFAULT_EXPENSE_LIST_QUERY,
  activeFilterCount,
  customRangeError,
  expenseListFilters,
  openExpenseQuery,
  readAmount,
  readExpenseListQuery,
  readOpenExpense,
  writeExpenseListQuery,
  writeOpenExpense,
  type ExpenseListContext,
} from './expense-list-query';

// Fictional ids only.
const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const STRANGER = 'a00000000000000000000099';
const RENT = 'd00000000000000000000001';
const FOOD = 'd00000000000000000000002';

const household: ExpenseListContext = {
  memberIds: [ALEX, SAM],
  tagIds: [RENT, FOOD],
  currency: 'INR',
  dateWindows: false,
};
const trip: ExpenseListContext = { ...household, dateWindows: true };

const read = (query: string, context = household) =>
  readExpenseListQuery(new URLSearchParams(query), context);

describe('reading the view from the address', () => {
  it('is the default view with nothing in the address', () => {
    expect(read('')).toEqual(DEFAULT_EXPENSE_LIST_QUERY);
  });

  it('reads every part the toolbar writes', () => {
    expect(
      read(
        `search=water%20cans&paidBy=${SAM}&tag=${RENT}&involvesMe=1&min=500&max=1249.50` +
          '&sort=largest&page=3&when=custom&from=2026-09-01&to=2026-09-30',
        trip,
      ),
    ).toEqual({
      search: 'water cans',
      paidBy: SAM,
      tag: RENT,
      involvesMe: true,
      min: '500',
      max: '1249.50',
      sort: 'largest',
      when: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
      page: 3,
    });
  });

  it('drops what this Group can’t show: someone outside it, a Tag it doesn’t have', () => {
    expect(read(`paidBy=${STRANGER}&tag=${'d'.repeat(24)}`)).toMatchObject({
      paidBy: null,
      tag: null,
    });
  });

  it('drops an amount that isn’t a plain amount in the Group’s currency', () => {
    for (const bad of ['-5', '1e3', 'ten', '10.005', '1.', ' ', '₹500'])
      expect(read(`min=${encodeURIComponent(bad)}`).min, bad).toBeNull();
    expect(read('min=0.5').min).toBe('0.5');
    expect(readAmount('1500', 'JPY')).toBe('1500');
    expect(readAmount('1500.5', 'JPY')).toBeNull();
  });

  it('drops a range the wrong way round', () => {
    expect(read('min=500&max=100')).toMatchObject({ min: null, max: null });
    expect(read('min=500&max=500')).toMatchObject({ min: '500', max: '500' });
  });

  it('reads an unknown sort as newest first, and a page below 2 as the first', () => {
    expect(read('sort=random').sort).toBe('newest');
    for (const page of ['0', '-2', '1.5', 'two', '1'])
      expect(read(`page=${page}`).page, page).toBe(1);
  });

  it('reads the date quick-filters only where they apply, and custom days only for a custom window', () => {
    expect(read('when=thisWeek').when).toBeNull();
    expect(read('when=thisWeek', trip).when).toBe('thisWeek');
    expect(read('when=someday', trip).when).toBeNull();
    expect(read('when=lastMonth&from=2026-09-01', trip).from).toBeNull();
    expect(read('when=custom&from=2026-13-01&to=2026-09-31', trip)).toMatchObject({
      from: null,
      to: '2026-09-31',
    });
  });

  it('keeps a search as it was typed, to the longest a description can be', () => {
    expect(read('search=%20Tea%20&%20toast').search).toBe(' Tea ');
    expect(read(`search=${'a'.repeat(300)}`).search).toHaveLength(200);
  });
});

describe('writing a change to the address', () => {
  it('sets what changed and leaves defaults out', () => {
    expect(writeExpenseListQuery('', { paidBy: SAM, involvesMe: true, sort: 'oldest' })).toBe(
      `paidBy=${SAM}&involvesMe=1&sort=oldest`,
    );
    expect(writeExpenseListQuery('sort=oldest&involvesMe=1', { sort: 'newest' })).toBe(
      'involvesMe=1',
    );
    expect(writeExpenseListQuery('involvesMe=1', { involvesMe: false })).toBe('');
  });

  it('keeps every other parameter, such as a Household’s Month', () => {
    expect(writeExpenseListQuery('month=2026-08&action=add-expense', { search: 'rent' })).toBe(
      'month=2026-08&action=add-expense&search=rent',
    );
  });

  it('goes back to the first page when anything but the page changes', () => {
    expect(writeExpenseListQuery('page=4&tag=x', { tag: RENT })).toBe(`tag=${RENT}`);
    expect(writeExpenseListQuery('page=4', { page: 5 })).toBe('page=5');
    expect(writeExpenseListQuery('page=4', { page: 1 })).toBe('');
  });

  it('drops a custom window’s days with the custom window', () => {
    expect(writeExpenseListQuery('when=custom&from=2026-09-01&to=2026-09-02', { when: null })).toBe(
      '',
    );
    expect(
      writeExpenseListQuery('when=custom&from=2026-09-01&to=2026-09-02', { when: 'thisWeek' }),
    ).toBe('when=thisWeek');
    expect(
      writeExpenseListQuery('', { when: 'custom', from: '2026-09-01', to: '2026-09-02' }),
    ).toBe('when=custom&from=2026-09-01&to=2026-09-02');
  });

  it('clears every filter but keeps the sort and the Month', () => {
    expect(
      writeExpenseListQuery(
        `month=2026-08&search=rent&paidBy=${SAM}&involvesMe=1&min=1&max=2&sort=largest&page=2`,
        CLEARED_FILTERS,
      ),
    ).toBe('month=2026-08&sort=largest');
  });

  it('reads back what it wrote', () => {
    const change = {
      search: 'tea & toast?',
      paidBy: ALEX,
      tag: FOOD,
      involvesMe: true,
      min: '0.50',
      max: '99',
      sort: 'smallest' as const,
      page: 2,
    };
    expect(read(writeExpenseListQuery('', change))).toEqual({
      ...DEFAULT_EXPENSE_LIST_QUERY,
      ...change,
    });
  });
});

describe('the filters in use', () => {
  it('counts search, Paid by, Tag, involves me, the amount range and the date window', () => {
    expect(activeFilterCount(DEFAULT_EXPENSE_LIST_QUERY)).toBe(0);
    expect(
      activeFilterCount({ ...DEFAULT_EXPENSE_LIST_QUERY, sort: 'largest', page: 3, search: '  ' }),
    ).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_EXPENSE_LIST_QUERY,
        search: 'rent',
        paidBy: SAM,
        tag: RENT,
        involvesMe: true,
        max: '10',
        when: 'thisWeek',
      }),
    ).toBe(6);
  });
});

describe('a custom date window', () => {
  const custom = (from: string | null, to: string | null) =>
    customRangeError({ when: 'custom', from, to });

  it('needs both days, in order, and at most 31 days', () => {
    expect(custom(null, '2026-09-02')).toBe('Choose the first and last day.');
    expect(custom('2026-09-03', '2026-09-02')).toBe(
      'The first day must be on or before the last day.',
    );
    expect(custom('2026-09-01', '2026-10-02')).toBe('Choose 31 days or fewer.');
    expect(custom('2026-09-01', '2026-10-01')).toBeNull();
    expect(custom('2026-09-02', '2026-09-02')).toBeNull();
    expect(customRangeError({ when: 'thisWeek', from: null, to: null })).toBeNull();
  });
});

describe('the Expense list read for a view', () => {
  it('sends the filters, the sort and "involves me" as the viewer', () => {
    expect(
      expenseListFilters(
        {
          ...DEFAULT_EXPENSE_LIST_QUERY,
          search: ' rent ',
          paidBy: SAM,
          tag: RENT,
          involvesMe: true,
          min: '500',
          sort: 'largest',
          page: 2,
        },
        { userId: ALEX, pageSize: 50 },
      ),
    ).toEqual({
      page: 2,
      limit: 50,
      quickFilter: undefined,
      search: 'rent',
      paidByUser: SAM,
      tagId: RENT,
      sortBy: 'amount',
      sortOrder: 'desc',
      involvesUser: ALEX,
      amountMin: '500',
      amountMax: undefined,
    });
  });

  it('sends a Household’s Month as its dates, and otherwise the date window', () => {
    const month = { dateFrom: '2026-08-31T18:30:00.000Z', dateTo: '2026-09-30T18:29:59.999Z' };
    expect(
      expenseListFilters(
        { ...DEFAULT_EXPENSE_LIST_QUERY, when: 'thisWeek' },
        { userId: ALEX, pageSize: 50, month },
      ),
    ).toMatchObject({ ...month, sortBy: 'date', sortOrder: 'desc' });
    expect(
      expenseListFilters(
        { ...DEFAULT_EXPENSE_LIST_QUERY, when: 'lastWeek' },
        { userId: ALEX, pageSize: 50 },
      ),
    ).toMatchObject({ quickFilter: 'lastWeek' });
    expect(
      expenseListFilters(
        { ...DEFAULT_EXPENSE_LIST_QUERY, when: 'custom', from: '2026-09-01', to: '2026-09-05' },
        { userId: ALEX, pageSize: 50 },
      ),
    ).toMatchObject({ dateFrom: '2026-09-01', dateTo: '2026-09-05', sortOrder: 'desc' });
  });
});

describe('the open Expense in the address (#311)', () => {
  const OPEN = 'e00000000000000000000007';

  it('reads an Expense id, and nothing that couldn’t be one', () => {
    expect(readOpenExpense(new URLSearchParams(`expense=${OPEN}`))).toBe(OPEN);
    for (const query of ['', 'expense=', 'expense=7', `expense=${OPEN}x`, 'expense=../balances'])
      expect(readOpenExpense(new URLSearchParams(query))).toBeNull();
  });

  it('opens and closes beside the view, which stays as it was, page included', () => {
    const view = `month=2026-08&search=rent&paidBy=${SAM}&page=2`;
    expect(writeOpenExpense(view, OPEN)).toBe(`${view}&expense=${OPEN}`);
    expect(writeOpenExpense(`${view}&expense=${OPEN}`, null)).toBe(view);
    expect(writeOpenExpense(`expense=${OPEN}`, null)).toBe('');
  });

  it('stays open when the view changes, and is never a filter', () => {
    expect(writeExpenseListQuery(`expense=${OPEN}&page=3`, { tag: RENT })).toBe(
      `expense=${OPEN}&tag=${RENT}`,
    );
    expect(read(`expense=${OPEN}`)).toEqual(DEFAULT_EXPENSE_LIST_QUERY);
    expect(activeFilterCount(read(`expense=${OPEN}`))).toBe(0);
  });

  it('links to an Expense open, with the list searched for it', () => {
    expect(openExpenseQuery(OPEN)).toBe(`expense=${OPEN}`);
    const query = openExpenseQuery(OPEN, { search: 'Tea & toast?' });
    expect(query).toBe(`expense=${OPEN}&search=Tea%20%26%20toast%3F`);
    expect(readOpenExpense(new URLSearchParams(query))).toBe(OPEN);
    expect(read(query).search).toBe('Tea & toast?');
  });
});
