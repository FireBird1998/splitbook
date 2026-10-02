import { useSyncExternalStore } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyExpenseEditor } from '../data/expense-draft';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { FetchResponse, MobileFetch } from '../data/types';
import { clockTime } from './activity-format';
import { ExpenseEditor } from './expense-editor';

// Host stand-ins: the record renders through these names, so the tree keeps the props
// (roles, labels, hints, states, handlers) that Android receives.
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

// Fictional people and Groups only.
const alex = { id: 'a00000000000000000000001', name: 'Alex Rao', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 'sam@example.test' };
const priya = { id: 'a00000000000000000000003', name: 'Priya Shah', email: 'priya@example.test' };
const groupId = 'a00000000000000000000010';
const tagId = 'a00000000000000000000020';
const ids = {
  bill: 'b00000000000000000000001',
  dinner: 'b00000000000000000000002',
  deleted: 'b00000000000000000000003',
  historical: 'b00000000000000000000004',
};
const iso = '2026-09-29T14:32:00.000Z';
const group = {
  _id: groupId,
  createdBy: alex.id,
  name: 'Maple House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  members: [alex, sam, priya].map((user) => ({
    user: { ...user, _id: user.id, image: null },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Utilities', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const person = (user: { id: string; name: string }) => ({ _id: user.id, name: user.name });
const row = (user: { id: string; name: string } | null, amountMinor: number) => ({
  user: user && person(user),
  amount: amountMinor / 100,
  amountMinor,
});
const expense = (id: string, fields: Record<string, unknown>) => ({
  _id: id,
  group: groupId,
  revision: 0,
  currency: 'INR',
  moneyVersion: 1,
  splitMethod: 'equal',
  date: '2026-09-29T06:30:00.000Z',
  createdAt: iso,
  updatedAt: iso,
  category: 'other',
  tagId,
  tag: 'Utilities',
  notes: '',
  isDeleted: false,
  editHistory: [],
  ...fields,
});
const records: Record<string, Record<string, unknown>> = {
  // The stored allocation gives the leftover ₹0.01 to Sam; the record never recalculates it.
  [ids.bill]: expense(ids.bill, {
    description: 'Electricity bill',
    amount: 2860,
    amountMinor: 286000,
    revision: 1,
    paidBy: [row(sam, 286000)],
    splitBetween: [row(alex, 95333), row(sam, 95334), row(priya, 95333)],
    category: 'housing',
    notes: 'August–September meter cycle',
    createdBy: person(sam),
    updatedAt: '2026-09-29T15:40:00.000Z',
  }),
  [ids.dinner]: expense(ids.dinner, {
    description: 'Sunday dinner',
    amount: 2400,
    amountMinor: 240000,
    paidBy: [row(alex, 240000)],
    splitBetween: [row(alex, 80000), row(sam, 80000), row(priya, 80000)],
    createdBy: alex.id,
  }),
  [ids.deleted]: expense(ids.deleted, {
    description: 'Movie tickets',
    amount: 450,
    amountMinor: 45000,
    paidBy: [row(sam, 45000)],
    splitBetween: [row(alex, 22500), row(sam, 22500)],
    isDeleted: true,
    deletedAt: '2026-09-29T16:00:00.000Z',
    updatedAt: '2026-09-29T16:00:00.000Z',
  }),
  [ids.historical]: expense(ids.historical, {
    description: 'Old groceries',
    amount: 300,
    amountMinor: 30000,
    paidBy: [row(null, 30000)],
    splitBetween: [row(alex, 15000), row(null, 15000)],
  }),
};
const json = (data: unknown, status = 200): FetchResponse =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function backend() {
  const writes: string[] = [];
  const stored = new Map<string, unknown>();
  const drafts = {
    load: async (accountId: string, id: string) =>
      structuredClone(stored.get(`${accountId}:${id}`) ?? null),
    save: async (accountId: string, id: string, value: unknown) => {
      stored.set(`${accountId}:${id}`, structuredClone(value));
    },
    remove: async (accountId: string, id: string) => {
      stored.delete(`${accountId}:${id}`);
    },
    clear: async () => stored.clear(),
  };
  const deleted = new Set<string>();
  const fetch: MobileFetch = async (url, init) => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    if (method !== 'GET' && path.startsWith('/api/groups')) writes.push(`${method} ${path}`);
    if (path.endsWith('/demo-persona/sign-in'))
      return new Response(JSON.stringify({ user: alex }), {
        headers: { 'Set-Cookie': 'better-auth.session_token=alex.signature; Max-Age=2592000' },
      });
    if (path.endsWith('/get-session'))
      return json({ user: alex, session: { userId: alex.id, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path === '/api/groups') return json({ data: [group], status: 200 });
    if (path === '/api/user/balances') return json({ data: { buckets: [] }, status: 200 });
    if (path === `/api/groups/${groupId}`) return json({ data: group, status: 200 });
    const id = path.split('/').pop()!;
    if (path === `/api/groups/${groupId}/expenses/${id}` && records[id]) {
      if (method === 'DELETE') deleted.add(id);
      return json({
        status: 200,
        data: { ...records[id], isDeleted: deleted.has(id) || records[id].isDeleted },
      });
    }
    if (path.endsWith('/expenses'))
      return json({
        status: 200,
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
        },
      });
    if (path.endsWith('/balances'))
      return json({ data: { currency: 'INR', balances: [], debts: [], byCurrency: [] } });
    if (path.endsWith('/activity'))
      return json({
        status: 200,
        data: {
          activities: [
            {
              _id: 'd00000000000000000000001',
              group: groupId,
              type: 'expense_edited',
              actor: person(sam),
              createdAt: '2026-09-29T15:40:00.000Z',
              metadata: { expenseId: ids.bill, description: 'Electricity bill' },
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      });
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
      now: () => Date.parse('2026-09-30T09:00:00.000Z'),
      newSubmissionKey: () => 'native-record-test-0001',
    },
  );
  return { controller, writes };
}

function RecordScreen({ controller }: { controller: MobileController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <ExpenseEditor
      state={state.expense}
      currentUserId={alex.id}
      onClose={() => void controller.back()}
      onChange={(patch) => void controller.updateExpenseDraft(patch)}
      onLeaveField={controller.touchExpenseField}
      onSave={() => void controller.saveExpense()}
      onEdit={() => void controller.editExpense()}
      onResume={controller.resumeExpenseDraft}
      onDiscard={() => void controller.discardExpenseDraft()}
      onRetry={() => void controller.openExpense(groupId, state.expense.requestedExpenseId!)}
      onReviewDelete={controller.reviewExpenseDeletion}
      onDelete={() => void controller.deleteExpense()}
      onCancelDelete={controller.cancelExpenseDeletion}
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

async function render(open: (controller: MobileController) => Promise<void>) {
  const harness = backend();
  await harness.controller.signIn('alex');
  await open(harness.controller);
  await act(async () => {
    screen = create(<RecordScreen controller={harness.controller} />);
  });
  const root = () => screen!.root;
  /** The visible screen, or the sheet over it: a closed sheet's content isn't on screen. */
  const shown = () => {
    const sheets = root().findAll((node) => isHost(node, 'Modal') && node.props.visible === true);
    return sheets.length ? sheets[sheets.length - 1] : root();
  };
  const pressable = (label: string, scope = shown()) =>
    scope.find((node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === label);
  const labels = () =>
    root()
      .findAll((node) => isHost(node, 'View') && node.props.accessible === true)
      .map((node) => node.props.accessibilityLabel as string);
  return {
    ...harness,
    root,
    shown,
    pressable,
    labels,
    headings: () =>
      root()
        .findAll((node) => isHost(node, 'Text') && node.props.accessibilityRole === 'header')
        .map(text),
    press: async (label: string) => {
      await act(async () => pressable(label).props.onPress());
      await settle();
    },
  };
}

const open = (id: string) => (controller: MobileController) => controller.openExpense(groupId, id);

describe('compact Expense record', () => {
  it('shows what it was for, the member’s position and who owes what', async () => {
    const ui = await render(open(ids.bill));
    expect(ui.headings().slice(0, 2)).toEqual(['Expense', 'Electricity bill']);
    const shown = text(ui.root());
    expect(shown).toContain('Maple House');
    expect(shown).toContain('₹2,860.00');
    // From the stored allocation: Alex’s share is ₹953.33, owed to the one payer.
    expect(shown).toContain('You owe Sam ₹953.33');
    const tagged = ui
      .root()
      .find((node) => isHost(node, 'Text') && /Tag Utilities$/.test(node.props.accessibilityLabel));
    expect(text(tagged)).toMatch(/· Utilities$/);
    expect(ui.labels().filter((label) => label.includes(': paid'))).toEqual([
      'You: paid nothing, share ₹953.33',
      'Sam Chen: paid ₹2,860.00, share ₹953.34',
      'Priya Shah: paid nothing, share ₹953.33',
    ]);
    expect(shown).toContain('Equally · 3');
    expect(shown).toContain('Shares differ by the smallest unit so the whole amount is shared.');
    // A saved Expense always adds up; the form’s running check isn’t repeated.
    expect(shown).not.toContain('Adds up');
    expect(shown).not.toContain('paid =');
    expect(ui.labels()).toEqual(
      expect.arrayContaining(['Category: Housing', 'Notes: August–September meter cycle']),
    );
    expect(shown).not.toMatch(/[0-9a-f]{24}/);
    // No amount is ever cut short: one held to a line shrinks to fit instead.
    const amounts = ui
      .root()
      .findAll((node) => isHost(node, 'Text') && /^₹/.test(String(node.children[0])));
    expect(amounts.length).toBeGreaterThan(3);
    for (const amount of amounts)
      if (amount.props.numberOfLines) expect(amount.props.adjustsFontSizeToFit).toBe(true);
    expect(ui.writes).toEqual([]);
  });

  it('shows when it was added and last changed under History', async () => {
    const ui = await render(open(ids.bill));
    expect(ui.headings()).toContain('History');
    const history = ui.labels().filter((label) => /added this Expense|Last changed/.test(label));
    const when = (value: string) =>
      `${new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${clockTime(value)}`;
    expect(history).toEqual([
      `Last changed, ${when('2026-09-29T15:40:00.000Z')}`,
      `Sam Chen added this Expense, ${when(iso)}`,
    ]);
  });

  it('says what the member lent, and leaves out Category and Notes when there are none', async () => {
    const ui = await render(open(ids.dinner));
    const shown = text(ui.root());
    expect(shown).toContain('You lent ₹1,600.00');
    expect(ui.labels().some((label) => /^(Category|Notes):/.test(label))).toBe(false);
    expect(ui.labels().filter((label) => /added this Expense|Last changed/.test(label))).toEqual([
      expect.stringMatching(/^You added this Expense, /),
    ]);
  });

  it('has Edit in the top bar, which opens the compact form', async () => {
    const ui = await render(open(ids.bill));
    const edit = ui.pressable('Edit expense');
    expect(edit.props.disabled).toBe(false);
    expect(text(edit)).toBe('Edit');
    expect(ui.pressable('Back to Group')).toBeTruthy();
    await ui.press('Edit expense');
    expect(ui.headings()[0]).toBe('Edit expense');
    expect(ui.writes).toEqual([]);
  });

  it('keeps Delete in ⋮ behind the confirmation; Cancel keeps the Expense', async () => {
    const ui = await render(open(ids.bill));
    // Delete isn't on the record itself.
    expect(ui.root().findAll((node) => isHost(node, 'Modal') && node.props.visible)).toHaveLength(
      0,
    );
    await ui.press('Expense options');
    expect(text(ui.shown())).toContain('Expense options');
    // A menu has no entries to keep.
    expect(ui.pressable('Close Expense options')).toBeTruthy();
    expect(ui.pressable('Refresh, Read the latest saved version')).toBeTruthy();
    await ui.press('Delete expense');
    expect(ui.controller.getSnapshot().expense.status).toBe('delete-review');
    expect(text(ui.shown())).toContain('Delete this Expense?');
    expect(text(ui.shown())).toContain('Electricity bill will no longer count in balances.');
    expect(ui.writes).toEqual([]);

    await ui.press('Cancel');
    expect(ui.controller.getSnapshot().expense.status).toBe('detail');
    expect(ui.writes).toEqual([]);

    await ui.press('Expense options');
    await ui.press('Delete expense');
    await ui.press('Delete expense');
    expect(ui.writes).toEqual([`DELETE /api/groups/${groupId}/expenses/${ids.bill}`]);
    expect(ui.controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Expense deleted · Electricity bill' },
    });
  });

  it('says a deleted Expense was deleted and offers neither Edit nor Delete', async () => {
    const ui = await render(open(ids.deleted));
    const shown = text(ui.root());
    expect(shown).toContain('Deleted');
    expect(shown).toContain('This Expense was deleted. It no longer counts in balances.');
    expect(shown).not.toContain('You owe');
    expect(() => ui.pressable('Edit expense')).toThrow();
    await ui.press('Expense options');
    expect(() => ui.pressable('Delete expense')).toThrow();
    expect(ui.labels()).toEqual(expect.arrayContaining([expect.stringMatching(/^Deleted, /)]));
  });

  it('explains why an Expense with a former member can’t be edited', async () => {
    const ui = await render(open(ids.historical));
    const reason =
      'This Expense includes a member whose account is no longer available, so it can’t be edited.';
    expect(ui.pressable('Edit expense').props).toMatchObject({
      disabled: true,
      accessibilityHint: reason,
    });
    expect(text(ui.root())).toContain('It can be deleted, but not edited.');
    // A missing identity can't be matched across payer and participant rows.
    expect(ui.labels().filter((label) => label.includes(': paid'))).toEqual([
      'You: paid nothing, share ₹150.00',
      'Former member: paid nothing, share ₹150.00',
      'Former member: paid ₹300.00, share ₹0.00',
    ]);
    await ui.press('Expense options');
    expect(ui.pressable('Delete expense').props.disabled).toBe(false);
  });

  it('names Activity on Back when it opened from an Activity event', async () => {
    const ui = await render(async (controller) => {
      await controller.openActivity(groupId);
      await controller.openActivityEvent('d00000000000000000000001');
    });
    expect(ui.headings()[1]).toBe('Electricity bill');
    await ui.press('Back to Activity');
    expect(ui.controller.getSnapshot()).toMatchObject({ screen: 'group', destination: 'activity' });
  });

  it('names the Expense while it opens, and when it can’t be opened', async () => {
    await act(async () => {
      screen = create(
        <ExpenseEditor
          state={{ ...emptyExpenseEditor(), status: 'loading', requestedExpenseId: ids.bill }}
          onChange={() => undefined}
          onLeaveField={() => undefined}
          onSave={() => undefined}
          onResume={() => undefined}
          onDiscard={() => undefined}
          onRetry={() => undefined}
          onEdit={() => undefined}
          onReviewDelete={() => undefined}
          onDelete={() => undefined}
          onCancelDelete={() => undefined}
          onReconcile={() => undefined}
          onReviewLatest={() => undefined}
          onAcceptCurrent={() => undefined}
        />,
      );
    });
    expect(text(screen!.root)).toContain('Opening this Expense…');
    act(() => screen?.unmount());

    const ui = await render((controller) =>
      controller.openExpense(groupId, 'b00000000000000000000099'),
    );
    expect(text(ui.root())).toContain('Couldn’t open this Expense');
    // The Group is still there; only the Expense is missing.
    expect(text(ui.root())).toContain('This Expense isn’t available.');
    expect(text(ui.root())).not.toMatch(/draft|group/i);
  });
});
