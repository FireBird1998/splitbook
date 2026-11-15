import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import GroupSettingsView from './GroupSettingsView';

/*
 * #1250: the Members list on Group settings, as the board WebMembersRoles shows it to an admin:
 * the member menu says "Make admin", "Make member" and "Remove from Group", a change ends in a
 * Snackbar naming the person, with no Undo, and the server's last-admin sentence stays under the
 * list until dismissed. #1251: Remove from Group asks first, and an admin's own row offers Step
 * down to member while another admin exists, which asks first too. The server is a stand-in that
 * keeps the Group, so the page's next read
 * shows what was saved; MUI's menu, dialog and Snackbar render inline, since their portals and
 * timers need a browser. The page's other sections and its text fields need a browser too, and
 * have tests of their own, so they stand in here.
 */

vi.mock('./TagManager', () => ({ default: () => null }));
vi.mock('./GroupCurrenciesSection', () => ({ default: () => null }));
vi.mock('./LeaveGroupSection', () => ({ default: () => null }));
vi.mock('@mui/material/TextField', () => ({
  default: ({ label, value }: { label: string; value: string }) =>
    createElement('input', { 'aria-label': label, value, readOnly: true }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement('a', { href }, children),
}));
vi.mock('@mui/material/Menu', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('ul', { role: 'menu' }, children) : null,
}));
// The dialog keeps what assistive technology reads, and its close for Escape and the backdrop.
vi.mock('@mui/material/Dialog', () => ({
  default: ({
    open,
    children,
    onClose,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
  }: {
    open: boolean;
    children: ReactNode;
    onClose?: (event: object, reason: string) => void;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
  }) =>
    open
      ? createElement(
          'div',
          {
            role: 'dialog',
            'aria-labelledby': labelledBy,
            'aria-describedby': describedBy,
            onClose,
          },
          children,
        )
      : null,
}));
vi.mock('@mui/material/Snackbar', () => ({
  default: ({
    open,
    message,
    action,
  }: {
    open: boolean;
    message: ReactNode;
    action?: ReactNode;
  }) => (open ? createElement('div', { role: 'status' }, message, action) : null),
}));

const GROUP = 'b00000000000000000000010';
const ALEX = 'a00000000000000000000001';
const PRIYA = 'a00000000000000000000002';
const SAM = 'a00000000000000000000003';

type Role = 'admin' | 'member';
const person = (id: string, name: string, role: Role) => ({
  user: { _id: id, name, email: `${name.split(' ')[0].toLowerCase()}@example.test`, image: null },
  role,
  joinedAt: '2026-03-12T00:00:00.000Z',
});
const world = vi.hoisted(() => ({
  group: null as unknown as Record<string, unknown> & { members: ReturnType<typeof person>[] },
  requests: [] as { method: string; path: string; body: unknown }[],
  answers: new Map<string, { status: number; body: unknown }>(),
}));

/** Maple House: Alex (you) and Sam Chen are admins, Priya Shah is a member. */
function mapleHouse(members: ReturnType<typeof person>[]) {
  world.group = {
    _id: GROUP,
    name: 'Maple House',
    description: '',
    category: 'other',
    defaultCurrency: 'INR',
    alternateCurrencies: [],
    startDate: null,
    endDate: null,
    isArchived: false,
    assistantRule: 'allowed',
    createdBy: ALEX,
    members,
    tags: [],
    createdAt: '2026-03-12T00:00:00.000Z',
    updatedAt: '2026-03-12T00:00:00.000Z',
  };
}

// The page's Group read: what the stand-in server holds, read again on every refresh.
vi.mock('@/lib/hooks/use-groups', async () => {
  const { useReducer } = await import('react');
  return {
    useGroup: () => {
      const [, refresh] = useReducer((reads: number) => reads + 1, 0);
      return {
        data: structuredClone(world.group),
        isLoading: false,
        error: undefined,
        mutate: async () => refresh(),
      };
    },
  };
});

vi.mock('@/lib/utils/api-fetch', () => ({
  apiFetch: async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    world.requests.push({ method, path, body });
    const planned = world.answers.get(`${method} ${path}`);
    const member = path.match(/\/members\/([0-9a-f]{24})$/)?.[1];
    if (!planned && member && (method === 'PATCH' || method === 'DELETE')) {
      // As the server saves it: a role change keeps the member, a removal drops them.
      world.group.members =
        method === 'DELETE'
          ? world.group.members.filter(({ user }) => user._id !== member)
          : world.group.members.map((m) => (m.user._id === member ? { ...m, role: body.role } : m));
      return new Response(JSON.stringify({ data: world.group }), { status: 200 });
    }
    const answer = planned ?? { status: 500, body: { error: 'Unplanned' } };
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  },
}));

let renderer: ReactTestRenderer;

async function mount() {
  await act(async () => {
    renderer = create(
      createElement(
        SWRConfig,
        { value: { provider: () => new Map(), dedupingInterval: 0 } },
        createElement(GroupSettingsView, {
          groupId: GROUP,
          userId: ALEX,
          recurringExpensesEnabled: false,
          assistantsAvailable: false,
        }),
      ),
      { createNodeMock: () => ({ focus() {}, addEventListener() {}, removeEventListener() {} }) },
    );
  });
}

/** A node's text as read: elements apart, the pieces of one text run together. */
const textOf = (node: ReactTestInstance | null): string =>
  node
    ? node.children
        .map((child) => (typeof child === 'string' ? child : ` ${textOf(child)} `))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
const byRole = (role: string) =>
  renderer.root.findAll((node) => typeof node.type === 'string' && node.props.role === role);
const menu = () => byRole('menu')[0] ?? null;
const dialog = () => byRole('dialog')[0] ?? null;
const menuItems = () => byRole('menuitem').map(textOf);
const snackbars = () => byRole('status').map(textOf);
const alerts = () => byRole('alert');

async function openMenuFor(name: string) {
  const dots = renderer.root.find(
    (node) => node.type === 'button' && node.props['aria-label'] === `Actions for member ${name}`,
  );
  await act(async () => dots.props.onClick({ currentTarget: dots }));
}
async function choose(item: string) {
  const found = byRole('menuitem').find((node) => textOf(node) === item);
  if (!found) throw new Error(`Missing menu item ${item}; the menu has ${menuItems().join(', ')}`);
  await act(async () => found.props.onClick());
}
async function press(scope: ReactTestInstance, name: string) {
  const found = scope.findAll((node) => node.type === 'button' && textOf(node) === name)[0];
  if (!found) throw new Error(`Missing button ${name}`);
  await act(async () => found.props.onClick());
}
const buttons = (scope: ReactTestInstance) =>
  scope.findAll((node) => node.type === 'button').map(textOf);
/** The text a dialog's aria attribute points at, as a screen reader announces it. */
const announced = (attribute: 'aria-labelledby' | 'aria-describedby') =>
  textOf(renderer.root.find((node) => node.props.id === dialog()!.props[attribute]));
const hasMenuFor = (name: string) =>
  renderer.root.findAll(
    (node) => node.type === 'button' && node.props['aria-label'] === `Actions for member ${name}`,
  ).length > 0;
const changes = () => world.requests.filter(({ method }) => method !== 'GET');
const role = (id: string) => world.group.members.find(({ user }) => user._id === id)?.role;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world.requests.length = 0;
  world.answers.clear();
  mapleHouse([
    person(ALEX, 'Alex Rivera', 'admin'),
    person(PRIYA, 'Priya Shah', 'member'),
    person(SAM, 'Sam Chen', 'admin'),
  ]);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the member menu on Group settings (#1250)', () => {
  it('offers a member Make admin and Remove from Group', async () => {
    await mount();
    await openMenuFor('Priya Shah');
    expect(menuItems()).toEqual(['Make admin', 'Remove from Group']);
  });

  it('offers an admin Make member and Remove from Group', async () => {
    await mount();
    await openMenuFor('Sam Chen');
    expect(menuItems()).toEqual(['Make member', 'Remove from Group']);
  });

  it('makes a member an admin at once and names them, with no Undo', async () => {
    await mount();
    await openMenuFor('Priya Shah');
    await choose('Make admin');

    expect(changes()).toEqual([
      { method: 'PATCH', path: `/api/groups/${GROUP}/members/${PRIYA}`, body: { role: 'admin' } },
    ]);
    expect(role(PRIYA)).toBe('admin');
    expect(menu()).toBeNull();
    expect(dialog()).toBeNull();
    expect(snackbars()).toEqual(['Priya Shah is now an admin']);
    expect(byRole('status')[0].findAll((node) => node.type === 'button')).toEqual([]);
  });

  it('makes an admin a member at once and names them', async () => {
    await mount();
    await openMenuFor('Sam Chen');
    await choose('Make member');

    expect(changes()).toEqual([
      { method: 'PATCH', path: `/api/groups/${GROUP}/members/${SAM}`, body: { role: 'member' } },
    ]);
    expect(role(SAM)).toBe('member');
    expect(dialog()).toBeNull();
    expect(snackbars()).toEqual(['Sam Chen is now a member']);
  });

  it('names the member and the Group once they are removed, with no Undo', async () => {
    await mount();
    await openMenuFor('Priya Shah');
    await choose('Remove from Group');
    await press(dialog()!, 'Remove from Group');

    expect(changes()).toEqual([
      { method: 'DELETE', path: `/api/groups/${GROUP}/members/${PRIYA}`, body: undefined },
    ]);
    expect(dialog()).toBeNull();
    expect(role(PRIYA)).toBeUndefined();
    expect(snackbars()).toEqual(['Priya Shah was removed from Maple House']);
    expect(byRole('status')[0].findAll((node) => node.type === 'button')).toEqual([]);
  });

  it('keeps the server’s last-admin sentence under the list until it is dismissed', async () => {
    await mount();
    const sentence = 'Maple House needs an admin. Make someone else an admin first.';
    world.answers.set(`PATCH /api/groups/${GROUP}/members/${SAM}`, {
      status: 409,
      body: { error: sentence, status: 409, code: 'LAST_ADMIN' },
    });
    await openMenuFor('Sam Chen');
    await choose('Make member');

    expect(alerts().map(textOf)).toEqual([sentence]);
    expect(snackbars()).toEqual([]);
    expect(role(SAM)).toBe('admin');
    await act(async () =>
      alerts()[0]
        .find((node) => node.type === 'button' && node.props['aria-label'] === 'Close')
        .props.onClick(),
    );
    expect(alerts()).toEqual([]);
  });
});

describe('removing a member asks first (#1251)', () => {
  it('names the member and the Group, and sends nothing until it is confirmed', async () => {
    await mount();
    await openMenuFor('Priya Shah');
    await choose('Remove from Group');

    expect(menu()).toBeNull();
    expect(announced('aria-labelledby')).toBe('Remove Priya Shah from Maple House?');
    expect(announced('aria-describedby')).toBe(
      'Priya won’t see this Group or its balances any more. The Expenses and payments they’re part of stay for everyone else. They can rejoin with an invite.',
    );
    expect(buttons(dialog()!)).toEqual(['Cancel', 'Remove from Group']);
    expect(
      dialog()!.findAll((node) => node.type === 'button' && textOf(node) === 'Remove from Group')[0]
        .props.className,
    ).toContain('MuiButton-colorError');
    expect(changes()).toEqual([]);
  });

  it('sends nothing when Cancel or Escape closes it', async () => {
    await mount();
    await openMenuFor('Priya Shah');
    await choose('Remove from Group');
    await press(dialog()!, 'Cancel');
    expect(dialog()).toBeNull();

    await openMenuFor('Priya Shah');
    await choose('Remove from Group');
    await act(async () => dialog()!.props.onClose({}, 'escapeKeyDown'));
    expect(dialog()).toBeNull();

    expect(changes()).toEqual([]);
    expect(role(PRIYA)).toBe('member');
    expect(snackbars()).toEqual([]);
  });

  it('shows the server’s refusal in the notice under the list, as before', async () => {
    await mount();
    const sentence = 'Priya Shah owes ₹300.00 in this Group. Settle up before removing them.';
    world.answers.set(`DELETE /api/groups/${GROUP}/members/${PRIYA}`, {
      status: 409,
      body: { error: sentence, status: 409, code: 'OPEN_BALANCE' },
    });
    await openMenuFor('Priya Shah');
    await choose('Remove from Group');
    await press(dialog()!, 'Remove from Group');

    expect(dialog()).toBeNull();
    expect(alerts().map(textOf)).toEqual([`${sentence} Go to Balances`]);
    expect(snackbars()).toEqual([]);
    expect(role(PRIYA)).toBe('member');
  });
});

describe('an admin steps down from their own row (#1251)', () => {
  it('offers only Step down to member on your own row while another admin exists', async () => {
    await mount();
    await openMenuFor('Alex Rivera');
    expect(menuItems()).toEqual(['Step down to member']);
  });

  it('gives the only admin’s own row no menu', async () => {
    mapleHouse([person(ALEX, 'Alex Rivera', 'admin'), person(PRIYA, 'Priya Shah', 'member')]);
    await mount();
    expect(hasMenuFor('Alex Rivera')).toBe(false);
    expect(hasMenuFor('Priya Shah')).toBe(true);
  });

  it('asks first, naming who stays an admin, and sends nothing until it is confirmed', async () => {
    await mount();
    await openMenuFor('Alex Rivera');
    await choose('Step down to member');

    expect(announced('aria-labelledby')).toBe('Step down to member?');
    expect(announced('aria-describedby')).toBe(
      'You’ll stay in Maple House and keep adding Expenses. You won’t be able to change Group settings, Tags or members. Sam Chen stays an admin.',
    );
    expect(buttons(dialog()!)).toEqual(['Cancel', 'Step down']);
    expect(changes()).toEqual([]);

    await press(dialog()!, 'Cancel');
    expect(dialog()).toBeNull();
    expect(changes()).toEqual([]);
    expect(role(ALEX)).toBe('admin');
  });

  it('names every admin who stays', async () => {
    mapleHouse([
      person(ALEX, 'Alex Rivera', 'admin'),
      person(PRIYA, 'Priya Shah', 'admin'),
      person(SAM, 'Sam Chen', 'admin'),
    ]);
    await mount();
    await openMenuFor('Alex Rivera');
    await choose('Step down to member');

    expect(announced('aria-describedby')).toContain('Priya Shah and Sam Chen stay admins.');
  });

  it('once confirmed, shows the member’s settings and says so', async () => {
    await mount();
    await openMenuFor('Alex Rivera');
    await choose('Step down to member');
    await press(dialog()!, 'Step down');

    expect(changes()).toEqual([
      { method: 'PATCH', path: `/api/groups/${GROUP}/members/${ALEX}`, body: { role: 'member' } },
    ]);
    expect(role(ALEX)).toBe('member');
    expect(textOf(renderer.root)).toContain('Only admins can change this Group’s settings.');
    expect(textOf(renderer.root)).not.toContain('Members (3)');
    expect(snackbars()).toEqual(['You’re now a member of Maple House']);
  });

  it('keeps the server’s last-admin sentence in the notice when the other admin stepped down meanwhile', async () => {
    await mount();
    const sentence = 'Maple House needs an admin. Make someone else an admin first.';
    world.answers.set(`PATCH /api/groups/${GROUP}/members/${ALEX}`, {
      status: 409,
      body: { error: sentence, status: 409, code: 'LAST_ADMIN' },
    });
    await openMenuFor('Alex Rivera');
    await choose('Step down to member');
    await press(dialog()!, 'Step down');

    expect(dialog()).toBeNull();
    expect(alerts().map(textOf)).toEqual([sentence]);
    expect(snackbars()).toEqual([]);
    expect(textOf(renderer.root)).toContain('Members (3)');
  });
});
