import type { ReactElement } from 'react';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeaveGroupState, MobileGroup } from '../data/types';
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

const { GroupMembers, leaveDiscardsDraft, leaveExplanation, leaveNeedsConnection } =
  await import('./group-members');

const you = 'a00000000000000000000001';
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
    member('a00000000000000000000002', 'Priya Shah', 'admin'),
    member('a00000000000000000000003', 'Sam Chen', 'member'),
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

function page(overrides: Partial<Parameters<typeof GroupMembers>[0]> = {}) {
  const props = {
    group: household,
    currentUserId: you,
    back: { label: 'Back to Group', onPress: vi.fn() },
    invite: { onPress: vi.fn(), disabled: false, offline: false },
    leave: leaveActions(),
    ...overrides,
  };
  return { root: render(<GroupMembers {...props} />), props };
}
/** The Leave Group sheet, and whether it shows. */
const sheet = (root: ReactTestInstance) => one(root.findAll((node) => isHost(node, 'Modal')));

describe('Members and Group details', () => {
  it('titles the page with the Group and returns from the back arrow', () => {
    const { root, props } = page();
    // A section's title keeps a hair space to spare (#639).
    expect(byRole(root, 'header').map(text)).toEqual(['Members and details', 'Members · 3\u200a']);
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
    const { root } = page();
    expect(spoken(root).slice(4)).toEqual([
      'Alex Rivera, You, Admin',
      'Priya Shah, Admin',
      'Sam Chen, Member',
    ]);
    expect(text(root)).toContain('Alex Rivera · YouAdmin');
    expect(text(root)).toContain('Sam ChenMember');
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

  it('says role changes and removals happen on the web', () => {
    const { root } = page();
    expect(text(root)).toContain('Changing roles or removing members is done on the web for now.');
  });

  it('explains a Group that is no longer available', () => {
    const { root } = page({ group: null, unavailable: 'You no longer have access to this group.' });
    expect(text(one(byRole(root, 'alert')))).toBe('You no longer have access to this group.');
    expect(byRole(root, 'button', 'Invite people')).toHaveLength(0);
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

  it('only closes when the member is the last admin', () => {
    const message = 'Make someone else an admin before you leave.';
    const { root } = page({
      leave: leaveActions({ status: 'refused', code: 'LAST_ADMIN', message }),
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
          />
        </ThemeContext.Provider>,
      );
      expect(labelRuns(root, 'Members · 3')).toEqual([['Members · 3', hairSpace]]);
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
