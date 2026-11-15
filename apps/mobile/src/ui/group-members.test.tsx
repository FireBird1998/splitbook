import type { ReactElement } from 'react';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  LeaveGroupState,
  MemberRemovalState,
  MemberRoleState,
  MobileGroup,
  StepDownState,
} from '../data/types';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import {
  findHosts,
  flatten,
  hairSpace,
  labelRuns,
  largeTextWindows,
  unreadText,
} from '../test-utils/layout';
import { setWindow } from '../test-utils/native';
import { ThemeContext } from './theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  GroupMembers,
  leaveDiscardsDraft,
  leaveExplanation,
  leaveNeedsConnection,
  memberChangesNeedConnection,
} = await import('./group-members');

const you = 'a00000000000000000000001',
  priyaId = 'a00000000000000000000002',
  samId = 'a00000000000000000000003';
const member = (id: string, name: string, role: 'admin' | 'member') => ({
  user: { id, name, email: `${id}@x.test`, image: null },
  role,
  joinedAt: new Date(),
});
const household: MobileGroup = {
  id: 'b00000000000000000000001',
  name: 'Maple House',
  description: 'Rent, bills and groceries for the flat',
  category: 'home',
  defaultCurrency: 'INR',
  alternateCurrencies: [],
  latestExpenseCurrency: null,
  members: [
    member(you, 'Alex Rivera', 'admin'),
    member(priyaId, 'Priya Shah', 'admin'),
    member(samId, 'Sam Chen', 'member'),
  ],
  startDate: null,
  endDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const trip: MobileGroup = {
  ...household,
  name: 'Goa Weekend',
  description: '',
  category: 'trip',
  defaultCurrency: 'EUR',
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
/** Inside the Leave Group sheet, which stays mounted (hidden) so it can slide in and out. */
const inSheet = (node: ReactTestInstance | null): boolean =>
  !!node && (isHost(node, 'Modal') || inSheet(node.parent));
/** On the page itself; `sheet()` reads the Leave Group sheet. */
const hosts = (root: ReactTestInstance, match: (props: Record<string, unknown>) => boolean) =>
  root.findAll(
    (node) =>
      typeof node.type === 'string' && match(node.props) && (inSheet(root) || !inSheet(node)),
  );
const byRole = (root: ReactTestInstance, role: string, label?: string) =>
  hosts(
    root,
    (p) => p.accessibilityRole === role && (label === undefined || p.accessibilityLabel === label),
  );
const one = (nodes: ReactTestInstance[]) => {
  expect(nodes).toHaveLength(1);
  return nodes[0];
};
const text = (node: ReactTestInstance) =>
  node
    .findAll((n) => isHost(n, 'Text') && (inSheet(node) || !inSheet(n)))
    .flatMap((n) => n.children.filter((c): c is string => typeof c === 'string'))
    .join('');
/** What TalkBack reads for each element that groups its contents. */
const spoken = (root: ReactTestInstance) =>
  hosts(root, (p) => p.accessible === true && typeof p.accessibilityLabel === 'string').map(
    (node) => node.props.accessibilityLabel as string,
  );

const closed: LeaveGroupState = {
  groupId: null,
  status: 'closed',
  code: null,
  message: null,
  draft: false,
  check: null,
};
const leaveActions = (state: Partial<LeaveGroupState> = {}, offline = false) => ({
  state: { ...closed, ...(state.status ? { groupId: household.id } : {}), ...state },
  offline,
  onOpen: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  onCheck: vi.fn(),
});

const idle: MemberRoleState = {
  groupId: null,
  userId: null,
  name: null,
  role: null,
  status: 'idle',
  message: null,
  done: null,
};
const roleActions = (state: Partial<MemberRoleState> = {}, offline = false) => ({
  state: { ...idle, ...(state.status ? { groupId: household.id } : {}), ...state },
  offline,
  onChange: vi.fn(),
  onMemberGone: vi.fn(),
  onDismissDone: vi.fn(),
});

const removalClosed: MemberRemovalState = {
  groupId: null,
  userId: null,
  name: null,
  status: 'closed',
  code: null,
  message: null,
  check: null,
};
const removalActions = (state: Partial<MemberRemovalState> = {}, offline = false) => ({
  state: { ...removalClosed, ...(state.status ? { groupId: household.id } : {}), ...state },
  offline,
  onReview: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  onCheck: vi.fn(),
  onOpenWeb: vi.fn(),
});

const stepDownClosed: StepDownState = { groupId: null, status: 'closed', message: null };
const stepDownActions = (state: Partial<StepDownState> = {}, offline = false) => ({
  state: { ...stepDownClosed, ...(state.status ? { groupId: household.id } : {}), ...state },
  offline,
  onReview: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
});

function page(overrides: Partial<Parameters<typeof GroupMembers>[0]> = {}) {
  const props = {
    group: household,
    currentUserId: you,
    back: { label: 'Back to Group', onPress: vi.fn() },
    invite: { onPress: vi.fn(), disabled: false, offline: false },
    leave: leaveActions(),
    roles: roleActions(),
    removal: removalActions(),
    stepDown: stepDownActions(),
    ...overrides,
  };
  return { root: render(<GroupMembers {...props} />), props };
}
/** A sheet, by its title, and whether it shows. */
const sheetTitled = (root: ReactTestInstance, title: string) =>
  one(root.findAll((node) => isHost(node, 'Modal') && text(node).startsWith(title)));
/** The Leave Group sheet. */
const sheet = (root: ReactTestInstance) => sheetTitled(root, 'Leave ');
/** Member options, the sheet a member's row opens. */
const options = (root: ReactTestInstance) => sheetTitled(root, 'Member options');
/** Presses the button labelled `label`, on the page or inside `within`. */
const press = (root: ReactTestInstance, label: string) =>
  act(() => {
    one(
      root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === label &&
          typeof node.props.onPress === 'function',
      ),
    ).props.onPress();
  });

describe('Members and Group details', () => {
  it('titles the page with the Group and returns from the back arrow', () => {
    const { root, props } = page();
    // A section's title keeps a hair space to spare (#639).
    expect(byRole(root, 'header').map(text)).toEqual([
      'Members and details',
      'Members\u00a0· 3\u200a',
    ]);
    expect(text(root)).toContain('Maple House');
    act(() => {
      one(byRole(root, 'button', 'Back to Group')).props.onPress();
    });
    expect(props.back.onPress).toHaveBeenCalledOnce();
  });

  it('shows a Household’s Theme, currency, Month lens and description', () => {
    const { root } = page();
    expect(spoken(root).slice(0, 4)).toEqual([
      'Theme: Household',
      'Currency: INR',
      'Expenses shown by: Month',
      'Description: Rent, bills and groceries for the flat',
    ]);
  });

  it('leaves out the Month lens for other Themes, and an empty description', () => {
    const { root } = page({ group: trip });
    expect(spoken(root).slice(0, 2)).toEqual(['Theme: Trip', 'Currency: EUR']);
    expect(text(root)).not.toContain('Expenses shown by');
    expect(text(root)).not.toContain('Description');
  });

  it('lists the members with their roles, marking you and each admin', () => {
    const { root } = page({ currentUserId: samId });
    expect(spoken(root).slice(4)).toEqual([
      'Alex Rivera, Admin',
      'Priya Shah, Admin',
      'Sam Chen, You, Member',
    ]);
    expect(text(root)).toContain('Alex RiveraAdmin');
    expect(text(root)).toContain('Sam Chen\u00a0· YouMember');
    const rows = hosts(root, (p) => p.accessible === true).slice(4);
    const shields = rows.map(
      (row) =>
        row.findAll(
          (node) => isHost(node, 'Ionicons') && node.props.name === 'shield-checkmark-outline',
        ).length,
    );
    expect(shields).toEqual([1, 1, 0]);
  });

  it('invites through the share flow', () => {
    const { root, props } = page();
    const invite = one(byRole(root, 'button', 'Invite people'));
    expect(invite.props.accessibilityState).toEqual({ disabled: false, busy: false });
    act(() => {
      invite.props.onPress();
    });
    expect(props.invite.onPress).toHaveBeenCalledOnce();
  });

  it('says Invite needs a connection while offline', () => {
    const { root } = page({ invite: { onPress: vi.fn(), disabled: false, offline: true } });
    const invite = one(byRole(root, 'button', 'Invite people'));
    expect(invite.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(invite.props.accessibilityHint).toBe('Inviting needs a connection.');
    expect(text(root)).toContain('Inviting needs a connection.');
  });

  it('keeps Invite unavailable while a link is being read', () => {
    const { root } = page({ invite: { onPress: vi.fn(), disabled: true, offline: false } });
    expect(one(byRole(root, 'button', 'Invite people')).props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
    expect(text(root)).not.toContain('Inviting needs a connection.');
  });

  it('tells an admin to tap a member, and anyone else who can change roles (#1252)', () => {
    const admin = page().root;
    expect(text(admin)).toContain('Tap a member to change their role or remove them.');
    expect(text(admin)).not.toContain('Only admins can change roles or remove members.');
    expect(text(admin)).not.toContain('done on the web');
    act(() => renderer?.unmount());
    const other = page({ currentUserId: samId }).root;
    expect(text(other)).toContain('Only admins can change roles or remove members.');
    expect(text(other)).not.toContain('Tap a member');
  });

  it('explains a Group that is no longer available', () => {
    const { root } = page({ group: null, unavailable: 'You no longer have access to this group.' });
    expect(text(one(byRole(root, 'alert')))).toBe('You no longer have access to this group.');
    expect(byRole(root, 'button', 'Invite people')).toHaveLength(0);
  });
});

describe('Changing a member’s role (#1252)', () => {
  /** Each member row's dots, in list order. */
  const dots = (root: ReactTestInstance) =>
    hosts(root, (p) => p.accessible === true || p.accessibilityRole === 'button')
      .filter((row) => /^(Alex|Priya|Sam)/.test(String(row.props.accessibilityLabel)))
      .map(
        (row) =>
          row.findAll((node) => isHost(node, 'Ionicons') && node.props.name === 'ellipsis-vertical')
            .length,
      );

  it('gives an admin three dots on every other member’s row, each opening their options', () => {
    const { root } = page();
    expect(byRole(root, 'button', 'Priya Shah, Admin, options')).toHaveLength(1);
    expect(byRole(root, 'button', 'Sam Chen, Member, options')).toHaveLength(1);
    // Your own row has dots too while another admin exists, for Step down (#1254).
    expect(byRole(root, 'button', 'Alex Rivera, You, Admin, options')).toHaveLength(1);
    expect(dots(root)).toEqual([1, 1, 1]);
    expect(options(root).props.visible).toBe(false);
    press(root, 'Sam Chen, Member, options');
    expect(options(root).props.visible).toBe(true);
  });

  it('gives a member who isn’t an admin plain rows that do nothing', () => {
    const { root } = page({ currentUserId: samId });
    expect(
      byRole(root, 'button').filter((b) => /options$/.test(b.props.accessibilityLabel)),
    ).toEqual([]);
    expect(dots(root)).toEqual([0, 0, 0]);
    expect(root.findAll((n) => isHost(n, 'Modal') && text(n).startsWith('Member options'))).toEqual(
      [],
    );
  });

  it('offers Make admin for a member: chosen, it is sent at once and the sheet closes', () => {
    const { root, props } = page();
    press(root, 'Sam Chen, Member, options');
    const sheet = options(root);
    expect(text(sheet)).toContain('Sam Chen');
    expect(text(sheet)).toContain('Member');
    expect(text(sheet)).toContain('Can change Group settings, Tags and members');
    expect(text(sheet)).not.toContain('Make member');
    press(sheet, 'Make admin, Can change Group settings, Tags and members');
    expect(props.roles.onChange).toHaveBeenCalledExactlyOnceWith(samId, 'admin');
    expect(options(root).props.visible).toBe(false);
  });

  it('offers Make member for an admin', () => {
    const { root, props } = page();
    press(root, 'Priya Shah, Admin, options');
    const sheet = options(root);
    expect(text(sheet)).not.toContain('Make admin');
    press(sheet, 'Make member, Keeps adding Expenses; can’t change the Group');
    expect(props.roles.onChange).toHaveBeenCalledExactlyOnceWith(priyaId, 'member');
  });

  it('closes Member options with Close, sending nothing', () => {
    const { root, props } = page();
    press(root, 'Sam Chen, Member, options');
    press(options(root), 'Close');
    expect(options(root).props.visible).toBe(false);
    expect(props.roles.onChange).not.toHaveBeenCalled();
  });

  it('dims a row while its role changes and says what is happening', () => {
    const { root } = page({
      roles: roleActions({ status: 'changing', userId: samId, name: 'Sam Chen', role: 'admin' }),
    });
    const row = one(byRole(root, 'button', 'Sam Chen, Making admin…'));
    expect(row.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(text(row)).toContain('Making admin…');
    expect(text(row)).not.toContain('Member');
    const other = page({
      roles: roleActions({
        status: 'changing',
        userId: priyaId,
        name: 'Priya Shah',
        role: 'member',
      }),
    }).root;
    expect(text(other)).toContain('Making member…');
  });

  it('keeps the options of others waiting while a role changes', () => {
    const { root, props } = page({
      roles: roleActions({ status: 'changing', userId: samId, name: 'Sam Chen', role: 'admin' }),
    });
    press(root, 'Priya Shah, Admin, options');
    const action = one(
      options(root).findAll(
        (n) =>
          typeof n.type === 'string' &&
          n.props.accessibilityRole === 'button' &&
          String(n.props.accessibilityLabel).startsWith('Make member'),
      ),
    );
    expect(action.props.accessibilityState).toEqual({ disabled: true, busy: false });
    act(() => action.props.onPress?.());
    expect(props.roles.onChange).not.toHaveBeenCalled();
  });

  // #1262 (3): a change under way on another Group keeps these options waiting, and says why.
  it('says why the options wait while another Group’s role change is being made', () => {
    const { root, props } = page({
      roles: roleActions({
        status: 'changing',
        groupId: 'b00000000000000000000009',
        userId: samId,
        name: 'Sam Chen',
        role: 'admin',
      }),
    });
    // Nothing on this Group's list is busy.
    expect(text(root)).not.toContain('Making admin…');
    press(root, 'Priya Shah, Admin, options');
    const sheet = options(root);
    expect(text(sheet)).toContain('Another role change is still being made.');
    const action = one(
      sheet.findAll(
        (n) =>
          typeof n.type === 'string' &&
          n.props.accessibilityRole === 'button' &&
          String(n.props.accessibilityLabel).startsWith('Make member'),
      ),
    );
    expect(action.props.accessibilityState).toEqual({ disabled: true, busy: false });
    act(() => action.props.onPress?.());
    expect(props.roles.onChange).not.toHaveBeenCalled();
  });

  it('explains a failed change above the Group’s details', () => {
    const { root } = page({
      roles: roleActions({
        status: 'failed',
        userId: samId,
        name: 'Sam Chen',
        role: 'admin',
        message: 'Couldn’t make Sam Chen an admin. Try again.',
      }),
    });
    expect(text(one(byRole(root, 'alert')))).toBe('Couldn’t make Sam Chen an admin. Try again.');
    // Above the details: the alert comes before the Theme row.
    const order = hosts(
      root,
      (p) => p.accessibilityRole === 'alert' || p.accessibilityLabel === 'Theme: Household',
    ).map((node) => node.props.accessibilityRole ?? 'details');
    expect(order).toEqual(['alert', 'details']);
    // The row is back to what it was.
    expect(byRole(root, 'button', 'Sam Chen, Member, options')).toHaveLength(1);
  });

  it('names the person in a Snackbar with no action, which goes after a while', async () => {
    vi.useFakeTimers();
    try {
      const { root, props } = page({ roles: roleActions({ done: 'Sam Chen is now an admin' }) });
      const snack = one(hosts(root, (p) => p.accessibilityLiveRegion === 'polite'));
      expect(text(snack)).toBe('Sam Chen is now an admin');
      expect(
        snack.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button'),
      ).toEqual([]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(props.roles.onDismissDone).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('offline: rows still open, the options are off with the note, nothing is sent', () => {
    const { root, props } = page({
      invite: { onPress: vi.fn(), disabled: false, offline: true },
      leave: leaveActions({}, true),
      roles: roleActions({}, true),
    });
    expect(text(root)).toContain(memberChangesNeedConnection);
    expect(text(root)).not.toContain('Tap a member');
    press(root, 'Sam Chen, Member, options');
    const sheet = options(root);
    expect(sheet.props.visible).toBe(true);
    expect(text(sheet)).toContain(memberChangesNeedConnection);
    const action = one(
      sheet.findAll(
        (n) =>
          typeof n.type === 'string' &&
          n.props.accessibilityRole === 'button' &&
          String(n.props.accessibilityLabel).startsWith('Make admin'),
      ),
    );
    expect(action.props.accessibilityState).toEqual({ disabled: true, busy: false });
    act(() => action.props.onPress?.());
    expect(props.roles.onChange).not.toHaveBeenCalled();
  });

  it('closes Member options when the member leaves the list, their role changes or you stop being an admin', () => {
    const { root, props } = page();
    press(root, 'Sam Chen, Member, options');
    act(() => {
      renderer!.update(
        <GroupMembers
          {...props}
          group={{ ...household, members: household.members.slice(0, 2) }}
        />,
      );
    });
    expect(options(root).props.visible).toBe(false);
    // A Snackbar says so (MembersRolesNotes).
    expect(props.roles.onMemberGone).toHaveBeenCalledExactlyOnceWith(samId, 'Sam Chen');

    act(() => renderer!.update(<GroupMembers {...props} />));
    press(root, 'Sam Chen, Member, options');
    act(() => {
      renderer!.update(
        <GroupMembers
          {...props}
          group={{
            ...household,
            members: household.members.map((m) =>
              m.user.id === samId ? { ...m, role: 'admin' as const } : m,
            ),
          }}
        />,
      );
    });
    // Another admin changed Sam's role meanwhile: the option shown would be the other one.
    expect(options(root).props.visible).toBe(false);
    expect(props.roles.onMemberGone).toHaveBeenCalledOnce();
    act(() => renderer!.update(<GroupMembers {...props} />));

    press(root, 'Priya Shah, Admin, options');
    act(() => {
      renderer!.update(
        <GroupMembers
          {...props}
          group={{
            ...household,
            members: household.members.map((m) =>
              m.user.id === you ? { ...m, role: 'member' as const } : m,
            ),
          }}
        />,
      );
    });
    expect(root.findAll((n) => isHost(n, 'Modal') && text(n).startsWith('Member options'))).toEqual(
      [],
    );
  });
});

describe('Removing a member (#1253)', () => {
  const removeSheet = (root: ReactTestInstance) => sheetTitled(root, 'Remove ');
  const buttonIn = (root: ReactTestInstance, label: string) =>
    root.findAll(
      (n) =>
        typeof n.type === 'string' &&
        n.props.accessibilityRole === 'button' &&
        n.props.accessibilityLabel === label,
    );
  const refused = (code: string, message: string, check: 'balances' | 'web' | null = null) =>
    removalActions({
      status: 'refused',
      userId: samId,
      name: 'Sam Chen',
      code,
      message,
      check,
    });

  it('offers Remove from Group, in red, for a member and an admin: it asks first', () => {
    const { root, props } = page();
    press(root, 'Sam Chen, Member, options');
    expect(text(options(root))).toContain('You’ll be asked to confirm');
    // In the error colour, on its title as on its tile (board MembersRolesSheet 8).
    const colour = options(root)
      .findAll((n) => isHost(n, 'Text') && text(n) === 'Remove from Group')
      .flatMap((n) => [n.props.style].flat(Infinity))
      .filter((style) => style && 'color' in style)
      .at(-1)?.color;
    expect(colour).toBe(getSemanticTokens('light').status.negative);
    press(options(root), 'Remove from Group, You’ll be asked to confirm');
    expect(props.removal.onReview).toHaveBeenCalledExactlyOnceWith(samId);
    expect(options(root).props.visible).toBe(false);
    press(root, 'Priya Shah, Admin, options');
    press(options(root), 'Remove from Group, You’ll be asked to confirm');
    expect(props.removal.onReview).toHaveBeenLastCalledWith(priyaId);
  });

  it('asks in a sheet naming the member and the Group, with Cancel and a red Remove', () => {
    const { root, props } = page({
      removal: removalActions({ status: 'confirm', userId: samId, name: 'Sam Chen' }),
    });
    const sheet = removeSheet(root);
    expect(sheet.props.visible).toBe(true);
    expect(text(sheet)).toContain('Remove Sam Chen from Maple House?');
    expect(text(sheet)).toContain(
      'Sam won’t see this Group or its balances any more. The Expenses and payments they’re part of stay for everyone else.',
    );
    expect(text(sheet)).toContain('They can rejoin with an invite.');
    press(sheet, 'Cancel');
    expect(props.removal.onCancel).toHaveBeenCalledOnce();
    press(sheet, 'Remove from Group');
    expect(props.removal.onConfirm).toHaveBeenCalledOnce();
  });

  it('shows progress while removing, and can’t be dismissed or sent twice', () => {
    const { root } = page({
      removal: removalActions({ status: 'removing', userId: samId, name: 'Sam Chen' }),
    });
    const sheet = removeSheet(root);
    expect(
      sheet.findAll(
        (n) => typeof n.type === 'string' && n.props.accessibilityRole === 'progressbar',
      ),
    ).not.toHaveLength(0);
    expect(one(buttonIn(sheet, 'Remove from Group')).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(one(buttonIn(sheet, 'Cancel')).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('not settled up: the server’s sentence, Go to Balances, Close, and no Remove', () => {
    const words = 'Sam Chen owes ₹300.00 in this Group. Settle up before removing them.';
    const { root, props } = page({ removal: refused('OPEN_BALANCE', words, 'balances') });
    const sheet = removeSheet(root);
    expect(text(one(sheet.findAll((n) => n.props.accessibilityRole === 'alert')))).toBe(words);
    expect(text(sheet)).not.toContain('They can rejoin with an invite.');
    expect(buttonIn(sheet, 'Remove from Group')).toEqual([]);
    press(sheet, 'Go to Balances');
    expect(props.removal.onCheck).toHaveBeenCalledOnce();
    press(sheet, 'Close');
    expect(props.removal.onCancel).toHaveBeenCalledOnce();
  });

  it('a recurring Expense: Android’s sentence and Open on the web, nothing that can’t fix it', () => {
    const words =
      'Rent (recurring) still includes Sam Chen. Remove them from it on the web before removing them from the Group.';
    const { root, props } = page({
      removal: refused('RECURRING_EXPENSE_PROBLEM', words, 'web'),
    });
    const sheet = removeSheet(root);
    expect(text(sheet)).toContain(words);
    expect(buttonIn(sheet, 'Remove from Group')).toEqual([]);
    expect(buttonIn(sheet, 'Go to Balances')).toEqual([]);
    press(sheet, 'Open on the web');
    expect(props.removal.onOpenWeb).toHaveBeenCalledOnce();
  });

  it('the Group changed: an error, with the explanation and Remove kept, to try again', () => {
    const words = 'This Group changed while you were removing this member. Try again.';
    const { root, props } = page({ removal: refused('REMOVAL_CONFLICT', words) });
    const sheet = removeSheet(root);
    expect(text(one(sheet.findAll((n) => n.props.accessibilityRole === 'alert')))).toBe(words);
    expect(text(sheet)).toContain('They can rejoin with an invite.');
    press(sheet, 'Remove from Group');
    expect(props.removal.onConfirm).toHaveBeenCalledOnce();
    expect(buttonIn(sheet, 'Cancel')).toHaveLength(1);
  });

  it('the last admin: the server’s sentence in place of the text and the button', () => {
    const words = 'Maple House needs an admin. Make someone else an admin first.';
    const { root } = page({ removal: refused('LAST_ADMIN', words) });
    const sheet = removeSheet(root);
    expect(text(sheet)).toContain(words);
    expect(text(sheet)).not.toContain('They can rejoin with an invite.');
    expect(buttonIn(sheet, 'Remove from Group')).toEqual([]);
    expect(buttonIn(sheet, 'Close')).toHaveLength(1);
  });

  it('a failure keeps Remove, to try again', () => {
    const { root } = page({
      removal: removalActions({
        status: 'error',
        userId: samId,
        name: 'Sam Chen',
        message: 'Couldn’t remove Sam Chen. Try again.',
      }),
    });
    const sheet = removeSheet(root);
    expect(text(one(sheet.findAll((n) => n.props.accessibilityRole === 'alert')))).toBe(
      'Couldn’t remove Sam Chen. Try again.',
    );
    expect(one(buttonIn(sheet, 'Remove from Group')).props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('offline: Remove is off in both sheets, with the note', () => {
    const { root, props } = page({
      roles: roleActions({}, true),
      removal: removalActions({ status: 'confirm', userId: samId, name: 'Sam Chen' }, true),
    });
    const sheet = removeSheet(root);
    expect(one(buttonIn(sheet, 'Remove from Group')).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(text(sheet)).toContain(memberChangesNeedConnection);
    act(() => renderer!.update(<GroupMembers {...props} removal={removalActions({}, true)} />));
    press(root, 'Sam Chen, Member, options');
    const option = one(buttonIn(options(root), 'Remove from Group, You’ll be asked to confirm'));
    expect(option.props.accessibilityState).toEqual({ disabled: true, busy: false });
    act(() => option.props.onPress?.());
    expect(props.removal.onReview).not.toHaveBeenCalled();
  });
});

describe('Stepping down to member (#1254)', () => {
  const stepDownSheet = (root: ReactTestInstance) => sheetTitled(root, 'Step down to member?');
  const buttonIn = (root: ReactTestInstance, label: string) =>
    root.findAll(
      (n) =>
        typeof n.type === 'string' &&
        n.props.accessibilityRole === 'button' &&
        n.props.accessibilityLabel === label,
    );
  const onlyAdmin: MobileGroup = {
    ...household,
    members: household.members.map((m) =>
      m.user.id === priyaId ? { ...m, role: 'member' as const } : m,
    ),
  };

  it('gives your own row three dots while another admin exists, offering only Step down', () => {
    const { root, props } = page();
    press(root, 'Alex Rivera, You, Admin, options');
    const sheet = options(root);
    expect(sheet.props.visible).toBe(true);
    expect(text(sheet)).toContain('Alex Rivera · You');
    expect(text(sheet)).not.toContain('Make member');
    expect(text(sheet)).not.toContain('Remove from Group');
    press(sheet, 'Step down to member, You’ll be asked to confirm');
    expect(props.stepDown.onReview).toHaveBeenCalledOnce();
    expect(options(root).props.visible).toBe(false);
  });

  it('gives the only admin’s own row no dots, and nothing to tap', () => {
    const { root } = page({ group: onlyAdmin });
    expect(spoken(root)).toContain('Alex Rivera, You, Admin');
    expect(byRole(root, 'button', 'Alex Rivera, You, Admin, options')).toEqual([]);
  });

  it('asks first, naming who stays an admin, with Cancel and a filled Step down', () => {
    const { root, props } = page({ stepDown: stepDownActions({ status: 'confirm' }) });
    const sheet = stepDownSheet(root);
    expect(sheet.props.visible).toBe(true);
    expect(text(sheet)).toContain(
      'You’ll stay in Maple House and keep adding Expenses. You won’t be able to change Group settings, Tags or members.',
    );
    expect(text(sheet)).toContain('Priya Shah stays an admin.');
    press(sheet, 'Cancel');
    expect(props.stepDown.onCancel).toHaveBeenCalledOnce();
    press(sheet, 'Step down');
    expect(props.stepDown.onConfirm).toHaveBeenCalledOnce();
  });

  it('names every other admin who stays', () => {
    const { root } = page({
      group: {
        ...household,
        members: household.members.map((m) =>
          m.user.id === samId ? { ...m, role: 'admin' as const } : m,
        ),
      },
      stepDown: stepDownActions({ status: 'confirm' }),
    });
    expect(text(stepDownSheet(root))).toContain('Priya Shah and Sam Chen stay admins.');
  });

  it('shows progress while stepping down, and can’t be dismissed or sent twice', () => {
    const { root } = page({ stepDown: stepDownActions({ status: 'stepping' }) });
    const sheet = stepDownSheet(root);
    expect(
      sheet.findAll(
        (n) => typeof n.type === 'string' && n.props.accessibilityRole === 'progressbar',
      ),
    ).not.toHaveLength(0);
    expect(one(buttonIn(sheet, 'Step down')).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(one(buttonIn(sheet, 'Cancel')).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('the last admin after a race: the server’s sentence in place of the text and the button', () => {
    const words = 'Maple House needs an admin. Make someone else an admin first.';
    const { root } = page({
      stepDown: stepDownActions({ status: 'refused', message: words }),
    });
    const sheet = stepDownSheet(root);
    expect(text(one(sheet.findAll((n) => n.props.accessibilityRole === 'alert')))).toBe(words);
    expect(text(sheet)).not.toContain('You’ll stay in Maple House');
    expect(buttonIn(sheet, 'Step down')).toEqual([]);
    expect(buttonIn(sheet, 'Close')).toHaveLength(1);
  });

  it('a failure keeps Step down, to try again', () => {
    const { root } = page({
      stepDown: stepDownActions({ status: 'error', message: 'Couldn’t step down. Try again.' }),
    });
    const sheet = stepDownSheet(root);
    expect(text(one(sheet.findAll((n) => n.props.accessibilityRole === 'alert')))).toBe(
      'Couldn’t step down. Try again.',
    );
    expect(one(buttonIn(sheet, 'Step down')).props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('closes your own options once no other admin is left', () => {
    const { root, props } = page();
    press(root, 'Alex Rivera, You, Admin, options');
    expect(options(root).props.visible).toBe(true);
    act(() => renderer!.update(<GroupMembers {...props} group={onlyAdmin} />));
    expect(options(root).props.visible).toBe(false);
    expect(props.stepDown.onReview).not.toHaveBeenCalled();
  });

  // Board MembersRolesDone 16: the screen becomes the member's view.
  it('after stepping down: your own row plain, the member’s line, and the Snackbar', () => {
    const { root } = page({
      group: {
        ...household,
        members: household.members.map((m) =>
          m.user.id === you ? { ...m, role: 'member' as const } : m,
        ),
      },
      roles: roleActions({ done: 'You’re now a member of Maple House' }),
    });
    expect(spoken(root)).toContain('Alex Rivera, You, Member');
    expect(
      byRole(root, 'button').filter((b) => /options$/.test(b.props.accessibilityLabel)),
    ).toEqual([]);
    expect(text(root)).toContain('Only admins can change roles or remove members.');
    expect(text(one(hosts(root, (p) => p.accessibilityLiveRegion === 'polite')))).toBe(
      'You’re now a member of Maple House',
    );
  });

  it('offline: Step down is off, with the note', () => {
    const { root } = page({
      roles: roleActions({}, true),
      stepDown: stepDownActions({ status: 'confirm' }, true),
    });
    const sheet = stepDownSheet(root);
    expect(one(buttonIn(sheet, 'Step down')).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(text(sheet)).toContain(memberChangesNeedConnection);
  });
});

describe('Leave Group', () => {
  it('is the last action on the page, a destructive one that opens the sheet', () => {
    const { root, props } = page();
    const buttons = byRole(root, 'button');
    const leave = buttons.at(-1)!;
    expect(leave.props.accessibilityLabel).toBe('Leave Group');
    expect(leave.props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(sheet(root).props.visible).toBe(false);
    act(() => {
      leave.props.onPress();
    });
    expect(props.leave.onOpen).toHaveBeenCalledOnce();
  });

  it('says leaving needs a connection while offline', () => {
    const { root } = page({ leave: leaveActions({}, true) });
    const leave = one(byRole(root, 'button', 'Leave Group'));
    expect(leave.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(leave.props.accessibilityHint).toBe(leaveNeedsConnection);
    expect(text(root)).toContain(leaveNeedsConnection);
  });

  it('confirms in a sheet titled with the Group, explaining what leaving means', () => {
    const { root, props } = page({ leave: leaveActions({ status: 'confirm' }) });
    const modal = sheet(root);
    expect(modal.props.visible).toBe(true);
    expect(byRole(modal, 'header').map(text)).toEqual(['Leave Maple House?']);
    expect(text(modal)).toContain(leaveExplanation);
    expect(text(modal)).not.toContain(leaveDiscardsDraft);
    expect(byRole(modal, 'button', 'Go to Balances')).toHaveLength(0);
    const confirm = one(byRole(modal, 'button', 'Leave Group'));
    expect(confirm.props.accessibilityState).toEqual({ disabled: false, busy: false });
    act(() => {
      confirm.props.onPress();
    });
    expect(props.leave.onConfirm).toHaveBeenCalledOnce();
    act(() => {
      one(byRole(modal, 'button', 'Cancel')).props.onPress();
    });
    expect(props.leave.onCancel).toHaveBeenCalledOnce();
  });

  it('says a draft kept on this device will be discarded', () => {
    const { root } = page({ leave: leaveActions({ status: 'confirm', draft: true }) });
    expect(text(sheet(root))).toContain(leaveDiscardsDraft);
  });

  it('disables the sheet and shows progress while leaving', () => {
    const { root } = page({ leave: leaveActions({ status: 'leaving' }) });
    const modal = sheet(root);
    expect(one(byRole(modal, 'button', 'Leave Group')).props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
    expect(one(byRole(modal, 'button', 'Cancel')).props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
    expect(one(byRole(modal, 'progressbar')).props.accessibilityLabel).toBe('Leaving this Group');
  });

  it('can’t be confirmed offline', () => {
    const { root } = page({ leave: leaveActions({ status: 'confirm' }, true) });
    const confirm = one(byRole(sheet(root), 'button', 'Leave Group'));
    expect(confirm.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(confirm.props.accessibilityHint).toBe(leaveNeedsConnection);
  });

  it('shows an open balance in the server’s words and offers Balances', () => {
    const message = 'Settle up before you leave: you owe ₹1,480.00 in this Group.';
    const { root, props } = page({
      leave: leaveActions({ status: 'refused', code: 'OPEN_BALANCE', message, check: 'balances' }),
    });
    const modal = sheet(root);
    expect(text(one(byRole(modal, 'alert')))).toBe(message);
    expect(byRole(modal, 'button', 'Leave Group')).toHaveLength(0);
    act(() => {
      one(byRole(modal, 'button', 'Go to Balances')).props.onPress();
    });
    expect(props.leave.onCheck).toHaveBeenCalledOnce();
  });

  // #1254 (MembersRolesOffline 24): Android makes admins now, so the last admin chooses one here.
  it('offers the last admin Choose an admin, which closes the sheet onto the list', () => {
    const message = 'Make someone else an admin before you leave.';
    const { root, props } = page({
      leave: leaveActions({ status: 'refused', code: 'LAST_ADMIN', message }),
    });
    const modal = sheet(root);
    expect(text(one(byRole(modal, 'warning').concat(byRole(modal, 'alert'))))).toBe(message);
    expect(text(modal)).not.toContain('web');
    expect(byRole(modal, 'button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Close, staying in this Group',
      'Close',
      'Choose an admin',
    ]);
    press(modal, 'Choose an admin');
    expect(props.leave.onCancel).toHaveBeenCalledOnce();
    // What the admin must do first, in the warning tone, with nothing else (board 24).
    expect(text(modal)).not.toContain(leaveExplanation);
    const alert = one(byRole(modal, 'alert'));
    expect(flatten(alert.props.style).backgroundColor).toBe(getSemanticTokens('light').warning.bg);
  });

  it('names a recurring Expense that still includes the member, and only closes (#257)', () => {
    const message =
      'Rent (recurring) still includes you. Ask an admin to remove you from it, then leave.';
    const { root } = page({
      leave: leaveActions({ status: 'refused', code: 'RECURRING_EXPENSE_PROBLEM', message }),
    });
    const modal = sheet(root);
    expect(text(one(byRole(modal, 'alert')))).toBe(message);
    expect(byRole(modal, 'button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Cancel, staying in this Group',
      'Cancel',
    ]);
  });

  it('offers to try again after a concurrent change', () => {
    const { root } = page({
      leave: leaveActions({
        status: 'refused',
        code: 'LEAVE_CONFLICT',
        message: 'This Group changed while you were leaving. Try again.',
      }),
    });
    expect(one(byRole(sheet(root), 'button', 'Leave Group')).props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
  });

  it('blocks leaving while a save may already be recorded, offering Expenses', () => {
    const message =
      'An Expense save in this Group isn’t confirmed yet. Check it on Expenses first: it may already be recorded and change your balance.';
    const { root, props } = page({
      leave: leaveActions({ status: 'blocked', message, check: 'expenses', draft: true }),
    });
    const modal = sheet(root);
    expect(text(one(byRole(modal, 'alert')))).toBe(message);
    expect(text(modal)).not.toContain(leaveDiscardsDraft);
    expect(byRole(modal, 'button', 'Leave Group')).toHaveLength(0);
    act(() => {
      one(byRole(modal, 'button', 'Go to Expenses')).props.onPress();
    });
    expect(props.leave.onCheck).toHaveBeenCalledOnce();
  });
});

it('warns the final member explicitly and labels the irreversible confirmation', () => {
  const finalGroup = { ...household, members: [household.members[0]] };
  const { root, props } = page({
    group: finalGroup,
    leave: leaveActions({ status: 'confirm', deleteIfLastMember: true }),
  });
  const modal = sheet(root);
  expect(text(modal)).toContain('Leaving will permanently delete this Group and its history.');
  expect(text(modal)).toContain('Expenses, Settlements and Activity');
  const confirm = one(byRole(modal, 'button', 'Leave and delete Group'));
  act(() => confirm.props.onPress());
  expect(props.leave.onConfirm).toHaveBeenCalledOnce();
  act(() => one(byRole(modal, 'button', 'Cancel')).props.onPress());
  expect(props.leave.onCancel).toHaveBeenCalledOnce();
});

// #639: on the emulator at density 160, "Members · 3" drew "Members ·": the title is as wide as
// its words, and Android, laying it out again to draw it, wrapped the count out of sight. It
// keeps room to spare.
describe.each(['light', 'dark'] as const)('Members at large text in %s (#639)', (mode) => {
  it.each(largeTextWindows)(
    'keeps the members’ count whole, $width dp at $fontScale× text',
    (size) => {
      setWindow(size);
      const root = render(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <GroupMembers
            group={household}
            currentUserId={you}
            back={{ label: 'Back to Group', onPress: vi.fn() }}
            invite={{ onPress: vi.fn(), disabled: false, offline: false }}
            leave={leaveActions()}
            roles={roleActions()}
            removal={removalActions()}
            stepDown={stepDownActions()}
          />
        </ThemeContext.Provider>,
      );
      expect(labelRuns(root, 'Members\u00a0· 3')).toEqual([['Members\u00a0· 3', hairSpace]]);
    },
  );
});

// #639: at 200% on a 360dp phone, the Group's details broke their values mid-word beside their
// labels ("Mon / th" beside "Expenses shown by", "dev / elopment"), and the title read "Members
// and det…". A value goes under its label where it would be left too narrow a column.
describe.each(['light', 'dark'] as const)('Members’ details at large text in %s (#639)', (mode) => {
  it.each(largeTextWindows)('read in full, $width dp at $fontScale× text', (size) => {
    setWindow(size);
    act(() => {
      renderer = create(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <GroupMembers
            group={{
              ...household,
              description: 'Fictional isolated data for native development only.',
            }}
            currentUserId={you}
            back={{ label: 'Back to Group', onPress: vi.fn() }}
            invite={{ onPress: vi.fn(), disabled: false, offline: false }}
            leave={leaveActions()}
            roles={roleActions()}
            removal={removalActions()}
            stepDown={stepDownActions()}
          />
        </ThemeContext.Provider>,
      );
    });
    const tree = renderer!.toJSON() as ReactTestRendererJSON;
    const [bar] = findHosts(
      tree,
      (props, type) => type === 'View' && flatten(props.style).minHeight === 64,
    );
    // The details, in the first Card, inset 16dp from the screen's edges.
    const [details] = findHosts(
      tree,
      (props) =>
        flatten(props.style).borderRadius === 14 && flatten(props.style).overflow === 'hidden',
    );
    expect(
      findHosts(details!, (props) => props.accessibilityLabel === 'Expenses shown by: Month'),
    ).toHaveLength(1);
    expect(unreadText(bar!, size.fontScale, size.width)).toEqual([]);
    expect(unreadText(details!, size.fontScale, size.width - 32)).toEqual([]);
  });
});

type Json = ReactTestRendererJSON | ReactTestRendererJSON[] | null;
/** The page without its sheets, which lie over it. */
const screenOnly = (node: Json): Json =>
  node && !Array.isArray(node)
    ? {
        ...node,
        children:
          node.children
            ?.filter((child) => typeof child === 'string' || child.type !== 'Modal')
            .map((child) => (typeof child === 'string' ? child : (screenOnly(child) as never))) ??
          null,
      }
    : node;

// #1252 (board MembersRoles130): the list with its dots and a busy row, a failed change's Banner,
// and Member options read in full at large text: names wrap, the shield and dots keep their size.
describe.each(['light', 'dark'] as const)('Member roles at large text in %s (#1252)', (mode) => {
  it.each(largeTextWindows)(
    'reads the list, the Banner and Member options in full, $width dp at $fontScale× text',
    (size) => {
      setWindow(size);
      const props = {
        group: household,
        currentUserId: you,
        back: { label: 'Back to Group', onPress: vi.fn() },
        invite: { onPress: vi.fn(), disabled: false, offline: false },
        leave: leaveActions(),
        roles: roleActions({
          status: 'changing',
          userId: priyaId,
          name: 'Priya Shah',
          role: 'member',
        }),
        removal: removalActions(),
        stepDown: stepDownActions(),
      };
      const failed = roleActions({
        status: 'failed',
        userId: samId,
        name: 'Sam Chen',
        role: 'admin',
        message: 'Couldn’t make Sam Chen an admin. Try again.',
      });
      act(() => {
        renderer = create(
          <ThemeContext.Provider value={getSemanticTokens(mode)}>
            <GroupMembers {...props} />
          </ThemeContext.Provider>,
        );
      });
      // The page's content lies 16dp in from each edge.
      expect(
        unreadText(screenOnly(renderer!.toJSON()) as never, size.fontScale, size.width - 32),
      ).toEqual([]);
      act(() => {
        renderer!.update(
          <ThemeContext.Provider value={getSemanticTokens(mode)}>
            <GroupMembers {...props} roles={failed} />
          </ThemeContext.Provider>,
        );
      });
      expect(
        unreadText(screenOnly(renderer!.toJSON()) as never, size.fontScale, size.width - 32),
      ).toEqual([]);
      press(renderer!.root, 'Sam Chen, Member, options');
      const [modal] = findHosts(
        renderer!.toJSON() as never,
        (p, type) => type === 'Modal' && p.visible === true,
      );
      expect(modal).toBeDefined();
      expect(unreadText(modal!, size.fontScale, size.width)).toEqual([]);
      // The list's dots and shields keep their size.
      const icons = renderer!.root.findAll(
        (n) =>
          isHost(n, 'Ionicons') &&
          !inSheet(n) &&
          ['ellipsis-vertical', 'shield-checkmark-outline'].includes(n.props.name),
      );
      expect(new Set(icons.map((n) => `${n.props.name}:${n.props.size}`))).toEqual(
        new Set(['ellipsis-vertical:20', 'shield-checkmark-outline:22']),
      );
    },
  );

  // #1253 (MembersRoles130 phone 27): a refusal in the Remove sheet wraps inside its Banner and its
  // button keeps one line.
  it.each(largeTextWindows)(
    'reads a refusal in the Remove sheet in full, $width dp at $fontScale× text',
    (size) => {
      setWindow(size);
      act(() => {
        renderer = create(
          <ThemeContext.Provider value={getSemanticTokens(mode)}>
            <GroupMembers
              group={household}
              currentUserId={you}
              back={{ label: 'Back to Group', onPress: vi.fn() }}
              invite={{ onPress: vi.fn(), disabled: false, offline: false }}
              leave={leaveActions()}
              roles={roleActions()}
              removal={removalActions({
                status: 'refused',
                userId: samId,
                name: 'Sam Chen',
                code: 'OPEN_BALANCE',
                message: 'Sam Chen owes ₹300.00 in this Group. Settle up before removing them.',
                check: 'balances',
              })}
              stepDown={stepDownActions()}
            />
          </ThemeContext.Provider>,
        );
      });
      const [modal] = findHosts(
        renderer!.toJSON() as never,
        (p, type) => type === 'Modal' && p.visible === true,
      );
      expect(modal).toBeDefined();
      expect(unreadText(modal!, size.fontScale, size.width)).toEqual([]);
    },
  );
});
