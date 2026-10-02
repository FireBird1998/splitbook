import { useSyncExternalStore } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { FetchResponse, MobileFetch } from '../data/types';
import { ExpenseEditor } from './expense-editor';

// Host stand-ins: the editor renders through these names, so the tree keeps the
// props (labels, hints, values, handlers) that Android receives.
vi.mock('react-native', () => ({
  AccessibilityInfo: { sendAccessibilityEvent: vi.fn() },
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
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useWindowDimensions: () => ({ width: 412, height: 915, scale: 2, fontScale: 1 }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const [alexId, samId, priyaId] = [
  'a00000000000000000000001',
  'a00000000000000000000002',
  'a00000000000000000000003',
];
const formerId = 'a00000000000000000000009';
const groupId = 'a00000000000000000000010';
const tagId = 'a00000000000000000000020';
const expenseId = 'a00000000000000000000030';
const iso = '2026-09-28T10:00:00.000Z';
const people = [
  { id: alexId, name: 'Alex Rao', email: 'alex@example.test', image: null },
  { id: samId, name: 'Sam Chen', email: 'sam@example.test', image: null },
  { id: priyaId, name: 'Priya Shah', email: 'priya@example.test', image: null },
];
const group = {
  _id: groupId,
  createdBy: alexId,
  name: 'Maple House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  members: people.map(({ id, ...user }) => ({
    user: { _id: id, ...user },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const exactExpense = {
  _id: expenseId,
  group: groupId,
  description: 'Rent',
  amount: 10,
  currency: 'INR',
  amountMinor: 1000,
  moneyVersion: 1,
  revision: 3,
  splitMethod: 'exact',
  paidBy: [{ user: { _id: alexId, name: 'Alex Rao' }, amount: 10, amountMinor: 1000 }],
  splitBetween: [
    { user: { _id: alexId, name: 'Alex Rao' }, amount: 6, amountMinor: 600 },
    { user: { _id: samId, name: 'Sam Chen' }, amount: 4, amountMinor: 400 },
  ],
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'other',
  tagId,
  tag: 'Groceries',
  notes: '',
  isDeleted: false,
  editHistory: [],
};
const json = (data: unknown, status = 200, cookie?: string): FetchResponse =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  });

function backend(record: Record<string, unknown> = exactExpense) {
  const writes: { method: string; body: Record<string, unknown> }[] = [];
  const records = new Map<string, unknown>();
  const drafts = {
    load: async (accountId: string, id: string) =>
      structuredClone(records.get(`${accountId}:${id}`) ?? null),
    save: async (accountId: string, id: string, value: unknown) => {
      records.set(`${accountId}:${id}`, structuredClone(value));
    },
    remove: async (accountId: string, id: string) => {
      records.delete(`${accountId}:${id}`);
    },
    clear: async () => records.clear(),
  };
  const fetch: MobileFetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method && init.method !== 'GET' && path.startsWith('/api/groups'))
      writes.push({ method: init.method, body: JSON.parse(String(init.body)) });
    if (path.endsWith('/demo-persona/sign-in'))
      return json(
        { user: people[0] },
        200,
        'better-auth.session_token=alex.signature; Max-Age=2592000',
      );
    if (path.endsWith('/get-session'))
      return json({
        user: people[0],
        session: { userId: alexId, expiresAt: '2030-01-01T00:00:00Z' },
      });
    if (path === `/api/groups/${groupId}`) return json({ data: group, status: 200 });
    if (path === `/api/groups/${groupId}/expenses/${expenseId}`)
      return init.method === 'PATCH'
        ? json({ data: { ...record, revision: 4 }, status: 200 })
        : json({ data: record, status: 200 });
    if (path === `/api/groups/${groupId}/expenses` && init.method === 'POST')
      return json({ status: 201, data: { _id: expenseId, group: groupId } }, 201);
    if (path.endsWith('/expenses'))
      return json({
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
        },
        status: 200,
      });
    if (path.endsWith('/balances'))
      return json({ data: { currency: 'INR', balances: [], debts: [], byCurrency: [] } });
    if (path === '/api/groups') return json({ data: [group], status: 200 });
    return json({ error: 'Unavailable', status: 404 }, 404);
  };
  let cookie: string | null = null;
  let account: string | null = null;
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
    },
    {
      fetch,
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      expenseDrafts: drafts,
      accountLocal: {
        owner: {
          load: async () => account,
          save: async (value) => {
            account = value;
          },
          clear: async () => {
            account = null;
          },
        },
        cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
        stores: [drafts],
      },
      now: () => Date.parse(iso),
      newSubmissionKey: () => 'native-expense-test-0001',
    },
  );
  return { controller, writes };
}

const noop = () => undefined;
function EditorScreen({ controller }: { controller: MobileController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <ExpenseEditor
      state={state.expense}
      currentUserId={alexId}
      onClose={noop}
      onChange={(patch) => void controller.updateExpenseDraft(patch)}
      onLeaveField={controller.touchExpenseField}
      onSave={() => void controller.saveExpense()}
      onEdit={() => void controller.editExpense()}
      onResume={controller.resumeExpenseDraft}
      onDiscard={noop}
      onRetry={noop}
      onReviewDelete={noop}
      onDelete={noop}
      onCancelDelete={noop}
      onReconcile={noop}
      onReviewLatest={noop}
      onAcceptCurrent={noop}
    />
  );
}

const settle = () =>
  act(async () => {
    for (let tick = 0; tick < 20; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (scope: ReactTestInstance) =>
  scope
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});

async function render(open: (controller: MobileController) => Promise<void>, record?: object) {
  const harness = backend(record as Record<string, unknown>);
  await harness.controller.signIn('alex');
  await open(harness.controller);
  await act(async () => {
    screen = create(<EditorScreen controller={harness.controller} />);
  });
  const root = () => screen!.root;
  const run = async (action: () => void) => {
    await act(async () => action());
    await settle();
  };
  const pressable = (label: string) =>
    root().find((node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === label);
  const input = (label: string) =>
    root().find((node) => isHost(node, 'TextInput') && node.props.accessibilityLabel === label);
  /** The open Split sheet, or undefined when it's closed. */
  const sheet = () =>
    root()
      .findAll((node) => isHost(node, 'Modal') && node.props.visible === true)
      .find((modal) => text(modal).includes('Split'));
  /** Each person's checkbox label, which names them and their resulting share. */
  const people = () =>
    sheet()!
      .findAll((node) => isHost(node, 'Pressable') && node.props.accessibilityRole === 'checkbox')
      .map((node) => ({
        label: node.props.accessibilityLabel as string,
        checked: node.props.accessibilityState.checked as boolean,
      }));
  const methods = () =>
    sheet()!
      .find(
        (node) =>
          isHost(node, 'View') &&
          node.props.accessibilityRole === 'radiogroup' &&
          node.props.accessibilityLabel === 'Split method',
      )
      .findAll((node) => isHost(node, 'Pressable') && node.props.accessibilityRole === 'radio')
      .map((node) => [node.props.accessibilityLabel, node.props.accessibilityState.checked]);
  const splitTile = () =>
    root().find(
      (node) =>
        isHost(node, 'Pressable') && String(node.props.accessibilityLabel).startsWith('Split:'),
    );
  return {
    ...harness,
    root,
    sheet,
    pressable,
    people,
    methods,
    input,
    splitTile,
    openSplit: () => run(() => splitTile().props.onPress()),
    done: () =>
      run(() =>
        sheet()!
          .find((node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === 'Done')
          .props.onPress(),
      ),
    press: (label: string) => run(() => pressable(label).props.onPress()),
    type: (label: string, value: string) => run(() => input(label).props.onChangeText(value)),
    toggle: (name: string) =>
      run(() =>
        sheet()!
          .find(
            (node) =>
              isHost(node, 'Pressable') &&
              node.props.accessibilityRole === 'checkbox' &&
              String(node.props.accessibilityLabel).split(',')[0] === name,
          )
          .props.onPress(),
      ),
  };
}

const newExpense = (controller: MobileController) => controller.openExpense(groupId);
async function withAmount(amount: string) {
  const ui = await render(newExpense);
  await ui.type('Amount, required', amount);
  await ui.openSplit();
  return ui;
}

describe('Split sheet', () => {
  it('offers four methods, a checkbox for each person and their resulting share', async () => {
    const ui = await withAmount('1249.50');
    expect(ui.sheet()).toBeTruthy();
    expect(text(ui.sheet()!)).toContain('Total ₹1,249.50 · INR');
    expect(ui.methods()).toEqual([
      ['Equal', true],
      ['Amounts', false],
      ['Percentage', false],
      ['Shares', false],
    ]);
    expect(ui.people()).toEqual([
      { label: 'You, ₹416.50', checked: true },
      { label: 'Sam Chen, ₹416.50', checked: true },
      { label: 'Priya Shah, ₹416.50', checked: true },
    ]);
    expect(text(ui.sheet()!)).toContain('Adds up');
    expect(text(ui.sheet()!)).toContain('3 people · ₹1,249.50 allocated');
    expect(text(ui.sheet()!)).not.toContain('leftover');

    await ui.toggle('Priya Shah');
    expect(ui.people()).toEqual([
      { label: 'You, ₹624.75', checked: true },
      { label: 'Sam Chen, ₹624.75', checked: true },
      { label: 'Priya Shah, Not included', checked: false },
    ]);
    expect(ui.splitTile().props.accessibilityLabel).toBe('Split: Equally · 2');
  });

  it('uses steppers for Shares and names who got the leftover', async () => {
    const ui = await withAmount('1249.50');
    await ui.press('Shares');
    expect(text(ui.sheet()!)).toContain('Switching method clears these values.');
    expect(
      ui
        .sheet()!
        .findAll(
          (node) => isHost(node, 'Text') && /^shares for /.test(node.props.accessibilityLabel),
        )
        .map((node) => node.props.accessibilityLabel),
    ).toEqual(['shares for you: 1', 'shares for Sam Chen: 1', 'shares for Priya Shah: 1']);
    expect(
      ui
        .root()
        .findAll((node) => isHost(node, 'TextInput') && /for /.test(node.props.accessibilityLabel)),
    ).toHaveLength(0);

    await ui.press('Increase shares for you');
    expect(ui.people()).toEqual([
      { label: 'You, ₹624.75', checked: true },
      { label: 'Sam Chen, ₹312.38', checked: true },
      { label: 'Priya Shah, ₹312.37', checked: true },
    ]);
    expect(text(ui.sheet()!)).toContain('4 shares · ₹1,249.50 allocated');
    expect(text(ui.sheet()!)).toContain(
      'The leftover ₹0.01 goes to Sam Chen so the total is exact.',
    );
    expect(ui.pressable('Decrease shares for Sam Chen').props.disabled).toBe(true);
  });

  it('shows what Amounts still have to assign, and sends a new Expense as unequal', async () => {
    const ui = await withAmount('1249.50');
    await ui.press('Amounts');
    expect(text(ui.sheet()!)).toContain('₹1,249.50 still to assign');
    await ui.type('Amount for you', '1000');
    await ui.type('Amount for Sam Chen', '200');
    expect(text(ui.sheet()!)).toContain('₹49.50 still to assign');
    expect(text(ui.sheet()!)).toContain('₹1,200.00 of ₹1,249.50');
    expect(text(ui.sheet()!)).not.toContain('Adds up');
    await ui.type('Amount for Priya Shah', '59.50');
    expect(text(ui.sheet()!)).toContain('₹10.00 over the total');
    await ui.type('Amount for Priya Shah', '49.50');
    expect(text(ui.sheet()!)).toContain('Adds up');
    expect(ui.people()[2]).toEqual({ label: 'Priya Shah, ₹49.50', checked: true });

    await ui.done();
    expect(ui.sheet()).toBeUndefined();
    expect(ui.splitTile().props.accessibilityLabel).toBe('Split: By amounts · 3');
    await ui.type('Description, required', 'Weekly groceries');
    await ui.press('Tag: Groceries');
    await ui.press('Save expense ₹1,249.50');
    expect(ui.writes).toHaveLength(1);
    expect(ui.writes[0]).toMatchObject({
      method: 'POST',
      body: {
        splitMethod: 'unequal',
        splitBetween: [
          { user: alexId, amount: 1000 },
          { user: samId, amount: 200 },
          { user: priyaId, amount: 49.5 },
        ],
      },
    });
  });

  it('shows the percentage still to assign', async () => {
    const ui = await withAmount('1000');
    await ui.press('Percentage');
    await ui.type('Percentage for you', '50');
    await ui.type('Percentage for Sam Chen', '25');
    expect(text(ui.sheet()!)).toContain('25% still to assign');
    expect(text(ui.sheet()!)).toContain('75% of 100%');
    await ui.type('Percentage for Priya Shah', '30');
    expect(text(ui.sheet()!)).toContain('5% over 100%');
    await ui.type('Percentage for Priya Shah', '25');
    expect(text(ui.sheet()!)).toContain('100% · ₹1,000.00 allocated');
  });

  it('warns that switching method clears the values, and does clear them', async () => {
    const ui = await withAmount('100');
    await ui.press('Amounts');
    await ui.type('Amount for you', '60');
    await ui.press('Amounts');
    expect(ui.input('Amount for you').props.value).toBe('60');
    expect(text(ui.sheet()!)).toContain('Switching method clears these values.');
    await ui.press('Percentage');
    await ui.press('Amounts');
    expect(ui.input('Amount for you').props.value).toBe('');
  });

  it('explains wrong entries and missing people inside the sheet, and keeps them on Done', async () => {
    const ui = await withAmount('100');
    await ui.press('Amounts');
    await ui.type('Amount for you', '10.005');
    const correction = 'INR amounts can have at most 2 decimal places. Nothing is rounded for you.';
    expect(ui.input('Amount for you').props.accessibilityHint).toBe(correction);
    expect(
      ui
        .sheet()!
        .findAll((node) => isHost(node, 'View') && node.props.accessibilityLabel === correction),
    ).toHaveLength(1);
    expect(text(ui.sheet()!)).toContain('Correct the entry marked above.');

    await ui.press('Equal');
    for (const name of ['You', 'Sam Chen', 'Priya Shah']) await ui.toggle(name);
    expect(text(ui.sheet()!)).toContain('Choose at least one person to share this Expense.');
    expect(ui.people().every((row) => !row.checked)).toBe(true);

    await ui.press('Close Split, keeping your entries');
    expect(ui.sheet()).toBeUndefined();
    expect(ui.splitTile().props.accessibilityLabel).toBe(
      'Split: Equally · 0. Choose at least one person to share this Expense.',
    );
    await ui.openSplit();
    expect(ui.people().every((row) => !row.checked)).toBe(true);
    expect(ui.writes).toEqual([]);
  });

  it('keeps an exact Expense exact while its amounts change', async () => {
    const ui = await render(async (controller) => {
      await controller.openExpense(groupId, expenseId);
      await controller.editExpense();
    });
    await ui.openSplit();
    expect(ui.methods()).toContainEqual(['Amounts', true]);
    // Choosing Amounts again is not a method change, so nothing is cleared.
    await ui.press('Amounts');
    expect(ui.input('Amount for you').props.value).toBe('6');
    expect(ui.input('Amount for Sam Chen').props.value).toBe('4');
    expect(ui.people()[2]).toEqual({ label: 'Priya Shah, Not included', checked: false });
    await ui.type('Amount for you', '7');
    await ui.type('Amount for Sam Chen', '3');
    await ui.done();
    await ui.press('Save changes ₹10.00');
    expect(ui.writes).toEqual([
      {
        method: 'PATCH',
        body: expect.objectContaining({
          splitMethod: 'exact',
          splitBetween: [
            { user: alexId, amount: 7 },
            { user: samId, amount: 3 },
          ],
        }),
      },
    ]);
  });

  it('sends the method an exact Expense was changed to', async () => {
    const ui = await render(async (controller) => {
      await controller.openExpense(groupId, expenseId);
      await controller.editExpense();
    });
    await ui.openSplit();
    await ui.press('Equal');
    await ui.done();
    await ui.press('Save changes ₹10.00');
    expect(ui.writes).toEqual([
      { method: 'PATCH', body: expect.objectContaining({ splitMethod: 'equal' }) },
    ]);
  });

  it('marks someone who left the Group, and unticking removes them', async () => {
    const ui = await render(
      async (controller) => {
        await controller.openExpense(groupId, expenseId);
        await controller.editExpense();
      },
      {
        ...exactExpense,
        splitBetween: [
          exactExpense.splitBetween[0],
          { user: { _id: formerId, name: 'Jo Park' }, amount: 4, amountMinor: 400 },
        ],
      },
    );
    await ui.openSplit();
    expect(ui.people()).toContainEqual({
      label: 'Jo Park, ₹4.00, no longer in this Group',
      checked: true,
    });
    expect(text(ui.sheet()!)).toContain('No longer in this Group');
    await ui.toggle('Jo Park');
    expect(ui.people().map((row) => row.label.split(',')[0])).toEqual([
      'You',
      'Sam Chen',
      'Priya Shah',
    ]);
  });
});
