import { useSyncExternalStore, type ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlineManager } from '@tanstack/query-core';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import type {
  DraftReview,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import type { MobileController } from '../data/mobile-controller';
import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook, expensePage } from '../test-utils/fake-splitbook';
import { activateWithScreenReader, setWindow, touchAlong } from '../test-utils/native';
import { confirmSheetIn, confirmSheetOpen } from '../test-utils/confirm-sheet';
import { Alert } from 'react-native';
import { ThemeContext } from './theme';
import { clockTime } from './activity-format';
import { ToReviewHomeCard, ToReviewOverlay } from './to-review';
import { GroupMembers } from './group-members';
import { ReviewRunOverlay } from './review-run';
import { PayerSheet } from './payer-sheet';

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
    /** The kind the To review read names for the Group (#596). */
    category?: 'trip' | 'home';
    /** Maple House's extra currencies (#874). */
    extras?: string[];
  } = {},
) {
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', String(options.flag ?? true));
  const first = row(1, 'Lunch', 12.34),
    second = row(2, 'Fare', 23.45);
  const incomplete = {
    ...row(3, 'Missing amount', 30),
    values: { description: 'Missing amount' },
    // The Group sets the currency, so the server never lists it (#512).
    missingFields: ['amount', 'date'],
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
  let denied = false;
  const saves: string[] = [],
    reviews: string[][] = [],
    calls: string[] = [];
  const committed = new Set<string>();
  let putReply: Promise<void> | null = null;
  let nextRead: Promise<void> | null = null;
  const backend = fakeSplitbook();
  backend.world.people.alex = user;
  backend.auth.cookie = () => 'better-auth.session_token=alex.signature';
  Object.defineProperty(backend.world, 'toReview', {
    get: () => ({
      total: items.length,
      groups: [groupId, otherGroupId].flatMap((id) => {
        const own = items.filter((item) => item.draft.groupId === id);
        return own.length
          ? [
              {
                groupId: id,
                groupName: id === groupId ? group.name : 'Goa Friends Trip',
                currency: 'INR',
                ...(options.extras ? { alternateCurrencies: options.extras } : {}),
                ...(options.category && id === groupId ? { category: options.category } : {}),
                count: own.length,
                items: own,
              },
            ]
          : [];
      }),
    }),
  });
  backend.world.home = { buckets: [], groups: [{ groupId, balances: [] }] };
  Object.defineProperty(backend.world, 'groups', {
    get: () => [
      { ...group, alternateCurrencies: options.extras ?? [] },
      { ...group, _id: otherGroupId, name: 'Goa Friends Trip' },
    ],
  });
  backend.world.groupsByAccount[user.id] = options.laterReadyGroup
    ? [group, { ...group, _id: otherGroupId, name: 'Goa Friends Trip' }]
    : [group];
  for (const id of [groupId, otherGroupId]) {
    // The original summary intentionally omits byMember; keep that reply for #1075.
    const page = expensePage();
    delete (page.summary as Partial<typeof page.summary>).byMember;
    backend.world.expenses[id] = page;
    backend.world.balances[id] = { byCurrency: [] };
  }
  backend.reply('*', '*', async ({ url, init }) => {
    const path = url.pathname;
    if (
      [
        '/api/auth/demo-persona/sign-in',
        '/api/auth/get-session',
        '/api/auth/sign-out',
        '/api/notifications/device',
      ].includes(path)
    )
      return undefined;
    if (path === '/api/user/to-review') {
      if (nextRead) {
        const held = nextRead;
        nextRead = null;
        await held;
      }
      await options.held;
      return undefined;
    }
    if (path === `/api/groups/${groupId}` && denied)
      return json({ error: 'Forbidden', status: 403 }, 403);
    if (
      [
        '/api/user/balances',
        '/api/groups',
        `/api/groups/${groupId}`,
        `/api/groups/${otherGroupId}`,
      ].includes(path)
    )
      return undefined;
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
    // The old default create fell through to a list-shaped (unreadable) receipt; preserve it for #1075.
    if (path.endsWith('/expenses') && init.method !== 'GET')
      return json({ status: 200, data: backend.world.expenses[groupId] });
    if (path.endsWith('/expenses') || path.endsWith('/balances')) return undefined;
    return json({ error: 'Unavailable', status: 404 }, 404);
  });
  const phone = testPhone(
    {
      get online() {
        return backend.online;
      },
      set online(value: boolean) {
        backend.online = value;
      },
      fetch: (url, init) => {
        calls.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
        return backend.fetch(url, init);
      },
    },
    {
      origin: 'http://localhost:4408',
      now: Date.parse(iso),
      newSubmissionKey: () => 'fictional-review-request',
      parts: {
        pendingInvitation: undefined,
        settlementAttempts: undefined,
        tagRequests: undefined,
        groupCreations: undefined,
        netInfo: undefined,
      },
    },
  );
  delete phone.stores.savedQueries.retainGroups;
  const requests = Object.assign(phone.stores.draftRequests, {
    values: phone.stores.draftRequests.records,
  });
  const makeController = () => {
    const controller = phone.open();
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
      backend.online = false;
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
/** The end of a run's counts, each a row read as one, such as "Saved 1". */
const tally = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(
      (node) =>
        typeof node.type === 'string' && node.props.accessible && !!node.props.accessibilityLabel,
    )
    .map((node) => String(node.props.accessibilityLabel))
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
    expect(text(run)).toContain('Review\u00a0· 1 of 2\u00a0· across 2\u00a0Groups');
    await tap(run, 'Skip for now');
    expect(text(run)).toContain('Goa Friends Trip');
    expect(text(run)).toContain('Review\u00a0· 2 of 2');
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
    expect(text(tree)).toContain('We didn’t hear back, so it may already be saved');
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
    expect(tally(tree)).toContain('Saved 1');
    expect(tally(tree)).toContain('Deleted 0');
    expect(tally(tree)).toContain('Left for later 0');
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
    expect(text(tree)).toContain('You set this aside');
    expect(text(tree)).toContain('Finish later\u00a0· today');
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
    expect(text(tree)).toContain('Save it only if it’s a different expense.');
    expect(button(tree, 'Save expense').props.disabled).toBe(true);
    await tap(tree, 'It’s a different expense, save it anyway');
    expect(button(tree, 'Save expense').props.disabled).toBe(false);
    await tap(tree, 'Save expense');
    expect(text(tree)).toContain('things left before you can save');
    expect(button(tree, 'Save expense').props.disabled).toBe(true);
    await tap(tree, 'Delete');
    expect(text(tree)).toContain(
      'It was never saved, so nothing in Maple House changes. You can’t undo this.',
    );
    await tap(tree, 'Delete item');
    expect(tally(tree)).toContain('Saved 2');
    expect(tally(tree)).toContain('Deleted 1');
    expect(tally(tree)).toContain('Left for later 1');
  });
  it('checks “It’s a different expense” on a tap or a screen reader’s activate, never on a drag (#684)', async () => {
    const f = fixture({ member: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    // As in the case above: save the first item and skip Fare, which brings the duplicate.
    await tap(tree, 'Save expense');
    await tap(tree, 'Skip for now');
    expect(text(tree)).toContain('Possible duplicate');
    const different = () => button(tree, 'It’s a different expense, save it anyway');
    const checked = () => different().props.accessibilityState.checked;
    const landed = { pageX: 180, pageY: 500 };
    const finger = async (path: Parameters<typeof touchAlong>[1]) =>
      act(async () => {
        touchAlong(different(), path);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    await finger([landed, { pageX: 180, pageY: 400 }, { pageX: 181, pageY: 250 }]);
    expect(checked()).toBe(false);
    expect(button(tree, 'Save expense').props.disabled).toBe(true);
    await finger([landed, { pageX: 182, pageY: 503 }]);
    expect(checked()).toBe(true);
    expect(button(tree, 'Save expense').props.disabled).toBe(false);
    await act(async () => {
      activateWithScreenReader(different());
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(checked()).toBe(false);
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
    expect(text(tree)).not.toContain('didn’t know who paid');
    expect(button(tree, 'Save expense').props.disabled).toBe(false);
    await tap(tree, 'Save expense');
    expect(f.saves).toHaveLength(1);
    expect(tally(tree)).toContain('Saved 1');
  });
  it('labels Amount and Description above their boxes as Add expense does (#524)', async () => {
    const f = fixture({ one: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    for (const name of ['Amount', 'Description']) {
      // TalkBack hears the Amount's currency with it: "Amount, Indian Rupee" (#874).
      const input = tree.root.find(
        (node) =>
          String(node.type) === 'TextInput' &&
          String(node.props.accessibilityLabel).split(',')[0] === name,
      );
      // The field around the box starts with its visible label and Required mark, above the
      // box (Amount's sits in a row with the Group's currency, #512).
      let field = input.parent!;
      const shown = () =>
        field.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
      while (!shown().includes(name)) field = field.parent!;
      // The marker's pill keeps a hair space to spare (#639).
      expect(shown().slice(0, 2), name).toEqual([name, 'Required\u200a']);
      const [label, box] = field.children as ReactTestInstance[];
      expect(label.findAll((node) => String(node.type) === 'Text').length, name).toBe(2);
      expect(
        box.findAll((node) => node === input),
        name,
      ).toHaveLength(1);
    }
  });
  it('turns the Amount label red for an amount To review asks to fix (#524)', async () => {
    const f = fixture({ one: true });
    const item = f.items()[0];
    // ₹12.345: there, but with more decimal places than INR has.
    item.draft.values = { ...item.draft.values, amount: 12.345 };
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    const tone = (name: string) =>
      tree.root.find((node) => node.props.children === name && node.props.tone !== undefined).props
        .tone;
    expect(tone('Amount')).toBe('negative');
    expect(tone('Description')).toBe('secondary');
  });
  it('opens a long Description at its start until the member is in it (#525)', async () => {
    const f = fixture({ one: true });
    f.items()[0].draft.values!.description = 'Sofa cleaning service with a long name';
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    const description = () =>
      tree.root.find(
        (node) =>
          String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'Description',
      );
    expect(description().props.selection).toEqual({ start: 0, end: 0 });
    await act(async () => description().props.onFocus());
    expect(description().props.selection).toBeUndefined();
    await act(async () => description().props.onBlur());
    expect(description().props.selection).toEqual({ start: 0, end: 0 });
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
  it('pins Save, a red Delete and Skip in a bar under the item, and confirms Delete in red (#646)', async () => {
    const f = fixture({ one: true });
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    const outsideScroll = (label: string) => {
      let node = button(tree, label).parent;
      while (node && String(node.type) !== 'ScrollView') node = node.parent;
      return node === null;
    };
    for (const label of ['Save expense', 'Delete', 'Skip for now'])
      expect(outsideScroll(label), label).toBe(true);
    const theme = getSemanticTokens(mode);
    const words = (label: string) =>
      button(tree, label).find((node) => String(node.type) === 'Text').props.style;
    expect(words('Delete')).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: theme.status.negative })]),
    );
    // The amount shows once: in its box.
    expect(text(tree)).not.toContain('₹12.34');
    await tap(tree, 'Delete');
    expect(button(tree, 'Delete item').props.style({ pressed: false }).backgroundColor).toBe(
      theme.status.negative,
    );
  });
  it('shows an amount with too many decimals as entered, once, in its box (#537)', async () => {
    const f = fixture({ one: true });
    f.items()[0].draft.values!.amount = 10.555;
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    const amount = tree.root.find(
      (node) =>
        String(node.type) === 'TextInput' &&
        node.props.accessibilityLabel === 'Amount, Indian Rupee',
    );
    expect(amount.props.value).toBe('10.555');
    for (const shown of ['₹10.56', 'Amount needed']) expect(text(tree)).not.toContain(shown);
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
    expect(text(tree)).toContain('Claude didn’t know who paid, so it left that to you');
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
  it('says the same person is listed twice, not that Claude didn’t know who paid (#716)', async () => {
    const f = fixture({ one: true });
    // The assistant listed Alex twice: show the later ₹8.34, never the sum.
    f.items()[0].draft.values!.paidBy = [
      { user: user.id, amount: 4 },
      { user: user.id, amount: 8.34 },
    ];
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    expect(text(tree)).toContain('One thing left before you can save: who paid');
    // Its tile asks for the payer as for a missing one, never "2 people" for one person twice.
    expect(text(tree)).not.toContain('2\u00a0people');
    expect(text(tree)).toContain('The same person is listed twice. Choose who paid.');
    expect(text(tree)).not.toContain('didn’t know who paid');
    // The tile still asks for the payer, and saving stays off until they're chosen.
    expect(text(tree)).toContain('Who paid?\u00a0· Choose');
    expect(button(tree, 'Save expense').props.disabled).toBe(true);
    const before = JSON.stringify(f.items()[0].draft.values);
    const paidTile = tree.root.findAll(
      (node) =>
        String(node.type) === 'Pressable' &&
        String(node.props.accessibilityLabel).startsWith('Paid by'),
    )[0];
    await act(async () => paidTile.props.onPress());
    expect(tree.root.findByType(PayerSheet).props.draft.multiPayer).toBe(true);
    expect(tree.root.findByType(PayerSheet).props.draft.payers).toEqual([
      { user: user.id, amount: '8.34' },
    ]);
    expect(JSON.stringify(f.items()[0].draft.values)).toBe(before);
    expect(button(tree, 'Save expense').props.disabled).toBe(true);
  });
  it('names a split that does not add up, not a missing amount (#506)', async () => {
    const f = fixture({ one: true });
    // ₹12.34 split exactly as ₹10, as the server sent it before #506: the reason at the amount.
    const item = f.items()[0];
    item.draft.values = {
      ...item.draft.values,
      splitMethod: 'exact',
      splitBetween: [{ user: user.id, amount: 10 }],
    };
    item.draft.missingFields = ['amount'];
    item.problems = ['amount: Split amounts must add up to the expense amount'];
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);

    expect(text(tree)).toContain(
      'One thing left before you can save: the split to add up to the total',
    );
    expect(text(tree)).toContain('Must add up to the total');
    expect(text(tree)).not.toContain('the amount');
    expect(text(tree)).not.toContain('Choose who shared it and how');
    expect(button(tree, 'Save expense').props.disabled).toBe(true);
  });
  it('shows the Group’s currency, locked, for an item without one (#512)', async () => {
    const f = fixture({ one: true });
    delete f.items()[0].draft.values!.currency;
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);

    expect(
      tree.root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === 'Currency INR, the Group’s currency',
      ),
    ).toHaveLength(1);
    expect(
      tree.root.find(
        (node) =>
          String(node.type) === 'TextInput' &&
          node.props.accessibilityLabel === 'Amount, Indian Rupee',
      ).props.value,
    ).toBe('12.34');
    expect(text(tree)).not.toContain('Use INR as currency');
    expect(text(tree)).not.toContain('the currency');
    expect(button(tree, 'Save expense').props.disabled).toBe(false);
    // The Group's currency is a fact the save already has, so the item saves as it is.
    await tap(tree, 'Save expense');
    expect(f.saves).toHaveLength(1);
    expect(tally(tree)).toContain('Saved 1');
  });
  // #884: beside its chip, a currency's prefix shows only where it isn't the code the chip says:
  // "PLN ▾ 60.00" and "CHF ▾ 86.00", never "PLN ▾ zł 60.00" or "CHF ▾ CHF 86.00"; "EUR ▾ € 18.40".
  it.each([
    ['PLN', 'Polish Zloty', 60, ''],
    ['CHF', 'Swiss Franc', 86, ''],
    ['EUR', 'Euro', 18.4, '€'],
  ])(
    'shows %s’s amount beside its chip with the prefix it lacks (#884)',
    async (code, name, value, prefix) => {
      const f = fixture({ one: true, extras: [code] });
      const draft = f.items()[0].draft;
      draft.values = {
        ...draft.values,
        amount: value,
        currency: code,
        paidBy: [{ user: user.id, amount: value }],
      };
      await signIn(f);
      await act(async () => {
        await f.controller.startReviewRun();
      });
      const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
      // The row the chip sits in, with the Amount: the chip, the prefix (or nothing), the amount.
      let row = button(tree, `Currency, ${code}, ${name}. Change currency`);
      while (
        !row.findAll(
          (node) =>
            String(node.type) === 'TextInput' &&
            String(node.props.accessibilityLabel).startsWith('Amount'),
        ).length
      )
        row = row.parent!;
      // TalkBack hears the currency with the chip and the amount, so the prefix is hidden from it.
      const beside = row
        .findAll(
          (node) => String(node.type) === 'Text' && node.props.accessibilityElementsHidden === true,
        )
        .map((node) => node.children.join(''));
      expect(beside).toEqual(prefix ? [prefix] : []);
      expect(text(tree)).not.toContain('zł');
    },
  );
  // #874: Pasteis box, €18.40, in Maple House, which lists INR and EUR.
  it('shows an extra-currency item in its own currency, and changes it with Add expense’s picker (#874)', async () => {
    const f = fixture({ one: true, extras: ['EUR', 'JPY'] });
    const pasteis = f.items()[0].draft;
    pasteis.values = {
      ...pasteis.values,
      description: 'Pasteis box',
      amount: 18.4,
      currency: 'EUR',
      paidBy: [{ user: user.id, amount: 18.4 }],
    };
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    const amount = () =>
      tree.root.find(
        (node) =>
          String(node.type) === 'TextInput' &&
          String(node.props.accessibilityLabel).startsWith('Amount'),
      );

    // The item's own currency beside the Amount, with its minor digits, as Add expense shows it.
    expect(button(tree, 'Currency, EUR, Euro. Change currency')).toBeDefined();
    expect(text(tree)).toContain('€');
    expect(amount().props).toMatchObject({
      value: '18.40',
      keyboardType: 'decimal-pad',
      accessibilityLabel: 'Amount, Euro',
    });
    expect(text(tree)).not.toContain('Use INR');
    expect(button(tree, 'Save expense').props.disabled).toBe(false);

    await tap(tree, 'Currency, EUR, Euro. Change currency');
    const sheet = tree.root
      .findAll((node) => String(node.type) === 'Modal' && node.props.visible === true)
      .find((modal) =>
        modal
          .findAll((node) => String(node.type) === 'Text')
          .some((node) => node.children.join('') === 'Maple House\u00a0· 3\u00a0currencies'),
      );
    expect(sheet).toBeDefined();
    expect(
      sheet!
        .findAll(
          (node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'radio',
        )
        .map((node) => [node.props.accessibilityLabel, node.props.accessibilityState?.checked]),
    ).toEqual([
      ['INR, Indian Rupee, main currency', false],
      ['EUR, Euro', true],
      ['JPY, Japanese Yen, whole amounts only', false],
    ]);
    expect(text(tree)).toContain(
      'Changing the currency keeps the number you typed. Nothing is converted.',
    );
    await tap(tree, 'INR, Indian Rupee, main currency');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // Only the currency changed; the amount stays as entered.
    expect(f.items()[0].draft.values).toMatchObject({ amount: 18.4, currency: 'INR' });
    expect(button(tree, 'Currency, INR, Indian Rupee. Change currency')).toBeDefined();
  });

  it('shows a yen item whole, on the number pad (#874)', async () => {
    const f = fixture({ one: true, extras: ['EUR', 'JPY'] });
    const ramen = f.items()[0].draft;
    ramen.values = {
      ...ramen.values,
      description: 'Ramen',
      amount: 5,
      currency: 'JPY',
      paidBy: [{ user: user.id, amount: 5 }],
    };
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    expect(button(tree, 'Currency, JPY, Japanese Yen. Change currency')).toBeDefined();
    expect(
      tree.root.find(
        (node) =>
          String(node.type) === 'TextInput' &&
          node.props.accessibilityLabel === 'Amount, Japanese Yen',
      ).props,
    ).toMatchObject({ value: '5', keyboardType: 'number-pad', placeholder: '0' });
  });

  it('says an item in another currency needs the Group currency, not the expense details (#567)', async () => {
    const f = fixture({ one: true });
    f.items()[0].draft.values!.currency = 'USD';
    f.items()[0].problems = ['CURRENCY_MISMATCH'];
    await signIn(f);
    await act(async () => {
      await f.controller.startReviewRun();
    });
    const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);

    expect(text(tree)).toContain('One thing left before you can save: the Group currency');
    expect(text(tree)).not.toContain('the expense details');
    // Its own currency beside the Amount, and Add expense's picker to change it (#874).
    expect(button(tree, 'Save expense').props.disabled).toBe(true);
    await tap(tree, 'Currency, USD, US Dollar. Change currency');
    await tap(tree, 'INR, Indian Rupee, main currency');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(f.items()[0].draft.values).toMatchObject({ amount: 12.34, currency: 'INR' });
  });
  it.each([
    ['trip', 'Trip'],
    ['home', 'Household'],
  ] as const)(
    'names the currency an item in a %s needs by its kind (#596)',
    async (category, noun) => {
      const f = fixture({ one: true, category });
      f.items()[0].draft.values!.currency = 'USD';
      f.items()[0].problems = ['CURRENCY_MISMATCH'];
      await signIn(f);
      await act(async () => {
        await f.controller.startReviewRun();
      });
      const tree = await render(<ReviewRunOverlay controller={f.controller} />, mode);

      expect(text(tree)).toContain(`One thing left before you can save: the ${noun} currency`);
      expect(button(tree, 'Currency, USD, US Dollar. Change currency').props.disabled).toBe(false);
    },
  );
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
    expect(text(tree)).toContain('You’re seeing the latest version.');
    expect(
      tree.root.findAll(
        (node) =>
          String(node.type) === 'TextInput' &&
          node.props.accessibilityLabel === 'Amount, Indian Rupee',
      )[0].props.value,
    ).toBe('24.00');
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
    expect(text(tree)).toContain('You have 1\u00a0item in To review for Maple House');
    expect(text(tree)).not.toContain('1\u00a0items');
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
    await tap(tree, 'It’s a different expense, save it anyway');
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
  // #646: the app's own sheet, not a stock dialog. Only its red action leaves; the last kept
  // details stay in To review, and leaving sends nothing.
  it('asks in a sheet before leaving unkept changes; Back, a tap outside and Keep editing stay', async () => {
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
      expect(f.controller.getSnapshot().toReview.run?.unkept).toBeTruthy();
      const puts = f.calls.filter((call) => call.startsWith('PUT')).length;
      for (const how of ['pressCancel', 'pressBack', 'pressOutside'] as const) {
        await tap(tree, 'Close review');
        expect(Alert.alert).not.toHaveBeenCalled();
        expect(confirmSheetIn(tree.root)).toMatchObject({
          title: 'Leave without your latest changes?',
          message: 'These changes have not been kept. The last kept details stay in To review.',
          cancel: 'Keep editing',
          action: 'Leave without changes',
        });
        await act(async () => confirmSheetIn(tree.root)[how]());
        expect(confirmSheetOpen(tree.root)).toBe(false);
        expect(input().props.value).toBe('Queued correction');
        expect(f.controller.getSnapshot().toReview.run).not.toBeNull();
      }
      // The run's own Back asks the same.
      await act(async () =>
        tree.root.find((node) => String(node.type) === 'Modal').props.onRequestClose(),
      );
      expect(confirmSheetIn(tree.root).title).toBe('Leave without your latest changes?');
      await act(async () => {
        confirmSheetIn(tree.root).pressAction();
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(f.controller.getSnapshot().toReview.run).toBeNull();
      expect(tree.toJSON()).toBeNull();
      expect(f.items()[0].draft.values!.description).toBe('First correction');
      expect(f.calls.filter((call) => call.startsWith('PUT'))).toHaveLength(puts);
    } finally {
      release();
      onlineManager.setOnline(true);
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
