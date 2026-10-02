import { useSyncExternalStore } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseDraft } from '../data/expense-draft';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { FetchResponse, MobileFetch } from '../data/types';
import { ExpenseEditor } from './expense-editor';

// #122: the Who paid sheet, rendered over the Expense form through the real controller.
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
const formerId = 'a00000000000000000000099';
const groupId = 'a00000000000000000000010';
const tagId = 'a00000000000000000000020';
const iso = '2026-09-28T10:00:00.000Z';
const people = [
  { id: alexId, name: 'Alex Rivera' },
  { id: samId, name: 'Sam Chen' },
  { id: priyaId, name: 'Priya Shah' },
];
const alex = { ...people[0], email: 'alex@example.test', image: null };
const group = {
  _id: groupId,
  createdBy: alexId,
  name: 'Maple House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  members: people.map(({ id, name }) => ({
    user: { _id: id, name, email: `${id}@example.test` },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const json = (data: unknown, status = 200, cookie?: string): FetchResponse =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  });

function backend() {
  const writes: string[] = [];
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
      writes.push(`${init.method} ${path}`);
    if (path.endsWith('/demo-persona/sign-in'))
      return json({ user: alex }, 200, 'better-auth.session_token=alex.signature; Max-Age=2592000');
    if (path.endsWith('/get-session'))
      return json({ user: alex, session: { userId: alexId, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path === `/api/groups/${groupId}`) return json({ data: group, status: 200 });
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
  const stored = () =>
    (records.get(`${alexId}:${groupId}`) as { draft: ExpenseDraft } | undefined)?.draft;
  return { controller, writes, stored };
}

const noop = () => undefined;
function EditorScreen({ controller }: { controller: MobileController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <ExpenseEditor
      state={state.expense}
      currentUserId={alexId}
      onChange={(patch) => void controller.updateExpenseDraft(patch)}
      onLeaveField={controller.touchExpenseField}
      onSave={() => void controller.saveExpense()}
      onEdit={noop}
      onResume={noop}
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
const statusPattern =
  /^(Adds up|Correct the marked|Enter the Expense amount|₹[\d,.]+ (still|more))/;
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

async function render(draft: Partial<ExpenseDraft> = {}) {
  const harness = backend();
  await harness.controller.signIn('alex');
  await harness.controller.openExpense(groupId);
  await harness.controller.updateExpenseDraft({ description: 'Weekly groceries', tagId, ...draft });
  await act(async () => {
    screen = create(<EditorScreen controller={harness.controller} />);
  });
  const root = () => screen!.root;
  /** The Who paid sheet's Modal, open or not. */
  const sheet = () =>
    root().find((node) => isHost(node, 'Modal') && text(node).startsWith('Who paid?'));
  const find = (host: 'Pressable' | 'TextInput', label: string) =>
    sheet().find((node) => isHost(node, host) && node.props.accessibilityLabel === label);
  const pressable = (label: string) => find('Pressable', label);
  const input = (label: string) => find('TextInput', label);
  const exists = (host: 'Pressable' | 'TextInput', label: string) =>
    sheet().findAll((node) => isHost(node, host) && node.props.accessibilityLabel === label)
      .length > 0;
  const run = async (action: () => void) => {
    await act(async () => action());
    await settle();
  };
  const tile = () =>
    root().find(
      (node) =>
        isHost(node, 'Pressable') && String(node.props.accessibilityLabel).startsWith('Paid by'),
    );
  const announced = () =>
    sheet()
      .findAll(
        (node) =>
          isHost(node, 'View') &&
          node.props.accessible === true &&
          node.props.accessibilityLiveRegion === 'polite',
      )
      .map((node) => node.props.accessibilityLabel as string);
  return {
    ...harness,
    sheet,
    pressable,
    input,
    exists,
    tile,
    /** The footer's status: what is left, and how much of the total is entered. */
    status: () => announced().find((label) => statusPattern.test(label)),
    /** Messages beside the rows. */
    corrections: () => announced().filter((label) => !statusPattern.test(label)),
    progress: () =>
      sheet().findAll(
        (node) => isHost(node, 'View') && node.props.accessibilityRole === 'progressbar',
      ),
    open: () => run(() => tile().props.onPress()),
    press: (label: string) => run(() => pressable(label).props.onPress()),
    type: (label: string, value: string) => run(() => input(label).props.onChangeText(value)),
    done: () => run(() => pressable('Done').props.onPress()),
    back: () => run(() => sheet().props.onRequestClose()),
    tapOutside: () => run(() => pressable('Close Who paid?, keeping your entries').props.onPress()),
  };
}

describe('Who paid sheet', () => {
  it('opens from Paid by on "One person", a radio list of the Group’s members', async () => {
    const ui = await render({ amount: '1249.50' });
    expect(ui.sheet().props.visible).toBe(false);
    await ui.open();
    expect(ui.sheet().props.visible).toBe(true);

    const modes = ui
      .sheet()
      .find(
        (node) =>
          isHost(node, 'View') &&
          node.props.accessibilityRole === 'radiogroup' &&
          node.props.accessibilityLabel === 'How many people paid',
      );
    expect(
      modes
        .findAll((node) => isHost(node, 'Pressable'))
        .map((node) => [node.props.accessibilityLabel, node.props.accessibilityState.checked]),
    ).toEqual([
      ['One person', true],
      ['Several people', false],
    ]);
    const list = ui
      .sheet()
      .find(
        (node) =>
          isHost(node, 'View') &&
          node.props.accessibilityRole === 'radiogroup' &&
          node.props.accessibilityLabel === 'Who paid',
      );
    expect(
      list
        .findAll((node) => isHost(node, 'Pressable'))
        .map((node) => [
          node.props.accessibilityRole,
          node.props.accessibilityLabel,
          node.props.accessibilityState.checked,
        ]),
    ).toEqual([
      ['radio', 'You, Alex Rivera', true],
      ['radio', 'Sam Chen', false],
      ['radio', 'Priya Shah', false],
    ]);

    await ui.press('Sam Chen');
    expect(ui.pressable('Sam Chen').props.accessibilityState.checked).toBe(true);
    expect(ui.tile().props.accessibilityLabel).toBe('Paid by: Sam Chen');
    expect(ui.stored()?.payerId).toBe(samId);
    expect(ui.writes).toEqual([]);
  });

  it('runs the remainder for several people and gives the rest to the first empty payer, without saving', async () => {
    const ui = await render({ amount: '1249.50' });
    await ui.open();
    await ui.press('Several people');
    expect(ui.pressable('Several people').props.accessibilityState.checked).toBe(true);
    expect(text(ui.sheet())).toContain(
      'Enter what each person paid. Together it must equal ₹1,249.50.',
    );
    // The one payer starts with the whole amount.
    expect(ui.input('What you paid').props).toMatchObject({
      value: '1249.50',
      keyboardType: 'decimal-pad',
    });
    expect(ui.input('What Sam Chen paid').props).toMatchObject({
      value: '',
      placeholder: '0.00',
    });
    expect(ui.status()).toBe('Adds up. ₹1,249.50 of ₹1,249.50 entered.');

    await ui.type('What you paid', '1000.00');
    await ui.type('What Sam Chen paid', '200.00');
    expect(ui.status()).toBe('₹49.50 still to assign. ₹1,200.00 of ₹1,249.50 entered.');
    const [bar] = ui.progress();
    expect(bar.props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 96,
      text: '₹1,200.00 of ₹1,249.50',
    });
    expect(text(ui.sheet())).toContain('Entries stay in your draft. Done or Back keeps them.');

    await ui.press('Give ₹49.50 to Priya Shah');
    expect(ui.input('What Priya Shah paid').props.value).toBe('49.50');
    expect(ui.status()).toBe('Adds up. ₹1,249.50 of ₹1,249.50 entered.');
    expect(ui.exists('Pressable', 'Give ₹49.50 to Priya Shah')).toBe(false);
    expect(ui.sheet().props.visible).toBe(true);
    expect(ui.writes).toEqual([]);

    await ui.done();
    expect(ui.sheet().props.visible).toBe(false);
    expect(ui.tile().props.accessibilityLabel).toBe('Paid by: 3 people');
    expect(ui.writes).toEqual([]);
  });

  it('explains totals that don’t add up and entries that can’t count, then marks Paid by when closed invalid', async () => {
    const ui = await render({ amount: '100' });
    await ui.open();
    await ui.press('Several people');
    await ui.type('What you paid', '80');
    await ui.type('What Sam Chen paid', '30');
    expect(ui.status()).toBe('₹10.00 more than the total. ₹110.00 of ₹100.00 entered.');
    expect(ui.exists('Pressable', 'Give ₹10.00 to Priya Shah')).toBe(false);

    await ui.type('What Sam Chen paid', '10.005');
    const correction = 'INR amounts can have at most 2 decimal places. Nothing is rounded for you.';
    expect(ui.corrections()).toContain(correction);
    expect(ui.input('What Sam Chen paid').props.accessibilityHint).toBe(correction);
    expect(ui.input('What Sam Chen paid').props.value).toBe('10.005');
    expect(ui.status()).toBe('Correct the marked amounts first.');
    expect(ui.progress()).toHaveLength(0);

    await ui.type('What Sam Chen paid', '30');
    await ui.done();
    expect(ui.tile().props.accessibilityLabel).toBe(
      'Paid by: 2 people. Payer amounts must add up to the expense amount',
    );
    expect(ui.stored()?.payers).toEqual([
      { user: alexId, amount: '80' },
      { user: samId, amount: '30' },
    ]);
    expect(ui.writes).toEqual([]);
  });

  it('explains payers who are no longer in the Group, beside their row, and removes them', async () => {
    const ui = await render({
      amount: '10',
      multiPayer: true,
      payers: [
        { user: formerId, amount: '4' },
        { user: alexId, amount: '6' },
      ],
    });
    await ui.open();
    expect(ui.input('What Unavailable member paid').props).toMatchObject({
      editable: false,
      accessibilityHint: 'No longer in this Group.',
    });
    expect(ui.corrections()).toContain('No longer in this Group.');
    expect(ui.status()).toBe('Adds up. ₹10.00 of ₹10.00 entered.');

    await ui.press('Remove Unavailable member from who paid');
    expect(ui.exists('TextInput', 'What Unavailable member paid')).toBe(false);
    expect(ui.status()).toBe('₹4.00 still to assign. ₹6.00 of ₹10.00 entered.');
    await ui.press('Give ₹4.00 to Sam Chen');
    expect(ui.stored()?.payers).toEqual([
      { user: alexId, amount: '6' },
      { user: samId, amount: '4.00' },
    ]);
  });

  it('says when the one payer is no longer in the Group', async () => {
    const ui = await render({ amount: '10', payerId: formerId });
    await ui.open();
    expect(ui.corrections()).toEqual([
      'Unavailable member is no longer in this Group. Choose who paid.',
    ]);
    const radios = ui
      .sheet()
      .findAll((node) => isHost(node, 'Pressable') && node.props.accessibilityRole === 'radio')
      .filter((node) => !['One person', 'Several people'].includes(node.props.accessibilityLabel));
    expect(radios.map((node) => node.props.accessibilityState.checked)).toEqual([
      false,
      false,
      false,
    ]);
    await ui.done();
    expect(ui.tile().props.accessibilityLabel).toBe(
      'Paid by: Unavailable member. A payer is no longer in this Group. Choose who paid.',
    );
    await ui.open();
    await ui.press('You, Alex Rivera');
    expect(ui.corrections()).toEqual([]);
    expect(ui.tile().props.accessibilityLabel).toBe('Paid by: You');
  });

  it('keeps entries on Done, Back and tapping outside, and between the two modes', async () => {
    const ui = await render({ amount: '10' });
    await ui.open();
    await ui.press('Several people');
    await ui.type('What you paid', '6');
    await ui.back();
    expect(ui.sheet().props.visible).toBe(false);
    expect(ui.stored()).toMatchObject({
      multiPayer: true,
      payers: [{ user: alexId, amount: '6' }],
    });

    await ui.open();
    expect(ui.input('What you paid').props.value).toBe('6');
    await ui.press('One person');
    expect(ui.stored()).toMatchObject({
      multiPayer: false,
      payers: [{ user: alexId, amount: '6' }],
    });
    await ui.press('Several people');
    expect(ui.input('What you paid').props.value).toBe('6');
    await ui.type('What Sam Chen paid', '4');
    await ui.tapOutside();
    expect(ui.sheet().props.visible).toBe(false);
    expect(ui.stored()?.payers).toEqual([
      { user: alexId, amount: '6' },
      { user: samId, amount: '4' },
    ]);
    expect(ui.tile().props.accessibilityLabel).toBe('Paid by: 2 people');

    // Clearing an entry means that person paid nothing.
    await ui.open();
    await ui.type('What Sam Chen paid', '');
    expect(ui.stored()?.payers).toEqual([{ user: alexId, amount: '6' }]);
    expect(ui.status()).toBe('₹4.00 still to assign. ₹6.00 of ₹10.00 entered.');
    expect(ui.writes).toEqual([]);
  });
});
