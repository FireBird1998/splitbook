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
import { clockTime } from './activity-format';
import { ToReviewHomeCard, ToReviewOverlay } from './to-review';
import { GroupMembers } from './group-members';
import { ReviewRunOverlay } from './review-run';

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
    one?: boolean;
    member?: boolean;
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
  if (options.one) items = [review(first)];
  if (options.member) items[0].draft.preparedBy = { kind: 'member' };
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
  let putReply: Promise<void> | null = null;
  let nextRead: Promise<void> | null = null;
  const fetch: MobileFetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(`${init.method ?? 'GET'} ${path}`);
    if (offline) throw new Error('Offline');
    if (path.endsWith('/demo-persona/sign-in'))
      return json({ user }, 200, 'better-auth.session_token=alex.signature; Max-Age=2592000');
    if (path.endsWith('/get-session'))
      return json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path === '/api/user/to-review') {
      if (nextRead) {
        const held = nextRead;
        nextRead = null;
        await held;
      }
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
                    groupName: id === groupId ? group.name : 'Goa Friends Trip',
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
          ? [group, { ...group, _id: otherGroupId, name: 'Goa Friends Trip' }]
          : [group],
      });
    if (path === `/api/groups/${otherGroupId}`)
      return json({ status: 200, data: { ...group, _id: otherGroupId, name: 'Goa Friends Trip' } });
    if (path === `/api/groups/${groupId}`)
      return denied
        ? json({ error: 'Forbidden', status: 403 }, 403)
        : json({ status: 200, data: group });
    const editing = items.find((item) => path.endsWith(`/drafts/${item.draft.id}`));
    if (editing && init.method === 'PUT') {
      editing.draft = {
        ...editing.draft,
        revision: editing.draft.revision + 1,
        changedBy: { kind: 'member' },
        values: JSON.parse(String(init.body)).values,
        missingFields: [],
      };
      if (putReply) {
        const held = putReply;
        putReply = null;
        await held;
      }
      return json({ data: editing.draft });
    }
    if (editing && init.method === 'DELETE') {
      items = items.filter((item) => item !== editing);
      return json({ data: { discarded: true } });
    }
    if (path.includes('/expenses/e000'))
      return json({
        status: 200,
        data: {
          _id: 'e00000000000000000000001',
          group: groupId,
          revision: 0,
          description: 'Earlier dinner',
          amount: 30,
          currency: 'INR',
          paidBy: [{ user: user.id, amount: 30 }],
          splitBetween: [{ user: user.id, amount: 30 }],
          splitMethod: 'equal',
          date: iso,
          createdAt: iso,
          updatedAt: iso,
          category: 'other',
          isDeleted: false,
          createdBy: { _id: user.id, name: 'Alex' },
        },
      });
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
    if (path.endsWith('/drafts')) return json({ data: items.map((item) => item.draft) });
    if (path.endsWith('/expenses') && init.method === 'POST' && options.lostExpense)
      throw new Error('Lost expense reply');
    if (path.endsWith('/expenses'))
      return json({
        status: 200,
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0 },
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
        newSubmissionKey: () => 'fictional-review-request',
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
    saves,
    reviews,
    calls,
    committed,
    requests,
    items: () => items,
    holdPut: (held: Promise<void>) => {
      putReply = held;
    },
    holdRead: (held: Promise<void>) => {
      nextRead = held;
    },
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
describe.each(['light', 'dark'] as const)('Review run at 130 percent in %s', (mode) => {
  it('starts at Home, skips without saving, crosses Groups and closes back to Home', async () => {
    const f = fixture({ laterReadyGroup: true });
    await signIn(f);
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    await tap(home, 'Review 2, one at a time');
    const run = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    expect(text(run)).toContain('Maple House');
    expect(text(run)).toContain('Review · 1 of 2 · across 2 Groups');
    await tap(run, 'Skip for now');
    expect(text(run)).toContain('Goa Friends Trip');
    expect(text(run)).toContain('Review · 2 of 2');
    await tap(run, 'Close review');
    expect(run.toJSON()).toBeNull();
    expect(f.controller.getSnapshot().screen).toBe('groups');
    expect(f.saves).toHaveLength(0);
  });
  it('saves exactly one item after a lost reply and explicit Check again, then shows the summary', async () => {
    const f = fixture({ one: true, lost: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    await tap(tree, 'Save expense');
    expect(text(tree)).toContain("We didn't hear back, so it may already be saved");
    expect(f.committed.size).toBe(1);
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
      onlineManager.setOnline(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(f.saves).toHaveLength(1);
    await tap(tree, 'Check again');
    expect(f.committed.size).toBe(1);
    expect(f.saves[1]).toBe(f.saves[0]);
    expect(text(tree)).toContain('Done for now');
    expect(text(tree)).toContain('Saved 1');
    expect(text(tree)).toContain('Deleted 0');
    expect(text(tree)).toContain('Left for later 0');
    await tap(tree, 'Done');
    expect(tree.toJSON()).toBeNull();
  });
  it('says when an item was set aside in the app’s 12-hour time (#435)', async () => {
    const f = fixture({ member: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const run = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    expect(text(run)).toContain(clockTime(iso));
  });
  it('shows ready and missing details, both sources, duplicate details and deliberate acknowledgement', async () => {
    const f = fixture({ member: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    expect(text(tree)).toContain('You set this aside · Finish later · today');
    expect(button(tree, 'Save expense').props.disabled).toBe(false);
    await tap(tree, 'Save expense');
    expect(
      tree.root.findAll(
        (node) =>
          String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'Description',
      )[0].props.value,
    ).toBe('Fare');
    await tap(tree, 'Skip for now');
    expect(text(tree)).toContain('Possible duplicate');
    expect(text(tree)).toContain('Earlier dinner');
    expect(text(tree)).toContain('Added by Alex');
    expect(button(tree, 'Save expense').props.disabled).toBe(true);
    await tap(tree, "It's a different expense, save it anyway");
    expect(button(tree, 'Save expense').props.disabled).toBe(false);
    await tap(tree, 'Save expense');
    expect(text(tree)).toContain('things left before you can save');
    expect(button(tree, 'Save expense').props.disabled).toBe(true);
    await tap(tree, 'Delete');
    expect(text(tree)).toContain(
      "It was never saved, so nothing in Maple House changes. You can't undo this.",
    );
    await tap(tree, 'Delete item');
    expect(text(tree)).toContain('Saved 2');
    expect(text(tree)).toContain('Deleted 1');
    expect(text(tree)).toContain('Left for later 1');
  });
  it('is read-only offline and Close returns to the Group list that started it', async () => {
    const f = fixture();
    await signIn(f);
    await act(async () => {
      await f.controller.openToReview(groupId);
    });
    const overlay = await render(<ToReviewOverlay controller={f.controller} />, mode);
    await tap(overlay, 'Review one at a time');
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(text(overlay)).toContain('Connect to change or save this');
    for (const label of ['Save expense', 'Delete', 'Skip for now'])
      expect(button(overlay, label).props.disabled).toBe(true);
    const writes = f.calls.filter((call) => !call.startsWith('GET')).length;
    await tap(overlay, 'Close review');
    expect(f.controller.getSnapshot().toReview.groupId).toBe(groupId);
    expect(text(overlay)).toContain('To review');
    await act(async () => {
      onlineManager.setOnline(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(f.calls.filter((call) => !call.startsWith('GET'))).toHaveLength(writes);
  });
  it("saves Claude's one-payer item without a Category straight away", async () => {
    const f = fixture({ one: true });
    const values = f.items()[0].draft.values!;
    delete values.category;
    values.paidBy = [{ user: user.id }];
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    expect(text(tree)).not.toContain('before you can save');
    expect(text(tree)).not.toContain("didn't know who paid");
    expect(button(tree, 'Save expense').props.disabled).toBe(false);
    await tap(tree, 'Save expense');
    expect(f.saves).toHaveLength(1);
    expect(text(tree)).toContain('Saved 1');
  });
  it('shows "Paid by: You" when the signed-in member paid, as Add expense does (#434)', async () => {
    const f = fixture({ one: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    const tile = tree.root.findAll(
      (node) =>
        String(node.type) === 'Pressable' &&
        String(node.props.accessibilityLabel).startsWith('Paid by'),
    )[0];
    expect(tile.props.accessibilityLabel).toBe('Paid by: You');
  });
  it('names the signed-in member "You" in its split and in a newer version’s note (#434)', async () => {
    const f = fixture({ one: true });
    f.items()[0].allocation = {
      currency: 'INR',
      paidBy: [{ user: user.id, amount: 12.34 }],
      splitBetween: [{ user: user.id, amount: 12.34 }],
    };
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    expect(text(tree)).toContain('You share ₹12.34');
    const original = f.items()[0].draft;
    f.items()[0].draft = {
      ...original,
      revision: 1,
      values: { ...original.values, splitBetween: [{ user: user.id, amount: 12.34 }] },
    };
    await act(async () => {
      await f.controller.refreshToReview();
    });
    expect(text(tree)).toContain('You ₹12.34');
    expect(text(tree)).not.toMatch(/Alex (shares|₹)/);
  });
  it('keeps a correction with the existing payer sheet and labels every control', async () => {
    const f = fixture({ one: true });
    delete f.items()[0].draft.values!.paidBy;
    f.items()[0].draft.missingFields = ['paidBy'];
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    expect(text(tree)).toContain('One thing left before you can save: who paid');
    expect(text(tree)).toContain("Claude didn't know who paid, so it left that to you");
    const tile = tree.root.findAll(
      (node) =>
        String(node.type) === 'Pressable' &&
        String(node.props.accessibilityLabel).startsWith('Paid by'),
    )[0];
    await act(async () => {
      tile.props.onPress();
    });
    await tap(tree, 'You, Alex');
    expect(f.items()[0].draft.values!.paidBy).toEqual([{ user: user.id, amount: 12.34 }]);
    await act(async () => {
      await f.controller.closeReviewRun();
      await f.controller.startReviewRun();
    });
    expect(button(tree, 'Save expense').props.disabled).toBe(false);
    for (const node of tree.root.findAll((node) =>
      ['Pressable', 'TextInput'].includes(String(node.type)),
    ))
      expect(node.props.accessibilityLabel).toBeTruthy();
  });
  it('shows the shared change note from a newer read, and never saves an unseen version', async () => {
    const f = fixture({ one: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    const original = f.items()[0].draft;
    f.items()[0].draft = {
      ...original,
      revision: 1,
      changedBy: { kind: 'assistant', name: 'Claude' },
      values: { ...original.values, amount: 24, paidBy: [{ user: user.id, amount: 24 }] },
    };
    await act(async () => {
      await f.controller.refreshToReview();
    });
    expect(text(tree)).toContain('Claude changed the amount a moment ago: ₹12.34 → ₹24.00');
    expect(text(tree)).toContain("You're seeing the latest version.");
    expect(
      tree.root.findAll(
        (node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'Amount',
      )[0].props.value,
    ).toBe('24');
    const current = f.items()[0].draft;
    f.items()[0].draft = {
      ...current,
      revision: 2,
      changedBy: { kind: 'member' },
      values: { ...current.values, description: 'Corrected lunch' },
    };
    await tap(tree, 'Save expense');
    expect(f.saves).toHaveLength(0);
    expect(text(tree)).toContain('You on another device changed the description');
    await tap(tree, 'Save expense');
    expect(f.saves).toHaveLength(1);
    expect(JSON.parse(f.saves[0]).drafts[0].revision).toBe(2);
  });
  it('keeps rapid typed corrections in order before Close, and does not expose the run with the flag off', async () => {
    const f = fixture({ one: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    await act(async () => {
      const input = tree.root.findAll(
        (node) =>
          String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'Description',
      )[0];
      input.props.onChangeText('Lunch correction');
      input.props.onChangeText('Lunch correction two');
      await f.controller.closeReviewRun();
    });
    expect(f.items()[0].draft.values!.description).toBe('Lunch correction two');
    expect(tree.toJSON()).toBeNull();
    const off = fixture({ flag: false });
    await signIn(off);
    await act(async () => {
      await off.controller.startReviewRun();
    });
    expect(off.controller.getSnapshot().toReview.run).toBeNull();
  });
  it('uses singular item in the Leave sheet through the controller', async () => {
    const f = fixture({ one: true });
    await signIn(f);
    await act(async () => {
      await f.controller.openGroup(groupId);
      await f.controller.openMembers();
      await f.controller.reviewLeaveGroup();
    });
    function Members() {
      const snapshot = useSyncExternalStore(f.controller.subscribe, f.controller.getSnapshot);
      const noop = () => {};
      return (
        <GroupMembers
          group={snapshot.detail.data!}
          currentUserId={user.id}
          back={{ label: 'Back', onPress: noop }}
          invite={{ onPress: noop, disabled: false, offline: false }}
          leave={{
            state: snapshot.leave,
            offline: false,
            toReviewCount: snapshot.toReview.read.groups[0]?.count,
            onOpen: noop,
            onConfirm: noop,
            onCancel: noop,
            onCheck: noop,
          }}
        />
      );
    }
    const tree = await render(<Members />, mode);
    expect(text(tree)).toContain('You have 1 item in To review for Maple House');
    expect(text(tree)).not.toContain('1 items');
  });
  it('keeps typing entered during its own delayed post-write read', async () => {
    const f = fixture({ one: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    let release!: () => void;
    f.holdRead(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const input = () =>
      tree.root.findAll(
        (node) =>
          String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'Description',
      )[0];
    try {
      await act(async () => {
        input().props.onChangeText('First correction');
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      await act(async () => {
        input().props.onChangeText('Later correction');
        release();
        await f.controller.reviewRun()!.finishEditing();
      });
      expect(f.items()[0].draft.values!.description).toBe('Later correction');
      expect(input().props.value).toBe('Later correction');
    } finally {
      release();
    }
  });
  it('keeps newer typing on screen when the reply to an earlier correction arrives', async () => {
    const f = fixture({ one: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    const releases: (() => void)[] = [];
    const held = () => new Promise<void>((resolve) => releases.push(resolve));
    const input = () =>
      tree.root.findAll(
        (node) =>
          String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'Description',
      )[0];
    const puts = () => f.calls.filter((call) => call.startsWith('PUT')).length;
    f.holdPut(held());
    try {
      await act(async () => {
        input().props.onChangeText('First correction');
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      await act(async () => {
        input().props.onChangeText('Later correction');
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(puts()).toBe(1);
      // The later correction's write is held as well, so only the first reply lands.
      f.holdPut(held());
      await act(async () => {
        releases[0]();
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(puts()).toBe(2);
      expect(input().props.value).toBe('Later correction');
      await act(async () => {
        releases[1]();
        await f.controller.reviewRun()!.finishEditing();
      });
      expect(f.items()[0].draft.values!.description).toBe('Later correction');
      expect(input().props.value).toBe('Later correction');
    } finally {
      for (const release of releases) release();
    }
  });
  it('shows and acknowledges a newly found duplicate even when the version has not changed', async () => {
    const f = fixture({ one: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    f.items()[0].duplicates = [
      { kind: 'expense', id: 'e00000000000000000000001', description: 'Earlier dinner' },
    ];
    await tap(tree, 'Save expense');
    expect(f.saves).toHaveLength(0);
    expect(text(tree)).toContain('Earlier dinner');
    expect(text(tree)).toContain('₹30.00');
    expect(text(tree)).toContain('Added by Alex');
    expect(button(tree, 'Save expense').props.disabled).toBe(true);
    await tap(tree, "It's a different expense, save it anyway");
    await tap(tree, 'Save expense');
    expect(f.saves).toHaveLength(1);
  });
  it('keeps an offline-interrupted queued correction for an explicit retry only', async () => {
    const f = fixture({ one: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    let release!: () => void;
    f.holdPut(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const input = () =>
      tree.root.findAll(
        (node) =>
          String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'Description',
      )[0];
    try {
      await act(async () => {
        input().props.onChangeText('First correction');
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      await act(async () => {
        input().props.onChangeText('Queued correction');
        onlineManager.setOnline(false);
        release();
        await f.controller.reviewRun()!.finishEditing();
      });
      expect(text(tree)).toContain('Your latest changes have not been kept');
      expect(f.items()[0].draft.values!.description).toBe('First correction');
      const puts = f.calls.filter((call) => call.startsWith('PUT')).length;
      await act(async () => {
        onlineManager.setOnline(true);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(f.calls.filter((call) => call.startsWith('PUT'))).toHaveLength(puts);
      expect(input().props.value).toBe('Queued correction');
      await tap(tree, 'Keep my changes');
      expect(f.items()[0].draft.values!.description).toBe('Queued correction');
    } finally {
      release();
    }
  });
});

// Native input can arrive while the final read and edit promises settle. Exercise nearby
// orderings through the public controller, including its handoff from the shared edit queue.
it.each(Array.from({ length: 6 }, (_, index) => index))(
  'keeps a correction arriving as review refresh settles (microtask offset %i)',
  async (offset) => {
    const f = fixture({ one: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const machine = f.controller.reviewRun()!;
    let matches = f.controller.getSnapshot().toReview.run!.matches;
    let scheduled = false;
    let editingWhenDelivered = false;
    let deliver!: () => void;
    const delivered = new Promise<void>((resolve) => {
      deliver = resolve;
    });
    const stop = f.controller.subscribe(() => {
      const run = f.controller.getSnapshot().toReview.run;
      if (!run || scheduled) return;
      const refreshedMatches = run.matches !== matches;
      matches = run.matches;
      if (!run.editing || run.items[0].item.draft.revision !== 1 || !refreshedMatches) return;
      scheduled = true;
      let task = () => {
        editingWhenDelivered = f.controller.getSnapshot().toReview.run!.editing;
        void machine.change({ ...run.items[0].item.draft.values, description: 'Late correction' });
        deliver();
      };
      for (let index = 0; index < offset; index++) {
        const next = task;
        task = () => queueMicrotask(next);
      }
      queueMicrotask(task);
    });
    try {
      await act(async () => {
        const first = machine.change({
          ...f.items()[0].draft.values,
          description: 'First correction',
        });
        await delivered;
        await first;
        await machine.finishEditing();
      });
      expect(scheduled).toBe(true);
      expect(editingWhenDelivered).toBe(true);
      expect(f.items()[0].draft.values!.description).toBe('Late correction');
      expect(f.items()[0].draft.revision).toBe(2);
      expect(f.controller.getSnapshot().toReview.run!.items[0].item.draft.values!.description).toBe(
        'Late correction',
      );
      expect(f.calls.filter((call) => call.startsWith('PUT'))).toHaveLength(2);
    } finally {
      stop();
    }
  },
);
