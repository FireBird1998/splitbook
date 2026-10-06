import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ExpenseWindowSummary,
  GroupFinancialState,
  KeptDraft,
  MobileExpense,
  MobileGroup,
} from '../data/types';
import { GroupExpensesView } from './group-expenses';
import { refreshedLabel } from './refresh-feedback';

// #116: the Expenses destination's summary, rows, pagination and draft states, rendered.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const you = 'a00000000000000000000001',
  sam = 'a00000000000000000000002',
  priya = 'a00000000000000000000003';
const names: Record<string, string> = {
  [you]: 'Alex Rivera',
  [sam]: 'Sam Chen',
  [priya]: 'Priya Shah',
};
const person = (id: string) => ({ id, name: names[id], image: null });
const groupId = 'b00000000000000000000001';
// Wednesday 30 September 2026, midday on this device.
const now = new Date(2026, 8, 30, 12).getTime();
const at = new Date(2026, 8, 30, 10, 42).getTime();
const group = (category: MobileGroup['category'] = 'home'): MobileGroup => ({
  id: groupId,
  name: category === 'home' ? 'Maple House' : 'Goa Friends Trip',
  description: '',
  category,
  defaultCurrency: 'INR',
  members: [you, sam, priya].map((id) => ({
    user: { ...person(id), email: `${id}@example.test` },
    role: 'member' as const,
    joinedAt: new Date(at),
  })),
  startDate: null,
  endDate: null,
  createdAt: new Date(at),
  updatedAt: new Date(at),
});
const expense = (
  id: string,
  description: string,
  day: number,
  paidBy: [string, number][],
  splitBetween: [string, number][],
  tag = 'Groceries',
): MobileExpense => {
  const amountMinor = paidBy.reduce((total, [, minor]) => total + minor, 0);
  const rows = (allocations: [string, number][]) =>
    allocations.map(([user, minor]) => ({
      user: person(user),
      amountMinor: minor,
      amount: minor / 100,
    }));
  return {
    id,
    groupId,
    description,
    currency: 'INR',
    amount: amountMinor / 100,
    amountMinor,
    date: new Date(2026, 8, day, 12),
    createdAt: new Date(at),
    updatedAt: new Date(at),
    category: 'food',
    tag,
    tagId: 'c00000000000000000000001',
    paidBy: rows(paidBy),
    splitBetween: rows(splitBetween),
    splitMethod: 'equal',
  };
};
/** Alex, Sam and Priya's shares, in paise. */
const thirds = (paise: [number, number, number]): [string, number][] => [
  [you, paise[0]],
  [sam, paise[1]],
  [priya, paise[2]],
];
const groceries = expense(
  'e00000000000000000000001',
  'Weekly groceries',
  30,
  [[you, 124950]],
  thirds([41650, 41650, 41650]),
);
const electricity = expense(
  'e00000000000000000000002',
  'Electricity bill',
  29,
  [[sam, 286000]],
  thirds([95333, 95334, 95333]),
  'Utilities',
);
const lunch = expense(
  'e00000000000000000000003',
  'Beach shack lunch',
  29,
  [[priya, 186000]],
  [
    [sam, 93000],
    [priya, 93000],
  ],
  'Dining',
);
const villa = expense(
  'e00000000000000000000004',
  'Villa stay',
  27,
  [
    [you, 200000],
    [sam, 100000],
  ],
  thirds([100000, 100000, 100000]),
  'Stay',
);
const summary = (overrides: Partial<ExpenseWindowSummary> = {}): ExpenseWindowSummary => ({
  currency: 'INR',
  count: 14,
  totalsByCurrency: [{ currency: 'INR', totalAmount: 18420 }],
  userOwes: 0,
  userGetsBack: 0,
  byMember: [
    { user: person(you), paid: 5210, share: 6140, net: 930 },
    { user: person(sam), paid: 8000, share: 6140, net: -1860 },
  ],
  ...overrides,
});
const financial = (
  expenses: Partial<GroupFinancialState['expenses']> = {},
  month: string | null = '2026-09',
): GroupFinancialState => ({
  groupId,
  month,
  expenses: {
    status: 'ready',
    data: [groceries, electricity, lunch, villa],
    summary: summary(),
    pagination: { page: 1, limit: 20, total: 4, totalPages: 1 },
    message: null,
    moreStatus: 'idle',
    moreMessage: null,
    month,
    refreshedAt: at,
    ...expenses,
  },
  balances: { status: 'ready', data: [], message: null, refreshedAt: at, stale: false },
});
const kept = (overrides: Partial<KeptDraft> = {}): KeptDraft => ({
  groupId,
  draft: { description: 'Weekly groceries', amount: 1249.5, currency: 'INR', edit: false },
  unconfirmed: false,
  ...overrides,
});

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');
const labelled = (root: ReactTestInstance, label: string) =>
  root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityLabel === label);
const buttons = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Pressable'))
    .map((node) => node.props.accessibilityLabel as string);
const headings = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text') && node.props.accessibilityRole === 'header')
    .map((node) => node.children.join(''));
const press = (root: ReactTestInstance, label: string) =>
  act(() => labelled(root, label)[0].props.onPress());

function view(props: Partial<Parameters<typeof GroupExpensesView>[0]> = {}) {
  const calls = {
    onSelectMonth: vi.fn(),
    onRefreshExpenses: vi.fn(),
    onLoadMore: vi.fn(),
    onLoadNewer: vi.fn(),
    onOpenExpense: vi.fn(),
    onResumeDraft: vi.fn(),
    onDiscardDraft: vi.fn(),
  };
  act(() => {
    screen = create(
      <GroupExpensesView
        group={group()}
        currentUserId={you}
        state={financial()}
        kept={null}
        savedExpenseId={null}
        now={now}
        {...calls}
        {...props}
      />,
    );
  });
  return { root: screen!.root, ...calls };
}
const remount = () => act(() => screen?.unmount());

describe('Expenses summary', () => {
  it('a Household shows its Month bar and what the Month cost, never as Balances', () => {
    const { root, onSelectMonth } = view({ state: financial({ data: [] }) });
    expect(headings(root)).toContain('September 2026');
    expect(labelled(root, 'Previous month')[0].props.accessibilityState).toEqual({
      disabled: false,
    });
    // The current Month is the last one.
    expect(labelled(root, 'Next month')[0].props.accessibilityState).toEqual({ disabled: true });
    for (const stat of ['Spent: ₹18,420.00', 'Your share: ₹6,140.00', 'You paid: ₹5,210.00'])
      expect(labelled(root, stat)).toHaveLength(1);
    const shown = text(root);
    expect(shown).toContain('14 expenses this month');
    expect(shown).toContain(`Updated ${refreshedLabel(at)}`);
    expect(shown).not.toMatch(/owe|balance/i);
    press(root, 'Previous month');
    press(root, 'All time');
    expect(onSelectMonth.mock.calls).toEqual([['2026-08'], [null]]);
  });

  it('an earlier Month moves forward, and All time offers This month', () => {
    const august = view({ state: financial({}, '2026-08') });
    expect(text(august.root)).toContain('14 expenses in August');
    press(august.root, 'Next month');
    expect(august.onSelectMonth).toHaveBeenCalledWith('2026-09');
    remount();
    const all = view({ state: financial({}, null) });
    expect(headings(all.root)).toContain('All time');
    expect(text(all.root)).toContain('14 expenses');
    expect(labelled(all.root, 'Next month')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    press(all.root, 'This month');
    expect(all.onSelectMonth).toHaveBeenCalledWith('2026-09');
  });

  it('other Themes show an all-time summary without a Month bar', () => {
    const { root } = view({ group: group('trip'), state: financial({}, null) });
    expect(labelled(root, 'Previous month')).toHaveLength(0);
    expect(labelled(root, 'All time')).toHaveLength(0);
    expect(headings(root)).toContain('All time');
    expect(labelled(root, 'Your share: ₹6,140.00')).toHaveLength(1);
    const shown = text(root);
    expect(shown).toContain('14 expenses');
    expect(shown).not.toContain('this month');
    expect(shown).toContain(`Updated ${refreshedLabel(at)}`);
  });

  it('keeps other currencies out of the member’s figures, and says so', () => {
    const { root } = view({
      state: financial({
        summary: summary({
          totalsByCurrency: [
            { currency: 'INR', totalAmount: 18420 },
            { currency: 'EUR', totalAmount: 42.5 },
          ],
        }),
      }),
    });
    expect(labelled(root, 'Spent: ₹18,420.00')).toHaveLength(1);
    expect(text(root)).toContain('Also €42.50 in other currencies');
  });
});

describe('Expense rows', () => {
  it('sit under day headings and say what the member lent or owes', () => {
    const { root, onOpenExpense } = view();
    const day = (date: number) =>
      new Date(2026, 8, date, 12).toLocaleDateString([], {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
    expect(headings(root)).toEqual(
      expect.arrayContaining([`Today · ${day(30)}`, day(29), day(27)]),
    );
    expect(buttons(root)).toEqual(
      expect.arrayContaining([
        'Weekly groceries, ₹1,249.50, You paid, Groceries, you lent ₹833.00',
        'Electricity bill, ₹2,860.00, Sam Chen paid, Utilities, you owe ₹953.33',
        // Not involved: nothing either way.
        'Beach shack lunch, ₹1,860.00, Priya Shah paid, Dining',
        'Villa stay, ₹3,000.00, 2 people paid, Stay, you lent ₹1,000.00',
      ]),
    );
    const shown = text(root);
    expect(shown).toContain('You paid · Groceries');
    expect(shown).toContain('you lent ₹833.00');
    expect(shown).toContain('you owe ₹953.33');
    press(root, 'Electricity bill, ₹2,860.00, Sam Chen paid, Utilities, you owe ₹953.33');
    expect(onOpenExpense).toHaveBeenCalledWith(electricity.id);
  });

  it('marks the Expense just saved', () => {
    const { root } = view({ savedExpenseId: groceries.id });
    const marked = buttons(root).filter((label) => label?.endsWith('just saved'));
    expect(marked).toEqual([
      'Weekly groceries, ₹1,249.50, You paid, Groceries, you lent ₹833.00, just saved',
    ]);
  });

  it('loads more at the end with its own progress, and recovers from a failure', () => {
    const paged = { pagination: { page: 1, limit: 20, total: 25, totalPages: 2 } };
    const { root, onLoadMore } = view({ state: financial(paged) });
    press(root, 'Load more expenses');
    expect(onLoadMore).toHaveBeenCalledOnce();
    remount();

    const loading = view({ state: financial({ ...paged, moreStatus: 'loading' }) }).root;
    expect(text(loading)).toContain('Loading more expenses…');
    expect(loading.findAll((node) => isHost(node, 'ActivityIndicator'))).toHaveLength(1);
    expect(buttons(loading)).not.toContain('Load more expenses');
    expect(text(loading)).toContain('Weekly groceries');
    remount();

    const failed = view({
      state: financial({
        ...paged,
        moreStatus: 'error',
        moreMessage: 'Could not load more expenses. Please try again.',
      }),
    });
    const alert = failed.root.find(
      (node) => isHost(node, 'Text') && node.props.accessibilityRole === 'alert',
    );
    expect(alert.children.join('')).toContain('The ones shown are still here.');
    press(failed.root, 'Try loading more expenses');
    expect(failed.onLoadMore).toHaveBeenCalledOnce();
  });

  it('has no Load more on the last page', () => {
    expect(buttons(view().root)).not.toContain('Load more expenses');
  });

  it('loads newer above a list that has slid past its newest page, as Load more does (#219)', () => {
    const slid = { firstPage: 2, pagination: { page: 6, limit: 20, total: 130, totalPages: 7 } };
    expect(buttons(view().root)).not.toContain('Load newer expenses');
    remount();

    const { root, onLoadNewer } = view({ state: financial(slid) });
    const order = buttons(root);
    // Above the rows, and TalkBack names the list.
    expect(order.indexOf('Load newer expenses')).toBeLessThan(
      order.findIndex((label) => label?.startsWith('Weekly groceries')),
    );
    press(root, 'Load newer expenses');
    expect(onLoadNewer).toHaveBeenCalledOnce();
    remount();

    const loading = view({ state: financial({ ...slid, newerStatus: 'loading' }) }).root;
    expect(text(loading)).toContain('Loading newer expenses…');
    expect(loading.findAll((node) => isHost(node, 'ActivityIndicator'))).toHaveLength(1);
    expect(buttons(loading)).not.toContain('Load newer expenses');
    expect(text(loading)).toContain('Weekly groceries');
    remount();

    const failed = view({
      state: financial({
        ...slid,
        newerStatus: 'error',
        newerMessage: 'Could not load newer expenses. Please try again.',
      }),
    });
    const alert = failed.root.find(
      (node) => isHost(node, 'Text') && node.props.accessibilityRole === 'alert',
    );
    expect(alert.children.join('')).toContain('The ones shown are still here.');
    press(failed.root, 'Try loading newer expenses');
    expect(failed.onLoadNewer).toHaveBeenCalledOnce();
  });
  describe('when the newest page drops (#219)', () => {
    // 120 fictional rows of one day, 20 a page; each row is 60 high under a 30-high day heading.
    const rows = Array.from({ length: 120 }, (_, index) =>
      expense(
        `e${String(index + 1).padStart(23, '0')}`,
        `Fictional row ${index + 1}`,
        20,
        [[you, 1000]],
        [[you, 1000]],
      ),
    );
    const window = (first: number) =>
      financial({
        data: rows.slice((first - 1) * 20, (first + 4) * 20),
        firstPage: first,
        pagination: { page: first + 4, limit: 20, total: 120, totalPages: 6 },
      });
    const layout = (node: ReactTestInstance, y: number) =>
      act(() =>
        node.props.onLayout({
          nativeEvent: { layout: { x: 0, y, width: 390, height: 60 } },
        }),
      );
    /** The host Views that report the layout of a row, its day and the list, by row number. */
    const places = (root: ReactTestInstance, number: number) => {
      const found: ReactTestInstance[] = [];
      let node: ReactTestInstance | null = root.find(
        (candidate) =>
          isHost(candidate, 'Pressable') &&
          String(candidate.props.accessibilityLabel).startsWith(`Fictional row ${number},`),
      );
      while (node && found.length < 3) {
        if (isHost(node, 'View') && node.props.onLayout) found.push(node);
        node = node.parent;
      }
      const [row, day, list] = found;
      return { row, day, list };
    };
    /** Lays the window out as a phone would: the list at `listY`, rows from `first`. */
    const lay = (root: ReactTestInstance, first: number, listY: number) => {
      const { day, list } = places(root, first * 20 - 19);
      layout(list, listY);
      layout(day, 0);
      for (let number = first * 20 - 19; number <= (first + 4) * 20; number += 1)
        layout(places(root, number).row, 30 + (number - (first * 20 - 19)) * 60);
    };
    const render = (first: number, onShift: (dy: number) => void) => {
      const props = {
        group: group(),
        currentUserId: you,
        kept: null,
        savedExpenseId: null,
        now,
        onSelectMonth: vi.fn(),
        onRefreshExpenses: vi.fn(),
        onLoadMore: vi.fn(),
        onLoadNewer: vi.fn(),
        onShift,
        onOpenExpense: vi.fn(),
        onResumeDraft: vi.fn(),
        onDiscardDraft: vi.fn(),
      };
      act(() => {
        screen = create(<GroupExpensesView {...props} state={window(first)} />);
      });
      return (next: number) =>
        act(() => screen!.update(<GroupExpensesView {...props} state={window(next)} />));
    };
    const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    it('keeps the row on screen in its place: the view moves up by the rows that went', async () => {
      const onShift = vi.fn();
      const slide = render(1, onShift);
      lay(screen!.root, 1, 200);
      await tick();
      expect(onShift).not.toHaveBeenCalled();
      // Load more read page 6: pages 2 to 6 show, below Load newer, 60 high, above the list.
      slide(2);
      lay(screen!.root, 2, 260);
      await tick();
      // Row 21 was at 200 + 30 + 20 × 60 = 1430; it is now at 260 + 30 = 290.
      expect(onShift).toHaveBeenCalledExactlyOnceWith(290 - 1430);
      // Only the slide's own layout moves the view.
      layout(places(screen!.root, 21).list, 300);
      await tick();
      expect(onShift).toHaveBeenCalledOnce();
    });

    it('moves nothing when Load newer brings the newest page back', async () => {
      const onShift = vi.fn();
      const slide = render(2, onShift);
      lay(screen!.root, 2, 260);
      slide(1);
      lay(screen!.root, 1, 200);
      await tick();
      expect(onShift).not.toHaveBeenCalled();
    });
  });

  it('shows placeholders on a first load, and a retry when it fails', () => {
    const loading = view({ state: financial({ status: 'loading', data: [], summary: null }) });
    const placeholder = labelled(loading.root, 'Loading September 2026 expenses');
    expect(placeholder).toHaveLength(1);
    expect(placeholder[0].props.accessibilityState).toEqual({ busy: true });
    expect(loading.root.findAll((node) => isHost(node, 'ActivityIndicator'))).toHaveLength(0);
    expect(text(loading.root)).not.toContain('Spent');
    remount();

    const failed = view({
      state: financial({
        status: 'error',
        data: [],
        summary: null,
        message: 'Could not load expenses. Please try again.',
      }),
    });
    expect(text(failed.root)).toContain('Could not load expenses. Please try again.');
    press(failed.root, 'Retry expenses');
    expect(failed.onRefreshExpenses).toHaveBeenCalledOnce();
  });

  it('never lists one Month’s Expenses under another Month', () => {
    const { root } = view({ state: { ...financial({}, '2026-09'), month: '2026-08' } });
    expect(headings(root)).toContain('August 2026');
    expect(text(root)).not.toContain('Weekly groceries');
    expect(labelled(root, 'Loading August 2026 expenses')).toHaveLength(1);
  });
});

describe('A kept draft', () => {
  it('is offered in an info notice with Resume and Discard', () => {
    const { root, onResumeDraft, onDiscardDraft } = view({ kept: kept() });
    const notice = root.find(
      (node) => isHost(node, 'View') && node.props.accessibilityRole === 'summary',
    );
    expect(notice.props.accessibilityLiveRegion).toBe('polite');
    const shown = text(notice);
    expect(shown).toContain('Draft: Weekly groceries');
    expect(shown).toContain('₹1,249.50');
    expect(shown).toContain('Kept on this device. It hasn’t been sent to the Group.');
    press(root, 'Resume draft');
    press(root, 'Discard draft');
    expect(onResumeDraft).toHaveBeenCalledOnce();
    expect(onDiscardDraft).toHaveBeenCalledOnce();
  });

  it('says when it holds changes to a saved Expense', () => {
    const { root } = view({
      kept: kept({
        draft: { description: 'Wi-Fi', amount: null, currency: 'INR', edit: true },
      }),
    });
    expect(text(root)).toContain('Draft: Wi-Fi');
    expect(text(root)).toContain('Your changes are kept on this device.');
  });

  it('a save that may already be recorded is a warning that offers only to finish it', () => {
    const { root, onResumeDraft } = view({ kept: kept({ unconfirmed: true }) });
    const shown = text(root);
    expect(shown).toContain('Save not confirmed');
    expect(shown).toContain(
      'Weekly groceries may already be saved. Check it before adding another.',
    );
    expect(shown).not.toContain('Draft:');
    expect(buttons(root)).not.toContain('Discard draft');
    expect(buttons(root)).not.toContain('Resume draft');
    press(root, 'Open to check');
    expect(onResumeDraft).toHaveBeenCalledOnce();
  });

  it('can be resumed but not discarded when it can’t be read', () => {
    const { root } = view({ kept: kept({ draft: null }) });
    expect(text(root)).toContain('Unfinished draft');
    expect(buttons(root)).toContain('Resume draft');
    expect(buttons(root)).not.toContain('Discard draft');
  });

  it('shows only this Group’s draft', () => {
    const { root } = view({ kept: kept({ groupId: 'b00000000000000000000009' }) });
    expect(text(root)).not.toContain('Draft:');
    expect(buttons(root)).not.toContain('Resume draft');
  });
});
