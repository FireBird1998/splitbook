import { GroupExpensesView } from './group-expenses';
import { GroupActivity } from './group-activity';
import { GroupMembers } from './group-members';
import { useSyncExternalStore, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlineManager } from '@tanstack/query-core';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import type {
  DraftReview,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { MobileFetch } from '../data/types';
import { savedQueriesIn } from '../test-utils/saved-queries';
import { setWindow } from '../test-utils/native';
import { ThemeContext } from './theme';
import { ToReviewHomeCard, ToReviewList } from './to-review';
import { ControllerExpenseEditor } from './controller-expense-editor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const user = {
  id: 'a00000000000000000000001',
  name: 'Alex',
  email: 'alex@example.test',
  image: null,
};
const groupId = 'b00000000000000000000001';
const otherGroupId = 'b00000000000000000000002';
const tagId = 'c00000000000000000000001';
const iso = '2026-10-14T12:00:00.000Z';
const group = {
  _id: groupId,
  createdBy: user.id,
  name: 'Maple House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  createdAt: iso,
  updatedAt: iso,
  members: [{ user: { ...user, _id: user.id }, role: 'admin', joinedAt: iso }],
  tags: [{ _id: tagId, name: 'General', isArchived: false, createdAt: iso }],
};
const savedExpense = {
  _id: 'e00000000000000000000001',
  group: groupId,
  revision: 0,
  description: 'Electricity',
  amount: 9,
  amountMinor: 900,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: { _id: user.id, name: 'Alex' }, amount: 9, amountMinor: 900 }],
  splitBetween: [{ user: { _id: user.id, name: 'Alex' }, amount: 9, amountMinor: 900 }],
  splitMethod: 'equal',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'other',
  tagId,
  tag: 'General',
  notes: '',
  isDeleted: false,
  editHistory: [],
  preparedBy: { kind: 'assistant', name: 'ChatGPT' },
};
const json = (value: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  });
function row(index: number, description: string, amount: number): PersistedExpenseDraft {
  return {
    id: `d${String(index).padStart(23, '0')}`,
    groupId,
    revision: 0,
    state: 'active',
    preparedBy: { kind: 'assistant', name: 'Claude' },
    changedBy: { kind: 'assistant', name: 'Claude' },
    createdAt: iso,
    updatedAt: iso,
    missingFields: [],
    values: {
      description,
      amount,
      currency: 'INR',
      date: '2026-10-14',
      category: 'other',
      tagId,
      paidBy: [{ user: user.id, amount }],
      splitMethod: 'equal',
      splitBetween: [{ user: user.id }],
    },
  };
}
const review = (draft: PersistedExpenseDraft): DraftReview => ({
  draft,
  review: 'a'.repeat(64),
  problems: [],
  duplicates: [],
});
function memory() {
  const values = new Map<string, unknown>();
  return {
    values,
    load: async (account: string, id: string) =>
      structuredClone(values.get(`${account}:${id}`) ?? null),
    save: async (account: string, id: string, value: unknown) => {
      values.set(`${account}:${id}`, structuredClone(value));
    },
    remove: async (account: string, id: string) => {
      values.delete(`${account}:${id}`);
    },
    clear: async () => {
      values.clear();
    },
    list: async (account: string) =>
      [...values]
        .filter(([key]) => key.startsWith(`${account}:`))
        .map(([key, value]) => ({
          groupId: key.slice(account.length + 1),
          value: structuredClone(value),
        })),
  };
}
const controllers: MobileController[] = [];
const trees: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => {
    for (const tree of trees.splice(0)) tree.unmount();
  });
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.unstubAllEnvs();
});
function fixture(
  options: {
    empty?: boolean;
    full?: boolean;
    lostUpload?: boolean;
    uploadHeld?: Promise<void>;
    provenance?: boolean;
    laterReadyGroup?: boolean;
    held?: Promise<void>;
    saveHeld?: Promise<void>;
    lost?: boolean;
    lostExpense?: boolean;
    mixed?: boolean;
    flag?: boolean;
  } = {},
) {
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', String(options.flag ?? true));
  const first = row(1, 'Lunch', 12.34),
    second = row(2, 'Fare', 23.45);
  const incomplete = {
    ...row(3, 'Missing amount', 30),
    values: { description: 'Missing amount' },
    missingFields: ['amount', 'currency', 'date'],
  };
  const duplicate = {
    ...review(row(4, 'Duplicate dinner', 30)),
    duplicates: [
      { kind: 'expense' as const, id: 'e00000000000000000000001', description: 'Earlier dinner' },
    ],
  };
  let items: DraftReview[] = options.empty
    ? []
    : [review(first), review(second), review(incomplete), duplicate];
  if (options.laterReadyGroup)
    items = [review(incomplete), review({ ...first, groupId: otherGroupId })];
  if (options.full)
    items = Array.from({ length: 100 }, (_, index) => review(row(index + 1, `Item ${index}`, 1)));
  let operation = 0;
  let uploaded: PersistedExpenseDraft | undefined;
  let race = false;
  const uploads: { key: string | null; body: string }[] = [];
  const expenses = new Set<string>();
  const expenseWrites: { key: string | null; body: string }[] = [];
  let cookie: string | null = null,
    owner: string | null = null;
  let offline = false,
    denied = false,
    identity: unknown = null;
  const drafts = memory(),
    requests = memory(),
    cache = new Map<string, unknown>();
  const saves: string[] = [],
    reviews: string[][] = [],
    calls: string[] = [];
  const committed = new Set<string>();
  const fetch: MobileFetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(`${init.method ?? 'GET'} ${path}`);
    if (offline) throw new Error('Offline');
    if (path.endsWith('/demo-persona/sign-in'))
      return json({ user }, 200, 'better-auth.session_token=alex.signature; Max-Age=2592000');
    if (path.endsWith('/sign-out')) return json({ success: true });
    if (path.endsWith('/get-session'))
      return json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path === '/api/user/to-review') {
      await options.held;
      return json({
        status: 200,
        data: {
          total: items.length,
          groups: [groupId, otherGroupId].flatMap((id) => {
            const own = items.filter((item) => item.draft.groupId === id);
            return own.length
              ? [
                  {
                    groupId: id,
                    groupName: id === groupId ? group.name : 'Later trip',
                    count: own.length,
                    items: own,
                  },
                ]
              : [];
          }),
        },
      });
    }
    if (path === '/api/user/balances')
      return json({ status: 200, data: { buckets: [], groups: [{ groupId, balances: [] }] } });
    if (path === '/api/groups')
      return json({
        status: 200,
        data: options.laterReadyGroup
          ? [group, { ...group, _id: otherGroupId, name: 'Later trip' }]
          : [group, { ...group, _id: otherGroupId, name: 'Later trip' }],
      });
    if (path === `/api/groups/${otherGroupId}`)
      return json({ status: 200, data: { ...group, _id: otherGroupId, name: 'Later trip' } });
    if (path === `/api/groups/${groupId}`)
      return denied
        ? json({ error: 'Forbidden', status: 403 }, 403)
        : json({ status: 200, data: group });
    if (path.endsWith('/drafts/review')) {
      const ids: string[] = JSON.parse(String(init.body)).ids;
      reviews.push(ids);
      return json({ data: items.filter((item) => ids.includes(item.draft.id)) });
    }
    if (path.endsWith('/drafts/save')) {
      saves.push(String(init.body));
      const selected: { id: string }[] = JSON.parse(String(init.body)).drafts;
      const outcomes = selected.map(({ id }, index) => {
        if (options.mixed && index === 1)
          return { id, status: 'failed', message: 'STALE_REVISION: changed since review' };
        if (options.mixed && index === 2)
          return { id, status: 'failed', message: 'Tag is unavailable' };
        committed.add(id);
        return { id, status: 'saved', expenseId: `e${id.slice(1)}` };
      });
      items = items.filter((item) => !committed.has(item.draft.id));
      await options.saveHeld;
      if (options.lost && saves.length === 1) throw new Error('Lost committed reply');
      return json({ data: outcomes });
    }
    if (path.endsWith('/drafts') && init.method === 'POST') {
      uploads.push({
        key: new Headers(init.headers).get('Idempotency-Key'),
        body: String(init.body),
      });
      if (race) return json({ status: 409, error: 'Full', code: 'DRAFT_GROUP_LIMIT' }, 409);
      if (uploads.length > 1 && options.lostUpload) return json({ data: [uploaded] }, 201);
      const values = JSON.parse(String(init.body)).drafts[0];
      const kept = {
        ...row(101, values.description, values.amount),
        values,
        preparedBy: { kind: 'member' as const },
      };
      uploaded = kept;
      items.push(review(kept));
      await options.uploadHeld;
      if (options.lostUpload) throw new Error('Lost upload reply');
      return json({ data: [kept] }, 201);
    }
    if (path.endsWith('/drafts')) return json({ data: items.map((item) => item.draft) });
    if (path.endsWith('/expenses') && init.method === 'POST') {
      const key = new Headers(init.headers).get('Idempotency-Key');
      expenseWrites.push({ key, body: String(init.body) });
      expenses.add(key!);
      if (options.lostExpense && expenseWrites.length === 1) throw new Error('Lost Expense reply');
      return json({ status: 201, data: { _id: 'e00000000000000000000001', group: groupId } }, 201);
    }
    if (path === `/api/groups/${groupId}/expenses/${savedExpense._id}`)
      return json({ status: 200, data: savedExpense });
    if (path.endsWith('/activity'))
      return json({
        status: 200,
        data: {
          activities: [
            {
              _id: 'f00000000000000000000001',
              group: groupId,
              actor: { _id: user.id, name: 'Alex' },
              type: 'expense_added',
              createdAt: iso,
              metadata: {
                description: 'Electricity',
                expenseId: savedExpense._id,
                amount: 9,
                currency: 'INR',
                preparedBy: { kind: 'assistant', name: 'Claude' },
              },
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      });
    if (path.endsWith('/expenses'))
      return json({
        status: 200,
        data: {
          expenses: options.provenance ? [savedExpense] : [],
          pagination: {
            page: 1,
            limit: 20,
            total: options.provenance ? 1 : 0,
            totalPages: options.provenance ? 1 : 0,
          },
          summary: {
            count: options.provenance ? 1 : 0,
            totalsByCurrency: [],
            userOwes: 0,
            userGetsBack: 0,
          },
        },
      });
    if (path.endsWith('/balances')) return json({ status: 200, data: { byCurrency: [] } });
    return json({ error: 'Unavailable', status: 404 }, 404);
  };
  const makeController = () => {
    const controller = createMobileController(
      {
        apiBaseUrl: 'http://localhost:4408',
        authOrigin: 'http://localhost:4408',
        developmentPersonaEnabled: true,
      },
      {
        fetch,
        now: () => Date.parse(iso),
        newSubmissionKey: () => `fictional-review-${++operation}`,
        credentials: {
          load: async () => cookie,
          save: async (next) => {
            cookie = next;
          },
          clear: async () => {
            cookie = null;
          },
        },
        expenseDrafts: drafts,
        draftRequests: requests,
        savedQueries: savedQueriesIn(cache),
        offlineIdentity: {
          load: async () => identity,
          save: async (next) => {
            identity = next;
          },
          clear: async () => {
            identity = null;
          },
        },
        accountLocal: {
          owner: {
            load: async () => owner,
            save: async (next) => {
              owner = next;
            },
            clear: async () => {
              owner = null;
            },
          },
          cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
          stores: [drafts, requests],
        },
      },
    );
    controllers.push(controller);
    return controller;
  };
  const controller = makeController();
  return {
    restart: makeController,
    controller,
    drafts,
    uploads,
    expenses,
    expenseWrites,
    fillBeforeUpload: () => {
      items = Array.from({ length: 99 }, (_, index) => review(row(index + 1, `Item ${index}`, 1)));
    },
    limitRace: () => {
      race = true;
    },
    saves,
    reviews,
    calls,
    committed,
    requests,
    deny: () => {
      denied = true;
    },
    goOffline: () => {
      offline = true;
    },
    addReady: () => {
      items.push(review(row(5, 'Museum', 5)));
    },
    clear: () => {
      items = [];
    },
  };
}
async function render(element: ReactElement, mode: 'light' | 'dark') {
  setWindow({ width: 360, height: 780, fontScale: 1.3 });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ThemeContext.Provider value={getSemanticTokens(mode)}>{element}</ThemeContext.Provider>,
    );
  });
  trees.push(tree);
  return tree;
}
const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) =>
      node.children
        .filter((child) => typeof child === 'string' || typeof child === 'number')
        .join(''),
    )
    .join('\n');
const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
  )[0];
async function tap(tree: ReactTestRenderer, label: string) {
  await act(async () => {
    expect(button(tree, label), label).toBeDefined();
    button(tree, label).props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
async function signIn(f: ReturnType<typeof fixture>) {
  await act(async () => {
    await f.controller.signIn('alex');
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
const noop = () => {};
function GroupRows({ controller }: { controller: MobileController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const group = snapshot.detail.data!;
  return (
    <GroupExpensesView
      group={group}
      currentUserId={user.id}
      state={snapshot.financial}
      kept={snapshot.keptDraft}
      savedExpenseId={null}
      now={Date.parse(iso)}
      onSelectMonth={noop}
      onRefreshExpenses={noop}
      onLoadMore={noop}
      onLoadNewer={noop}
      onOpenExpense={(id) => void controller.openExpense(groupId, id)}
      onResumeDraft={noop}
      onDiscardDraft={noop}
    />
  );
}
function Activity({ controller }: { controller: MobileController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <GroupActivity
      state={snapshot.activity}
      currentUserId={user.id}
      currency="INR"
      offline={false}
      now={Date.parse(iso)}
      onRetry={noop}
      onMore={noop}
      onSelect={noop}
      onClose={noop}
    />
  );
}
function Members({ controller }: { controller: MobileController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const group = snapshot.detail.data!;
  return (
    <GroupMembers
      group={group}
      currentUserId={user.id}
      back={{ label: 'Back', onPress: noop }}
      invite={{ onPress: noop, disabled: false, offline: false }}
      leave={{
        state: snapshot.leave,
        offline: snapshot.offline.active,
        toReviewCount: snapshot.toReview.read.groups.find((entry) => entry.groupId === groupId)
          ?.count,
        onOpen: () => void controller.reviewLeaveGroup(),
        onConfirm: noop,
        onCancel: controller.cancelLeaveGroup,
        onCheck: noop,
      }}
    />
  );
}
async function form(f: ReturnType<typeof fixture>, mode: 'light' | 'dark') {
  return render(
    <ControllerExpenseEditor
      controller={f.controller}
      currentUserId={user.id}
      offline={f.controller.getSnapshot().offline.active}
      onChange={f.controller.updateExpenseDraft}
      onLeaveField={f.controller.touchExpenseField}
      onEdit={() => void f.controller.editExpense()}
      onReviewDelete={() => {}}
      onDelete={() => {}}
      onCancelDelete={() => {}}
      onSave={() => void f.controller.saveExpense()}
      onRetry={() => void f.controller.openExpense(groupId)}
      onResume={f.controller.resumeExpenseDraft}
      onDiscard={() => void f.controller.discardExpenseDraft()}
      onReconcile={() => void f.controller.reconcileExpense()}
      onReviewLatest={f.controller.reviewLatestExpense}
      onAcceptCurrent={f.controller.acceptCurrentExpense}
      onClose={() => void f.controller.closeExpense()}
    />,
    mode,
  );
}
async function enter(f: ReturnType<typeof fixture>) {
  await act(async () => {
    await f.controller.openExpense(groupId);
    await f.controller.updateExpenseDraft({ description: 'Phone groceries', amount: '9', tagId });
  });
}

describe.each(['light', 'dark'] as const)('Finish later at 130 percent in %s', (mode) => {
  it('keeps an online item and closes with a View confirmation', async () => {
    const f = fixture({ empty: true });
    await signIn(f);
    await act(async () => {
      await f.controller.openExpense(groupId);
      await f.controller.updateExpenseDraft({ description: 'Phone groceries', amount: '9', tagId });
    });
    const editor = await form(f, mode);
    expect(text(editor)).toContain('Keeps it in To review. Only you can see it.');
    await tap(editor, 'Finish later');
    expect(f.controller.getSnapshot().screen).toBe('group');
    expect(f.controller.getSnapshot().snackbar?.message).toBe('Kept in To review');
  });
  it('sits in the Save bar, under Save, with its note under the button', async () => {
    const f = fixture({ empty: true });
    await signIn(f);
    await enter(f);
    const editor = await form(f, mode);
    const later = button(editor, 'Finish later');
    // The bar is the one view on its surface with a line along its top.
    let bar = later.parent;
    while (bar && !(bar.props.style && bar.props.style.borderTopWidth === 1)) bar = bar.parent;
    expect(bar, 'Finish later inside the Save bar').toBeTruthy();
    const save = bar!.findAll(
      (node) =>
        String(node.type) === 'Pressable' &&
        String(node.props.accessibilityLabel).startsWith('Save expense'),
    );
    expect(save, 'Save in the same bar').toHaveLength(1);
    // In the bar's reading order: Save, Finish later, then what Finish later does.
    const order = bar!
      .findAll(
        (node) =>
          (String(node.type) === 'Pressable' && !!node.props.accessibilityLabel) ||
          String(node.type) === 'Text',
      )
      .map((node) =>
        String(node.type) === 'Pressable'
          ? String(node.props.accessibilityLabel)
          : node.children.filter((child) => typeof child === 'string').join(''),
      );
    const at = (label: string) => order.findIndex((entry) => entry.startsWith(label));
    expect(at('Save expense')).toBeLessThan(at('Finish later'));
    expect(at('Finish later')).toBeLessThan(at('Keeps it in To review'));
    // Full width, as Save is.
    expect(later.props.style({ pressed: false }).alignSelf).toBe('stretch');
  });
  it('asks on Back with full-width Finish later and Delete, and one Keep editing', async () => {
    const f = fixture({ empty: true });
    await signIn(f);
    await enter(f);
    const editor = await form(f, mode);
    await act(async () => {
      await f.controller.back();
    });
    const sheet = editor.root.find(
      (node) => String(node.type) === 'Modal' && node.props.transparent && node.props.visible,
    );
    const labelled = (label: string) =>
      sheet.findAll(
        (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
      );
    expect(labelled('Keep editing'), 'one Keep editing').toHaveLength(1);
    const later = labelled('Finish later');
    const remove = labelled('Delete');
    expect(later).toHaveLength(1);
    expect(remove).toHaveLength(1);
    // Full width, the main choice first and filled, Delete in the warning colour.
    expect(later[0]!.props.style({ pressed: false }).alignSelf).toBe('stretch');
    expect(remove[0]!.props.style({ pressed: false }).alignSelf).toBe('stretch');
    const theme = getSemanticTokens(mode);
    expect(later[0]!.props.style({ pressed: false }).backgroundColor).toBe(theme.brand.main);
    const order = sheet
      .findAll((node) => String(node.type) === 'Pressable' && !!node.props.accessibilityLabel)
      .map((node) => String(node.props.accessibilityLabel));
    expect(order.indexOf('Finish later')).toBeLessThan(order.indexOf('Delete'));
  });

  it('asks on Back and lets the member keep editing, delete, or Finish later', async () => {
    const f = fixture({ empty: true });
    await signIn(f);
    await enter(f);
    const editor = await form(f, mode);
    await act(async () => {
      await f.controller.back();
    });
    expect(text(editor)).toContain('Finish this expense later?');
    await tap(editor, 'Keep editing');
    expect(f.controller.getSnapshot().expense.closePrompt).toBe(false);
    expect(f.controller.getSnapshot().expense.draft?.description).toBe('Phone groceries');
    await act(async () => {
      await f.controller.closeExpense();
    });
    await tap(editor, 'Delete');
    expect(f.controller.getSnapshot().screen).toBe('group');
    expect(f.drafts.values.size).toBe(0);
    await enter(f);
    await act(async () => {
      await f.controller.back();
    });
    await tap(editor, 'Finish later');
    expect(f.controller.getSnapshot().snackbar?.message).toBe('Kept in To review');
  });
  it('closes an untouched Add form silently', async () => {
    const f = fixture({ empty: true });
    await signIn(f);
    await act(async () => {
      await f.controller.openExpense(groupId);
    });
    const editor = await form(f, mode);
    await act(async () => {
      await f.controller.back();
    });
    expect(f.controller.getSnapshot().screen).toBe('group');
    expect(text(editor)).not.toContain('Finish this expense later?');
    expect(f.calls.some((call) => call === `POST /api/groups/${groupId}/drafts`)).toBe(false);
  });
  it('keeps offline entries on this phone and reconnects without uploading', async () => {
    const f = fixture({ empty: true });
    await signIn(f);
    await enter(f);
    await act(async () => {
      onlineManager.setOnline(false);
    });
    const editor = await form(f, mode);
    // In the app's typographic quotes, as To review writes them (#640).
    const note =
      'You’re offline, so it stays on this phone. It shows in To review as “On this phone”.';
    expect(text(editor)).toContain(note);
    await tap(editor, 'Finish later');
    expect(f.drafts.values.size).toBe(1);
    expect(f.controller.getSnapshot().snackbar?.message).toBe(note);
    const before = f.calls.length;
    await act(async () => {
      onlineManager.setOnline(true);
      await f.controller.refreshToReview();
    });
    expect(f.calls.slice(before).every((call) => call.startsWith('GET '))).toBe(true);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(text(list)).toContain('On this phone');
    await tap(list, 'Continue Phone groceries');
    expect(f.controller.getSnapshot().expense.status).toBe('editing');
    expect(text(editor)).toContain('Save expense');
    expect(button(editor, 'Finish later')).toBeDefined();
    await tap(editor, 'Finish later');
    expect(f.drafts.values.size).toBe(0);
    expect(f.controller.getSnapshot().toReview.read.total).toBe(1);
  });
  it('explicitly keeps even an incomplete untouched form offline', async () => {
    const f = fixture({ empty: true });
    await signIn(f);
    await act(async () => {
      await f.controller.openExpense(groupId);
      onlineManager.setOnline(false);
    });
    const editor = await form(f, mode);
    await tap(editor, 'Finish later');
    expect(f.drafts.values.size).toBe(1);
    expect(f.controller.toReviewModel().counts.onThisPhone).toBe(1);
    expect(f.uploads).toHaveLength(0);
  });
  it('disables Finish later at the per-member limit and keeps the form on a limit race', async () => {
    const f = fixture({ full: true });
    await signIn(f);
    await enter(f);
    const editor = await form(f, mode);
    expect(button(editor, 'Finish later').props.disabled).toBe(true);
    expect(text(editor)).toContain('You have 100 items waiting in this Group.');
    expect(button(editor, 'View To review')).toBeDefined();
    f.clear();
    await act(async () => {
      await f.controller.refreshToReview();
    });
    f.limitRace();
    await tap(editor, 'Finish later');
    expect(f.controller.getSnapshot().screen).toBe('expense');
    expect(f.drafts.values.size).toBe(1);
    expect(text(editor)).toContain('You have 100 items waiting in this Group.');
  });
  it('replays a lost upload reply with the same identity and removes the phone copy only after acknowledgement', async () => {
    const f = fixture({ empty: true, lostUpload: true });
    await signIn(f);
    await enter(f);
    const editor = await form(f, mode);
    await tap(editor, 'Finish later');
    expect(f.drafts.values.size).toBe(1);
    expect(f.requests.values.size).toBe(1);
    await tap(editor, 'Check again');
    expect(f.uploads).toHaveLength(2);
    expect(f.uploads[1]).toEqual(f.uploads[0]);
    expect(f.drafts.values.size).toBe(0);
    expect(f.requests.values.size).toBe(0);
    expect(f.controller.getSnapshot().toReview.read.total).toBe(1);
  });
  it('settles an uncertain Expense save before Finish later and creates exactly one Expense', async () => {
    const f = fixture({ empty: true, lostExpense: true });
    await signIn(f);
    await enter(f);
    await act(async () => {
      await f.controller.saveExpense();
    });
    expect(f.controller.getSnapshot().expense.attempt).not.toBeNull();
    const editor = await form(f, mode);
    await tap(editor, 'Finish later');
    expect(f.expenses.size).toBe(1);
    expect(f.expenseWrites).toHaveLength(2);
    expect(f.expenseWrites[1]).toEqual(f.expenseWrites[0]);
    expect(f.uploads).toHaveLength(0);
    expect(f.controller.getSnapshot().screen).toBe('group');
  });
  it('carries older Continue and Resume entries into On this phone unchanged after restart', async () => {
    const f = fixture({ empty: true });
    await signIn(f);
    await enter(f);
    const stored = structuredClone(f.drafts.values.get(`${user.id}:${groupId}`)) as Record<
      string,
      unknown
    >;
    delete stored.blank;
    f.drafts.values.set(`${user.id}:${groupId}`, stored);
    f.drafts.values.set(`${user.id}:${otherGroupId}`, { ...stored, groupId: otherGroupId });
    const before = structuredClone(f.drafts.values);
    f.controller.dispose();
    const restarted = f.restart();
    await act(async () => {
      await restarted.restore();
      await restarted.refreshToReview();
    });
    const home = await render(<ToReviewHomeCard controller={restarted} />, mode);
    expect(text(home)).toContain('only on this phone');
    expect(restarted.toReviewModel().counts.onThisPhone).toBe(2);
    expect(f.drafts.values).toEqual(before);
    expect(f.uploads).toHaveLength(0);
  });
  it('flag off keeps Resume draft and silently closes changed entries', async () => {
    const f = fixture({ flag: false, empty: true });
    await signIn(f);
    await enter(f);
    const editor = await form(f, mode);
    expect(button(editor, 'Finish later')).toBeUndefined();
    await act(async () => {
      await f.controller.closeExpense();
      await f.controller.openExpense(groupId);
    });
    expect(button(editor, 'Resume draft')).toBeDefined();
    expect(f.controller.getSnapshot().expense.closePrompt).toBeUndefined();
  });

  it('claims Finish later before waiting for storage so repeated taps and Save expense cannot race', async () => {
    const f = fixture({ empty: true });
    await signIn(f);
    await act(async () => {
      await f.controller.openExpense(groupId);
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = f.drafts.save;
    vi.spyOn(f.drafts, 'save').mockImplementation(async (...args) => {
      await held;
      await save(...args);
    });
    let typing!: Promise<void>, first!: Promise<void>, second!: Promise<void>;
    await act(async () => {
      typing = f.controller.updateExpenseDraft({
        description: 'Held phone groceries',
        amount: '9',
        tagId,
      });
      first = f.controller.keepExpenseAsSharedDraft();
      second = f.controller.keepExpenseAsSharedDraft();
      await f.controller.saveExpense();
    });
    expect(f.controller.getSnapshot().expense.status).toBe('saving');
    expect(f.uploads).toHaveLength(0);
    expect(f.expenseWrites).toHaveLength(0);
    await act(async () => {
      release();
      await Promise.all([typing, first, second]);
    });
    expect(f.uploads).toHaveLength(1);
    expect(f.expenseWrites).toHaveLength(0);
    expect(f.controller.getSnapshot().toReview.read.total).toBe(1);
  });
  it('keeps an uncertain Expense on the phone when reconnecting during offline Finish later', async () => {
    const f = fixture({ empty: true, lostExpense: true });
    await signIn(f);
    await enter(f);
    await act(async () => {
      await f.controller.saveExpense();
      onlineManager.setOnline(false);
    });
    const earlier = structuredClone(f.drafts.values);
    await act(async () => {
      const keeping = f.controller.keepExpenseAsSharedDraft();
      onlineManager.setOnline(true);
      await keeping;
    });
    expect(f.uploads).toHaveLength(0);
    expect(f.expenseWrites).toHaveLength(1);
    expect(f.expenses.size).toBe(1);
    const saved = [...f.drafts.values.values()][0] as { attempt: unknown };
    const old = [...earlier.values()][0] as { attempt: unknown };
    expect(saved.attempt).toEqual(old.attempt);
    expect(f.controller.getSnapshot().screen).toBe('group');
  });
  it('restores Check again for a lost hundredth upload after restart even at the limit', async () => {
    const f = fixture({ empty: true, lostUpload: true });
    await signIn(f);
    await enter(f);
    f.fillBeforeUpload();
    await act(async () => {
      await f.controller.keepExpenseAsSharedDraft();
    });
    expect(f.requests.values.size).toBe(1);
    f.controller.dispose();
    const restarted = f.restart();
    await act(async () => {
      await restarted.restore();
      await restarted.refreshToReview();
      await restarted.openExpense(groupId);
    });
    expect(restarted.getSnapshot().toReview.read.total).toBe(100);
    const editor = await form({ ...f, controller: restarted }, mode);
    expect(button(editor, 'Check again').props.disabled).toBe(false);
    await tap(editor, 'Check again');
    expect(f.uploads).toHaveLength(2);
    expect(f.uploads[1]).toEqual(f.uploads[0]);
    expect(f.drafts.values.size).toBe(0);
    expect(f.requests.values.size).toBe(0);
  });
  it('ignores a late Finish later acknowledgement after sign-out', async () => {
    let release!: () => void;
    const f = fixture({
      empty: true,
      uploadHeld: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    await signIn(f);
    await enter(f);
    let pending!: Promise<void>;
    await act(async () => {
      pending = f.controller.keepExpenseAsSharedDraft();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      await f.controller.signOut();
      release();
      await pending;
    });
    expect(f.controller.getSnapshot().auth.status).toBe('signed-out');
    expect(f.controller.getSnapshot().snackbar).toBeNull();
    expect(f.controller.getSnapshot().expense.draft).toBeNull();
    expect(f.drafts.values.size).toBe(0);
    expect(f.requests.values.size).toBe(0);
  });
  it.each([true, false])(
    'shows prepared by on Expense rows, details and Activity with flag %s',
    async (flag) => {
      const f = fixture({ flag, provenance: true });
      await signIn(f);
      await act(async () => {
        await f.controller.openGroup(groupId);
      });
      const rows = await render(<GroupRows controller={f.controller} />, mode);
      expect(text(rows)).toContain('You paid · prepared by ChatGPT');
      await act(async () => {
        await f.controller.openExpense(groupId, savedExpense._id);
      });
      const editor = await form(f, mode);
      expect(text(editor)).toContain('Prepared by ChatGPT');
      await act(async () => {
        await f.controller.closeExpense();
        await f.controller.openActivity(groupId);
      });
      const activity = await render(<Activity controller={f.controller} />, mode);
      expect(JSON.stringify(activity.toJSON())).toContain('prepared by Claude');
      expect(
        activity.root
          .findAll((node) => String(node.type) === 'Pressable')
          .some((node) => node.props.accessibilityLabel?.includes('prepared by Claude')),
      ).toBe(true);
    },
  );
  it('shows the cached account count in Leave and retains it offline while the sheet is open', async () => {
    const f = fixture();
    await signIn(f);
    await act(async () => {
      await f.controller.openGroup(groupId);
      f.controller.openMembers();
      await f.controller.reviewLeaveGroup();
    });
    const members = await render(<Members controller={f.controller} />, mode);
    expect(text(members)).toContain(
      'You have 4 items in To review for Maple House. They’re kept but hidden while you’re not a member.',
    );
    await act(async () => {
      onlineManager.setOnline(false);
    });
    expect(text(members)).toContain('You have 4 items in To review');
  });
});
