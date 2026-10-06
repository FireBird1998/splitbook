import type { ReactElement } from 'react';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  ExpenseWindowSummary,
  GroupFinancialState,
  HomeFinancialState,
  MobileExpense,
  MobileGroup,
} from '../data/types';
import { flatten, layoutHeight } from '../test-utils/layout';
import { setFileWindow, setWindow, timing } from '../test-utils/native';
import { motion } from './compact';
import { GroupExpensesView } from './group-expenses';
import { HomeBalances, HomeGroups } from './home';

// #331: content takes its skeleton's place at the same height, so nothing below it moves when
// it arrives: Home's Groups and balances, and a Group's Expenses, at 100% and 130% text. The
// heights come from the rendered styles (`layoutHeight`), with rows that wrap broken into lines
// at a 360dp phone's width; text here stays on one line.
setFileWindow({ width: 360, height: 640 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = new Date(2026, 8, 30, 10, 42);
// Figures read today say "Updated 10:42 AM", as a fresh load does.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 12));
});
afterAll(() => vi.useRealTimers());
const you = 'a00000000000000000000001';
const person = (id: string, name: string) => ({ id, name, image: null });
const group = (id: string, name: string, category: MobileGroup['category']): MobileGroup => ({
  id,
  name,
  description: '',
  category,
  defaultCurrency: 'INR',
  members: [person(you, 'Alex Rivera'), person('a00000000000000000000002', 'Sam Chen')].map(
    (user) => ({ user: { ...user, email: '' }, role: 'member' as const, joinedAt: at }),
  ),
  startDate: null,
  endDate: null,
  createdAt: at,
  updatedAt: at,
});
const maple = group('b00000000000000000000001', 'Maple House', 'home');
const lisbon = group('b00000000000000000000002', 'Lisbon Offsite', 'work');
const football = group('b00000000000000000000003', 'Sunday Football', 'other');

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});
/** How tall `element` lays out, and how tall it is once `next` replaces it in place. */
function heights(element: ReactElement, next: ReactElement, fontScale: number) {
  setWindow({ fontScale });
  act(() => {
    renderer = create(element);
  });
  const before = layoutHeight(renderer!.toJSON() as ReactTestRendererJSON, fontScale, content);
  act(() => renderer!.update(next));
  const after = layoutHeight(renderer!.toJSON() as ReactTestRendererJSON, fontScale, content);
  act(() => renderer!.unmount());
  renderer = undefined;
  return { before, after };
}
/**
 * Renders `element`, lets Android answer that reduce motion is off, then replaces it with
 * `next` in place: the content that arrived, and the text of each part of it that fades in.
 */
async function arrival(element: ReactElement, next: ReactElement) {
  act(() => {
    renderer = create(element);
  });
  await act(async () => undefined);
  timing.mockClear();
  act(() => renderer!.update(next));
  const fades = timing.mock.results
    .map((result) => result.value)
    .filter((animation) => animation.config.duration === motion.reveal);
  const text = (node: ReactTestInstance) =>
    node
      .findAll((child) => (child.type as unknown) === 'Text')
      .flatMap((child) => child.children.filter((run) => typeof run === 'string'))
      .join(' ');
  return fades.map((fade) => {
    expect(fade.value.value).toBe(0);
    expect(fade.config).toMatchObject({ toValue: 1, useNativeDriver: true });
    expect(fade.start).toHaveBeenCalledOnce();
    const [faded] = renderer!.root.findAll(
      (node) =>
        (node.type as unknown) === 'AnimatedView' &&
        flatten(node.props.style).opacity === fade.value,
    );
    return text(faded!);
  });
}
const scales = [1, 1.3];
/** The screens' content width on a 360dp phone: 16 each side. */
const content = 360 - 32;

describe('Home', () => {
  const groups = (loading: boolean) => (
    <HomeGroups
      groups={{
        status: loading ? 'loading' : 'ready',
        data: loading ? [] : [maple, lisbon, football],
        message: null,
        loaded: !loading,
      }}
      byGroup={
        loading
          ? {}
          : {
              [maple.id]: [{ currency: 'INR', balance: -1480 }],
              [lisbon.id]: [{ currency: 'INR', balance: 620 }],
              [football.id]: [],
            }
      }
      newGroupLabel="New Group"
      onNewGroup={vi.fn()}
      onOpen={vi.fn()}
      onRetry={vi.fn()}
    />
  );
  it.each(scales)(
    'the Groups list takes the place of its three skeleton rows, at %s× text',
    (scale) => {
      const { before, after } = heights(groups(true), groups(false), scale);
      expect(after).toBeGreaterThan(150);
      expect(after).toBe(before);
    },
  );

  // The list's Card shows the skeleton, so the same Card fades the Groups in.
  it('the Groups fade in where their skeleton was', async () => {
    const faded = await arrival(groups(true), groups(false));
    expect(faded).toHaveLength(1);
    expect(faded[0]).toContain('Maple House');
    expect(faded[0]).toContain('Sunday Football');
  });

  const balances = (patch: Partial<HomeFinancialState>) => (
    <HomeBalances
      state={{
        status: 'ready',
        data: [{ currency: 'INR', youOwe: 1480, youAreOwed: 620 }],
        byGroup: {},
        message: null,
        refreshedAt: at.getTime(),
        stale: false,
        ...patch,
      }}
      onRefresh={vi.fn()}
    />
  );
  it.each(scales)(
    'a currency’s balances take the place of their skeleton, at %s× text',
    (scale) => {
      const { before, after } = heights(
        balances({ status: 'loading', data: null, refreshedAt: null }),
        balances({}),
        scale,
      );
      expect(after).toBeGreaterThan(80);
      expect(after).toBe(before);
    },
  );

  it('the balances fade in under a header that stays still', async () => {
    const faded = await arrival(
      balances({ status: 'loading', data: null, refreshedAt: null }),
      balances({}),
    );
    expect(faded).toHaveLength(1);
    expect(faded[0]).toContain('You owe');
    expect(faded[0]).not.toContain('Your balances');
  });
});

describe('A Group’s Expenses', () => {
  const now = new Date(2026, 8, 30, 12).getTime();
  const expense = (id: string, description: string, paise: number): MobileExpense => ({
    id,
    groupId: maple.id,
    description,
    currency: 'INR',
    amount: paise / 100,
    amountMinor: paise,
    date: new Date(2026, 8, 29, 12),
    createdAt: at,
    updatedAt: at,
    category: 'food',
    tag: 'Groceries',
    tagId: 'c00000000000000000000001',
    paidBy: [{ user: person(you, 'Alex Rivera'), amount: paise / 100, amountMinor: paise }],
    splitBetween: [
      { user: person(you, 'Alex Rivera'), amount: paise / 200, amountMinor: paise / 2 },
      {
        user: person('a00000000000000000000002', 'Sam Chen'),
        amount: paise / 200,
        amountMinor: paise / 2,
      },
    ],
    splitMethod: 'equal',
  });
  const summary: ExpenseWindowSummary = {
    currency: 'INR',
    count: 3,
    totalsByCurrency: [{ currency: 'INR', totalAmount: 4120 }],
    userOwes: 0,
    userGetsBack: 0,
    byMember: [{ user: person(you, 'Alex Rivera'), paid: 4120, share: 2060, net: 2060 }],
  };
  const state = (loading: boolean, month: string | null): GroupFinancialState => ({
    groupId: maple.id,
    month,
    expenses: {
      status: loading ? 'loading' : 'ready',
      data: loading
        ? []
        : [
            expense('e00000000000000000000001', 'Weekly groceries', 124000),
            expense('e00000000000000000000002', 'Electricity bill', 186000),
            expense('e00000000000000000000003', 'Beach shack lunch', 102000),
          ],
      summary: loading ? null : summary,
      pagination: loading ? null : { page: 1, limit: 20, total: 3, totalPages: 1 },
      message: null,
      moreStatus: 'idle',
      moreMessage: null,
      month,
      refreshedAt: loading ? null : at.getTime(),
    },
    balances: { status: 'ready', data: [], message: null, refreshedAt: at.getTime(), stale: false },
  });
  const view = (subject: MobileGroup, loading: boolean, month: string | null) => (
    <GroupExpensesView
      group={subject}
      currentUserId={you}
      state={state(loading, month)}
      kept={null}
      savedExpenseId={null}
      now={now}
      onSelectMonth={vi.fn()}
      onRefreshExpenses={vi.fn()}
      onLoadMore={vi.fn()}
      onOpenExpense={vi.fn()}
      onResumeDraft={vi.fn()}
      onDiscardDraft={vi.fn()}
    />
  );

  it('the Month’s figures and its Expenses fade in where their skeletons were', async () => {
    const faded = await arrival(view(maple, true, '2026-09'), view(maple, false, '2026-09'));
    expect(faded).toHaveLength(2);
    expect(faded.find((part) => part.includes('Spent'))).toBeDefined();
    expect(faded.find((part) => part.includes('Weekly groceries'))).toBeDefined();
  });

  it.each(scales)(
    'a Household’s Month summary and a day of Expenses take their skeletons’ place, at %s× text',
    (scale) => {
      const { before, after } = heights(
        view(maple, true, '2026-09'),
        view(maple, false, '2026-09'),
        scale,
      );
      expect(after).toBeGreaterThan(300);
      expect(after).toBe(before);
    },
  );

  // A Work Group's all-time header gains "Updated hh:mm" when its figures arrive: one caption
  // line beside the 32 high header, which at 130% is under a pixel taller than the header.
  it.each(scales)(
    'another Theme’s all-time summary and Expenses take their skeletons’ place, at %s× text',
    (scale) => {
      const { before, after } = heights(view(lisbon, true, null), view(lisbon, false, null), scale);
      expect(after).toBeGreaterThan(300);
      expect(Math.abs(after - before)).toBeLessThan(1);
    },
  );
});
