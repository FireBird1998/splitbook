import type { ReactElement } from 'react';
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inTimeZone } from '../test-utils/time-zone';
import { unreadText } from '../test-utils/layout';
import { mockDeviceLocale } from '../test-utils/device-locale';
import { onlineManager, focusManager } from '@tanstack/query-core';
import { Alert } from 'react-native';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import type {
  DraftReview,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { MobileFetch } from '../data/types';
import { savedQueriesIn } from '../test-utils/saved-queries';
import { activateWithScreenReader, setWindow, touchAlong } from '../test-utils/native';
import { ThemeContext } from './theme';
import { ToReviewHomeCard, ToReviewGroupBanner, ToReviewList, ToReviewOverlay } from './to-review';
import { ReviewRunOverlay } from './review-run';
import { CompactButton } from './compact';
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
    /** The Nth item update answers 500, as an unexpected server failure. */
    failPut?: number;
    /** Item updates for these ids answer 409 STALE_REVISION, as if changed elsewhere. */
    stale?: string[];
    /**
     * Dinner in Zürich, CHF 86.00, in Maple House, which lists INR with EUR and JPY (#733): the
     * server reviews it as CURRENCY_NOT_LISTED until CHF is added or its currency changed.
     */
    francs?: boolean;
    /** Dinner in Zürich's amount in francs, when it isn't 86.00. */
    francAmount?: number;
    /** With Maple House's list full: 4 extra currencies, the most a Group can have. */
    fullList?: boolean;
    /** Adding a currency is refused: another member filled Maple House's list first. */
    refuseAdd?: boolean;
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
  let extras: string[] = [];
  if (options.francs) {
    extras = options.fullList ? ['EUR', 'JPY', 'GBP', 'USD'] : ['EUR', 'JPY'];
    const dinner = row(7, 'Dinner in Zürich', options.francAmount ?? 86);
    items = [review({ ...dinner, values: { ...dinner.values, currency: 'CHF' } })];
  }
  /** The server's review now, against the Group's currencies (#732). */
  const reviewed = (item: DraftReview): DraftReview => {
    const currency = item.draft.values?.currency;
    const rest = item.problems.filter((problem) => problem !== 'CURRENCY_NOT_LISTED');
    return {
      ...item,
      problems:
        currency && !['INR', ...extras].includes(currency)
          ? ['CURRENCY_NOT_LISTED', ...rest]
          : rest,
    };
  };
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
  const puts: Array<{ id: string; revision: string | null; values: Record<string, unknown> }> = [],
    deletes: string[] = [];
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
                    currency: 'INR',
                    alternateCurrencies: extras,
                    count: own.length,
                    items: own.map(reviewed),
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
        : json({ status: 200, data: { ...group, alternateCurrencies: extras } });
    // Any member adds a currency to the Group (#721).
    if (path === `/api/groups/${groupId}/currencies` && init.method === 'POST') {
      if (options.refuseAdd) {
        extras = ['EUR', 'JPY', 'GBP', 'USD'];
        return json(
          {
            error: 'A Group can have at most 4 extra currencies.',
            code: 'INVALID_GROUP_CURRENCIES',
            status: 422,
          },
          422,
        );
      }
      const { currency } = JSON.parse(String(init.body)) as { currency: string };
      extras = [...extras, currency];
      return json(
        {
          status: 201,
          data: {
            mainCurrency: { code: 'INR', locked: true },
            extraCurrencies: extras.map((code) => ({
              code,
              use: {
                expenses: { count: 0, items: [] },
                settlements: 0,
                toReview: { yours: 0, others: 0 },
              },
              added: { by: { _id: user.id, name: user.name }, at: iso },
            })),
          },
        },
        201,
      );
    }
    if (path.endsWith('/drafts/review')) {
      const ids: string[] = JSON.parse(String(init.body)).ids;
      reviews.push(ids);
      return json({ data: items.filter((item) => ids.includes(item.draft.id)).map(reviewed) });
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
    const one = /\/drafts\/(d\d{23})$/.exec(path)?.[1];
    if (one && (init.method === 'PUT' || init.method === 'DELETE')) {
      const item = items.find((entry) => entry.draft.id === one);
      if (!item)
        return json({ error: 'Draft not found', code: 'DRAFT_NOT_FOUND', status: 404 }, 404);
      if (init.method === 'DELETE') {
        deletes.push(one);
        items = items.filter((entry) => entry !== item);
        return json({ data: null });
      }
      const values = JSON.parse(String(init.body)).values;
      const revision = new Headers(init.headers).get('X-Splitbook-Revision');
      puts.push({ id: one, revision, values });
      if (options.failPut === puts.length) return json({ error: 'Server error', status: 500 }, 500);
      if (options.stale?.includes(one) || revision !== String(item.draft.revision))
        return json({ error: 'Stale', code: 'STALE_REVISION', status: 409 }, 409);
      const present = (field: string) =>
        field === 'tagId' ? !!(values.tagId || values.tag) : values[field] !== undefined;
      item.draft = {
        ...item.draft,
        values,
        revision: item.draft.revision + 1,
        missingFields: (item.draft.missingFields ?? []).filter((field) => !present(field)),
      };
      item.problems = item.problems.filter((problem) => !present(problem.split(':')[0]));
      return json({ data: item.draft });
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
    puts,
    deletes,
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
  it('shows the Home card only after items arrive, then keeps it during refresh', async () => {
    let release!: () => void;
    const f = fixture({
      held: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    await signIn(f);
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    expect(home.toJSON()).toBeNull();
    await act(async () => {
      release();
      await f.controller.refreshToReview();
    });
    expect(text(home)).toContain('To review · 4');
    await act(async () => {
      const refreshing = f.controller.refreshToReview();
      expect(f.controller.toReviewModel().counts.total).toBe(4);
      await refreshing;
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
  it('lays the list out as its board: a top bar, a summary card and counted sections (#646)', async () => {
    const f = fixture();
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    // A top bar, its title "To review" over the Group and its count, with back as an arrow.
    const close = button(list, 'Close To review');
    expect(
      close.findAll(
        (node) => String(node.type) === 'Text' && node.children.includes('Close To review'),
      ),
      'an icon, not a text button',
    ).toHaveLength(0);
    expect(text(list)).toContain('Maple House · 4 items');
    // The three counts in a card, then Save and Review one at a time, full width.
    for (const label of ['ready to save', 'needs details', 'on this phone'])
      expect(text(list)).toContain(label);
    expect(button(list, 'Save 2 ready').props.style({ pressed: false }).alignSelf).toBe('stretch');
    // Each section says how many it holds.
    expect(text(list)).toMatch(/Ready · \d/);
  });
  it('shows Home’s card and the Group’s bar as their boards (#646)', async () => {
    const f = fixture();
    await signIn(f);
    await act(async () => {
      await f.controller.refreshToReview();
    });
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    // The heading is the brand-coloured overline label, not a large title.
    const heading = home.root.find(
      (node) => String(node.type) === 'Text' && node.props.accessibilityRole === 'header',
    );
    expect(heading.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ textTransform: 'uppercase' })]),
    );
    expect(button(home, 'Review 4, one at a time').props.style({ pressed: false }).alignSelf).toBe(
      'stretch',
    );
    // The Group's bar is one row that opens the list, ending "Review ›": no button inside it.
    const banner = await render(
      <ToReviewGroupBanner controller={f.controller} groupId={groupId} />,
      mode,
    );
    expect(button(banner, 'Review')).toBeUndefined();
    const bar = banner.root.findAll(
      (node) =>
        String(node.type) === 'Pressable' &&
        String(node.props.accessibilityLabel).startsWith('4 to review in Maple House'),
    );
    expect(bar).toHaveLength(1);
    await tap(banner, bar[0]!.props.accessibilityLabel);
    expect(f.controller.getSnapshot().toReview.groupId).toBe(groupId);
  });
  it('opens the list from the Group’s bar on a tap or a screen reader’s activate, never on a drag (#684)', async () => {
    const f = fixture();
    await signIn(f);
    await act(async () => {
      await f.controller.refreshToReview();
    });
    const banner = await render(
      <ToReviewGroupBanner controller={f.controller} groupId={groupId} />,
      mode,
    );
    const bar = () =>
      banner.root.find(
        (node) =>
          String(node.type) === 'Pressable' &&
          String(node.props.accessibilityLabel).startsWith('4 to review in Maple House'),
      );
    const landed = { pageX: 180, pageY: 300 };
    const finger = async (path: Parameters<typeof touchAlong>[1]) =>
      act(async () => {
        touchAlong(bar(), path);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    await finger([landed, { pageX: 180, pageY: 200 }, { pageX: 181, pageY: 60 }]);
    expect(f.controller.getSnapshot().toReview.groupId).toBeNull();
    await finger([landed, { pageX: 182, pageY: 297 }]);
    expect(f.controller.getSnapshot().toReview.groupId).toBe(groupId);
    await act(async () => {
      await f.controller.back();
    });
    expect(f.controller.getSnapshot().toReview.groupId).toBeNull();
    await act(async () => {
      activateWithScreenReader(bar());
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(f.controller.getSnapshot().toReview.groupId).toBe(groupId);
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
      expect(text(list)).toContain('Save 2 expenses?');
      expect(text(list)).not.toContain('Yesterday');
    }));
  it('dates an older item day first, on a US phone too (#640)', async () => {
    mockDeviceLocale('en-US');
    const f = fixture();
    f.items()[0].draft.values!.date = '2026-10-10';
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(text(list)).toContain('Prepared by Claude · 10 Oct 2026');
    expect(text(list)).not.toContain('Oct 10');
  });
  it('saves ready items without a currency in the Group’s (#512)', async () => {
    const f = fixture();
    delete f.items()[0].draft.values!.currency;
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await tap(list, 'Save 2 ready');
    expect(text(list)).toContain('Save 2 expenses?');
    expect(text(list)).toContain('₹12.34');
    expect(text(list)).not.toContain('Some items changed');
  });
  it('draws no empty Home card on launch or refresh while the check is pending', async () => {
    let release!: () => void;
    const options = {
      empty: true,
      held: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const f = fixture(options);
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    expect(home.toJSON()).toBeNull();
    await signIn(f);
    expect(home.toJSON()).toBeNull();
    await act(async () => {
      release();
      await f.controller.refreshToReview();
    });
    expect(home.toJSON()).toBeNull();
    options.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = f.controller.refreshToReview();
    });
    expect(home.toJSON()).toBeNull();
    await act(async () => {
      release();
      await refreshing;
    });
    expect(home.toJSON()).toBeNull();
  });
  it('hides an empty Home card and renders the empty list', async () => {
    const f = fixture({ empty: true });
    await signIn(f);
    const home = await render(<ToReviewHomeCard controller={f.controller} />, mode);
    expect(home.toJSON()).toBeNull();
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    // The board's empty state: a check, what appears here, and the way back; nothing to save.
    expect(text(list)).toContain('All caught up');
    expect(button(list, 'Save 0 ready')).toBeUndefined();
    expect(button(list, 'Back to Expenses')).toBeDefined();
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
  it('opens an item on a tap, never on a drag that starts on its row (#665)', async () => {
    const f = fixture();
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    const landed = { pageX: 180, pageY: 360 };
    await act(async () => {
      touchAlong(button(list, 'Review Fare'), [
        landed,
        { pageX: 180, pageY: 260 },
        { pageX: 181, pageY: 110 },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(f.controller.getSnapshot().toReview.run).toBeFalsy();
    await act(async () => {
      touchAlong(button(list, 'Review Fare'), [landed, { pageX: 182, pageY: 357 }]);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const run = f.controller.getSnapshot().toReview.run;
    expect(run?.items[run.index].item.draft.id).toBe(row(2, '', 1).id);
  });
  it('shows an amount without a currency in the Group’s, and never asks for it (#512)', async () => {
    const f = fixture({ unpaid: true });
    const draft = f.items()[0].draft;
    delete draft.values!.currency;
    draft.values!.amount = 1234.5;
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(text(list)).toContain('₹1,234.50');
    expect(text(list)).not.toContain('the currency');
    expect(text(list)).not.toContain('Amount needed');
  });
  it('shows an amount with too many decimals as entered, never rounded or called missing (#537)', async () => {
    const f = fixture({ unpaid: true });
    f.items()[0].draft.values!.amount = 10.555;
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(text(list)).toContain('₹10.555');
    for (const shown of ['₹10.56', 'Amount needed']) expect(text(list)).not.toContain(shown);
  });
  it('names a missing date, amount or description once, in the Needs line (#435)', async () => {
    const f = fixture();
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    // Chips ask who paid and the Tag (#439); the Needs line names the rest, once.
    expect(text(list)).toContain('Still needs the amount, the date');
    expect(text(list)).not.toContain('the currency');
    for (const repeated of ['Amount needed', 'Date needed', 'Description needed'])
      expect(text(list)).not.toContain(repeated);
  });
  it('says what an item needs once, in member words (#435)', async () => {
    const f = fixture({ unpaid: true });
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    // Each fact is said once: who paid and the Tag as chip questions (#439), the rest in the
    // Needs line, and no second line repeats either.
    expect(text(list)).toContain('Still needs how to split it, who shared it');
    expect(text(list).match(/who paid/gi)).toEqual(['Who paid']);
    expect(text(list).match(/the tag/gi)).toEqual(['The tag']);
    for (const raw of ['paidBy', 'splitMethod', 'splitBetween', 'tagId', 'Choose who paid.'])
      expect(text(list)).not.toContain(raw);
  });
  it('keeps row explanations and safe unknown guidance beside a split need (#713)', async () => {
    const f = fixture({ unpaid: true });
    const item = f.items()[0];
    item.draft.values = {
      ...row(6, 'Station dinner', 30).values,
      splitMethod: 'exact',
      splitBetween: [{ user: user.id, amount: 30.001 }],
    };
    item.draft.missingFields = [];
    item.problems = [
      'splitBetween.0.amount: Amount supports at most 2 decimal places',
      'splitBetween.0.amount: Amount supports at most 2 decimal places',
      'Private unfamiliar server diagnostic',
    ];
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    const shown = text(list);
    expect(shown).toContain('shares with at most 2 decimal places');
    expect(shown.split('The amount for you can have at most 2 decimal places.')).toHaveLength(2);
    expect(shown.split('Check the expense details and try again.')).toHaveLength(2);
    expect(shown).not.toContain('Private unfamiliar');
    expect(
      list.root.findAll(
        (node) =>
          String(node.type) === 'Pressable' &&
          node.props.accessibilityLabel === 'Save Station dinner',
      ),
    ).toHaveLength(0);
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
    expect(text(list)).toContain('We didn’t hear back, so it may already be saved');
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
  it('keeps what went wrong above an empty list, never only "All caught up" (#646)', async () => {
    const f = fixture({ empty: true });
    vi.spyOn(f.requests, 'list').mockRejectedValue(new Error('SQLITE_IOERR'));
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    expect(text(list)).toContain('Could not check this phone for unfinished saves');
    expect(button(list, 'Check this phone again')).toBeDefined();
  });
  it('says why a run is locked while a lost save in its Group waits to be checked (#646)', async () => {
    const f = fixture({ lost: true });
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await tap(list, 'Save 2 ready');
    await tap(list, 'Confirm save 2 ready');
    await act(async () => {
      await f.controller.startReviewRun(groupId);
    });
    const run = await render(<ReviewRunOverlay controller={f.controller} />, mode);
    expect(button(run, 'Check again')).toBeDefined();
    expect(text(run)).toContain('We didn’t hear back, so it may already be saved');
  });
  it('keeps Home’s rows as buttons, disabled while Home checks (#646)', async () => {
    const f = fixture();
    await signIn(f);
    await act(async () => {
      await f.controller.refreshToReview();
    });
    const home = await render(<ToReviewHomeCard controller={f.controller} disabled />, mode);
    const row = button(home, 'Maple House, 4 to review');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.disabled).toBe(true);
  });
  it('puts an amount on its own line at large text, so it never breaks in two (#646)', async () => {
    const f = fixture();
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    // 130% is large text: the amount sits under the title, in the same column.
    const amount = list.root.findAll(
      (node) =>
        String(node.type) === 'Text' &&
        typeof node.props.children === 'string' &&
        node.props.children.startsWith('₹'),
    )[0]!;
    // The view that holds it: the row's text column, with the title.
    let column = amount.parent;
    while (column && String(column.type) !== 'View') column = column.parent;
    expect(
      column!.findAll((node) => String(node.type) === 'Text' && node.props.numberOfLines === 2),
      'the title beside it',
    ).toHaveLength(1);
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
    expect(text(home)).toContain('We didn’t hear back, so it may already be saved');
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
    expect(text(home)).toContain('You’re offline. What Claude prepared');
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
    expect(text(home)).toContain('We didn’t hear back, so it may already be saved');
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
    expect(text(home)).toContain('You’re offline. What Claude prepared');
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

describe('To review quick fixes on Android (#439)', () => {
  const mode = 'light' as const;
  const lunch = row(1, '', 1).id;
  const fare = row(2, '', 1).id;
  const missingAmount = row(3, '', 1).id;
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  /** Lunch keeps everything but who paid, as an assistant often prepares it. */
  function payerMissing(f: ReturnType<typeof fixture>) {
    const item = f.items().find((entry) => entry.draft.id === lunch)!;
    delete item.draft.values!.paidBy;
    item.draft.missingFields = ['paidBy'];
  }
  it('a payer chip keeps a lone payer, and Save records only that item with no confirmation', async () => {
    const f = fixture();
    payerMissing(f);
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await tap(list, 'You, suggested');
    await settle();
    expect(f.puts[0]).toMatchObject({ id: lunch, revision: '0' });
    expect(f.puts[0].values.paidBy).toEqual([{ user: user.id }]);
    expect(text(list)).toContain('You paid · Split equally · General');
    await tap(list, 'Save Lunch');
    await settle();
    expect(f.reviews.at(-1)).toEqual([lunch]);
    expect(JSON.parse(f.saves[0]).drafts.map((draft: { id: string }) => draft.id)).toEqual([lunch]);
    // Saved straight from the row: no Save ready confirmation was opened.
    expect(f.controller.getSnapshot().sharedDraftCollection.confirmation).toBeNull();
    expect(f.committed).toEqual(new Set([lunch]));
    // "Lunch saved · View": View opens the Expense it became (#439 decision 10).
    expect(text(list)).toContain('After saving');
    await tap(list, 'View Lunch');
    await settle();
    const after = f.controller.getSnapshot();
    expect(after.toReview.groupId).toBeNull();
    expect(after.sharedDraftCollection.resultsVisible).toBe(false);
    expect(after.screen).toBe('expense');
    expect(after.expense.requestedExpenseId).toBe(`e${lunch.slice(1)}`);
  });
  it('You for all skips an item changed elsewhere, and Undo restores only its own', async () => {
    const f = fixture({ stale: [missingAmount] });
    payerMissing(f);
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await tap(list, 'You for all 2');
    await settle();
    const result = 'You set as payer on 1 item. 1 changed elsewhere and was left as it was.';
    expect(text(list)).toContain(result);
    // Shown at the foot of the screen, not in the list that re-sorts, and announced politely.
    const [scroll] = list.root.findAll((node) => String(node.type) === 'ScrollView');
    const words = (node: typeof scroll) =>
      node
        .findAll((entry) => String(entry.type) === 'Text')
        .map((entry) => entry.children.filter((child) => typeof child === 'string').join(''));
    expect(words(scroll)).not.toContain(result);
    let notice = list.root.find(
      (node) => String(node.type) === 'Text' && words(node).includes(result),
    );
    while (notice.parent && notice.props.accessibilityLiveRegion !== 'polite')
      notice = notice.parent;
    expect(notice.props.accessibilityLiveRegion).toBe('polite');
    const item = () => f.items().find((entry) => entry.draft.id === lunch)!;
    expect(item().draft.values?.paidBy).toEqual([{ user: user.id }]);
    await tap(list, 'Undo');
    await settle();
    expect(item().draft.values).not.toHaveProperty('paidBy');
    expect(f.puts.at(-1)).toMatchObject({ id: lunch, revision: '1' });
  });
  it('an unexpected failure part-way still offers Undo for the payer already set', async () => {
    const f = fixture({ failPut: 2 });
    payerMissing(f);
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await tap(list, 'You for all 2');
    await settle();
    expect(text(list)).toContain('You set as payer on 1 item');
    await tap(list, 'Undo');
    await settle();
    expect(f.items().find((entry) => entry.draft.id === lunch)!.draft.values).not.toHaveProperty(
      'paidBy',
    );
  });
  it('gives each one-tap chip a 48 dp target (#646)', async () => {
    const f = fixture();
    payerMissing(f);
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    const chip = button(list, 'You, suggested');
    expect(chip.props.style({ pressed: false }).minHeight).toBe(44);
    expect(chip.props.hitSlop).toEqual({ top: 2, bottom: 2, left: 2, right: 2 });
  });
  it('⋮ offers Open and Delete in a sheet, and Delete asks first', async () => {
    const f = fixture();
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await tap(list, 'More for Fare');
    // A sheet titled with the item, as the app's other options are; never a stock dialog.
    expect(vi.mocked(Alert.alert)).not.toHaveBeenCalled();
    expect(text(list)).toContain('Fare');
    expect(button(list, 'Open, Review it with every detail')).toBeDefined();
    await tap(list, 'Delete, Remove it from To review');
    expect(text(list)).toContain('Delete this item?');
    expect(f.deletes).toEqual([]);
    await tap(list, 'Delete Fare');
    await settle();
    expect(f.deletes).toEqual([fare]);
  });
  it('deletes on a tap or a screen reader’s activate of Delete, never on a drag (#693)', async () => {
    const f = fixture();
    await signIn(f);
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await tap(list, 'More for Fare');
    await tap(list, 'Delete, Remove it from To review');
    expect(text(list)).toContain('Delete this item?');
    const landed = { pageX: 180, pageY: 700 };
    await act(async () => {
      touchAlong(button(list, 'Delete Fare'), [
        landed,
        { pageX: 260, pageY: 702 },
        { pageX: 330, pageY: 703 },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await settle();
    expect(f.deletes).toEqual([]);
    expect(text(list)).toContain('Delete this item?');
    await act(async () => {
      touchAlong(button(list, 'Delete Fare'), [landed, { pageX: 183, pageY: 702 }]);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await settle();
    expect(f.deletes).toEqual([fare]);
    await tap(list, 'More for Lunch');
    await tap(list, 'Delete, Remove it from To review');
    await act(async () => {
      activateWithScreenReader(button(list, 'Delete Lunch'));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await settle();
    expect(f.deletes).toEqual([fare, lunch]);
  });
  it('More shows every Tag with the Category match suggested, and keeps the Tag identity', async () => {
    const extra = ['Food', 'Transport', 'Stay', 'Activities'].map((name, index) => ({
      _id: `c${String(index + 2).padStart(23, '0')}`,
      name,
      isArchived: false,
      createdAt: iso,
    }));
    group.tags.push(...extra);
    try {
      const f = fixture();
      const item = f.items().find((entry) => entry.draft.id === lunch)!;
      item.draft.values = { ...item.draft.values, category: 'food' };
      delete item.draft.values.tagId;
      item.draft.missingFields = ['tagId'];
      await signIn(f);
      const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
      expect(button(list, 'Food, suggested')).toBeDefined();
      expect(button(list, 'Activities')).toBeUndefined();
      await tap(list, 'More Tags for Lunch');
      expect(text(list)).toContain('Suggested');
      await tap(list, 'Activities');
      await settle();
      expect(f.puts.at(-1)!.values).toMatchObject({ tagId: extra[3]._id });
    } finally {
      group.tags.splice(1);
    }
  });
});

// #733, boards "To review: unlisted currency" and "change the currency": through the real
// controller, Dinner in Zürich is in CHF, which Maple House doesn't list; the web's two fixes.
describe('an item in a currency the Group doesn’t list (#733)', () => {
  const dialog = (tree: ReactTestRenderer, title: string) =>
    tree.root
      .findAll((node) => String(node.type) === 'Modal' && node.props.visible === true)
      .find((modal) =>
        modal
          .findAll(
            (node) => String(node.type) === 'Text' && node.props.accessibilityRole === 'header',
          )
          .some((header) => header.children.join('') === title),
      ) ?? null;
  const words = (node: ReturnType<typeof dialog>) =>
    (node?.findAll((child) => String(child.type) === 'Text') ?? [])
      .map((child) => child.children.filter((part) => typeof part === 'string').join(''))
      .join('\n');
  async function opened(
    mode: 'light' | 'dark' = 'light',
    fullList = false,
    francAmount?: number,
    more: { refuseAdd?: boolean } = {},
  ) {
    const f = fixture({ francs: true, fullList, francAmount, ...more });
    await signIn(f);
    await act(async () => {
      await f.controller.openToReview(groupId);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const list = await render(<ToReviewList controller={f.controller} groupId={groupId} />, mode);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return { f, list };
  }

  it('marks it, and opens a sheet that says what’s wrong with both fixes', async () => {
    const { list } = await opened();
    expect(text(list)).toContain('Needs details');
    expect(text(list)).toContain('Currency not listed');
    // Android's rows stay compact: what saving records is a Ready row's line only (#793).
    expect(text(list)).not.toContain('You paid · Split equally');
    await tap(list, 'Review Dinner in Zürich');
    const sheet = dialog(list, 'Dinner in Zürich');
    expect(sheet).not.toBeNull();
    const shown = words(sheet);
    expect(shown).toContain('CHF isn’t one of Maple House’s currencies.');
    expect(shown).toContain('Add it, or change this Expense’s currency.');
    expect(shown).toContain('Adding lets everyone use CHF, the 3rd of 4 extra currencies.');
    expect(shown).toContain(
      'Changing keeps 86.00 and changes only the currency; nothing is converted.',
    );
    expect(button(list, 'Add CHF to Maple House')).toBeDefined();
    expect(button(list, 'Change currency')).toBeDefined();
  });

  it('with the Group’s list full, offers only to change the currency, and says why', async () => {
    const { list } = await opened('light', true);
    await tap(list, 'Review Dinner in Zürich');
    const shown = words(dialog(list, 'Dinner in Zürich'));
    expect(shown).toContain(
      'CHF isn’t one of Maple House’s currencies. Change this Expense’s currency.',
    );
    expect(shown).toContain(
      'Maple House already has 4 extra currencies, the most a Group can have. An admin can remove one nothing uses in Group settings.',
    );
    expect(button(list, 'Add CHF to Maple House')).toBeUndefined();
    expect(button(list, 'Change currency')).toBeDefined();
  });

  it('adds the currency to the Group, and the item is then ready to save', async () => {
    const { f, list } = await opened();
    await tap(list, 'Review Dinner in Zürich');
    await tap(list, 'Add CHF to Maple House');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(f.calls).toContain(`POST /api/groups/${groupId}/currencies`);
    expect(dialog(list, 'Dinner in Zürich')).toBeNull();
    expect(text(list)).not.toContain('Currency not listed');
    expect(button(list, 'Save Dinner in Zürich')).toBeDefined();
  });

  it('changes only the currency, saying nothing is converted, and the item is then ready', async () => {
    const { f, list } = await opened();
    await tap(list, 'Review Dinner in Zürich');
    await tap(list, 'Change currency');
    const sheet = dialog(list, 'Change currency');
    expect(words(sheet)).toContain('Pick one of Maple House’s currencies for Dinner in Zürich.');
    expect(button(list, 'INR, Indian Rupee, main currency')).toBeDefined();
    expect(button(list, 'JPY, Japanese Yen, whole amounts only')).toBeDefined();
    await tap(list, 'EUR, Euro');
    expect(words(dialog(list, 'Change currency'))).toContain(
      'The amount stays 86.00, so it becomes €86.00. Splitbook doesn’t convert it; check it against the receipt.',
    );
    await tap(list, 'Use EUR');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(f.puts.at(-1)?.values).toMatchObject({ amount: 86, currency: 'EUR' });
    expect(f.calls).not.toContain(`POST /api/groups/${groupId}/currencies`);
    expect(dialog(list, 'Change currency')).toBeNull();
    expect(dialog(list, 'Dinner in Zürich')).toBeNull();
    expect(button(list, 'Save Dinner in Zürich')).toBeDefined();
  });

  it.each([1.3, 2])('reads both sheets in full on a 360dp phone at %s× text', async (fontScale) => {
    const { list } = await opened();
    setWindow({ width: 360, height: 780, fontScale });
    await tap(list, 'Review Dinner in Zürich');
    const tree = list.toJSON() as ReactTestRendererJSON;
    expect(unreadText(tree, fontScale, 360)).toEqual([]);
    await tap(list, 'Change currency');
    await tap(list, 'EUR, Euro');
    expect(unreadText(list.toJSON() as ReactTestRendererJSON, fontScale, 360)).toEqual([]);
  });

  it('offline, adding says it needs a connection and sends nothing', async () => {
    const { f, list } = await opened();
    await tap(list, 'Review Dinner in Zürich');
    f.goOffline();
    await act(async () => {
      await f.controller.refresh();
    });
    expect(f.controller.getSnapshot().offline.active).toBe(true);
    const add = button(list, 'Add CHF to Maple House');
    expect(add.props.disabled).toBe(true);
    expect(add.props.accessibilityHint).toBe('Adding a currency needs a connection.');
    expect(f.calls).not.toContain(`POST /api/groups/${groupId}/currencies`);
  });

  /** The guided review's item, where it starts. */
  const reviewing = (f: Awaited<ReturnType<typeof opened>>['f']) => {
    const run = f.controller.getSnapshot().toReview.run;
    return run?.items[run.index]?.item.draft.values;
  };

  it('with the list full and an amount no listed currency keeps, says what else it needs and opens the guided review', async () => {
    const { f, list } = await opened('light', true, 86.555);
    await tap(list, 'Review Dinner in Zürich');
    expect(words(dialog(list, 'Dinner in Zürich'))).toContain(
      'It also needs an amount with at most 2 decimal places.',
    );
    setWindow({ width: 360, height: 780, fontScale: 2 });
    expect(unreadText(list.toJSON() as ReactTestRendererJSON, 2, 360)).toEqual([]);
    await tap(list, 'Review it with every detail');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // The fix sheet closed: its fixes are gone.
    expect(button(list, 'Change currency')).toBeUndefined();
    expect(reviewing(f)).toMatchObject({ amount: 86.555, currency: 'CHF' });
  });

  /** How a sheet's button is drawn: primary unless it says otherwise. */
  const variantOf = (tree: ReactTestRenderer, label: string) =>
    tree.root.findAll((node) => node.type === CompactButton && node.props.label === label)[0]?.props
      .variant ?? 'primary';

  // The Designer's order for an item no listed currency can keep (#733): the guided review first.
  it('when no listed currency can keep the amount, leads with the guided review and says why Change can’t', async () => {
    const { list } = await opened('light', true, 86.555);
    await tap(list, 'Review Dinner in Zürich');
    const shown = words(dialog(list, 'Dinner in Zürich'));
    expect(shown).toContain(
      'CHF isn’t one of Maple House’s currencies. Review it to fix the amount and the currency.',
    );
    const order = [
      'It also needs an amount with at most 2 decimal places.',
      'Review it with every detail',
      'Change currency',
      'No listed currency can keep CHF\u00a086.555.',
    ].map((line) => shown.indexOf(line));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(variantOf(list, 'Review it with every detail')).toBe('primary');
    expect(button(list, 'Change currency').props.disabled).toBe(true);
    setWindow({ width: 360, height: 780, fontScale: 2 });
    expect(unreadText(list.toJSON() as ReactTestRendererJSON, 2, 360)).toEqual([]);
  });

  it('when a listed currency can keep it, keeps Add and Change first, with the guided review the tonal third', async () => {
    const { f, list } = await opened();
    // Prepared without a date: it needs one besides a listed currency.
    const dinner = f.items()[0]!;
    const values = { ...dinner.draft.values };
    delete values.date;
    dinner.draft = { ...dinner.draft, values, missingFields: ['date'] };
    await act(async () => {
      await f.controller.refresh();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await tap(list, 'Review Dinner in Zürich');
    const shown = words(dialog(list, 'Dinner in Zürich'));
    expect(shown).toContain(
      'CHF isn’t one of Maple House’s currencies. Add it, or change this Expense’s currency.',
    );
    expect(shown).toContain('It also needs the date.');
    const order = ['Add CHF to Maple House', 'Change currency', 'Review it with every detail'].map(
      (line) => shown.indexOf(line),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(variantOf(list, 'Add CHF to Maple House')).toBe('primary');
    expect(variantOf(list, 'Review it with every detail')).toBe('tonal');
    expect(button(list, 'Change currency').props.disabled).toBe(false);
  });

  it('offers the guided review only when the item needs more than a listed currency', async () => {
    const { list } = await opened();
    await tap(list, 'Review Dinner in Zürich');
    expect(words(dialog(list, 'Dinner in Zürich'))).not.toContain('It also needs');
    expect(button(list, 'Review it with every detail')).toBeUndefined();
  });

  it('opens the item from More in the guided review, with every detail', async () => {
    const { f, list } = await opened();
    await tap(list, 'More for Dinner in Zürich');
    await tap(list, 'Open, Review it with every detail');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // The fix sheet closed: its fixes are gone.
    expect(button(list, 'Change currency')).toBeUndefined();
    expect(reviewing(f)).toMatchObject({ amount: 86, currency: 'CHF' });
  });

  it('says in the sheet why adding was refused, when the Group read again doesn’t list it', async () => {
    const { f, list } = await opened('light', false, undefined, { refuseAdd: true });
    await tap(list, 'Review Dinner in Zürich');
    await tap(list, 'Add CHF to Maple House');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(f.calls).toContain(`POST /api/groups/${groupId}/currencies`);
    expect(words(dialog(list, 'Dinner in Zürich'))).toContain(
      'A Group can have at most 4 extra currencies.',
    );
  });

  it('fixes the item as it is now, when it changed elsewhere while its sheet was open', async () => {
    const { f, list } = await opened();
    await tap(list, 'Review Dinner in Zürich');
    const dinner = f.items()[0]!;
    const revision = dinner.draft.revision + 1;
    // Changed on the web meanwhile: CHF 90.00, paid as before.
    const values = dinner.draft.values ?? {};
    dinner.draft = {
      ...dinner.draft,
      revision,
      values: {
        ...values,
        amount: 90,
        paidBy: values.paidBy?.map((paid) => ({ ...paid, amount: 90 })),
      },
    };
    await act(async () => {
      await f.controller.refresh();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(words(dialog(list, 'Dinner in Zürich'))).toContain(
      'Changing keeps 90.00 and changes only the currency; nothing is converted.',
    );
    await tap(list, 'Change currency');
    await tap(list, 'EUR, Euro');
    expect(words(dialog(list, 'Change currency'))).toContain(
      'The amount stays 90.00, so it becomes €90.00.',
    );
    await tap(list, 'Use EUR');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(f.puts.at(-1)).toMatchObject({
      revision: String(revision),
      values: { amount: 90, currency: 'EUR' },
    });
    expect(button(list, 'Save Dinner in Zürich')).toBeDefined();
  });

  it('offline, says once at the top that both fixes need a connection', async () => {
    const { f, list } = await opened();
    await tap(list, 'Review Dinner in Zürich');
    f.goOffline();
    await act(async () => {
      await f.controller.refresh();
    });
    const shown = words(dialog(list, 'Dinner in Zürich'));
    const offline = 'You’re offline. Adding or changing a currency needs a connection.';
    expect(shown.split(offline)).toHaveLength(2);
    expect(shown.indexOf(offline)).toBeLessThan(shown.indexOf('86.00'));
    expect(shown.indexOf(offline)).toBeLessThan(
      shown.indexOf('CHF isn’t one of Maple House’s currencies.'),
    );
    // The captions under each fix stay as they are.
    expect(shown).toContain('Adding a currency needs a connection.\n');
    expect(shown).toContain(
      'Changing keeps 86.00 and changes only the currency; nothing is converted.',
    );
    expect(button(list, 'Change currency').props.disabled).toBe(true);
    setWindow({ width: 360, height: 780, fontScale: 2 });
    expect(unreadText(list.toJSON() as ReactTestRendererJSON, 2, 360)).toEqual([]);
  });

  it('says a yen amount without decimals: 86.00 becomes ¥86', async () => {
    const { list } = await opened();
    await tap(list, 'Review Dinner in Zürich');
    await tap(list, 'Change currency');
    await tap(list, 'JPY, Japanese Yen, whole amounts only');
    expect(words(dialog(list, 'Change currency'))).toContain(
      'The amount stays 86.00, so it becomes ¥86. Splitbook doesn’t convert it; check it against the receipt.',
    );
    expect(button(list, 'Use JPY')).toBeDefined();
  });

  it('doesn’t offer yen for 86.50, which has no smaller unit to keep the 50 in', async () => {
    const { f, list } = await opened('light', false, 86.5);
    await tap(list, 'Review Dinner in Zürich');
    await tap(list, 'Change currency');
    const yen = button(list, 'JPY, Japanese Yen, whole amounts only, can’t keep 86.50');
    expect(yen.props.accessibilityState).toMatchObject({ disabled: true, checked: false });
    expect(words(dialog(list, 'Change currency'))).toContain(
      'Whole amounts only · Can’t keep 86.50',
    );
    await tap(list, 'JPY, Japanese Yen, whole amounts only, can’t keep 86.50');
    expect(button(list, 'Use JPY')).toBeUndefined();
    expect(button(list, 'Choose a currency')).toBeDefined();
    await tap(list, 'EUR, Euro');
    expect(words(dialog(list, 'Change currency'))).toContain(
      'The amount stays 86.50, so it becomes €86.50.',
    );
    await tap(list, 'Use EUR');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(f.puts.at(-1)?.values).toMatchObject({ amount: 86.5, currency: 'EUR' });
  });
});
