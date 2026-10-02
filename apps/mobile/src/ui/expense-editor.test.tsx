import { useSyncExternalStore, type ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { FetchResponse, MobileFetch } from '../data/types';
import { ExpenseEditor } from './expense-editor';
import { expenseDateLabel } from './expense-form';

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

function backend({
  record = savedExpense as Record<string, unknown>,
  loseCreate = false,
  conflict,
  losePatch = false,
}: {
  record?: Record<string, unknown>;
  /** Loses every create response, or only this many. */
  loseCreate?: boolean | number;
  /** The Expense as someone else saves it just before the member's first edit arrives. */
  conflict?: Record<string, unknown>;
  /** Edits never reach the server. */
  losePatch?: boolean;
} = {}) {
  const writes: string[] = [];
  const submissions: { key: string | null; body: string }[] = [];
  let saved = record;
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
    if (path === `/api/groups/${groupId}/expenses/${expenseId}`) {
      if (init.method === 'PATCH') {
        if (losePatch) throw new Error('The connection dropped before the edit arrived');
        if (conflict && saved !== conflict) {
          saved = conflict;
          return json({ code: 'STALE_REVISION', status: 409 }, 409);
        }
        return json({ data: { ...saved, revision: Number(saved.revision) + 1 }, status: 200 });
      }
      return json({ data: saved, status: 200 });
    }
    if (path === `/api/groups/${groupId}/expenses` && init.method === 'POST') {
      submissions.push({
        key: new Headers(init.headers).get('Idempotency-Key'),
        body: String(init.body),
      });
      if (loseCreate === true || submissions.length <= Number(loseCreate))
        throw new Error('The response was lost after the server committed it');
      return json({ status: 201, data: { _id: expenseId, group: groupId } }, 201);
    }
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
  return { controller, drafts, writes, submissions };
}

interface NodeMock {
  element: ReactElement<Record<string, unknown>>;
  focus: ReturnType<typeof vi.fn>;
}
const noop = () => undefined;
const calls = { close: vi.fn(), discard: vi.fn() };

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
      currentUserId={memberId}
      onClose={calls.close}
      onChange={(patch) => void controller.updateExpenseDraft(patch)}
      onLeaveField={controller.touchExpenseField}
      onReveal={onReveal}
      onSave={() => void controller.saveExpense()}
      onEdit={() => void controller.editExpense()}
      onResume={controller.resumeExpenseDraft}
      onDiscard={calls.discard}
      onRetry={noop}
      onReviewDelete={noop}
      onDelete={noop}
      onCancelDelete={noop}
      onReconcile={() => void controller.reconcileExpense()}
      onReviewLatest={() => void controller.reviewLatestExpense()}
      onAcceptCurrent={() => void controller.acceptCurrentExpense()}
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
  calls.close.mockClear();
  calls.discard.mockClear();
});

async function render(
  open: (controller: MobileController) => Promise<void>,
  options?: Parameters<typeof backend>[0],
) {
  const harness = backend(options);
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
  // Save names the amount once it is valid, as in "Save expense ₹250.50".
  const pressable = (label: string) =>
    root().find(
      (node) =>
        isHost(node, 'Pressable') &&
        (node.props.accessibilityLabel === label ||
          String(node.props.accessibilityLabel).startsWith(`${label} `)),
    );
  /** One of the Date, Paid by, Split and Tag tiles. */
  const tile = (label: string) =>
    root().find(
      (node) =>
        isHost(node, 'Pressable') &&
        node.props.accessibilityRole === 'button' &&
        /^[^:]+:/.test(String(node.props.accessibilityLabel)) &&
        String(node.props.accessibilityLabel).startsWith(label),
    );
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
    tile,
    revealed,
    focusCount,
    type: (label: string, text: string) => act$(() => input(label).props.onChangeText(text)),
    leave: (label: string) => act$(() => input(label).props.onBlur()),
    press: (label: string) => act$(() => pressable(label).props.onPress()),
  };
}

const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
/** The section that owns this input: the largest ancestor holding no other input. */
const fieldOf = (input: ReactTestInstance) => {
  const inputs = (node: ReactTestInstance) =>
    node.findAll((child) => isHost(child, 'TextInput')).length;
  let node = input.parent!;
  while (node.parent && inputs(node.parent) === 1) node = node.parent;
  return node;
};
/** Corrections are announced as they appear; other labelled views (the currency) aren't. */
const corrections = (scope: ReactTestInstance) =>
  scope
    .findAll(
      (node) =>
        isHost(node, 'View') &&
        node.props.accessible === true &&
        node.props.accessibilityLiveRegion === 'polite' &&
        !String(node.props.accessibilityLabel).startsWith('Draft '),
    )
    .map((node) => node.props.accessibilityLabel as string);
/** The top bar's draft status, and whether a screen reader announces it. */
const draftStatus = (scope: ReactTestInstance) =>
  scope
    .findAll(
      (node) =>
        isHost(node, 'View') &&
        ['Draft saved', 'Saving draft…', 'Draft not saved'].includes(node.props.accessibilityLabel),
    )
    .map((node) => ({
      label: node.props.accessibilityLabel,
      live: node.props.accessibilityLiveRegion,
    }));
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
    expect(text(ui.root())).toContain('One thing to fix before saving');
    expect(ui.pressable('Go to Description')).toBeTruthy();
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
    // A draft stored before the calendar can still hold a date that doesn't exist.
    const ui = await render(async (controller) => {
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ date: '2026-02-30' });
    });
    await ui.press('Save expense');

    expect(ui.writes).toEqual([]);
    expect(corrections(fieldOf(ui.input('Amount, required')))).toEqual([
      'Enter the amount, such as 250.50.',
    ]);
    expect(corrections(fieldOf(ui.input('Description, required')))).toEqual([
      'Add a description, such as Groceries.',
    ]);
    expect(ui.tile('Date').props.accessibilityLabel).toBe(
      'Date: 2026-02-30. 2026-02-30 isn’t a real date. Check the day and month.',
    );
    expect(corrections(ui.root())).toContain(
      '2026-02-30 isn’t a real date. Check the day and month.',
    );
    expect(ui.tile('Tag').props.accessibilityLabel).toBe(
      'Tag, required: Choose a Tag. Choose a Tag for this Expense.',
    );
    expect(corrections(ui.root())).toContain('Choose a Tag for this Expense.');
    expect(text(ui.root())).toContain('4 things to fix before saving');
    for (const field of ['Amount', 'Description', 'Date', 'Tag'])
      expect(ui.pressable(`Go to ${field}`)).toBeTruthy();
    expect(ui.focusCount('Amount, required')).toBe(1);
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
    expect(corrections(ui.root())).not.toContain('Choose a Tag for this Expense.');
    expect(ui.tile('Tag').props.accessibilityLabel).toBe('Tag, required: Groceries');
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
    expect(draftStatus(ui.root())).toEqual([{ label: 'Draft not saved', live: 'polite' }]);
  });

  it('keeps Save enabled and the bar steady while a draft write is pending', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    await ui.type('Amount, required', '120');
    await ui.press('Tag: Groceries');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { save } = ui.drafts;
    ui.drafts.save = async (accountId, id, value) => {
      await gate;
      await save(accountId, id, value);
    };
    await ui.type('Description, required', 'Milk');
    expect(ui.controller.getSnapshot().expense.persistence).toBe('saving');

    const button = ui.pressable('Save expense');
    expect(button.props.disabled).toBe(false);
    expect(button.props.accessibilityHint).toBeUndefined();
    expect(text(ui.root())).not.toContain('Available once');
    // A quick write changes nothing on screen and announces nothing.
    expect(draftStatus(ui.root())).toEqual([{ label: 'Draft saved', live: 'none' }]);
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(draftStatus(ui.root())).toEqual([{ label: 'Saving draft…', live: 'none' }]);

    // Save waits for the write, then sends once however often it was tapped.
    await act(async () => {
      button.props.onPress();
      button.props.onPress();
    });
    await settle();
    expect(ui.writes).toEqual([]);
    await act(async () => release());
    await settle();
    expect(ui.writes).toEqual([`POST /api/groups/${groupId}/expenses`]);
  });
});

const banner = (root: ReactTestInstance, role: 'summary' | 'alert') =>
  root.findAll((node) => isHost(node, 'View') && node.props.accessibilityRole === role);
/** A banner's icon shows its tone: information for a draft, a warning for a recovery. */
const icon = (scope: ReactTestInstance) =>
  scope.findAll((node) => isHost(node, 'Ionicons'))[0].props.name as string;
/** Each piece of text on its own, such as a top-bar badge. */
const words = (scope: ReactTestInstance) =>
  scope
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'));
const labelled = (root: ReactTestInstance, label: string) =>
  root.findAll((node) => isHost(node, 'View') && node.props.accessibilityLabel === label);

describe('rendered draft recovery', () => {
  it('resumes an ordinary draft calmly and drops the resume notice once answered', async () => {
    const ui = await render(async (controller) => {
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ amount: '42.00', description: 'Milk and bread' });
      await controller.openExpense(groupId);
    });
    const [info] = banner(ui.root(), 'summary');
    expect(text(info)).toContain('Unfinished draft');
    expect(text(info)).toContain('Nothing has been sent.');
    expect(icon(info)).toBe('information-circle-outline');
    expect(banner(ui.root(), 'alert')).toEqual([]);
    expect(text(ui.root())).not.toContain('We couldn’t confirm');
    expect(words(ui.root())).not.toContain('Not confirmed');
    expect(draftStatus(ui.root())).toEqual([{ label: 'Draft saved', live: 'none' }]);
    expect(() => ui.pressable('Check and finish saving')).toThrow();
    expect(ui.pressable('Discard draft')).toBeTruthy();

    await ui.press('Resume draft');
    expect(text(ui.root())).not.toContain('Unfinished draft');
    expect(ui.input('Amount, required').props.value).toBe('42.00');
    expect(ui.input('Description, required').props.value).toBe('Milk and bread');
    expect(ui.input('Description, required').props.editable).toBe(true);
    expect(ui.writes).toEqual([]);
  });

  it('opens a saved Expense read-only beside a draft and offers to resume the draft', async () => {
    const ui = await render(async (controller) => {
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({ amount: '42.00', description: 'Milk and bread' });
      await controller.openExpense(groupId, expenseId);
    });
    // The top bar's title is the first heading.
    const title = () =>
      text(
        ui
          .root()
          .findAll((node) => isHost(node, 'Text') && node.props.accessibilityRole === 'header')[0],
      );
    expect(title()).toBe('Expense');
    expect(text(ui.root())).toContain('Weekly groceries');
    const [note] = banner(ui.root(), 'summary');
    expect(text(note)).toContain(
      'This Group has an unfinished draft. Finish or discard it to edit or delete this Expense.',
    );
    const reason = 'Finish or discard the draft in this Group first.';
    for (const action of ['Edit Expense', 'Delete Expense'])
      expect(ui.pressable(action).props).toMatchObject({
        disabled: true,
        accessibilityHint: reason,
      });

    await ui.press('Resume draft');
    expect(title()).toBe('Add expense');
    expect(ui.input('Description, required').props.value).toBe('Milk and bread');
    expect(ui.input('Description, required').props.editable).toBe(true);
    expect(ui.writes).toEqual([]);
  });

  it('states in the top banner why a save not confirmed comes before another Expense', async () => {
    const ui = await render(
      async (controller) => {
        await controller.openExpense(groupId);
        await controller.updateExpenseDraft({ amount: '42.00', description: 'Milk', tagId });
        await controller.saveExpense();
        await controller.openExpense(groupId, expenseId);
      },
      { loseCreate: true },
    );
    const [warning] = banner(ui.root(), 'alert');
    expect(text(warning)).toContain('We couldn’t confirm this save');
    expect(text(warning)).toContain('before opening another Expense');
    // Stated once, at the top.
    expect(text(ui.root()).split('before opening another Expense')).toHaveLength(2);
  });
});

describe('rendered save not confirmed', () => {
  const lostSave = async (controller: MobileController) => {
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ amount: '42.00', description: 'Milk', tagId });
    await controller.saveExpense();
  };

  it('locks the form, badges it and finishes with the same submission', async () => {
    const ui = await render(lostSave, { loseCreate: 1 });
    const [warning] = banner(ui.root(), 'alert');
    expect(text(warning)).toContain('We couldn’t confirm this save');
    expect(text(warning)).toContain('Checking reuses the same submission');
    expect(icon(warning)).toBe('alert-circle-outline');
    expect(words(ui.root())).toContain('Not confirmed');
    expect(draftStatus(ui.root())).toEqual([]);
    expect(ui.input('Amount, required').props.editable).toBe(false);
    expect(ui.input('Description, required').props.editable).toBe(false);
    for (const tile of ['Date', 'Paid by', 'Split', 'Tag'])
      expect(ui.tile(tile).props.accessibilityLabel).toMatch(/\. locked$/);
    expect(() => ui.pressable('Expense options')).toThrow();
    expect(() => ui.pressable('Discard draft')).toThrow();

    await ui.press('Keep for later');
    expect(calls.close).toHaveBeenCalledOnce();
    expect(ui.submissions).toHaveLength(1);

    await ui.press('Check and finish saving');
    expect(ui.submissions).toHaveLength(2);
    expect(ui.submissions[1]).toEqual(ui.submissions[0]);
    expect(ui.controller.getSnapshot().expense.status).toBe('saved');
  });

  it('reopens the same way, announced calmly, and never as an ordinary draft', async () => {
    const ui = await render(
      async (controller) => {
        await lostSave(controller);
        await controller.openExpense(groupId);
      },
      { loseCreate: 1 },
    );
    expect(banner(ui.root(), 'alert')).toEqual([]);
    const [warning] = banner(ui.root(), 'summary');
    expect(text(warning)).toContain('We couldn’t confirm this save');
    expect(text(warning)).toContain('This Expense may already be in Shared home.');
    expect(icon(warning)).toBe('alert-circle-outline');
    expect(words(ui.root())).toContain('Not confirmed');
    expect(text(ui.root())).not.toContain('Unfinished draft');
    expect(() => ui.pressable('Resume draft')).toThrow();
    expect(() => ui.pressable('Discard draft')).toThrow();
    expect(ui.input('Amount, required').props.editable).toBe(false);
    expect(ui.pressable('Keep for later')).toBeTruthy();

    await ui.press('Check and finish saving');
    expect(ui.submissions).toHaveLength(2);
    expect(ui.submissions[1]).toEqual(ui.submissions[0]);
  });
});

describe('rendered edit conflict', () => {
  // Someone else saved a new amount and notes before the member's edit arrived.
  const theirs = {
    ...savedExpense,
    revision: 4,
    amount: 12,
    amountMinor: 1200,
    paidBy: [{ user: { _id: memberId, name: 'Alex' }, amount: 12, amountMinor: 1200 }],
    splitBetween: [{ user: { _id: memberId, name: 'Alex' }, amount: 12, amountMinor: 1200 }],
    notes: 'Paid in cash',
  };
  const editDescription = async (controller: MobileController) => {
    await controller.openExpense(groupId, expenseId);
    await controller.editExpense();
    await controller.updateExpenseDraft({ description: 'Weekly groceries and milk' });
    await controller.saveExpense();
  };

  it('compares both versions and keeps the member’s, holding the changed amount for a choice', async () => {
    const ui = await render(editDescription, { conflict: theirs });
    const [warning] = banner(ui.root(), 'alert');
    expect(text(warning)).toContain('This Expense changed since you started editing');
    expect(words(ui.root())).toContain('Changed');
    expect(text(ui.root())).toContain('What’s different');
    for (const row of [
      'Amount: yours ₹10.00, saved now ₹12.00',
      'Description: yours Weekly groceries and milk, saved now Weekly groceries',
      'Notes: yours none, saved now Paid in cash',
    ])
      expect(labelled(ui.root(), row)).toHaveLength(1);
    expect(ui.input('Description, required').props.editable).toBe(false);
    expect(ui.pressable('Use the saved version')).toBeTruthy();

    await ui.press('Keep my version for review');
    expect(ui.input('Description, required').props).toMatchObject({
      value: 'Weekly groceries and milk',
      editable: true,
    });
    // The amount is neither kept nor taken until the member chooses.
    expect(ui.input('Amount, required').props.value).toBe('10');
    expect(labelled(ui.root(), 'Amount: yours ₹10.00, saved now ₹12.00')).toHaveLength(1);
    expect(labelled(ui.root(), 'Notes: yours none, saved now Paid in cash')).toEqual([]);
    const reason = 'Choose which version to keep for each change in What’s different first.';
    expect(ui.pressable('Save changes').props).toMatchObject({
      disabled: true,
      accessibilityHint: reason,
    });
    await ui.press('Category and notes, optional');
    expect(ui.input('Notes').props.value).toBe('Paid in cash');

    await ui.press('Use the saved amount');
    expect(ui.input('Amount, required').props.value).toBe('12');
    expect(text(ui.root())).not.toContain('What’s different');
    await ui.press('Save changes');
    expect(ui.writes).toEqual([
      `PATCH /api/groups/${groupId}/expenses/${expenseId}`,
      `PATCH /api/groups/${groupId}/expenses/${expenseId}`,
    ]);
  });

  it('brings the choice left after keeping a version into view, and Save leads back to it', async () => {
    const ui = await render(editDescription, { conflict: theirs });
    const focused = () =>
      vi
        .mocked(AccessibilityInfo.sendAccessibilityEvent)
        .mock.calls.map(([node, event]) => [
          (node as unknown as NodeMock).element.props.accessibilityLabel,
          event,
        ]);
    const revealed = () => ui.revealed.map((node) => node.element.props.accessibilityLabel);

    await ui.press('Keep my version for review');
    expect(revealed()).toEqual(['What’s different']);
    expect(focused()).toEqual([['What’s different', 'focus']]);

    // Scrolled away, the disabled Save still leads back to the choice.
    expect(ui.pressable('Save changes').props.disabled).toBe(true);
    await ui.press('Go to What’s different');
    expect(revealed()).toEqual(['What’s different', 'What’s different']);
    expect(focused()).toHaveLength(2);

    // Choosing doesn't move focus, and nothing is left to go back to.
    await ui.press('Use the saved amount');
    expect(focused()).toHaveLength(2);
    expect(() => ui.pressable('Go to What’s different')).toThrow();
  });

  it('uses the saved version without sending anything', async () => {
    const ui = await render(editDescription, { conflict: theirs });
    await ui.press('Use the saved version');
    expect(ui.controller.getSnapshot().expense).toMatchObject({
      status: 'detail',
      draft: { amount: '12', notes: 'Paid in cash' },
    });
    expect(ui.writes).toHaveLength(1);
  });

  it('checks an unconfirmed edit, and says when the saved Expense hasn’t changed', async () => {
    const ui = await render(
      async (controller) => {
        await editDescription(controller);
        await controller.openExpense(groupId, expenseId);
      },
      { losePatch: true },
    );
    const [warning] = banner(ui.root(), 'summary');
    expect(text(warning)).toContain('We couldn’t confirm this change');
    expect(words(ui.root())).toContain('Not confirmed');
    expect(ui.pressable('Keep for later')).toBeTruthy();

    await ui.press('Check the saved Expense');
    const [conflict] = banner(ui.root(), 'alert');
    expect(text(conflict)).toContain('Your change isn’t in the saved Expense');
    expect(words(ui.root())).toContain('Not saved');
    expect(
      labelled(
        ui.root(),
        'Description: yours Weekly groceries and milk, saved now Weekly groceries',
      ),
    ).toHaveLength(1);
    expect(ui.writes).toHaveLength(1);
  });
});

describe('rendered edit history', () => {
  const former = 'a00000000000000000000099';
  const withHistory = {
    ...savedExpense,
    editHistory: [
      {
        editedBy: { _id: memberId, name: 'Alex' },
        editedAt: '2026-09-27T15:40:00.000Z',
        changes: {
          amount: { old: 8.99, new: 10 },
          amountMinor: { old: 899, new: 1000 },
          moneyVersion: { new: 1 },
          paidBy: {
            old: [{ user: former, amount: 8.99, amountMinor: 899 }],
            new: [{ user: memberId, amount: 10, amountMinor: 1000 }],
          },
        },
      },
      {
        editedBy: former,
        editedAt: iso,
        changes: {
          tag: { old: 'Snacks', new: 'Groceries' },
          tagId: { old: 'a00000000000000000000021', new: tagId },
          internalState: { old: { nested: true }, new: [former] },
        },
      },
    ],
  };

  it('names people and formats values without raw data or identifiers', async () => {
    const ui = await render((controller) => controller.openExpense(groupId, expenseId), {
      record: withHistory,
    });
    const shown = text(ui.root());
    const labels = ui
      .root()
      .findAll((node) => isHost(node, 'Text') && typeof node.props.accessibilityLabel === 'string')
      .map((node) => node.props.accessibilityLabel as string);

    // Newest first.
    expect(shown.indexOf('Former member changed the Tag')).toBeLessThan(
      shown.indexOf('Alex changed the amount and who paid'),
    );
    expect(labels).toContain('Amount changed from ₹8.99 to ₹10.00');
    expect(labels).toContain('Alex’s payment changed from ₹0.00 to ₹10.00');
    expect(labels).toContain('Former member’s payment changed from ₹8.99 to ₹0.00');
    expect(labels).toContain('Tag changed from Snacks to Groceries');
    expect(shown).toContain('Other details changed');
    expect(shown).not.toMatch(/[a-f\d]{24}/);
    expect(shown).not.toMatch(/[{}"[\]]|moneyVersion|amountMinor|internalState/);
    expect(labels.join(' ')).not.toMatch(/[a-f\d]{24}/);
  });
});

describe('compact Expense form', () => {
  const openSheet = (root: ReactTestInstance, title: string) =>
    root
      .findAll((node) => isHost(node, 'Modal') && node.props.visible === true)
      .some((modal) => text(modal).includes(title));

  it('is a full-screen task: close keeps the draft, and the status says it is stored', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    const headings = ui
      .root()
      .findAll((node) => isHost(node, 'Text') && node.props.accessibilityRole === 'header');
    expect(text(headings[0])).toBe('Add expense');
    expect(text(ui.root())).toContain('Shared home · INR');
    await ui.type('Description, required', 'Milk');
    expect(
      ui
        .root()
        .findAll((node) => isHost(node, 'View') && node.props.accessibilityLabel === 'Draft saved'),
    ).toHaveLength(1);
    await ui.press('Back to Group, keeping your draft');
    expect(calls.close).toHaveBeenCalledOnce();
    expect(ui.writes).toEqual([]);
  });

  it('says “Draft saved” only while the entries differ from the saved Expense', async () => {
    const ui = await render(async (controller) => {
      await controller.openExpense(groupId, expenseId);
      await controller.editExpense();
    });
    const saved = () =>
      ui
        .root()
        .findAll((node) => isHost(node, 'View') && node.props.accessibilityLabel === 'Draft saved');
    expect(saved()).toHaveLength(0);
    await ui.type('Description, required', 'Weekly groceries and milk');
    expect(saved()).toHaveLength(1);
    await ui.type('Description, required', 'Weekly groceries');
    expect(saved()).toHaveLength(0);
    expect(await ui.drafts.load(memberId, groupId)).toBeNull();
  });

  it('offers Discard draft from Expense options; the app confirms it', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    await ui.press('Expense options');
    expect(openSheet(ui.root(), 'Expense options')).toBe(true);
    await ui.press('Discard draft, Removes these entries from this device');
    expect(calls.discard).toHaveBeenCalledOnce();
  });

  it('uses a decimal keypad for Amount beside its read-only currency, then moves to Description', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    const amount = ui.input('Amount, required');
    expect(amount.props).toMatchObject({ keyboardType: 'decimal-pad', returnKeyType: 'next' });
    expect(
      ui
        .root()
        .findAll(
          (node) =>
            isHost(node, 'View') &&
            node.props.accessibilityLabel === 'Currency INR, the Group’s currency',
        ),
    ).toHaveLength(1);
    act(() => {
      amount.props.onSubmitEditing();
    });
    expect(ui.focusCount('Description, required')).toBe(1);
  });

  // A hardware keyboard or a paste bypasses the numeric keypad.
  it('refuses letters and symbols in numbers, but never converts a value it keeps for correction', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    await ui.type('Amount, required', '-5');
    expect(ui.input('Amount, required').props.value).toBe('-5');
    await ui.type('Description, required', 'Milk');
    await ui.press('Tag: Groceries');
    await ui.press('Save expense');
    expect(ui.writes).toEqual([]);
    expect(corrections(fieldOf(ui.input('Amount, required')))).toEqual([
      'Enter an amount greater than 0.',
    ]);

    await ui.type('Amount, required', '12.5');
    for (const edit of ['12.5x', '₹12.5', '12.5 ']) await ui.type('Amount, required', edit);
    expect(ui.input('Amount, required').props.value).toBe('12.5');

    await ui.press(ui.tile('Split').props.accessibilityLabel);
    await ui.press('Shares');
    await ui.type('Shares for Alex', '1.5');
    expect(ui.input('Shares for Alex').props.value).toBe('1.5');
    await ui.type('Shares for Alex', '1.5a');
    expect(ui.input('Shares for Alex').props.value).toBe('1.5');
  });

  it('shows each value on its tile and opens its editor', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    expect(ui.tile('Date').props.accessibilityLabel).toMatch(/^Date: /);
    expect(ui.tile('Paid by').props.accessibilityLabel).toBe('Paid by: You');
    expect(ui.tile('Split').props.accessibilityLabel).toBe('Split: Equally · 1');
    expect(ui.tile('Tag').props.accessibilityLabel).toBe('Tag, required: Choose a Tag');

    await ui.press(ui.tile('Paid by').props.accessibilityLabel);
    expect(openSheet(ui.root(), 'Who paid?')).toBe(true);

    await ui.press('Tag, required: Choose a Tag');
    expect(openSheet(ui.root(), 'Only this Group’s active Tags are listed.')).toBe(true);
    await ui.press('Tag: Groceries');
    expect(ui.tile('Tag').props.accessibilityLabel).toBe('Tag, required: Groceries');
    expect(openSheet(ui.root(), 'Only this Group’s active Tags are listed.')).toBe(false);
  });

  it('picks the date from a calendar, and closing the sheet keeps it on the Date tile', async () => {
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    const locale = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...resolvedOptions.call(this), locale: 'en-IN' };
      });
    onTestFinished(() => locale.mockRestore());
    const ui = await render((controller) => controller.openExpense(groupId));
    await ui.press(ui.tile('Date').props.accessibilityLabel);
    expect(openSheet(ui.root(), 'September 2026')).toBe(true);
    expect(() => ui.input('Date, required')).toThrow();
    expect(ui.pressable('Monday, 28 September 2026').props.accessibilityState.selected).toBe(true);

    await ui.press('Tuesday, 15 September 2026');
    expect(openSheet(ui.root(), 'Tuesday, 15 September 2026')).toBe(true);
    // Back, like swiping down or tapping outside, behaves like Done.
    const sheet = ui.root().find((node) => isHost(node, 'Modal') && node.props.visible === true);
    await act(async () => sheet.props.onRequestClose());
    expect(openSheet(ui.root(), 'September 2026')).toBe(false);
    const label = expenseDateLabel('2026-09-15');
    expect(ui.tile('Date').props.accessibilityLabel).toBe(`Date: ${label.spoken}`);
    expect(text(ui.tile('Date'))).toBe(`Date${label.shown}`);
    expect(ui.controller.getSnapshot().expense.draft?.date).toBe('2026-09-15');
    expect(ui.writes).toEqual([]);
  });

  it('keeps the calendar and the Date tile on Gregorian dates in a Persian-calendar locale', async () => {
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    const locale = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...resolvedOptions.call(this), locale: 'fa-IR' };
      });
    onTestFinished(() => locale.mockRestore());
    const ui = await render((controller) => controller.openExpense(groupId));
    expect(ui.tile('Date').props.accessibilityLabel).toContain('۲۸ سپتامبر ۲۰۲۶');
    await ui.press(ui.tile('Date').props.accessibilityLabel);
    expect(openSheet(ui.root(), 'سپتامبر ۲۰۲۶')).toBe(true);
    expect(ui.pressable('دوشنبه ۲۸ سپتامبر ۲۰۲۶').props.accessibilityState.selected).toBe(true);

    await ui.press('سه‌شنبه ۱۵ سپتامبر ۲۰۲۶');
    expect(openSheet(ui.root(), 'سه‌شنبه ۱۵ سپتامبر ۲۰۲۶')).toBe(true);
    const sheet = ui.root().find((node) => isHost(node, 'Modal') && node.props.visible === true);
    await act(async () => sheet.props.onRequestClose());
    expect(ui.controller.getSnapshot().expense.draft?.date).toBe('2026-09-15');
    expect(ui.tile('Date').props.accessibilityLabel).toBe('Date: سه‌شنبه ۱۵ سپتامبر ۲۰۲۶');
    expect(text(ui.tile('Date'))).toContain('۱۵ سپتامبر');
  });

  it('shows who owes what as soon as the amount is valid, and names it on Save', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    expect(text(ui.root())).toContain('Enter a valid amount to see who owes what.');
    expect(ui.pressable('Save expense').props.accessibilityLabel).toBe('Save expense');
    await ui.type('Amount, required', '250.50');
    expect(
      ui
        .root()
        .findAll(
          (node) =>
            isHost(node, 'View') &&
            node.props.accessibilityLabel === 'You: paid ₹250.50, share ₹250.50',
        ),
    ).toHaveLength(1);
    expect(text(ui.root())).toContain('Adds up');
    expect(ui.pressable('Save expense').props.accessibilityLabel).toBe('Save expense ₹250.50');
  });

  it('keeps Category and Notes behind one optional row', async () => {
    const ui = await render((controller) => controller.openExpense(groupId));
    const row = () => ui.pressable('Category and notes, optional');
    expect(row().props.accessibilityState).toEqual({ expanded: false });
    expect(() => ui.input('Notes')).toThrow();
    await ui.press('Category and notes, optional');
    expect(row().props.accessibilityState).toEqual({ expanded: true });
    expect(ui.input('Notes')).toBeTruthy();
    expect(
      ui
        .root()
        .findAll(
          (node) =>
            isHost(node, 'View') &&
            node.props.accessibilityRole === 'radiogroup' &&
            node.props.accessibilityLabel === 'Category',
        ),
    ).toHaveLength(1);
  });
});
