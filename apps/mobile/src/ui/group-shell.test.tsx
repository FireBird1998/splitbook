import type { ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityEvent, ActivityState } from '../data/activity';
import type { MobileGroup } from '../data/types';

// Host stand-ins keep the props (roles, labels, states, handlers) that Android receives.
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    View: 'AnimatedView',
    Value: class {
      setValue() {}
    },
    spring: () => ({ start: () => undefined }),
  },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  PanResponder: { create: (config: object) => ({ panHandlers: config }) },
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 412, height: 915, scale: 2, fontScale: 1 }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { GroupShell } = await import('./group-shell');
const { GroupActivity } = await import('./group-activity');
const { clockTime } = await import('./activity-format');

const you = 'a00000000000000000000001';
const group: MobileGroup = {
  id: 'b00000000000000000000001',
  name: 'Maple House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  members: [
    {
      user: { id: you, name: 'Alex Rao', email: 'a@x.test', image: null },
      role: 'admin',
      joinedAt: new Date(),
    },
    {
      user: { id: 'a00000000000000000000002', name: 'Sam Chen', email: 's@x.test', image: null },
      role: 'member',
      joinedAt: new Date(),
    },
    {
      user: { id: 'a00000000000000000000003', name: 'Priya Shah', email: 'p@x.test', image: null },
      role: 'member',
      joinedAt: new Date(),
    },
  ],
  startDate: null,
  endDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
});
function render(element: ReactElement) {
  act(() => {
    renderer = create(element);
  });
  return renderer!.root;
}
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const hosts = (root: ReactTestInstance, match: (props: Record<string, unknown>) => boolean) =>
  root.findAll((node) => typeof node.type === 'string' && match(node.props));
const byRole = (root: ReactTestInstance, role: string, label?: string) =>
  hosts(
    root,
    (p) => p.accessibilityRole === role && (label === undefined || p.accessibilityLabel === label),
  );
const one = (nodes: ReactTestInstance[]) => {
  expect(nodes).toHaveLength(1);
  return nodes[0];
};
const press = (node: ReactTestInstance) => {
  act(() => {
    node.props.onPress();
  });
};
/** The text in reading order, with nested Text where it sits in its sentence. */
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('');

function shell(overrides: Partial<Parameters<typeof GroupShell>[0]> = {}) {
  const props = {
    group,
    currentUserId: you,
    destination: 'balances' as const,
    onDestination: vi.fn(),
    back: { label: 'Back to Home', onPress: vi.fn() },
    invite: { onPress: vi.fn(), disabled: false, offline: false },
    onRefresh: vi.fn(),
    pull: { refreshing: false, onRefresh: vi.fn() },
    ...overrides,
  };
  return { root: render(<GroupShell {...props}>{null}</GroupShell>), props };
}

describe('Group shell', () => {
  it('shows the Group name as the heading with its Theme, member count and currency', () => {
    const { root } = shell();
    // The first heading is the top bar's; the closed options sheet carries its own.
    expect(text(byRole(root, 'header')[0])).toBe('Maple House');
    expect(text(root)).toContain('Household · 3 members · INR');
  });

  it('returns Home from the back arrow', () => {
    const { root, props } = shell();
    press(one(byRole(root, 'button', 'Back to Home')));
    expect(props.back.onPress).toHaveBeenCalledOnce();
  });

  it('marks the current destination and switches with one tap', () => {
    const { root, props } = shell();
    one(byRole(root, 'tablist', 'Maple House sections'));
    expect(
      byRole(root, 'tab').map((tab) => [
        tab.props.accessibilityLabel,
        tab.props.accessibilityState.selected,
      ]),
    ).toEqual([
      ['Expenses', false],
      ['Balances', true],
      ['Activity', false],
    ]);
    press(one(byRole(root, 'tab', 'Activity')));
    expect(props.onDestination).toHaveBeenCalledWith('activity');
  });

  it('offers Invite, and says why it is unavailable offline', () => {
    const online = shell();
    press(one(byRole(online.root, 'button', 'Invite people')));
    expect(online.props.invite.onPress).toHaveBeenCalledOnce();
    act(() => {
      renderer?.unmount();
    });
    const offline = shell({ invite: { onPress: vi.fn(), disabled: false, offline: true } });
    expect(
      one(byRole(offline.root, 'button', 'Invite people. Inviting needs a connection')).props
        .accessibilityState,
    ).toEqual({ disabled: true });
  });

  it('opens Group options with Refresh and the members, marking you and admins', () => {
    const { root, props } = shell();
    const sheet = () => root.find((node) => isHost(node, 'Modal'));
    expect(sheet().props.visible).toBe(false);
    press(one(byRole(root, 'button', 'Group options')));
    expect(sheet().props.visible).toBe(true);
    expect(text(sheet())).toContain('Alex RaoYou · Group admin');
    expect(text(sheet())).toContain('Sam ChenMember');
    press(one(byRole(root, 'button', 'Refresh, Check for the latest changes')));
    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(sheet().props.visible).toBe(false);
  });
});

const now = new Date(2026, 8, 30, 12).getTime();
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 8, day, hour, minute).toISOString();
const events: ActivityEvent[] = [
  {
    _id: 'd00000000000000000000001',
    group: group.id,
    type: 'expense_added',
    actor: { _id: you, name: 'Alex Rao' },
    createdAt: at(30, 9, 14),
    metadata: { description: 'Weekly groceries', amount: 1249.5, currency: 'INR' },
  },
  {
    _id: 'd00000000000000000000002',
    group: group.id,
    type: 'expense_updated',
    actor: { _id: 'a00000000000000000000003', name: 'Priya Shah' },
    createdAt: at(29, 19, 40),
    metadata: {
      expenseId: 'c00000000000000000000001',
      description: 'Wi-Fi',
      changes: { amount: { old: 899, new: 999 }, amountMinor: { old: 89900, new: 99900 } },
    },
  },
  {
    _id: 'd00000000000000000000003',
    group: group.id,
    type: 'settlement_recorded',
    actor: { _id: 'a00000000000000000000003', name: 'Priya Shah' },
    createdAt: at(27, 18, 15),
    metadata: { amount: 200, currency: 'INR', paidByName: 'Priya Shah', paidToName: 'Sam Chen' },
  },
];
const ready = (overrides: Partial<ActivityState> = {}): ActivityState => ({
  selected: null,
  target: { status: 'none' },
  groupId: group.id,
  status: 'ready',
  events,
  pagination: { page: 1, limit: 20, total: 25, totalPages: 2 },
  message: null,
  moreStatus: 'idle',
  ...overrides,
});
function activity(state: ActivityState, offline = false, pulling = false) {
  const handlers = { onRetry: vi.fn(), onMore: vi.fn(), onSelect: vi.fn(), onClose: vi.fn() };
  const root = render(
    <GroupActivity
      state={state}
      currentUserId={you}
      currency="INR"
      members={group.members.map(({ user }) => ({ id: user.id, name: user.name }))}
      offline={offline}
      pulling={pulling}
      now={now}
      {...handlers}
    />,
  );
  return { root, ...handlers };
}

describe('Group Activity', () => {
  it('groups events under day headings, newest first', () => {
    const { root } = activity(ready());
    const headings = byRole(root, 'header').map(text);
    expect(headings[0]).toBe('Changes in this Group');
    expect(headings.slice(1, 3)).toEqual(['Today', 'Yesterday']);
    expect(headings).toHaveLength(4);
  });

  it('says each change in plain language with names, amounts and time', () => {
    const { root, onSelect } = activity(ready());
    expect(
      byRole(root, 'button')
        .map((row) => row.props.accessibilityLabel)
        .slice(0, 3),
    ).toEqual([
      `You added Weekly groceries, ₹1,249.50, ${clockTime(events[0].createdAt)}`,
      `Priya Shah edited Wi-Fi, Amount ₹899.00 → ₹999.00, ${clockTime(events[1].createdAt)}`,
      `Priya Shah recorded a payment, Priya Shah → Sam Chen, ₹200.00, ${clockTime(events[2].createdAt)}`,
    ]);
    press(byRole(root, 'button')[1]);
    expect(onSelect).toHaveBeenCalledWith('d00000000000000000000002');
    expect(text(root)).not.toMatch(/[0-9a-f]{24}/);
  });

  it('says which events open their Expense and which open what was recorded', () => {
    const { root, onSelect } = activity(ready());
    const rows = byRole(root, 'button').slice(0, 3);
    expect(rows.map((row) => row.props.accessibilityHint)).toEqual([
      // An event that doesn't name its Expense can only show what was recorded.
      'Opens what was recorded',
      'Opens this Expense',
      'Opens what was recorded',
    ]);
    press(rows[1]);
    expect(onSelect).toHaveBeenCalledWith('d00000000000000000000002');
  });

  it('loads older activity with its own progress, and recovers from a failure', () => {
    const idle = activity(ready());
    press(one(byRole(idle.root, 'button', 'Load older activity')));
    expect(idle.onMore).toHaveBeenCalledOnce();
    act(() => {
      renderer?.unmount();
    });

    const loading = activity(ready({ moreStatus: 'loading' }));
    expect(byRole(loading.root, 'button', 'Load older activity')).toHaveLength(0);
    expect(text(one(hosts(loading.root, (p) => p.accessibilityLiveRegion === 'polite')))).toBe(
      'Loading older activity…',
    );
    act(() => {
      renderer?.unmount();
    });

    const failed = activity(ready({ moreStatus: 'error' }));
    expect(text(one(byRole(failed.root, 'alert')))).toContain('Couldn’t load older activity');
    press(one(byRole(failed.root, 'button', 'Try loading older activity')));
    expect(failed.onMore).toHaveBeenCalledOnce();
  });

  it('keeps events readable while updating, leaving the cue to the header or the pull', () => {
    const { root } = activity(ready({ status: 'loading' }));
    expect(byRole(root, 'progressbar')).toHaveLength(0);
    expect(byRole(root, 'button').every((row) => row.props.accessibilityState.disabled)).toBe(true);
  });

  it('draws a progress bar only for a first load that is not a pull', () => {
    const first = activity(ready({ status: 'loading', events: [], pagination: null }));
    one(byRole(first.root, 'progressbar', 'Loading Activity'));
    act(() => {
      renderer?.unmount();
    });
    const pulled = activity(
      ready({ status: 'loading', events: [], pagination: null }),
      false,
      true,
    );
    expect(byRole(pulled.root, 'progressbar')).toHaveLength(0);
  });

  it('explains a failed update and offers Try again', () => {
    const { root, onRetry } = activity(ready({ status: 'error', message: null }), true);
    expect(text(root)).toContain('Couldn’t update Activity');
    press(one(byRole(root, 'button', 'Try again')));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows an edit’s changes in its detail, without references', () => {
    const { root, onClose } = activity(
      ready({ selected: events[1], target: { status: 'deleted', description: 'Wi-Fi' } }),
    );
    expect(text(root)).toContain('What changed');
    expect(text(root)).toContain('Amount ₹899.00 → ₹999.00');
    expect(text(root)).toContain('This Expense has since been deleted.');
    expect(text(root)).not.toMatch(/[0-9a-f]{24}/);
    press(one(byRole(root, 'button', 'Back to Activity')));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('says what a Group edit changed, in its row and its detail', () => {
    const edit: ActivityEvent = {
      _id: 'd00000000000000000000004',
      group: group.id,
      type: 'group_updated',
      actor: { _id: you, name: 'Alex Rao' },
      createdAt: at(26, 11, 5),
      metadata: {
        changes: {
          memberRole: {
            old: { userId: 'a00000000000000000000003', role: 'member' },
            new: { userId: 'a00000000000000000000003', role: 'admin' },
          },
        },
      },
    };
    const list = activity(ready({ events: [edit] }));
    expect(text(list.root)).toContain('You made Priya Shah an admin');
    one(
      byRole(
        list.root,
        'button',
        `You made Priya Shah an admin, Member role, ${clockTime(edit.createdAt)}`,
      ),
    );
    act(() => {
      renderer?.unmount();
    });

    const { root } = activity(ready({ events: [edit], selected: edit }));
    expect(text(root)).toContain('What changed');
    expect(text(root)).toContain('Priya Shah’s role Member → Group admin');
    expect(text(root)).not.toMatch(/[0-9a-f]{24}/);
  });

  it('sets an edit’s amounts in the money font, in its row and its detail', () => {
    const edit: ActivityEvent = {
      ...events[1],
      metadata: {
        ...events[1].metadata,
        changes: {
          amount: { old: 899, new: 999 },
          amountMinor: { old: 89900, new: 99900 },
          splitBetween: {
            old: [{ user: you, amount: 899, amountMinor: 89900 }],
            new: [
              { user: you, amount: 499.5, amountMinor: 49950 },
              { user: 'a00000000000000000000002', amount: 499.5, amountMinor: 49950 },
            ],
          },
        },
      },
    };
    const amounts = (node: ReactTestInstance) =>
      node
        .findAll(
          (n) => isHost(n, 'Text') && JSON.stringify(n.props.style ?? {}).includes('IBMPlexMono'),
        )
        .map(text);

    const list = activity(ready({ events: [edit] }));
    const row = one(
      byRole(
        list.root,
        'button',
        `Priya Shah edited Wi-Fi, Amount ₹899.00 → ₹999.00, 2 more, ${clockTime(edit.createdAt)}`,
      ),
    );
    expect(amounts(row)).toEqual(['₹899.00', '₹999.00']);
    act(() => {
      renderer?.unmount();
    });

    const { root } = activity(ready({ events: [edit], selected: edit }));
    expect(text(root)).toContain('Amount ₹899.00 → ₹999.00');
    expect(text(root)).toContain('Sam Chen’s share Not included → ₹499.50');
    expect(amounts(root)).toEqual(['₹899.00', '₹999.00', '₹899.00', '₹499.50', '₹499.50']);
  });
});
