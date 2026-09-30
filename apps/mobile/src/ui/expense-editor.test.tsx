import { useSyncExternalStore, type ReactElement } from 'react';
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
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));

const { AccessibilityInfo } = await import('react-native');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const memberId = 'a00000000000000000000001';
const groupId = 'a00000000000000000000010';
const tagId = 'a00000000000000000000020';
const expenseId = 'a00000000000000000000030';
const iso = '2026-09-28T10:00:00.000Z';
const alex = { id: memberId, name: 'Alex', email: 'alex@example.test', image: null };
const group = {
  _id: groupId,
  createdBy: memberId,
  name: 'Shared home',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  members: [{ user: { ...alex, _id: memberId }, role: 'admin', joinedAt: iso }],
  tags: [{ _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const savedExpense = {
  _id: expenseId,
  group: groupId,
  description: 'Weekly groceries',
  amount: 10,
  currency: 'INR',
  amountMinor: 1000,
  moneyVersion: 1,
  revision: 3,
  splitMethod: 'equal',
  paidBy: [{ user: { _id: memberId, name: 'Alex' }, amount: 10, amountMinor: 1000 }],
  splitBetween: [{ user: { _id: memberId, name: 'Alex' }, amount: 10, amountMinor: 1000 }],
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'food',
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
    // Ledger writes only; signing in is not part of the journeys under test.
    if (init.method && init.method !== 'GET' && path.startsWith('/api/groups'))
      writes.push(`${init.method} ${path}`);
    if (path.endsWith('/demo-persona/sign-in'))
      return json({ user: alex }, 200, 'better-auth.session_token=alex.signature; Max-Age=2592000');
    if (path.endsWith('/get-session'))
      return json({ user: alex, session: { userId: memberId, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path === `/api/groups/${groupId}`) return json({ data: group, status: 200 });
    if (path === `/api/groups/${groupId}/expenses/${expenseId}`)
      return json({ data: savedExpense, status: 200 });
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
  return { controller, drafts, writes };
}

interface NodeMock {
  element: ReactElement<Record<string, unknown>>;
  focus: ReturnType<typeof vi.fn>;
}
const noop = () => undefined;

function EditorScreen({
  controller,
  onReveal,
}: {
  controller: MobileController;
  onReveal: (section: unknown) => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <ExpenseEditor
      state={state.expense}
      onChange={(patch) => void controller.updateExpenseDraft(patch)}
      onLeaveField={controller.touchExpenseField}
      onReveal={onReveal}
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

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
  vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

async function render(open: (controller: MobileController) => Promise<void>) {
  const harness = backend();
  await harness.controller.signIn('alex');
  await open(harness.controller);
  const revealed: NodeMock[] = [];
  const mocks: NodeMock[] = [];
  await act(async () => {
    screen = create(
      <EditorScreen
        controller={harness.controller}
        onReveal={(section) => revealed.push(section as NodeMock)}
      />,
      {
        createNodeMock: (element) => {
          const mock = { element, focus: vi.fn() } as NodeMock;
          mocks.push(mock);
          return mock;
        },
      },
    );
  });
  const root = () => screen!.root;
  const input = (label: string) =>
    root().find((node) => isHost(node, 'TextInput') && node.props.accessibilityLabel === label);
  const pressable = (label: string) =>
    root().find((node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === label);
  const act$ = async (run: () => void) => {
    await act(async () => run());
    await settle();
  };
  // Callback refs re-attach on render, so one input can own several node mocks.
  const focusCount = (label: string) =>
    mocks
      .filter((mock) => mock.element.props.accessibilityLabel === label)
      .reduce((count, mock) => count + mock.focus.mock.calls.length, 0);
  return {
    ...harness,
    root,
    input,
    pressable,
    revealed,
    focusCount,
    type: (label: string, text: string) => act$(() => input(label).props.onChangeText(text)),
    leave: (label: string) => act$(() => input(label).props.onBlur()),
    press: (label: string) => act$(() => pressable(label).props.onPress()),
  };
}

const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
/** The Field wrapper that owns this input: its label, input, hint and correction. */
const fieldOf = (input: ReactTestInstance) => input.parent!;
const corrections = (scope: ReactTestInstance) =>
  scope
    .findAll((node) => isHost(node, 'View') && node.props.accessible === true)
    .map((node) => node.props.accessibilityLabel as string);
const tagSection = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'View') && node.props.accessibilityRole === 'radiogroup')
    .find(
      (node) => node.findAll((child) => child.props.accessibilityLabel === 'Tag: Groceries').length,
    )!;
const text = (scope: ReactTestInstance) =>
  scope
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');

describe('rendered Expense corrections', () => {
  it('moves a blank Description submission to its field and saves once after correction', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    await ui.type('Amount, required', '250.50');
    await ui.press('Tag: Groceries');
    await ui.press('Save expense');

    const description = ui.input('Description, required');
    expect(ui.writes).toEqual([]);
    expect(corrections(fieldOf(description))).toEqual(['Add a description, such as Groceries.']);
    expect(description.props.accessibilityHint).toContain('Add a description, such as Groceries.');
    expect(corrections(fieldOf(ui.input('Amount, required')))).toEqual([]);
    expect(ui.focusCount('Description, required')).toBe(1);
    expect(ui.focusCount('Amount, required')).toBe(0);
    expect(ui.revealed).toHaveLength(1);
    expect(text(ui.root())).toContain('Description · Required');
    expect(ui.input('Amount, required').props.value).toBe('250.50');
    expect(ui.pressable('Tag: Groceries').props.accessibilityState.checked).toBe(true);

    await ui.type('Description, required', 'Groceries');
    expect(corrections(fieldOf(ui.input('Description, required')))).toEqual([]);
    expect(ui.input('Description, required').props.accessibilityHint).toBe('What was this for?');
    expect(ui.focusCount('Description, required')).toBe(1);

    await ui.press('Save expense');
    expect(ui.writes).toEqual([`POST /api/groups/${groupId}/expenses`]);
  });

  it('shows every correction beside its own control and focuses the first one', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    await ui.type('Date, required', '2026-02-30');
    await ui.press('Save expense');

    expect(ui.writes).toEqual([]);
    expect(corrections(fieldOf(ui.input('Amount, required')))).toEqual([
      'Enter the amount, such as 250.50.',
    ]);
    expect(corrections(fieldOf(ui.input('Description, required')))).toEqual([
      'Add a description, such as Groceries.',
    ]);
    expect(corrections(fieldOf(ui.input('Date, required')))).toEqual([
      '2026-02-30 isn’t a real date. Check the day and month.',
    ]);
    const tags = tagSection(ui.root());
    expect(corrections(tags)).toEqual(['Choose a Tag for this Expense.']);
    expect(text(ui.root())).toContain(
      'Correct 4 fields before saving: Amount, Description, Date and Tag.',
    );
    expect(ui.focusCount('Amount, required')).toBe(1);
    expect(ui.focusCount('Date, required')).toBe(0);
  });

  it('waits until a field is left before showing its correction', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    await ui.type('Amount, required', '10.005');
    expect(corrections(fieldOf(ui.input('Amount, required')))).toEqual([]);
    await ui.leave('Amount, required');
    expect(corrections(fieldOf(ui.input('Amount, required')))).toEqual([
      'INR amounts can have at most 2 decimal places. Nothing is rounded for you.',
    ]);
    expect(corrections(fieldOf(ui.input('Description, required')))).toEqual([]);
    expect(ui.focusCount('Amount, required')).toBe(0);
    await ui.type('Amount, required', '10.05');
    expect(corrections(fieldOf(ui.input('Amount, required')))).toEqual([]);
  });

  it('moves screen-reader focus to a missing Tag instead of opening the keyboard', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    await ui.type('Amount, required', '12');
    await ui.type('Description, required', 'Milk');
    await ui.press('Save expense');

    expect(ui.writes).toEqual([]);
    const [target] = vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls[0];
    expect((target as unknown as NodeMock).element.props.accessibilityLabel).toBe(
      'Choose a Tag for this Expense.',
    );
    expect(ui.focusCount('Amount, required')).toBe(0);
    expect(ui.focusCount('Description, required')).toBe(0);
    await ui.press('Tag: Groceries');
    const tags = tagSection(ui.root());
    expect(corrections(tags)).toEqual([]);
  });

  it('shows the same Description correction when editing, without a write', async () => {
    const ui = await render((controller) => controller.openExpense(groupId, expenseId));
    await ui.press('Edit Expense');
    await ui.type('Description, required', '   ');
    await ui.press('Save changes');

    expect(ui.writes).toEqual([]);
    expect(corrections(fieldOf(ui.input('Description, required')))).toEqual([
      'Add a description, such as Groceries.',
    ]);
    expect(text(ui.root())).not.toMatch(/"code"|"path"/);
    expect(ui.focusCount('Description, required')).toBe(1);
  });

  it('explains a disabled Save when the draft cannot be stored on the device', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    ui.drafts.save = async () => {
      throw new Error('Disk full');
    };
    await ui.type('Description, required', 'Milk');

    const save = ui.pressable('Save expense');
    const reason =
      'Save is unavailable until this draft is stored on this device. Retry saving the draft first.';
    expect(save.props.disabled).toBe(true);
    expect(save.props.accessibilityHint).toBe(reason);
    expect(text(ui.root())).toContain(reason);
    expect(ui.pressable('Retry saving draft')).toBeTruthy();
    expect(ui.input('Description, required').props.value).toBe('Milk');
  });
});
