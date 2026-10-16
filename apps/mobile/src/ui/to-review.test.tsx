import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inTimeZone } from '../test-utils/time-zone';
import { onlineManager, focusManager } from '@tanstack/query-core';
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
import { ToReviewHomeCard, ToReviewGroupBanner, ToReviewList, ToReviewOverlay } from './to-review';
import { ContinueDrafts } from './home';

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
    laterReadyGroup?: boolean;
    held?: Promise<void>;
    saveHeld?: Promise<void>;
    lost?: boolean;
    lostExpense?: boolean;
    mixed?: boolean;
    flag?: boolean;
    /** An item missing who paid, the split and the Tag, with the server's raw problems. */
    unpaid?: boolean;
    /** Reviews carry the server's allocation: who paid and each share. */
    allocated?: boolean;
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
  if (options.unpaid)
    items = [
      {
        ...review({
          ...row(6, 'Station dinner', 30),
          values: {
            description: 'Station dinner',
            amount: 30,
            currency: 'INR',
            date: '2026-10-14',
          },
          missingFields: ['paidBy', 'splitMethod', 'splitBetween', 'tagId'],
        }),
        problems: [
          'paidBy: Choose who paid.',
          'splitMethod: Choose a split method.',
          'splitBetween: Choose who shared this Expense.',
          'tagId: Choose a Tag.',
        ],
      },
    ];
  if (options.laterReadyGroup)
    items = [review(incomplete), review({ ...first, groupId: otherGroupId })];
  if (options.allocated)
    items = items.map((item) => {
      const amount = item.draft.values?.amount ?? 0;
      return {
        ...item,
        allocation: {
          currency: 'INR',
          paidBy: [{ user: user.id, amount }],
          splitBetween: [{ user: user.id, amount }],
        },
      };
    });
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
          : [group],
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
    deny: () => {
      denied = true;
    },
    goOffline: () => {
      offline = true;
    },
    addReady: () => {
      items.push(review(row(5, 'Museum', 5)));
    },
    items: () => items,
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
async function phoneItem(f: ReturnType<typeof fixture>) {
  await act(async () => {
    await f.controller.openExpense(groupId);
    await f.controller.updateExpenseDraft({ description: 'Phone groceries', amount: '9', tagId });
    await f.controller.closeExpense(true);
    await f.controller.back();
  });
  expect(f.controller.getSnapshot().drafts).toHaveLength(1);
}

describe.each(['light', 'dark'] as const)('To review at 130 percent text in %s', (mode) => {
  it('renders waiting then the shared Home count, Group banner and ready navigation', async () => {
    let release!: () => void;
    const f = fixture({
      held: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    await signIn(f);
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    expect(text(home)).toContain('Checking what’s waiting');
    await act(async () => {
      release();
      await f.controller.refreshToReview();
    });
    expect(text(home)).toContain('To review · 4');
    expect(text(home)).toContain('4 from Claude');
    const banner = await render(
      <ToReviewGroupBanner controller={f.controller} groupId={groupId} />,
      mode,
    );
    expect(text(banner)).toContain('4 to review');
    expect(text(banner)).toContain('4 from Claude today');
    await tap(home, 'Review 4, one at a time');
    expect(f.controller.getSnapshot().toReview.run?.items[0].groupId).toBe(groupId);
  });
  it('shows an item’s day as it is, in a zone behind UTC (#437)', () =>
    inTimeZone('Pacific/Pago_Pago', async () => {
      const f = fixture();
      await signIn(f);
      const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
      // Dated 14 Oct, as the test clock's today is there too, never the day before.
      expect(text(list)).toContain('Prepared by Claude · Today');
      expect(text(list)).not.toContain('Yesterday');
      await tap(list, 'Save 2 ready');
      expect(text(list)).toContain('Save ready expenses?');
      expect(text(list)).not.toContain('Yesterday');
    }));
  it('hides an empty Home card and renders the empty list', async () => {
    const f = fixture({ empty: true });
    await signIn(f);
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    expect(home.toJSON()).toBeNull();
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(text(list)).toContain('All caught up');
    expect(button(list, 'Save 0 ready').props.disabled).toBe(true);
  });
  it('opens a tapped item in the guided review, never a raw editor (#435)', async () => {
    const f = fixture();
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await tap(list, 'Review Fare');
    const run = f.controller.getSnapshot().toReview.run;
    expect(run?.items[run.index].item.draft.id).toBe(row(2, '', 1).id);
    expect(run?.items.map((entry) => entry.item.draft.id).sort()).toEqual(
      [row(1, '', 1), row(2, '', 1), row(3, '', 1), row(4, '', 1)].map((entry) => entry.id).sort(),
    );
    for (const raw of ['Edit expense details', 'Currency (e.g. INR)', 'Date (YYYY-MM-DD)'])
      expect(text(list)).not.toContain(raw);
  });
  it('keeps showing an amount whose currency is missing (#435)', async () => {
    const f = fixture({ unpaid: true });
    const draft = f.items()[0].draft;
    delete draft.values!.currency;
    draft.values!.amount = 1234.5;
    draft.missingFields = [...(draft.missingFields ?? []), 'currency'];
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(text(list)).toContain('1,234.5');
    expect(text(list)).toContain('the currency');
    expect(text(list)).not.toContain('Amount needed');
  });
  it('names a missing date, amount or description once, in the Needs line (#435)', async () => {
    const f = fixture();
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(text(list)).toContain('Needs the amount, the currency, the date');
    for (const repeated of ['Amount needed', 'Date needed', 'Description needed'])
      expect(text(list)).not.toContain(repeated);
  });
  it('says what an item needs once, in member words (#435)', async () => {
    const f = fixture({ unpaid: true });
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(text(list)).toContain('Needs who paid, how to split it, who shared it, the tag');
    // Said once: no second line repeats a fact the Needs line already names.
    for (const raw of [
      'paidBy',
      'splitMethod',
      'splitBetween',
      'tagId',
      'Choose who paid.',
      'Who paid?',
      'The tag?',
    ])
      expect(text(list)).not.toContain(raw);
  });
  it('renders every list section, exact freshly reviewed confirmation, saved and changed outcomes', async () => {
    const f = fixture({ mixed: true });
    f.addReady();
    await signIn(f);
    await phoneItem(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    for (const label of [
      'Ready',
      'Check before saving',
      'Needs details',
      'On this phone',
      'Phone groceries',
      'Prepared by Claude',
    ])
      expect(text(list)).toContain(label);
    await tap(list, 'Save 3 ready');
    expect(f.reviews[0]).toEqual([row(1, '', 1).id, row(2, '', 1).id, row(5, '', 1).id]);
    expect(text(list)).toContain('₹40.79');
    expect(text(list)).toContain('Balances there will change for everyone');
    expect(f.saves).toHaveLength(0);
    await tap(list, 'Confirm save 3 ready');
    expect(text(list)).toContain('After saving');
    expect(text(list)).toContain('Saved 1 · 2 left for later');
    expect(text(list)).toContain('Changed since you checked');
    expect(text(list)).toContain('Couldn’t save: Tag is unavailable');
    expect(f.committed.size).toBe(1);
  });
  it('asks about your own amount as "you" (#434)', async () => {
    const f = fixture({ unpaid: true });
    f.items()[0].draft.values = {
      ...f.items()[0].draft.values,
      paidBy: [{ user: user.id }],
      splitMethod: 'unequal',
      splitBetween: [{ user: user.id }],
    };
    f.items()[0].problems = [
      'paidBy.0.amount: Enter the amount paid.',
      'splitBetween.0.amount: Enter each share.',
    ];
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(text(list)).toContain('The amount paid by you?');
    expect(text(list)).toContain('The amount for you?');
    expect(text(list)).not.toContain('Alex?');
  });
  it('says what you paid and share when confirming Save ready (#434)', async () => {
    const f = fixture({ allocated: true });
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await tap(list, 'Save 2 ready');
    expect(text(list)).toContain('You paid ₹12.34');
    expect(text(list)).toContain('You share ₹12.34');
    expect(text(list)).not.toContain('Alex paid');
    expect(text(list)).not.toContain('Alex shares');
  });
  it('shows lost Save replies and Check again reuses exactly the retained identity', async () => {
    const f = fixture({ lost: true });
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await tap(list, 'Save 2 ready');
    await tap(list, 'Confirm save 2 ready');
    expect(text(list)).toContain("We didn't hear back, so it may already be saved");
    expect(f.requests.values.size).toBe(1);
    await act(async () => {
      focusManager.setFocused(false);
      onlineManager.setOnline(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(f.saves).toHaveLength(1);
    await tap(list, 'Check again');
    expect(f.saves).toHaveLength(2);
    expect(f.saves[1]).toBe(f.saves[0]);
    expect(f.committed.size).toBe(2);
    expect(f.requests.values.size).toBe(0);
    expect(text(list)).toContain('Saved 2');
  });
  it('settles a held Save reply across disconnection, closes offline, and reconnects without replay', async () => {
    let release!: () => void;
    const f = fixture({
      saveHeld: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    await signIn(f);
    await act(async () => {
      await f.controller.openToReview(groupId);
    });
    const overlay = await render(<ToReviewOverlay controller={f.controller} />, mode);
    await tap(overlay, 'Save 2 ready');
    await tap(overlay, 'Confirm save 2 ready');
    expect(f.controller.getSnapshot().sharedDraftCollection.busy).toBe(true);
    expect(f.saves).toHaveLength(1);
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    try {
      await act(async () => {
        release();
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(f.controller.getSnapshot().sharedDraftCollection).toMatchObject({
        busy: false,
        pending: false,
        resultsVisible: true,
      });
      expect(text(overlay)).toContain('Saved 2');
      expect(f.saves).toHaveLength(1);
      expect(button(overlay, 'Close To review').props.disabled).toBe(false);
      await tap(overlay, 'Close To review');
      expect(f.controller.getSnapshot().toReview.groupId).toBeNull();
      expect(overlay.toJSON()).toBeNull();
      const beforeReconnect = f.calls.length;
      await act(async () => {
        onlineManager.setOnline(true);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(f.calls.slice(beforeReconnect).every((call) => call.startsWith('GET '))).toBe(true);
      expect(f.saves).toHaveLength(1);
      expect(f.committed.size).toBe(2);
    } finally {
      release();
    }
  });
  it('keeps an empty Home recovery error and explicit local retry visible until storage recovers', async () => {
    const f = fixture({ empty: true });
    const listing = vi.spyOn(f.requests, 'list').mockRejectedValue(new Error('SQLITE_IOERR'));
    await signIn(f);
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    expect(f.controller.getSnapshot().toReview.read.total).toBe(0);
    expect(text(home)).toContain('Could not check this phone for unfinished saves');
    expect(button(home, 'Check this phone again')).toBeDefined();
    await tap(home, 'Check this phone again');
    expect(text(home)).toContain('Could not check this phone for unfinished saves');
    listing.mockResolvedValue([]);
    await tap(home, 'Check this phone again');
    expect(f.controller.getSnapshot().toReview.recoveryMessage).toBeNull();
    expect(home.toJSON()).toBeNull();
    expect(f.saves).toHaveLength(0);
  });
  it('keeps a committed lost-reply save reachable from Home after restart when the account list is empty', async () => {
    const f = fixture({ lost: true });
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await tap(list, 'Save 2 ready');
    await tap(list, 'Confirm save 2 ready');
    f.clear();
    await act(async () => {
      list.unmount();
    });
    trees.splice(trees.indexOf(list), 1);
    f.controller.dispose();
    controllers.splice(controllers.indexOf(f.controller), 1);
    const restarted = f.restart();
    await act(async () => {
      await restarted.restore();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(restarted.getSnapshot().toReview.read.total).toBe(0);
    expect(restarted.toReviewModel().counts.onThisPhone).toBeGreaterThan(0);
    const home = await render(<ToReviewHomeCard controller={restarted} />, mode);
    expect(text(home)).toContain("We didn't hear back, so it may already be saved");
    expect(f.saves).toHaveLength(1);
    await tap(home, 'Check again');
    const overlay = await render(<ToReviewOverlay controller={restarted} />, mode);
    await tap(overlay, 'Check again');
    expect(f.saves).toHaveLength(2);
    expect(f.saves[1]).toBe(f.saves[0]);
    expect(f.committed.size).toBe(2);
    expect(f.requests.values.size).toBe(0);
  });
  it('keeps phone items available offline without account load or Save', async () => {
    const f = fixture();
    await signIn(f);
    await phoneItem(f);
    f.goOffline();
    await act(async () => {
      await f.controller.refresh();
    });
    expect(f.controller.getSnapshot().offline.active).toBe(true);
    onlineManager.setOnline(false);
    const calls = f.calls.length;
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    expect(text(home)).toContain("You're offline. What Claude prepared");
    expect(text(home)).toContain('Phone groceries');
    expect(text(home)).not.toContain('4 from Claude');
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(button(list, 'Save 0 ready').props.disabled).toBe(true);
    expect(f.calls).toHaveLength(calls);
    await tap(home, 'Continue Phone groceries');
    expect(f.controller.getSnapshot().expense.draft?.description).toBe('Phone groceries');
  });
  it('shows the existing unconfirmed phone-save warning and resumes its protected form first', async () => {
    const f = fixture({ lostExpense: true });
    await signIn(f);
    await act(async () => {
      await f.controller.openExpense(groupId);
      await f.controller.updateExpenseDraft({
        description: 'Unconfirmed phone lunch',
        amount: '9',
        tagId,
      });
      await f.controller.saveExpense();
      await f.controller.closeExpense(true);
      await f.controller.back();
    });
    expect(f.controller.getSnapshot().drafts[0]?.unconfirmed).toBe(true);
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    expect(text(home)).toContain("We didn't hear back, so it may already be saved");
    const submitted = f.calls.filter(
      (path) => path === `POST /api/groups/${groupId}/expenses`,
    ).length;
    await tap(home, 'Continue Unconfirmed phone lunch');
    expect(f.controller.getSnapshot().expense.attempt).not.toBeNull();
    expect(f.controller.getSnapshot().expense.draft?.description).toBe('Unconfirmed phone lunch');
    expect(f.calls.filter((path) => path === `POST /api/groups/${groupId}/expenses`)).toHaveLength(
      submitted,
    );
  });
  it('reacts to a disconnected phone before any cached HTTP read fails', async () => {
    const f = fixture();
    await signIn(f);
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(text(home)).toContain("You're offline. What Claude prepared");
    expect(text(home)).not.toContain('4 from Claude');
    const reads = f.calls.length;
    await act(async () => {
      await f.controller.refreshToReview();
    });
    expect(f.calls).toHaveLength(reads);
  });
  it('removes inaccessible Group account items from Home after an authoritative denial', async () => {
    const f = fixture();
    await signIn(f);
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    expect(text(home)).toContain('4 from Claude');
    f.deny();
    await act(async () => {
      await f.controller.openGroup(groupId);
      await f.controller.back();
    });
    expect(f.controller.toReviewModel().groups.some((entry) => entry.groupId === groupId)).toBe(
      false,
    );
    expect(text(home)).not.toContain('4 from Claude');
    expect(button(home, 'Maple House, 4 to review')).toBeUndefined();
  });
  it('defers account review refresh while an Expense form is foregrounded', async () => {
    const f = fixture();
    await signIn(f);
    await act(async () => {
      await f.controller.openExpense(groupId);
    });
    const before = f.calls.filter((call) => call === 'GET /api/user/to-review').length;
    await act(async () => {
      focusManager.setFocused(false);
      onlineManager.setOnline(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(f.calls.filter((call) => call === 'GET /api/user/to-review')).toHaveLength(before);
    await act(async () => {
      await f.controller.closeExpense(true);
      await f.controller.refreshToReview();
    });
    expect(f.calls.filter((call) => call === 'GET /api/user/to-review').length).toBeGreaterThan(
      before,
    );
  });
  it('opens the first displayed Group even when a later Group has the first ready item', async () => {
    const f = fixture({ laterReadyGroup: true });
    await signIn(f);
    const model = f.controller.toReviewModel();
    expect(model.groups[0].groupId).toBe(groupId);
    expect(model.items[0].groupId).toBe(otherGroupId);
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    await tap(home, 'Review 2, one at a time');
    expect(f.controller.getSnapshot().toReview.run?.items[0].groupId).toBe(groupId);
  });
  it('lands a signed-out app link in its Group list after sign-in', async () => {
    const f = fixture();
    await act(async () => {
      await f.controller.openInvitation(`http://localhost:4408/groups/${groupId}/review`);
    });
    expect(f.controller.getSnapshot().toReview.groupId).toBeNull();
    await signIn(f);
    const overlay = await render(<ToReviewOverlay controller={f.controller} />, mode);
    expect(text(overlay)).toContain('To review');
    expect(text(overlay)).toContain('Maple House');
  });
  it('keeps inaccessible app links unavailable', async () => {
    const f = fixture();
    await signIn(f);
    f.deny();
    await act(async () => {
      await f.controller.openInvitation(`http://localhost:4408/groups/${groupId}/review`);
    });
    expect(f.controller.getSnapshot().detail.status).toBe('denied');
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(text(list)).toContain('This Group isn’t available');
    expect(button(list, 'Save 2 ready')).toBeUndefined();
  });
  it('flag off preserves Continue rows and never loads the account review read', async () => {
    const f = fixture({ flag: false });
    await signIn(f);
    await phoneItem(f);
    const home = await render(
      <ContinueDrafts
        drafts={f.controller.getSnapshot().drafts}
        onOpen={(draft) => {
          void f.controller.openExpense(draft.groupId);
        }}
      />,
      mode,
    );
    expect(text(home)).toContain('Continue where you left off');
    expect(text(home)).toContain('Phone groceries');
    expect(f.calls.some((path) => path.includes('/api/user/to-review'))).toBe(false);
  });
});
