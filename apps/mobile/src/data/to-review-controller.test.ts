import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DraftReview,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import { createMobileController, type MobileController } from './mobile-controller';
import type { MobileFetch } from './types';
import { savedQueriesIn } from '../test-utils/saved-queries';

const user = {
  id: 'a00000000000000000000001',
  name: 'Alex',
  email: 'alex@example.test',
  image: null,
};
const groupId = 'b00000000000000000000001';
const tagId = 'c00000000000000000000001';
const iso = '2026-10-16T12:00:00.000Z';
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
const ready = (index: number) => ({
  description: `Item ${index}`,
  amount: 10,
  currency: 'INR',
  date: '2026-10-16',
  category: 'other',
  tagId,
  paidBy: [{ user: user.id, amount: 10 }],
  splitMethod: 'equal',
  splitBetween: [{ user: user.id }],
});
const item = (index: number, complete = false): DraftReview => {
  const draft: PersistedExpenseDraft = {
    id: `d${String(index).padStart(23, '0')}`,
    groupId,
    revision: 0,
    state: 'active',
    preparedBy: { kind: 'assistant', name: 'Claude' },
    changedBy: { kind: 'assistant', name: 'Claude' },
    createdAt: iso,
    updatedAt: iso,
    missingFields: complete ? [] : ['amount'],
    values: complete ? ready(index) : { description: `Item ${index}` },
  } as PersistedExpenseDraft;
  return { draft, review: 'a'.repeat(64), problems: [], duplicates: [] };
};
function memory() {
  const values = new Map<string, unknown>();
  return {
    load: async (account: string, id: string) =>
      structuredClone(values.get(`${account}:${id}`) ?? null),
    save: async (account: string, id: string, value: unknown) =>
      void values.set(`${account}:${id}`, structuredClone(value)),
    remove: async (account: string, id: string) => void values.delete(`${account}:${id}`),
    clear: async () => values.clear(),
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
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.unstubAllEnvs();
});
function fixture(options: { groups?: boolean; extras?: string[] } = {}) {
  let held: Promise<void> | undefined;
  let operation = 0;
  let creation: unknown = null;
  let owner: string | null = null;
  let denied = false;
  let failing = false;
  let draftsOff = false;
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
  let items: DraftReview[] = [];
  /** The Group's extra currencies (#721): an item in one it doesn't list needs another (#732). */
  let extras = options.extras ?? [];
  let adding: 'ok' | 'lost' = 'ok';
  let groupReadsFail = false;
  const posted: string[] = [];
  const listed = () => [group.defaultCurrency, ...extras];
  /** Each item's problems as the server reviews it now, against the Group's currencies. */
  const reviewed = (entry: DraftReview): DraftReview => {
    const currency = entry.draft.values?.currency;
    const rest = entry.problems.filter((problem) => problem !== 'CURRENCY_NOT_LISTED');
    return {
      ...entry,
      problems: currency && !listed().includes(currency) ? ['CURRENCY_NOT_LISTED', ...rest] : rest,
    };
  };
  const currentGroup = () => ({ ...group, alternateCurrencies: extras });
  let groups = options.groups === false ? [] : [group];
  let cookie: string | null = null;
  const fetch: MobileFetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/demo-persona/sign-in'))
      return json({ user }, 200, 'better-auth.session_token=alex.signature; Max-Age=2592000');
    if (path.endsWith('/get-session'))
      return json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path === '/api/user/to-review') {
      const reply = {
        status: 200,
        data: {
          total: items.length,
          groups: items.length
            ? [
                {
                  groupId,
                  groupName: group.name,
                  currency: group.defaultCurrency,
                  alternateCurrencies: extras,
                  count: items.length,
                  items: items.map(reviewed),
                },
              ]
            : [],
        },
      };
      await held;
      if (failing) return json({ error: 'Unavailable', status: 500 }, 500);
      return json(reply);
    }
    if (path === '/api/user/balances')
      return json({
        status: 200,
        data: { buckets: [], groups: groups.map(() => ({ groupId, balances: [] })) },
      });
    if (path === '/api/groups' && init.method === 'POST') {
      groups = [group];
      return json({ status: 201, data: group }, 201);
    }
    if (path === '/api/groups') return json({ status: 200, data: groups });
    if (path === `/api/groups/${groupId}`) {
      if (groupReadsFail) throw new TypeError('Network request failed');
      return denied
        ? json({ error: 'Forbidden', status: 403 }, 403)
        : json({ status: 200, data: currentGroup() });
    }
    // Any member adds a currency to the Group (#721): the server's answer, or none (#722).
    if (path === `/api/groups/${groupId}/currencies` && init.method === 'POST') {
      const { currency } = JSON.parse(String(init.body)) as { currency: string };
      posted.push(currency);
      if (listed().includes(currency))
        return json(
          {
            error: `${currency} is already one of this Group’s currencies.`,
            code: 'INVALID_GROUP_CURRENCIES',
            status: 422,
          },
          422,
        );
      extras = [...extras, currency];
      if (adding === 'lost') throw new TypeError('Network request failed');
      return json(
        {
          status: 201,
          data: {
            mainCurrency: { code: group.defaultCurrency, locked: true },
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
      return json({ data: items.filter((entry) => ids.includes(entry.draft.id)).map(reviewed) });
    }
    if (path.endsWith('/drafts/save')) {
      const ids = (JSON.parse(String(init.body)).drafts as { id: string }[]).map(({ id }) => id);
      items = items.filter((entry) => !ids.includes(entry.draft.id));
      return json({
        data: ids.map((id) => ({ id, status: 'saved', expenseId: `e${id.slice(1)}` })),
      });
    }
    const one = items.find((entry) => path.endsWith(`/drafts/${entry.draft.id}`));
    if (path.includes('/drafts/') && ['PUT', 'DELETE'].includes(init.method ?? '')) {
      if (draftsOff)
        return json({ error: 'Drafts are not enabled', status: 404, code: 'DRAFTS_DISABLED' }, 404);
      if (!one)
        return json({ error: 'Draft not found', status: 404, code: 'DRAFT_NOT_FOUND' }, 404);
      if (init.method === 'DELETE') {
        items = items.filter((entry) => entry !== one);
        return json({ data: { id: one.draft.id } });
      }
      const draft = {
        ...one.draft,
        revision: one.draft.revision + 1,
        values: JSON.parse(String(init.body)).values,
      };
      items = items.map((entry) => (entry === one ? { ...entry, draft } : entry));
      return json({ data: draft });
    }
    if (path.endsWith('/drafts')) return json({ data: items.map((entry) => entry.draft) });
    if (path.endsWith('/activity'))
      return json({
        status: 200,
        data: { activities: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      });
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
  const drafts = memory(),
    requests = memory();
  let deviceHeld: Promise<void> | undefined;
  const list = drafts.list;
  drafts.list = async (account: string) => {
    await deviceHeld;
    return list(account);
  };
  const saved = new Map<string, unknown>();
  const makeController = () => {
    const controller = createMobileController(
      {
        apiBaseUrl: 'http://localhost:4433',
        authOrigin: 'http://localhost:4433',
        developmentPersonaEnabled: true,
      },
      {
        fetch,
        now: () => Date.parse(iso),
        newSubmissionKey: () => `fictional-433-${++operation}`,
        credentials: {
          load: async () => cookie,
          save: async (next) => void (cookie = next),
          clear: async () => void (cookie = null),
        },
        expenseDrafts: drafts,
        draftRequests: requests,
        groupCreations: {
          load: async () => structuredClone(creation),
          save: async (_account, value) => void (creation = structuredClone(value)),
          remove: async () => void (creation = null),
          clear: async () => undefined,
        },
        savedQueries: savedQueriesIn(saved),
        accountLocal: {
          owner: {
            load: async () => owner,
            save: async (next) => void (owner = next),
            clear: async () => void (owner = null),
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
    controller,
    restart: () => {
      controller.dispose();
      return makeController();
    },
    holdDevice: () => {
      const gate = latch();
      deviceHeld = gate.held;
      return gate.release;
    },
    disableDrafts: () => {
      draftsOff = true;
    },
    fail: (next: boolean) => {
      failing = next;
    },
    deny: () => {
      denied = true;
      groups = [];
    },
    allow: () => {
      denied = false;
      groups = [group];
    },
    hold: () => {
      const gate = latch();
      held = gate.held;
      return gate.release;
    },
    prepare: (count: number, complete = false) => {
      items = Array.from({ length: count }, (_, index) => item(index + 1, complete));
    },
    /** Dinner in Zürich, CHF 86.00, prepared by Claude, complete but in a currency not listed. */
    prepareInFrancs: () => {
      const entry = item(1, true);
      items = [
        {
          ...entry,
          draft: {
            ...entry.draft,
            values: {
              ...entry.draft.values,
              description: 'Dinner in Zürich',
              amount: 86,
              currency: 'CHF',
              paidBy: [{ user: user.id, amount: 86 }],
            },
          },
        },
      ];
    },
    /** The phone sent the add, and Splitbook added it, but the reply never came back. */
    loseAddReply: () => {
      adding = 'lost';
    },
    /** Another member added it, before this phone read the Group again. */
    addElsewhere: (currency: string) => {
      extras = [...extras, currency];
    },
    /** Reading the Group fails from now on, as the connection does. */
    failGroupReads: () => {
      groupReadsFail = true;
    },
    posted,
    extras: () => extras,
    draftValues: () => items.map((entry) => entry.draft.values),
    /** Saved or deleted on another screen or device. */
    removeElsewhere: (id: string) => {
      items = items.filter((entry) => entry.draft.id !== id);
    },
  };
}
/** A reply held until `release`. */
function latch() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  return { held, release };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function create(f: ReturnType<typeof fixture>) {
  f.controller.updateCreation({ name: 'Cabin Weekend', category: 'home', defaultCurrency: 'INR' });
  await f.controller.createGroup();
  await settle();
}

describe('To review stays current (#433)', () => {
  it('finishes a To review read that Home outdated while it was on its way', async () => {
    const f = fixture({ groups: false });
    const release = f.hold();
    await f.controller.signIn('alex');
    await settle();
    expect(f.controller.getSnapshot().toReview.status).toBe('loading');
    // Creating a Group outdates Home's reads while To review's read is still on its way.
    await create(f);
    release();
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 0 },
    });
  });

  it('reads To review again when Home is outdated, so items prepared meanwhile show', async () => {
    const f = fixture({ groups: false });
    await f.controller.signIn('alex');
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 0 },
    });
    f.prepare(2);
    await create(f);
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 2 },
    });
  });

  it('never shows a denied Group from a later read, until Home lists it again', async () => {
    const f = fixture();
    f.prepare(2);
    await f.controller.signIn('alex');
    await settle();
    expect(f.controller.getSnapshot().toReview.read.total).toBe(2);
    f.deny();
    await f.controller.openGroup(groupId);
    await f.controller.back();
    await settle();
    // The server's To review read still lists it (a read sent before the denial, or a lagging server).
    await f.controller.refresh();
    await settle();
    expect(f.controller.getSnapshot().toReview.read).toEqual({ total: 0, groups: [] });
    // Home lists it again only once the member creates or joins it again; so does To review.
    f.allow();
    await create(f);
    await settle();
    expect(f.controller.getSnapshot().toReview.read.total).toBe(2);
  });

  it('keeps To review as it was, never "Checking", while opening a Group reads it again', async () => {
    const f = fixture();
    f.prepare(2);
    await f.controller.signIn('alex');
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 2 },
    });
    f.prepare(3);
    const release = f.hold();
    await f.controller.openGroup(groupId);
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 2 },
    });
    release();
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 3 },
    });
  });

  it('finishes a To review read started at a cold start when the member opens a Group meanwhile', async () => {
    const f = fixture();
    f.prepare(2);
    await f.controller.signIn('alex');
    await settle();
    const restarted = f.restart();
    const release = f.hold();
    await restarted.restore();
    await settle();
    expect(restarted.getSnapshot().toReview.status).toBe('loading');
    // Opening the Group reads it and its Expenses, which outdates Home's reads (M1-5).
    await restarted.openGroup(groupId);
    await settle();
    release();
    await settle();
    expect(restarted.getSnapshot().toReview).toMatchObject({ status: 'ready', read: { total: 2 } });
  });

  it('keeps To review as it was when opening a Group outdates a Refresh Home on its way', async () => {
    const f = fixture();
    f.prepare(2);
    await f.controller.signIn('alex');
    await settle();
    f.prepare(3);
    const release = f.hold();
    const refreshing = f.controller.refresh();
    await settle();
    await f.controller.openGroup(groupId);
    await settle();
    expect(f.controller.getSnapshot().toReview.read.total).toBe(2);
    expect(f.controller.getSnapshot().toReview.status).not.toBe('idle');
    release();
    await refreshing;
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 3 },
    });
  });

  it('shows Try again after a failed first read as checking until it answers', async () => {
    const f = fixture();
    f.prepare(2);
    f.fail(true);
    await f.controller.signIn('alex');
    await settle();
    expect(f.controller.getSnapshot().toReview.status).toBe('error');
    f.fail(false);
    const release = f.hold();
    const retrying = f.controller.refreshToReview();
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({ status: 'loading', message: null });
    release();
    await retrying;
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 2 },
    });
  });

  it("Refresh Home reads To review without waiting for this phone's storage", async () => {
    const f = fixture();
    await f.controller.signIn('alex');
    await settle();
    f.prepare(2);
    const release = f.holdDevice();
    const refreshing = f.controller.refresh('pull');
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 2 },
    });
    release();
    await refreshing;
  });

  // The top bar's Refresh Home is a Retry, and Home's pull-to-refresh a pull.
  it.each(['retry', 'pull'] as const)(
    'Refresh Home (%s) reads To review again and shows items a Connected assistant prepared',
    async (origin) => {
      const f = fixture();
      await f.controller.signIn('alex');
      await settle();
      f.prepare(2);
      await f.controller.refresh(origin);
      await settle();
      expect(f.controller.getSnapshot().toReview).toMatchObject({
        status: 'ready',
        read: { total: 2 },
      });
    },
  );

  it.each(['retry', 'pull'] as const)(
    'a Group view refresh (%s) reads To review again, so its banner shows new items',
    async (origin) => {
      const f = fixture();
      await f.controller.signIn('alex');
      await settle();
      await f.controller.openGroup(groupId);
      await settle();
      f.prepare(2);
      await f.controller.refresh(origin);
      await settle();
      expect(f.controller.getSnapshot().screen).toBe('group');
      expect(f.controller.getSnapshot().toReview).toMatchObject({
        status: 'ready',
        read: { total: 2 },
      });
    },
  );

  it('opens a Group To review with its items without a manual refresh', async () => {
    const f = fixture();
    await f.controller.signIn('alex');
    await settle();
    f.prepare(2);
    await f.controller.openToReview(groupId);
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 2 },
    });
  });
});

describe("a Group's items in To review stay current (#436, #435)", () => {
  /** Signed in, on a Group's To review with its items read. */
  async function listed(options: { complete?: boolean } = {}) {
    const f = fixture();
    f.prepare(2, options.complete);
    await f.controller.signIn('alex');
    await settle();
    await f.controller.openToReview(groupId);
    const items = f.controller.draftCollection(groupId);
    closers.push(items.open());
    await settle();
    const ids = () => f.controller.getSnapshot().sharedDraftCollection.rows.map((row) => row.id);
    expect(ids()).toHaveLength(2);
    return { f, items, ids };
  }
  const closers: (() => void)[] = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
  });

  it('Refresh items reads the Group’s items again, so one saved elsewhere goes', async () => {
    const { f, ids } = await listed();
    const [first] = ids();
    f.removeElsewhere(first);
    await f.controller.refreshToReview();
    await settle();
    expect(ids()).not.toContain(first);
  });

  it('an item saved in the guided review is gone when Done returns to the list', async () => {
    const { f, ids } = await listed({ complete: true });
    const [, second] = ids();
    // Tapping an item opens the guided review at that item (#435).
    await f.controller.startReviewRun(groupId, second);
    expect(f.controller.getSnapshot().toReview.run?.items[0].item.draft.id).toBe(second);
    await f.controller.reviewRun()!.save();
    await settle();
    await f.controller.closeReviewRun();
    await settle();
    expect(ids()).toEqual([item(1).draft.id]);
  });

  it('deleting an item takes it off the list', async () => {
    const { f, items, ids } = await listed();
    const [first] = ids();
    await items.discard(f.controller.getSnapshot().sharedDraftCollection.rows[0]);
    expect(ids()).not.toContain(first);
  });
});

// #733, boards "To review: unlisted currency" and "change the currency": an item in a currency
// its Group doesn't list needs details, with the web's two fixes (#732).
describe('an item in a currency the Group doesn’t list (#733)', () => {
  const closers: (() => void)[] = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
  });
  /** Signed in, on Maple House's To review (INR, with EUR and JPY), Dinner in Zürich in francs. */
  async function inFrancs() {
    const f = fixture({ extras: ['EUR', 'JPY'] });
    f.prepareInFrancs();
    await f.controller.signIn('alex');
    await settle();
    await f.controller.openToReview(groupId);
    const items = f.controller.draftCollection(groupId);
    closers.push(items.open());
    await settle();
    const dinner = () => f.controller.toReviewModel(groupId).groups[0]?.items[0];
    return { f, items, dinner };
  }

  it('needs a currency the Group lists, and keeps the item and its amount as prepared', async () => {
    const { dinner } = await inFrancs();
    expect(dinner()).toMatchObject({
      state: 'needs-details',
      needs: [{ field: 'currency', reason: 'currency-not-listed' }],
      accountItem: { draft: { values: { amount: 86, currency: 'CHF' } } },
    });
  });

  it('adds the currency to the Group, and the item is then ready to save', async () => {
    const { f, dinner } = await inFrancs();
    expect(await f.controller.addGroupCurrency('CHF')).toBe(true);
    await settle();
    expect(f.posted).toEqual(['CHF']);
    expect(f.extras()).toEqual(['EUR', 'JPY', 'CHF']);
    expect(dinner()?.state).toBe('ready');
    expect(f.controller.getSnapshot().currencyAdd).toMatchObject({ status: 'idle', message: null });
  });

  // The Tester's lost-reply case on #732's web half, on Android: #722's addGroupCurrency reads
  // the Group again after any failure, and To review reads the item again after that.
  it('when the add’s reply is lost, the item is ready, with the currency listed', async () => {
    const { f, dinner } = await inFrancs();
    f.loseAddReply();
    expect(await f.controller.addGroupCurrency('CHF')).toBe(true);
    await settle();
    expect(f.posted).toEqual(['CHF']);
    expect(dinner()?.state).toBe('ready');
    expect(f.controller.getSnapshot().toReview.read.groups[0]?.alternateCurrencies).toContain(
      'CHF',
    );
    expect(f.controller.getSnapshot().currencyAdd).toMatchObject({ status: 'idle', message: null });
  });

  it('when the Group already lists it, as another member added it, the item is ready the same way', async () => {
    const { f, dinner } = await inFrancs();
    f.addElsewhere('CHF');
    expect(await f.controller.addGroupCurrency('CHF')).toBe(true);
    await settle();
    expect(f.posted).toEqual(['CHF']);
    expect(dinner()?.state).toBe('ready');
    expect(f.controller.getSnapshot().toReview.read.groups[0]?.alternateCurrencies).toContain(
      'CHF',
    );
    expect(f.controller.getSnapshot().currencyAdd).toMatchObject({ status: 'idle', message: null });
  });

  it('when reading the Group again fails too, the add’s own failure shows, and the item still needs a listed one', async () => {
    const { f, dinner } = await inFrancs();
    f.loseAddReply();
    f.failGroupReads();
    expect(await f.controller.addGroupCurrency('CHF')).toBe(false);
    await settle();
    expect(f.controller.getSnapshot().currencyAdd).toMatchObject({
      status: 'error',
      message: 'Could not reach Splitbook. Check your connection and try again.',
    });
    // The phone is offline now, so To review shows no account items; as last read, the item
    // still needs a listed currency.
    expect(f.controller.getSnapshot().toReview.read.groups[0]?.items[0]?.problems).toContain(
      'CURRENCY_NOT_LISTED',
    );
    expect(dinner()).toBeUndefined();
  });

  it('changes only the item’s currency to a listed one: the amount stays, nothing is converted', async () => {
    const { f, items, dinner } = await inFrancs();
    const draft = f.controller.getSnapshot().sharedDraftCollection.rows[0]!;
    await items.changeCurrency(draft, 'EUR');
    await settle();
    expect(f.draftValues()[0]).toMatchObject({ amount: 86, currency: 'EUR' });
    expect(f.posted).toEqual([]);
    expect(dinner()).toMatchObject({
      state: 'ready',
      accountItem: { draft: { values: { amount: 86, currency: 'EUR' } } },
    });
  });
});
