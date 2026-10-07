import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyExpenseHistory, parseActivityPage, type ExpenseHistoryState } from '../data/activity';
import {
  draftFromExpense,
  emptyExpenseEditor,
  parseExpenseContext,
  type ExpenseEditor as Editor,
} from '../data/expense-draft';
import { parseExpenseRecord } from '../data/expense-record';
import { parseExpensePage } from '../data/financial-dto';
import { ExpenseEditor } from './expense-editor';
import { recordOutline } from './expense-record-view';
import { OfflineNotice } from './offline-notice';
import { refreshedLabel } from './refresh-feedback';

// #220: an Expense record's history as a window of up to 5 pages, with Load newer above it, and
// the loading-state audit's items for the record (2026-10-07). Rendered from the snapshot's
// shape, as the App passes it. Fictional people and Groups only.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const alex = { id: 'a00000000000000000000001', name: 'Alex Rao' };
const sam = { id: 'a00000000000000000000002', name: 'Sam Chen' };
const groupId = 'a00000000000000000000010';
const billId = 'b00000000000000000000001';
const iso = '2026-09-29T14:32:00.000Z';
const at = Date.parse('2026-09-30T08:15:00.000Z');
const group = {
  _id: groupId,
  createdBy: alex.id,
  name: 'Maple House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  members: [alex, sam].map((user) => ({
    user: { _id: user.id, name: user.name, email: `${user.id}@example.test`, image: null },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: 'a00000000000000000000020', name: 'Utilities', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const wire = {
  _id: billId,
  group: groupId,
  revision: 3,
  description: 'Electricity bill',
  amount: 2860,
  amountMinor: 286000,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: { _id: sam.id, name: sam.name }, amount: 2860, amountMinor: 286000 }],
  splitBetween: [
    { user: { _id: alex.id, name: alex.name }, amount: 1430, amountMinor: 143000 },
    { user: { _id: sam.id, name: sam.name }, amount: 1430, amountMinor: 143000 },
  ],
  splitMethod: 'equal',
  date: '2026-09-29T06:30:00.000Z',
  createdAt: iso,
  updatedAt: iso,
  category: 'other',
  tagId: 'a00000000000000000000020',
  tag: 'Utilities',
  notes: '',
  isDeleted: false,
  createdBy: { _id: sam.id, name: sam.name },
  editHistory: [],
};
const original = parseExpenseRecord({ status: 200, data: wire }, groupId, billId);
const context = parseExpenseContext({ status: 200, data: group });
/** 140 fictional changes of the bill, newest first: change `n` is "Note n". */
const changes = Array.from({ length: 140 }, (_, index) => ({
  _id: `d${String(index + 1).padStart(23, '0')}`,
  group: groupId,
  type: 'expense_updated',
  actor: { _id: sam.id, name: sam.name },
  createdAt: new Date(Date.parse('2026-09-29T20:00:00.000Z') - index * 60_000).toISOString(),
  metadata: {
    expenseId: billId,
    changes: { notes: { old: `Note ${index + 2}`, new: `Note ${index + 1}` } },
  },
}));
/** Pages `first` to `first + 4` of the bill's changes, as the snapshot holds them. */
const windowOf = (first: number, overrides: Partial<ExpenseHistoryState> = {}) => {
  const pages = Array.from({ length: 5 }, (_, index) =>
    parseActivityPage(
      {
        status: 200,
        data: {
          activities: changes.slice((first + index - 1) * 20, (first + index) * 20),
          pagination: { page: first + index, limit: 20, total: 140, totalPages: 7 },
        },
      },
      groupId,
      first + index,
      billId,
    ),
  );
  return {
    ...emptyExpenseHistory(),
    expenseId: billId,
    status: 'ready' as const,
    events: pages.flatMap((page) => page.events),
    pagination: pages[4].pagination,
    firstPage: first,
    refreshedAt: at,
    ...overrides,
  };
};
const detail = (history: ExpenseHistoryState, overrides: Partial<Editor> = {}): Editor => ({
  ...emptyExpenseEditor(),
  groupId,
  context,
  draft: draftFromExpense(original),
  status: 'detail',
  requestedExpenseId: billId,
  history,
  ...overrides,
});

const scrollTo = vi.fn();
let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
  scrollTo.mockClear();
});
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (scope: ReactTestInstance) =>
  scope
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');
const pressables = (label: string) =>
  screen!.root.findAll(
    (node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === label,
  );
/** Whether a reader can reach this node: no ancestor hides it. */
const readable = (node: ReactTestInstance) => {
  for (let parent: ReactTestInstance | null = node; parent; parent = parent.parent)
    if (parent.props?.accessibilityElementsHidden) return false;
  return true;
};

function editor(state: Editor, props: Partial<Parameters<typeof ExpenseEditor>[0]> = {}) {
  return (
    <ExpenseEditor
      state={state}
      currentUserId={alex.id}
      onChange={() => undefined}
      onLeaveField={() => undefined}
      onSave={() => undefined}
      onResume={() => undefined}
      onDiscard={() => undefined}
      onRetry={() => undefined}
      onEdit={() => undefined}
      onReviewDelete={() => undefined}
      onDelete={() => undefined}
      onCancelDelete={() => undefined}
      onReconcile={() => undefined}
      onReviewLatest={() => undefined}
      onAcceptCurrent={() => undefined}
      onLoadOlderHistory={() => undefined}
      onLoadNewerHistory={() => undefined}
      onRetryHistory={() => undefined}
      {...props}
    />
  );
}
function render(state: Editor, props: Partial<Parameters<typeof ExpenseEditor>[0]> = {}) {
  act(() => {
    screen = create(editor(state, props), {
      createNodeMock: () => ({ scrollTo, focus: () => undefined }),
    });
  });
  return (next: Editor) => act(() => screen!.update(editor(next, props)));
}

describe('an Expense’s changes past 5 pages (#220, M7-2)', () => {
  const layout = (node: ReactTestInstance, y: number) =>
    act(() =>
      node.props.onLayout({ nativeEvent: { layout: { x: 0, y, width: 390, height: 60 } } }),
    );
  /** The host Views that report where a change's row and the list of changes lie. */
  const places = (number: number) => {
    const found: ReactTestInstance[] = [];
    let node: ReactTestInstance | null = screen!.root.find(
      (candidate) =>
        isHost(candidate, 'View') &&
        candidate.props.accessible === true &&
        String(candidate.props.accessibilityLabel).includes(`to “Note ${number}”`),
    );
    while (node && found.length < 2) {
      if (isHost(node, 'View') && node.props.onLayout) found.push(node);
      node = node.parent;
    }
    const [row, list] = found;
    return { row, list };
  };
  /** Lays the window out as a phone would: the list at `listY`, each change 61 high. */
  const lay = (first: number, listY: number) => {
    layout(places(first * 20 - 19).list, listY);
    for (let number = first * 20 - 19; number <= (first + 4) * 20; number += 1)
      layout(places(number).row, (number - (first * 20 - 19)) * 61);
  };
  const scrolled = (y: number) =>
    act(() =>
      screen!.root
        // The record's own: its sheets scroll too.
        .find((node) => isHost(node, 'ScrollView') && node.props.onScrollEndDrag)
        .props.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 0, y } } }),
    );
  const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  it('keeps the change on screen in its place when the newest page drops: the view moves up by what left', async () => {
    const slide = render(detail(windowOf(1)));
    lay(1, 700);
    scrolled(1900);
    await tick();
    expect(scrollTo).not.toHaveBeenCalled();
    // Load older read page 6: pages 2 to 6 show, below Load newer, which moved the list down.
    slide(detail(windowOf(2)));
    lay(2, 760);
    await tick();
    // Change 21 was at 700 + 20 × 61 = 1920; it is now at 760.
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 1900 + 760 - 1920, animated: false });
  });

  it('keeps the change on screen when Load newer brings the newest page back: the view moves down by what came', async () => {
    const slide = render(detail(windowOf(2)));
    lay(2, 760);
    scrolled(300);
    await tick();
    slide(detail(windowOf(1)));
    lay(1, 700);
    await tick();
    // Change 21, first under Load newer at 760, now has page 1's 20 changes above it.
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 300 + 1920 - 760, animated: false });
  });

  it('offers Load newer above the changes once they have slid, as Load older is offered below', () => {
    const slide = render(detail(windowOf(1)));
    expect(pressables('Load newer changes')).toHaveLength(0);
    slide(detail(windowOf(2)));
    const newer = pressables('Load newer changes');
    expect(newer).toHaveLength(1);
    expect(newer[0].props).toMatchObject({ accessibilityRole: 'button', disabled: false });
    const order = screen!.root
      .findAll((node) => isHost(node, 'Pressable') || node.props.accessible === true)
      .map((node) => String(node.props.accessibilityLabel));
    expect(order.indexOf('Load newer changes')).toBeLessThan(
      order.findIndex((label) => label.includes('to “Note 21”')),
    );
    expect(pressables('Load older changes')).toHaveLength(1);
  });

  it('says Load newer is loading as Load older does, and keeps the changes when it fails', () => {
    render(detail(windowOf(2, { newerStatus: 'loading' })));
    expect(text(screen!.root)).toContain('Loading newer changes…');
    expect(pressables('Load newer changes')).toHaveLength(0);
    act(() => screen!.unmount());
    const onLoadNewerHistory = vi.fn();
    render(detail(windowOf(2, { newerStatus: 'error' })), { onLoadNewerHistory });
    const alert = screen!.root.find(
      (node) => isHost(node, 'Text') && node.props.accessibilityRole === 'alert',
    );
    expect(text(alert)).toBe('Couldn’t load newer changes. The changes shown are still here.');
    act(() => pressables('Try loading newer changes')[0].props.onPress());
    expect(onLoadNewerHistory).toHaveBeenCalledOnce();
    expect(text(screen!.root)).toContain('Note 21');
  });

  it('keeps Load older and Load newer in place, disabled, while the changes shown are read again', () => {
    render(detail(windowOf(2, { status: 'loading' })));
    expect(pressables('Load newer changes')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(pressables('Load older changes')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    // The changes shown stay, marked as being read again, with the oldest page's time.
    expect(text(screen!.root)).toContain('Note 21');
    expect(text(screen!.root)).toContain(`Saved ${refreshedLabel(at)} · refreshing`);
  });
});

describe('opening an Expense: what is already known shows at once (loading-state audit)', () => {
  it('shows what the list row says straight away, while the record is read', () => {
    const row = parseExpensePage(
      {
        status: 200,
        data: {
          expenses: [wire],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          summary: { count: 1, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
        },
      },
      groupId,
      'INR',
    ).expenses[0]!;
    render(
      { ...emptyExpenseEditor(), status: 'loading', requestedExpenseId: billId },
      {
        outline: recordOutline(row, alex.id),
      },
    );
    for (const shown of ['Electricity bill', '₹2,860.00', 'You owe Sam ₹1,430.00']) {
      const found = screen!.root.findAll(
        (node) => isHost(node, 'Text') && node.children.join('').startsWith(shown),
      );
      expect(found.length, shown).toBeGreaterThan(0);
      expect(found.every(readable), shown).toBe(true);
    }
  });

  it('says when a record shown from what this device knew was saved, while it is read again', () => {
    render(detail(windowOf(1), { known: { refreshedAt: at, refreshing: true } }));
    expect(text(screen!.root)).toContain(`Saved ${refreshedLabel(at)} · refreshing`);
    act(() => screen!.unmount());
    // Its read failed: it still says when it was saved.
    render(detail(windowOf(1), { known: { refreshedAt: at, refreshing: false } }));
    expect(text(screen!.root)).toContain(`Saved ${refreshedLabel(at)}`);
    expect(text(screen!.root)).not.toContain('refreshing');
    act(() => screen!.unmount());
    render(detail(windowOf(1), { known: null }));
    expect(text(screen!.root)).not.toContain('Saved');
  });

  it('says it is offline above the one Try again when nothing of the Expense shows (S1)', () => {
    const offline = { active: true, refreshedAt: at, message: null };
    render(
      {
        ...emptyExpenseEditor(),
        groupId,
        status: 'blocked',
        requestedExpenseId: billId,
        message: 'This Expense isn’t saved on this phone. Connect to load it.',
      },
      {
        notice: <OfflineNotice state={offline} onRetry={() => undefined} />,
        emptyNotice: <OfflineNotice state={offline} savedShown={false} />,
      },
    );
    expect(text(screen!.root)).toContain('You’re offline');
    expect(text(screen!.root)).toContain('Connect to load the latest.');
    expect(text(screen!.root)).toContain('Couldn’t open this Expense');
    expect(text(screen!.root)).toContain(
      'This Expense isn’t saved on this phone. Connect to load it.',
    );
    expect(text(screen!.root)).not.toContain('What’s shown was saved');
    expect(
      screen!.root.findAll((node) => isHost(node, 'Pressable') && /Try again/.test(text(node))),
    ).toHaveLength(1);
  });
});

describe('the Group’s details unknown beside a draft (the device check of 3ac9be2)', () => {
  const draft = (status: Editor['status']): Editor => ({
    ...emptyExpenseEditor(),
    groupId,
    context: null,
    draft: { ...draftFromExpense(original), description: 'Electricity bill draft' },
    status,
    requestedExpenseId: billId,
  });

  it('says to connect only while offline', () => {
    render(draft('resume'), { offline: true });
    expect(text(screen!.root)).toContain('Connect to check the current members and Tags.');
  });

  it('says access was lost, with no offline cue, when the Group refused the member', () => {
    render(draft('blocked'));
    expect(text(screen!.root)).toContain(
      'You no longer have access to this Group’s members and Tags. Your draft is kept.',
    );
    expect(text(screen!.root)).not.toContain('Connect to check');
    expect(
      screen!.root.findAll(
        (node) => isHost(node, 'Ionicons') && node.props.name === 'cloud-offline-outline',
      ),
    ).toEqual([]);
  });

  it('says the details couldn’t be checked when they weren’t read online', () => {
    render(draft('resume'));
    expect(text(screen!.root)).toContain(
      'Couldn’t check the current members and Tags. You can still edit your saved text.',
    );
    expect(text(screen!.root)).not.toContain('Connect to check');
  });
});
