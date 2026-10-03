import type { ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ExpenseDraftSummary,
  HomeFinancialState,
  MobileGroup,
  MobileSnapshot,
} from '../data/types';
import { ContinueDrafts, HomeBalances, HomeGroups, HomeTopBar } from './home';
import { refreshedLabel } from './refresh-feedback';
import { setFileWindow, setWindow } from '../test-utils/native';

// #126: Home's balances, drafts to resume and Groups, rendered.
setFileWindow({ width: 360, height: 640 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = new Date('2026-10-01T10:42:00');
const [maple, goa, lisbon, football] = [1, 2, 3, 4].map(
  (n) => `b0000000000000000000000${n}`,
) as string[];
const group = (
  id: string,
  name: string,
  category: MobileGroup['category'],
  members = 3,
  dates: [string, string] | null = null,
): MobileGroup => ({
  id,
  name,
  description: '',
  category,
  defaultCurrency: 'INR',
  members: Array.from({ length: members }, (_, index) => ({
    user: {
      id: `a0000000000000000000001${index}`,
      name: `Member ${index}`,
      email: '',
      image: null,
    },
    role: 'member' as const,
    joinedAt: at,
  })),
  startDate: dates && new Date(`${dates[0]}T00:00:00.000Z`),
  endDate: dates && new Date(`${dates[1]}T00:00:00.000Z`),
  createdAt: at,
  updatedAt: at,
});
const groupsList: MobileGroup[] = [
  group(maple, 'Maple House', 'home'),
  group(goa, 'Goa Friends Trip', 'trip', 3, ['2026-09-17', '2026-09-20']),
  group(lisbon, 'Lisbon Offsite', 'work', 4),
  group(football, 'Sunday Football', 'other', 8),
];
const home = (patch: Partial<HomeFinancialState> = {}): HomeFinancialState => ({
  status: 'ready',
  data: [
    { currency: 'INR', youOwe: 1480, youAreOwed: 620 },
    { currency: 'EUR', youOwe: 0, youAreOwed: 42.5 },
  ],
  byGroup: {
    [maple]: [{ currency: 'INR', balance: -1480 }],
    [goa]: [
      { currency: 'INR', balance: 620 },
      { currency: 'EUR', balance: 12.5 },
    ],
    [football]: [],
  },
  message: null,
  refreshedAt: at.getTime(),
  stale: false,
  ...patch,
});
const draft = (patch: Partial<ExpenseDraftSummary>): ExpenseDraftSummary => ({
  groupId: maple,
  groupName: 'Maple House',
  expenseId: null,
  description: 'Weekly groceries',
  amount: '1249.5',
  currency: 'INR',
  unconfirmed: false,
  ...patch,
});

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});
const render = (element: ReactElement) => {
  act(() => {
    renderer = create(element);
  });
  return renderer!.root;
};
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');
const buttons = (root: ReactTestInstance) =>
  root.findAll((node) => isHost(node, 'Pressable') && node.props.accessibilityRole === 'button');
const button = (root: ReactTestInstance, label: string) => {
  const found = buttons(root).filter((node) => node.props.accessibilityLabel === label);
  expect(found).toHaveLength(1);
  return found[0];
};
const announced = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'View') && node.props.accessible === true)
    .map((node) => node.props.accessibilityLabel as string);
const headers = (root: ReactTestInstance) =>
  root
    .findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'header')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''));

describe('Home top bar', () => {
  it('keeps a refresh action and opens Account from the avatar', () => {
    const onRefresh = vi.fn(),
      onAccount = vi.fn();
    const root = render(
      <HomeTopBar userName="Alex Rivera" onRefresh={onRefresh} onAccount={onAccount} />,
    );
    expect(headers(root)).toEqual(['splitbook']);
    act(() => button(root, 'Refresh Home').props.onPress());
    act(() => button(root, 'Account and settings').props.onPress());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onAccount).toHaveBeenCalledTimes(1);
    expect(text(root)).toContain('AR');
  });

  it('keeps Account closed while a Group is being saved', () => {
    const root = render(
      <HomeTopBar userName="Alex Rivera" accountDisabled onRefresh={vi.fn()} onAccount={vi.fn()} />,
    );
    expect(button(root, 'Account and settings').props.accessibilityState).toEqual({
      disabled: true,
    });
  });
});

describe('Home balances', () => {
  it.each([1, 1.3])(
    'shows one row per currency with You owe, Owed to you and the update time at %sx text',
    (fontScale) => {
      setWindow({ fontScale });
      const root = render(<HomeBalances state={home()} onRefresh={vi.fn()} />);
      expect(headers(root)).toContain('Your balances');
      expect(text(root)).toContain(`Updated ${refreshedLabel(at.getTime())}`);
      expect(announced(root)).toEqual([
        'INR: You owe ₹1,480.00, Owed to you ₹620.00',
        'EUR: You owe €0.00, Owed to you €42.50',
      ]);
    },
  );

  it('says when nothing is outstanding', () => {
    const root = render(<HomeBalances state={home({ data: [] })} onRefresh={vi.fn()} />);
    expect(text(root)).toContain('Nothing outstanding in your Groups');
    expect(announced(root)).toEqual([]);
  });

  it('shows a first load without a time, and a failed one with Retry', () => {
    const onRefresh = vi.fn();
    const loading = render(
      <HomeBalances
        state={home({ status: 'loading', data: null, refreshedAt: null })}
        onRefresh={onRefresh}
      />,
    );
    // Placeholders, never a spinner; the screen's one progress bar is under the top bar.
    const placeholder = loading.find(
      (node) => isHost(node, 'View') && node.props.accessibilityLabel === 'Loading your balances',
    );
    expect(placeholder.props.accessibilityState).toEqual({ busy: true });
    expect(loading.findAll((node) => isHost(node, 'ActivityIndicator'))).toHaveLength(0);
    expect(text(loading)).not.toContain('Updated');

    const failed = render(
      <HomeBalances
        state={home({ status: 'error', data: null, refreshedAt: null, message: 'No connection.' })}
        onRefresh={onRefresh}
      />,
    );
    const alert = failed.find(
      (node) => isHost(node, 'Text') && node.props.accessibilityRole === 'alert',
    );
    expect(alert.children).toEqual(['No connection.']);
    act(() => button(failed, 'Retry Home balances').props.onPress());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('Continue where you left off', () => {
  it('is absent without drafts', () => {
    const root = render(<ContinueDrafts drafts={[]} onOpen={vi.fn()} />);
    expect(text(root)).toBe('');
  });

  it('lists each draft with its description, amount and Group, and opens the one tapped', () => {
    const onOpen = vi.fn();
    const unconfirmed = draft({
      groupId: goa,
      groupName: 'Goa Friends Trip',
      description: 'Airport taxi',
      amount: '1150',
      unconfirmed: true,
    });
    const root = render(
      <ContinueDrafts
        drafts={[
          unconfirmed,
          draft({}),
          draft({ groupId: lisbon, groupName: 'Lisbon Offsite', description: ' ', amount: '' }),
        ]}
        onOpen={onOpen}
      />,
    );
    expect(headers(root)).toEqual(['Continue where you left off']);
    expect(buttons(root).map((row) => row.props.accessibilityLabel)).toEqual([
      'Save not confirmed, Airport taxi, ₹1,150.00, Goa Friends Trip',
      'Draft, Weekly groceries, ₹1,249.50, Maple House',
      // Not yet valid: nothing is guessed.
      'Draft, No description, Lisbon Offsite',
    ]);
    const shown = text(root);
    expect(shown).toContain('Save not confirmed · Goa Friends Trip');
    expect(shown).toContain('Draft · Maple House');
    act(() =>
      button(root, 'Save not confirmed, Airport taxi, ₹1,150.00, Goa Friends Trip').props.onPress(),
    );
    expect(onOpen).toHaveBeenCalledWith(unconfirmed);
  });
});

describe('Home Groups', () => {
  const view = (
    groups: Partial<MobileSnapshot['groups']> = {},
    props: Partial<Parameters<typeof HomeGroups>[0]> = {},
  ) => {
    const handlers = { onNewGroup: vi.fn(), onOpen: vi.fn(), onRetry: vi.fn() };
    const root = render(
      <HomeGroups
        groups={{ status: 'ready', data: groupsList, message: null, loaded: true, ...groups }}
        byGroup={home().byGroup}
        newGroupLabel="New Group"
        {...handlers}
        {...props}
      />,
    );
    return { root, ...handlers };
  };

  it('shows the member’s balance in each Group, its first currency and +N, or Settled up', () => {
    const { root, onOpen } = view();
    expect(headers(root)).toEqual(['Groups · 4']);
    expect(buttons(root).map((row) => row.props.accessibilityLabel)).toEqual([
      'New Group',
      'Open Maple House, Household · 3 members, You owe ₹1,480.00',
      'Open Goa Friends Trip, Trip · 17–20 Sep · 3 members, Owed to you ₹620.00, plus 1 more currency',
      // Not in the Home response, so nothing is claimed.
      'Open Lisbon Offsite, Work · 4 members',
      'Open Sunday Football, General · 8 members, Settled up',
    ]);
    const shown = text(root);
    expect(shown).toContain('₹1,480.00you owe');
    expect(shown).toContain('₹620.00owed to you · +1');
    expect(shown).toContain('Settled up');
    act(() => button(root, 'Open Lisbon Offsite, Work · 4 members').props.onPress());
    expect(onOpen).toHaveBeenCalledWith(lisbon);
  });

  it('keeps New Group, or continues an unfinished Group form', () => {
    const { root, onNewGroup } = view();
    act(() => button(root, 'New Group').props.onPress());
    expect(onNewGroup).toHaveBeenCalledTimes(1);
    const continuing = view({}, { newGroupLabel: 'Continue Group form' });
    expect(buttons(continuing.root)[0].props.accessibilityLabel).toBe('Continue Group form');
  });

  it('invites a first Group when there are none, and explains a failed read with a retry', () => {
    const empty = view({ data: [] });
    expect(headers(empty.root)).toEqual(['Groups · 0']);
    expect(text(empty.root)).toContain('A shared space starts here.');
    act(() => button(empty.root, 'Refresh Groups').props.onPress());
    expect(empty.onRetry).toHaveBeenCalledTimes(1);

    const failed = view({ status: 'error', message: 'No connection.' });
    expect(text(failed.root)).toContain('Couldn’t load your Groups');
    expect(text(failed.root)).toContain('No connection. Showing previously verified Groups.');
    expect(text(failed.root)).toContain('Maple House');
    act(() => button(failed.root, 'Try again').props.onPress());
    expect(failed.onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows placeholders only for a list never read, and keeps an empty list while it is read again', () => {
    const placeholders = (root: ReactTestInstance) =>
      root.findAll((node) => node.props.accessibilityLabel === 'Loading your Groups');
    const first = view({ status: 'loading', data: [], loaded: false });
    expect(placeholders(first.root)).not.toHaveLength(0);
    expect(headers(first.root)).toEqual(['Groups']);

    const again = view({ status: 'loading', data: [], loaded: true });
    expect(placeholders(again.root)).toHaveLength(0);
    expect(headers(again.root)).toEqual(['Groups · 0']);
    expect(text(again.root)).toContain('A shared space starts here.');
  });
});
