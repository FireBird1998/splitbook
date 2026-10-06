import { useSyncExternalStore } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyExpenseEditor } from '../data/expense-draft';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { FetchResponse, MobileFetch } from '../data/types';
import { clockTime } from './activity-format';
import { ExpenseEditor } from './expense-editor';
import { fonts } from './theme';
import { motion } from './compact';
import { findHosts, flatten, layoutHeight } from '../test-utils/layout';
import { setWindow, timing } from '../test-utils/native';

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
  weekly: 'b00000000000000000000005',
  taxi: 'b00000000000000000000006',
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
  [ids.taxi]: expense(ids.taxi, {
    description: 'Airport taxi',
    amount: 1500,
    amountMinor: 150000,
    paidBy: [row(alex, 150000)],
    splitBetween: [row(alex, 50000), row(sam, 50000), row(priya, 50000)],
    createdBy: alex.id,
  }),
  [ids.weekly]: expense(ids.weekly, {
    description: 'Weekly groceries',
    amount: 900,
    amountMinor: 90000,
    paidBy: [row(alex, 90000)],
    splitBetween: [row(alex, 45000), row(sam, 45000)],
    createdBy: alex.id,
  }),
};
const gone = 'a00000000000000000000099';
const edit = (
  id: string,
  actor: unknown,
  createdAt: string,
  changes: Record<string, { old: unknown; new: unknown }>,
) => ({
  _id: id,
  group: groupId,
  type: 'expense_updated',
  actor,
  createdAt,
  metadata: { changes },
});
const added = (id: string, actor: unknown, createdAt: string) => ({
  _id: id,
  group: groupId,
  type: 'expense_added',
  actor,
  createdAt,
  metadata: {},
});
/** Each Expense's own Activity, newest first, as the Expense filter returns it. */
const histories: Record<string, Record<string, unknown>[]> = {
  [ids.bill]: [
    edit('d00000000000000000000011', person(priya), '2026-09-29T15:40:00.000Z', {
      amount: { old: 2680, new: 2860 },
      amountMinor: { old: 268000, new: 286000 },
    }),
    added('d00000000000000000000012', person(sam), iso),
  ],
  // Twenty notes edits, then the Expense being added: two pages.
  [ids.weekly]: [
    ...Array.from({ length: 20 }, (_, index) =>
      edit(
        `d000000000000000000001${String(index).padStart(2, '0')}`,
        person(sam),
        new Date(Date.parse('2026-09-29T20:00:00.000Z') - index * 60_000).toISOString(),
        { notes: { old: `Draft ${index + 1}`, new: `Draft ${index}` } },
      ),
    ),
    added('d00000000000000000000200', person(alex), iso),
  ],
  // Priya joins the split: her earlier share is a word, not an amount.
  [ids.taxi]: [
    edit('d00000000000000000000400', person(sam), '2026-09-29T15:20:00.000Z', {
      splitBetween: {
        old: [
          { user: alex.id, amount: 750, amountMinor: 75000 },
          { user: sam.id, amount: 750, amountMinor: 75000 },
        ],
        new: [
          { user: alex.id, amount: 500, amountMinor: 50000 },
          { user: sam.id, amount: 500, amountMinor: 50000 },
          { user: priya.id, amount: 500, amountMinor: 50000 },
        ],
      },
    }),
  ],
  // Neither the person who edited nor one of the people on the split is named any more.
  [ids.historical]: [
    edit('d00000000000000000000300', null, '2026-09-29T15:00:00.000Z', {
      splitBetween: {
        old: [
          { user: alex.id, amount: 100, amountMinor: 10000 },
          { user: gone, amount: 200, amountMinor: 20000 },
        ],
        new: [
          { user: alex.id, amount: 150, amountMinor: 15000 },
          { user: gone, amount: 150, amountMinor: 15000 },
        ],
      },
    }),
  ],
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
  let held: Promise<void> | null = null;
  let unreachable = false;
  const fetch: MobileFetch = async (url, init) => {
    const address = new URL(url);
    const path = address.pathname;
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
    const expenseId = address.searchParams.get('expenseId');
    if (path.endsWith('/activity') && expenseId !== null) {
      await held;
      if (unreachable) throw new Error('Network request failed');
      const page = Number(address.searchParams.get('page'));
      const events = (histories[expenseId] ?? []).map((event) => ({
        ...event,
        metadata: { ...(event.metadata as object), expenseId },
      }));
      return json({
        status: 200,
        data: {
          activities: events.slice((page - 1) * 20, page * 20),
          pagination: {
            page,
            limit: 20,
            total: events.length,
            totalPages: Math.ceil(events.length / 20),
          },
        },
      });
    }
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
  return {
    controller,
    writes,
    /** Holds history reads until the returned function is called. */
    holdHistory: () => {
      let release!: () => void;
      held = new Promise((resolve) => (release = resolve));
      return () => {
        held = null;
        release();
      };
    },
    /** History reads fail as they would offline, without a saved copy. */
    setUnreachable: (value: boolean) => {
      unreachable = value;
    },
  };
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
      onLoadOlderHistory={() => void controller.loadOlderExpenseHistory()}
      onRetryHistory={() => void controller.refreshExpenseHistory()}
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
/** Each line of text as it reads, with the runs nested in it. */
const lines = (scope: ReactTestInstance) => {
  const read = (node: ReactTestInstance): string =>
    node.children.map((child) => (typeof child === 'string' ? child : read(child))).join('');
  const nested = (node: ReactTestInstance) => {
    for (let parent = node.parent; parent; parent = parent.parent)
      if (isHost(parent, 'Text')) return true;
    return false;
  };
  return scope.findAll((node) => isHost(node, 'Text') && !nested(node)).map(read);
};

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});

async function render(
  open: (controller: MobileController) => Promise<void>,
  prepare?: (harness: ReturnType<typeof backend>) => void,
) {
  const harness = backend();
  await harness.controller.signIn('alex');
  prepare?.(harness);
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
/** Opens a record and returns once it's shown, while its changes may still be read. */
const shownBeforeHistory = (id: string) => async (controller: MobileController) => {
  void controller.openExpense(groupId, id);
  for (let tick = 0; tick < 50 && controller.getSnapshot().expense.status !== 'detail'; tick++)
    await new Promise((resolve) => setTimeout(resolve, 0));
};
const when = (value: string) =>
  `${new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${clockTime(value)}`;

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

  it('shows when it was added and last changed while its changes load', async () => {
    let release: () => void = () => undefined;
    const ui = await render(shownBeforeHistory(ids.bill), (harness) => {
      release = harness.holdHistory();
    });
    expect(ui.headings()).toContain('History');
    const history = () =>
      ui.labels().filter((label) => /changed|added this Expense|Last changed/.test(label));
    expect(history()).toEqual([
      `Last changed, ${when('2026-09-29T15:40:00.000Z')}`,
      `Sam Chen added this Expense, ${when(iso)}`,
    ]);
    const loading = ui
      .root()
      .find((node) => isHost(node, 'View') && node.props.accessibilityLiveRegion === 'polite');
    expect(text(loading)).toBe('Loading this Expense’s changes…');

    release();
    await settle();
    expect(history()).toEqual([
      `Priya Shah changed the amount, Amount from ₹2,680.00 to ₹2,860.00, ${when('2026-09-29T15:40:00.000Z')}`,
      `Sam Chen added this Expense, ${when(iso)}`,
    ]);
    expect(text(ui.root())).not.toContain('Loading this Expense’s changes');
  });

  it('lists who changed what with its before and after values, and no identifiers', async () => {
    const ui = await render(open(ids.bill));
    const shown = lines(ui.root());
    // The title names the change, so only its values follow, with the time.
    expect(shown).toEqual(
      expect.arrayContaining([
        'Priya Shah changed the amount',
        `₹2,680.00 → ₹2,860.00 · ${when('2026-09-29T15:40:00.000Z')}`,
        'Sam Chen added this Expense',
      ]),
    );
    expect(shown).not.toContain('Last changed');
    expect(shown.join('\n')).not.toMatch(/[0-9a-f]{24}|[{}[\]]|amountMinor/);
    expect(() => ui.pressable('Load older changes')).toThrow();
  });

  it('sets amounts in the money face, and a share that wasn’t there in the text face', async () => {
    const ui = await render(open(ids.taxi));
    expect(lines(ui.root())).toContain('Priya Shah’s share Not included → ₹500.00');
    const runs = (value: string) =>
      ui
        .root()
        .findAll((node) => isHost(node, 'Text') && node.children.join('') === value)
        .map(
          (node) =>
            [node.props.style]
              .flat(Infinity)
              .reduce((face, style) => style?.fontFamily ?? face, null) as string | null,
        );
    expect(runs('Not included')).toEqual([null]);
    expect(runs('₹750.00')).toEqual([fonts.mono, fonts.mono]);
    expect(runs('₹500.00')).toContain(fonts.mono);
  });

  it('names people who are no longer in the Group or on the Expense as former members', async () => {
    const ui = await render(open(ids.historical));
    expect(ui.labels()).toContain(
      `Former member changed the split, Alex Rao’s share from ₹100.00 to ₹150.00, Former member’s share from ₹200.00 to ₹150.00, ${when('2026-09-29T15:00:00.000Z')}`,
    );
    const shown = lines(ui.root());
    expect(shown).toEqual(
      expect.arrayContaining([
        'Former member changed the split',
        'Alex Rao’s share ₹100.00 → ₹150.00',
        'Former member’s share ₹200.00 → ₹150.00',
        when('2026-09-29T15:00:00.000Z'),
      ]),
    );
    expect(shown.join('\n')).not.toMatch(/[0-9a-f]{24}/);
    // Only one page, and it doesn't include the Expense being added: the record says when.
    expect(ui.labels()).toContain(`Added, ${when(iso)}`);
  });

  it('offers Load older changes while there are more, and adds them below', async () => {
    const ui = await render(open(ids.weekly));
    const rows = () => ui.labels().filter((label) => /changed the notes|added this/.test(label));
    expect(rows()).toHaveLength(20);
    expect(rows()[0]).toBe(
      `Sam Chen changed the notes, Notes from “Draft 1” to “Draft 0”, ${when('2026-09-29T20:00:00.000Z')}`,
    );
    const more = ui.pressable('Load older changes');
    expect(more.props).toMatchObject({ accessibilityRole: 'button', disabled: false });

    await ui.press('Load older changes');
    expect(rows()).toHaveLength(21);
    expect(rows().at(-1)).toBe(`You added this Expense, ${when(iso)}`);
    expect(() => ui.pressable('Load older changes')).toThrow();
  });

  it('keeps its added and last-changed times when its changes can’t be read; Try again reads them', async () => {
    const ui = await render(open(ids.bill), (harness) => harness.setUnreachable(true));
    expect(
      ui.labels().filter((label) => /changed|added this Expense|Last changed/.test(label)),
    ).toEqual([
      `Last changed, ${when('2026-09-29T15:40:00.000Z')}`,
      `Sam Chen added this Expense, ${when(iso)}`,
    ]);
    expect(text(ui.root())).toContain('Couldn’t load this Expense’s changes.');
    // The record itself is unaffected.
    expect(text(ui.root())).toContain('You owe Sam ₹953.33');
    expect(ui.pressable('Edit expense').props.disabled).toBe(false);

    const retry = ui.pressable('Try loading this Expense’s changes again');
    expect(retry.props.accessibilityRole).toBe('button');
    ui.setUnreachable(false);
    await ui.press('Try loading this Expense’s changes again');
    expect(ui.labels()).toContain(
      `Priya Shah changed the amount, Amount from ₹2,680.00 to ₹2,860.00, ${when('2026-09-29T15:40:00.000Z')}`,
    );
    expect(text(ui.root())).not.toContain('Couldn’t load');
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
    // The record's skeleton stands in, announced as busy under the Expense's name for the wait.
    const opening = screen!.root.findAll(
      (node) =>
        typeof node.type === 'string' && node.props.accessibilityLabel === 'Opening this Expense…',
    );
    expect(opening).toHaveLength(1);
    expect(opening[0].props.accessibilityState).toEqual({ busy: true });
    expect(opening[0].props.accessibilityLiveRegion).toBe('polite');
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

// #331: the record opens over a skeleton of its own shape, then fades in where it was.
describe('compact Expense record, opening', () => {
  /** The first card in the scrolling content: the record's summary, or its skeleton. */
  const summaryCard = () => {
    const [content] = findHosts(screen!.toJSON(), (_props, type) => type === 'ScrollView');
    const [card] = findHosts(content, (props) => {
      const style = flatten(props.style);
      return style.borderRadius === 14 && style.overflow === 'hidden';
    });
    return card;
  };
  const editor = (state: Parameters<typeof ExpenseEditor>[0]['state']) => (
    <ExpenseEditor
      state={state}
      currentUserId={alex.id}
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
    />
  );
  const opening = editor({
    ...emptyExpenseEditor(),
    status: 'loading',
    requestedExpenseId: ids.dinner,
  });

  // The amount and its badge share a wrapping row: on a 360dp phone this one's don't fit on one
  // line even at 100% text, on a 412dp phone they do until 130%. The skeleton stacks to match.
  it.each([
    [360, 1, 'wraps'],
    [360, 1.3, 'wraps'],
    [412, 1, 'fits'],
    [412, 1.3, 'wraps'],
  ] as const)(
    'its summary takes the place of the skeleton’s at the same height, %sdp wide at %s× text (%s)',
    async (width, fontScale, row) => {
      setWindow({ width, fontScale });
      // The card's width: the screen less the scrolling content's 16 each side.
      const card = width - 32;
      await act(async () => {
        screen = create(opening);
      });
      const skeleton = layoutHeight(summaryCard(), fontScale, card);
      act(() => screen?.unmount());
      await render(open(ids.dinner));
      expect(text(screen!.root)).toContain('Sunday dinner');
      // The fixture's amount and badge do wrap where the case says, so the comparison means it.
      expect(layoutHeight(summaryCard(), fontScale, card) - layoutHeight(summaryCard(), fontScale))[
        row === 'wraps' ? 'toBeGreaterThan' : 'toBe'
      ](0);
      expect(skeleton).toBeGreaterThan(100);
      expect(layoutHeight(summaryCard(), fontScale, card)).toBe(skeleton);
    },
  );

  it('fades in where its skeleton was, on the native driver', async () => {
    const harness = backend();
    await harness.controller.signIn('alex');
    await harness.controller.openExpense(groupId, ids.dinner);
    const record = harness.controller.getSnapshot().expense;
    // Shown over its skeleton first, once Android has said reduce motion is off.
    await act(async () => {
      screen = create(opening);
    });
    timing.mockClear();
    act(() => screen!.update(editor(record)));
    expect(text(screen!.root)).toContain('Sunday dinner');
    const fade = timing.mock.results
      .map((result) => result.value)
      .find((animation) => animation.config.duration === motion.reveal);
    expect(fade.config).toMatchObject({ toValue: 1, useNativeDriver: true });
    expect(fade.value.value).toBe(0);
    expect(fade.start).toHaveBeenCalledOnce();
    const faded = screen!.root.findAll(
      (node) => isHost(node, 'AnimatedView') && flatten(node.props.style).opacity === fade.value,
    );
    expect(faded).toHaveLength(1);
    expect(text(faded[0])).toContain('Sunday dinner');
  });
});
