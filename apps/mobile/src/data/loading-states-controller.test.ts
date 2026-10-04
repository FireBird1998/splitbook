import { describe, expect, it, vi } from 'vitest';
import { refreshFeedback } from '../ui/refresh-feedback';
import { createMobileController } from './mobile-controller';
import type { FetchResponse, MobileSnapshot } from './types';

// #127: first load, refresh, offline and cold-start states at the controller's public seam.
const accountId = 'a00000000000000000000001',
  maple = 'b00000000000000000000001',
  lisbon = 'b00000000000000000000002',
  tagId = 'c00000000000000000000001';
const iso = '2026-09-28T12:00:00.000Z';
const user = { id: accountId, name: 'Alex', email: 'alex@example.test', image: null };
const group = (id: string, name: string, category: string) => ({
  _id: id,
  name,
  createdBy: accountId,
  category,
  defaultCurrency: 'INR',
  members: [{ user: { ...user, _id: accountId }, role: 'admin', joinedAt: iso }],
  tags: [{ _id: tagId, name: 'Food', createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
const groups = [group(maple, 'Maple House', 'home'), group(lisbon, 'Lisbon Offsite', 'work')];
const json = (body: unknown, status = 200) => Response.json(body, { status });

function fixture() {
  const clock = { now: Date.parse(iso) };
  const state = {
    offline: false,
    /** get-session: a session, none, an expired one, or an HTTP status. */
    session: 'valid' as 'valid' | 'none' | 'expired' | number,
    cleanup: false,
    /** The member has no Groups, so Home is empty. */
    noGroups: false,
    /** Activity has no events. */
    noActivity: false,
    /** A Group the member was removed from: the list leaves it out and its reads are refused. */
    removed: null as string | null,
    /** A Group archived on the web: the list leaves it out, but its members can still read it. */
    archived: null as string | null,
  };
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null;
  const cache = new Map<string, unknown>(),
    drafts = new Map<string, unknown>();
  const requests: string[] = [];
  const holds: {
    prefix: string;
    arrive: () => void;
    response: Promise<FetchResponse | Error | null>;
  }[] = [];
  /**
   * The next request whose path starts with `prefix` waits until released: with a response,
   * with an Error (the connection dropped before an answer), or with the usual answer.
   */
  const hold = (prefix: string) => {
    let arrive!: () => void;
    let release!: (response?: FetchResponse | Error) => void;
    const reached = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const response = new Promise<FetchResponse | Error | null>((resolve) => {
      release = (value) => resolve(value ?? null);
    });
    holds.push({ prefix, arrive, response });
    return { reached, release };
  };
  let clearing: Promise<void> | null = null;
  let retaining: { arrive: () => void; released: Promise<void> } | null = null;
  // Reads from this device, which can be slow on a phone: while `slow`, each waits for a round.
  const storage = { slow: false, waiting: [] as (() => void)[] };
  const read = <T>(value: () => T) =>
    storage.slow
      ? new Promise<T>((resolve) => storage.waiting.push(() => resolve(value())))
      : Promise.resolve(value());
  const respond = (path: string, init: RequestInit): FetchResponse => {
    if (path.endsWith('/sign-in'))
      return new Response(JSON.stringify({ user }), {
        headers: { 'Set-Cookie': 'better-auth.session_token=alex.signature; Max-Age=2592000' },
      });
    if (path === '/api/auth/get-session') {
      if (typeof state.session === 'number') return json({}, state.session);
      if (state.session === 'none') return json(null);
      return json({
        user,
        session: {
          userId: accountId,
          expiresAt:
            state.session === 'expired' ? '2020-01-01T00:00:00.000Z' : '2030-01-01T00:00:00Z',
        },
      });
    }
    if (path === '/api/groups')
      return json({
        status: 200,
        data: state.noGroups
          ? []
          : groups.filter((item) => item._id !== state.removed && item._id !== state.archived),
      });
    if (path === '/api/user/balances')
      return json({
        status: 200,
        data: {
          buckets: state.noGroups ? [] : [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }],
        },
      });
    const id = /^\/api\/groups\/([a-f\d]{24})/.exec(path)?.[1];
    if (id && id === state.removed) return json({}, 403);
    const found = groups.find((item) => item._id === id);
    if (!found) return json({}, 404);
    if (path === `/api/groups/${id}`) return json({ status: 200, data: found });
    if (path.endsWith('/balances'))
      return json({
        status: 200,
        data: { byCurrency: [{ currency: 'INR', balances: [], debts: [] }] },
      });
    if (path.endsWith('/expenses'))
      return json({
        status: 200,
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
        },
      });
    if (path.endsWith('/activity'))
      return json({
        status: 200,
        data: {
          activities: state.noActivity
            ? []
            : [
                {
                  _id: 'd00000000000000000000001',
                  group: id,
                  type: 'group_created',
                  actor: { _id: accountId, name: 'Alex' },
                  metadata: {},
                  createdAt: iso,
                },
              ],
          pagination: state.noActivity
            ? { page: 1, limit: 20, total: 0, totalPages: 0 }
            : { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      });
    if (path.endsWith('/invite-link') && init.method !== 'POST')
      return json({
        status: 200,
        data: {
          inviteCode: 'deadbeef',
          inviteUrl: 'http://localhost:4145/join/deadbeef',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      });
    throw new Error(`Unexpected request ${init.method} ${path}`);
  };
  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4145',
        authOrigin: 'http://localhost:4145',
        developmentPersonaEnabled: true,
      },
      {
        now: () => clock.now,
        newSubmissionKey: () => 'loading-states-test-0001',
        credentials: {
          load: () => read(() => cookie),
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        offlineIdentity: {
          load: () => read(() => structuredClone(identity)),
          save: async (value) => {
            identity = structuredClone(value);
          },
          clear: async () => {
            identity = null;
          },
        },
        readCache: {
          retainGroups: async (account, groupIds) => {
            const held = retaining;
            retaining = null;
            held?.arrive();
            await held?.released;
            // As on a phone: what was saved for a Group no longer listed goes.
            for (const key of [...cache.keys()]) {
              const id = /^\/api\/groups\/([a-f\d]{24})/.exec(key.slice(account.length))?.[1];
              if (key.startsWith(account) && id && !groupIds.includes(id)) cache.delete(key);
            }
          },
          invalidateGroup: async () => undefined,
          load: (account, key) => read(() => structuredClone(cache.get(account + key) ?? null)),
          save: async (account, key, value) => {
            cache.set(account + key, structuredClone(value));
          },
          clear: async () => {
            cache.clear();
          },
        },
        expenseDrafts: {
          load: (account, id) =>
            read(() => structuredClone(drafts.get(`${account}:${id}`) ?? null)),
          save: async (account, id, value) => {
            drafts.set(`${account}:${id}`, structuredClone(value));
          },
          remove: async (account, id) => {
            drafts.delete(`${account}:${id}`);
          },
          clear: async () => {
            drafts.clear();
          },
          list: (account) =>
            read(() =>
              [...drafts]
                .filter(([key]) => key.startsWith(`${account}:`))
                .map(([key, value]) => ({
                  groupId: key.split(':')[1],
                  value: structuredClone(value),
                })),
            ),
        },
        pendingInvitation: {
          load: () => read(() => null),
          save: async () => undefined,
          clear: async () => undefined,
        },
        accountLocal: {
          owner: {
            load: () => read(() => owner),
            save: async (value) => {
              owner = value;
            },
            clear: async () => {
              owner = null;
            },
          },
          cleanupMarker: {
            load: () => read(() => state.cleanup),
            mark: async () => {
              state.cleanup = true;
            },
            clear: async () => {
              state.cleanup = false;
            },
          },
          stores: [
            {
              clear: async () => {
                await clearing;
                cache.clear();
                drafts.clear();
                identity = null;
              },
            },
          ],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname;
          requests.push(path);
          if (state.offline) throw new Error('Offline');
          const index = holds.findIndex((item) => path.startsWith(item.prefix));
          if (index >= 0) {
            const [item] = holds.splice(index, 1);
            item.arrive();
            const response = await item.response;
            if (response instanceof Error) throw response;
            if (response) return response;
          }
          return respond(path, init);
        },
      },
    );
  return {
    clock,
    state,
    requests,
    hold,
    create,
    /** What this device has saved for the signed-in account's read of `path`, if anything. */
    saved: (path: string) => cache.get(accountId + path) ?? null,
    /** From now on, each read from this device waits for `answerReads`. */
    slowStorage: () => {
      storage.slow = true;
    },
    /** Answers the reads waiting now: one round. Returns how many there were. */
    answerReads: async () => {
      const answers = storage.waiting.splice(0);
      answers.forEach((answer) => answer());
      await new Promise((resolve) => setTimeout(resolve, 0));
      return answers.length;
    },
    /** Answers every read at once again. */
    fastStorage: () => {
      storage.slow = false;
      storage.waiting.splice(0).forEach((answer) => answer());
    },
    /** Account cleanup waits for this until it settles. */
    holdCleanup: () => {
      let release!: () => void;
      clearing = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        release();
        clearing = null;
      };
    },
    /** The next trim of this device's saved copies to the listed Groups waits until released. */
    holdRetain: () => {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      retaining = { arrive, released };
      return { reached, release };
    },
  };
}

/** Signs in, opens Maple House on Expenses, Balances and Activity, keeps a draft, then quits. */
async function previousSession(f: ReturnType<typeof fixture>) {
  const first = f.create();
  await first.signIn('alex');
  await first.openGroup(maple, true, 'balances');
  await first.openActivity(maple);
  await first.selectDestination('expenses');
  await first.openExpense(maple);
  await first.updateExpenseDraft({ description: 'Weekly groceries', amount: '12', tagId });
  await first.back();
  first.dispose();
  return f.clock.now;
}

/** Every snapshot published from now on. */
function record(controller: ReturnType<ReturnType<typeof fixture>['create']>) {
  const published: MobileSnapshot[] = [];
  controller.subscribe(() => published.push(controller.getSnapshot()));
  return published;
}

describe('cold start (#127 decision): the saved Home while the session is checked', () => {
  it('shows the saved Home after three rounds of reads from a slow device, then checks the session', async () => {
    const f = fixture();
    await previousSession(f);
    f.requests.length = 0;
    f.slowStorage();
    const check = f.hold('/api/auth/get-session');
    const restarted = f.create();
    const restoring = restarted.restore();
    let rounds = 0;
    while (restarted.getSnapshot().auth.user === null && rounds < 10) {
      await f.answerReads();
      rounds += 1;
    }
    // The sign-out cleanup marker first, then the session cookie and the saved Home together.
    expect(rounds).toBe(3);
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'restoring', user: { id: accountId } },
      groups: { data: [{ id: maple }, { id: lisbon }] },
      drafts: [{ groupId: maple }],
    });
    // Only the session check follows it.
    expect(f.requests).toEqual(['/api/auth/get-session']);
    f.fastStorage();
    await check.reached;
    check.release();
    await restoring;
    expect(restarted.getSnapshot().auth.status).toBe('authenticated');
  });

  it('shows the saved Home before the first request resolves', async () => {
    const f = fixture();
    const savedAt = await previousSession(f);
    f.requests.length = 0;
    // Whatever goes out first stays unanswered until the saved Home has been checked.
    const first = f.hold('/');
    const restarted = f.create();
    const restoring = restarted.restore();
    await first.reached;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.requests).toEqual(['/api/auth/get-session']);
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'restoring', user: { id: accountId } },
      groups: { data: [{ id: maple }, { id: lisbon }] },
      home: { refreshedAt: savedAt },
      drafts: [{ groupId: maple, description: 'Weekly groceries' }],
    });
    first.release();
    await restoring;
    expect(restarted.getSnapshot().auth.status).toBe('authenticated');
  });

  it('shows the last account’s saved Home, marked as checking, and sends nothing else until confirmed', async () => {
    const f = fixture();
    const savedAt = await previousSession(f);
    f.clock.now += 60 * 60_000;
    const check = f.hold('/api/auth/get-session');
    const restarted = f.create();
    const restoring = restarted.restore();
    await check.reached;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saved = restarted.getSnapshot();
    expect(saved).toMatchObject({
      auth: { status: 'restoring', user: { id: accountId } },
      screen: 'groups',
      groups: { data: [{ id: maple }, { id: lisbon }] },
      home: { data: [{ currency: 'INR', youOwe: 30 }], refreshedAt: savedAt },
      drafts: [{ groupId: maple, description: 'Weekly groceries' }],
      offline: { active: false },
    });
    expect(refreshFeedback(saved)).toMatchObject({
      checking: true,
      savedAt,
      quiet: false,
      progress: null,
    });

    // Nothing can be sent, or change the screen, before the session is confirmed.
    f.requests.length = 0;
    await Promise.all([
      restarted.openGroup(maple),
      restarted.openExpense(maple),
      restarted.refresh(),
      restarted.refresh('pull'),
      restarted.refresh('foreground'),
      restarted.refreshHome(),
    ]);
    restarted.startCreate();
    restarted.openSettings();
    expect(f.requests).toEqual([]);
    expect(restarted.getSnapshot()).toMatchObject({
      screen: 'groups',
      auth: { status: 'restoring' },
    });

    const published = record(restarted);
    check.release();
    await restoring;
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: accountId } },
      groups: { status: 'ready', data: [{ id: maple }, { id: lisbon }] },
      home: { status: 'ready', refreshedAt: f.clock.now },
    });
    // Replaced by the confirmed Home without ever blanking.
    expect(published.every((shown) => shown.groups.data.length === 2)).toBe(true);
    expect(published.every((shown) => shown.home.data !== null)).toBe(true);
  });

  it.each([
    ['signed out', 'none'],
    ['expired', 'expired'],
    ['revoked', 401],
  ] as const)('replaces the saved Home with sign-in when the session is %s', async (_, session) => {
    const f = fixture();
    await previousSession(f);
    const check = f.hold('/api/auth/get-session');
    const restarted = f.create();
    const restoring = restarted.restore();
    await check.reached;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(restarted.getSnapshot().auth.user?.id).toBe(accountId);

    f.state.session = session;
    f.requests.length = 0;
    check.release();
    await restoring;
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'signed-out', user: null },
      groups: { data: [] },
      home: { data: null },
      drafts: [],
    });
    expect(f.requests).toEqual([]);
  });

  it('replaces the saved Home with recovery when the session can’t be checked', async () => {
    const f = fixture();
    await previousSession(f);
    f.state.session = 503;
    const restarted = f.create();
    const published = record(restarted);
    await restarted.restore();
    expect(published.some((shown) => shown.auth.user?.id === accountId)).toBe(true);
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'error', user: null },
      groups: { data: [] },
      home: { data: null },
    });
  });

  it('never shows a saved Home while a sign-out cleanup is pending', async () => {
    const f = fixture();
    await previousSession(f);
    // This phone shows its saved Home at cold start...
    const check = f.hold('/api/auth/get-session');
    const shown = f.create();
    const showing = shown.restore();
    await check.reached;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown.getSnapshot().auth.user?.id).toBe(accountId);
    check.release();
    await showing;
    shown.dispose();

    // ...until a sign-out is interrupted after marking its cleanup: then never, not even
    // while that cleanup finishes first.
    f.state.cleanup = true;
    const release = f.holdCleanup();
    const restarted = f.create();
    const published = record(restarted);
    const restoring = restarted.restore();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(restarted.getSnapshot().auth).toMatchObject({ status: 'restoring', user: null });
    release();
    await restoring;
    expect(published.every((item) => item.auth.user === null && !item.groups.data.length)).toBe(
      true,
    );
    expect(restarted.getSnapshot().auth.status).toBe('signed-out');
  });

  it('keeps the saved Home when the check finds no connection, now marked offline', async () => {
    const f = fixture();
    const savedAt = await previousSession(f);
    f.state.offline = true;
    const restarted = f.create();
    const published = record(restarted);
    await restarted.restore();
    const shown = published.findIndex((item) => item.auth.user !== null);
    expect(published.slice(shown).every((item) => item.groups.data.length === 2)).toBe(true);
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated' },
      offline: { active: true, refreshedAt: savedAt },
      home: { data: [{ youOwe: 30 }], refreshedAt: savedAt },
    });
  });
});

describe('refresh feedback (#127)', () => {
  it('keeps a pull’s indicator on the destination it started on', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(maple, true, 'balances');
    const expenses = f.hold(`/api/groups/${maple}/expenses`);
    const pulling = controller.refresh('pull');
    await expenses.reached;
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({ pull: true, quiet: false });

    // Activity's own first load shows its progress bar, and no pull indicator.
    const activity = f.hold(`/api/groups/${maple}/activity`);
    const switching = controller.selectDestination('activity');
    await activity.reached;
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({
      pull: false,
      progress: 'Loading Activity',
    });
    activity.release();
    expenses.release();
    await Promise.all([pulling, switching]);
    expect(controller.getSnapshot().pull).toBeNull();
  });

  it('keeps an automatic refresh silent, while a retry says it is refreshing', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(maple);
    const verifiedAt = f.clock.now;
    f.clock.now += 31_000;
    const automatic = f.hold(`/api/groups/${maple}/expenses`);
    const foreground = controller.refresh('foreground');
    await automatic.reached;
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({
      quiet: false,
      silent: true,
      pull: false,
      progress: null,
    });
    automatic.release();
    await foreground;
    expect(controller.getSnapshot().automatic).toBeNull();

    const retry = f.hold(`/api/groups/${maple}/expenses`);
    const retrying = controller.refresh();
    await retry.reached;
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({
      quiet: true,
      silent: false,
      savedAt: f.clock.now,
    });
    expect(verifiedAt).toBeLessThan(f.clock.now);
    retry.release();
    await retrying;
  });

  it('says once that Home is updating after returning from a Group', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(maple);
    const home = f.hold('/api/user/balances');
    const back = controller.back();
    await home.reached;
    const state = controller.getSnapshot();
    // The Home figures' own label says they're updating; the header stays quiet.
    expect(state.home).toMatchObject({ status: 'loading', stale: true });
    expect(refreshFeedback(state).quiet).toBe(false);
    home.release();
    await back;
  });

  it('keeps an empty Home loaded: silent when refreshed automatically, refreshing when asked', async () => {
    const f = fixture();
    f.state.noGroups = true;
    const controller = f.create();
    // A first load still shows its one progress cue.
    const first = f.hold('/api/groups');
    const signingIn = controller.signIn('alex');
    await first.reached;
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({ progress: 'Loading Home' });
    first.release();
    await signingIn;
    expect(controller.getSnapshot().groups).toMatchObject({ status: 'ready', data: [] });

    f.clock.now += 31_000;
    const automatic = f.hold('/api/groups');
    const foreground = controller.refresh('foreground');
    await automatic.reached;
    expect(controller.getSnapshot().groups).toMatchObject({ status: 'loading', data: [] });
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({
      silent: true,
      quiet: false,
      progress: null,
    });
    automatic.release();
    await foreground;

    const asked = f.hold('/api/groups');
    const refreshing = controller.refresh();
    await asked.reached;
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({
      silent: false,
      quiet: true,
      progress: null,
    });
    asked.release();
    await refreshing;
  });

  it('keeps an empty Activity loaded: silent when refreshed automatically, refreshing when asked', async () => {
    const f = fixture();
    f.state.noActivity = true;
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(maple);
    const first = f.hold(`/api/groups/${maple}/activity`);
    const opening = controller.openActivity(maple);
    await first.reached;
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({
      progress: 'Loading Activity',
    });
    first.release();
    await opening;
    expect(controller.getSnapshot().activity).toMatchObject({ status: 'ready', events: [] });

    f.clock.now += 31_000;
    const automatic = f.hold(`/api/groups/${maple}/activity`);
    const foreground = controller.refresh('foreground');
    await automatic.reached;
    expect(controller.getSnapshot().activity).toMatchObject({ status: 'loading', events: [] });
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({
      silent: true,
      quiet: false,
      progress: null,
    });
    automatic.release();
    await foreground;

    const asked = f.hold(`/api/groups/${maple}/activity`);
    const refreshing = controller.refresh();
    await asked.reached;
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({
      silent: false,
      quiet: true,
      progress: 'Refreshing',
    });
    asked.release();
    await refreshing;
  });

  it('shows a first load with one progress cue and no quiet status', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const read = f.hold(`/api/groups/${lisbon}`);
    const opening = controller.openGroup(lisbon);
    await read.reached;
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({
      progress: 'Opening Lisbon Offsite',
      quiet: false,
    });
    read.release();
    await opening;
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({ progress: null });
  });
});

describe('writes need the Group known and a connection (#127)', () => {
  it('offers Invite while the Group refreshes', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(maple);
    f.clock.now += 31_000;
    const read = f.hold(`/api/groups/${maple}`);
    const refreshing = controller.refresh();
    await read.reached;
    expect(controller.getSnapshot().detail.status).toBe('loading');
    expect(await controller.loadInviteLink()).toBe('http://localhost:4145/join/deadbeef');
    read.release();
    await refreshing;
  });

  it('sends nothing for Invite or Save while offline', async () => {
    const f = fixture();
    await previousSession(f);
    f.state.offline = true;
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(maple);
    expect(restarted.getSnapshot().offline.active).toBe(true);
    f.requests.length = 0;
    expect(await restarted.loadInviteLink()).toBeNull();

    await restarted.openExpense(maple);
    restarted.resumeExpenseDraft();
    f.requests.length = 0;
    await restarted.saveExpense();
    expect(f.requests).toEqual([]);
    expect(restarted.getSnapshot().expense).toMatchObject({
      status: 'editing',
      attempt: null,
      draft: { description: 'Weekly groceries' },
    });
  });
});

describe('offline states (#127)', () => {
  it('shows each view’s saved time offline', async () => {
    const f = fixture();
    const savedAt = await previousSession(f);
    f.clock.now += 60 * 60_000;
    f.state.offline = true;
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(maple);
    expect(restarted.getSnapshot()).toMatchObject({
      offline: { active: true, refreshedAt: savedAt },
      detail: { refreshedAt: savedAt },
      financial: { expenses: { refreshedAt: savedAt }, balances: { refreshedAt: savedAt } },
    });
    await restarted.selectDestination('activity');
    expect(restarted.getSnapshot().activity).toMatchObject({
      status: 'ready',
      refreshedAt: savedAt,
    });
  });

  it('keeps a Group never opened here unavailable offline, with nothing loading', async () => {
    const f = fixture();
    await previousSession(f);
    f.state.offline = true;
    const restarted = f.create();
    await restarted.restore();
    await restarted.openGroup(lisbon);
    const state = restarted.getSnapshot();
    expect(state).toMatchObject({
      screen: 'group',
      offline: { active: true },
      detail: { status: 'error', id: lisbon, data: null },
    });
    expect(refreshFeedback(state)).toMatchObject({ progress: null, quiet: false });

    // Try again reads it once the connection is back.
    f.state.offline = false;
    await restarted.refresh();
    expect(restarted.getSnapshot().detail).toMatchObject({
      status: 'ready',
      data: { name: 'Lisbon Offsite' },
    });
  });
});

describe('Home after navigating while the Groups list loads (#190)', () => {
  /** Home shows no "Refreshing…", pull indicator or first-load placeholders. */
  const settled = (state: MobileSnapshot) =>
    expect(refreshFeedback(state)).toMatchObject({ pull: false, quiet: false, progress: null });

  it('publishes a list that lands after the member opened a Group, so Home is settled on return', async () => {
    // The #109 reproduction: pull Home, open a Group while the list loads, then go back.
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    const group = f.hold(`/api/groups/${maple}`);
    const opening = controller.openGroup(maple);
    await group.reached;
    // The list lands while the Group is still being read; both finish.
    list.release();
    await vi.waitFor(() => expect(controller.getSnapshot().groups.status).toBe('ready'));
    group.release();
    await Promise.all([opening, pulling]);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', id: maple },
      financial: { expenses: { status: 'ready' } },
      groups: { status: 'ready', data: [{ name: 'Maple House' }, { name: 'Lisbon Offsite' }] },
    });

    f.requests.length = 0;
    await controller.back();
    const home = controller.getSnapshot();
    expect(home).toMatchObject({ screen: 'groups', groups: { status: 'ready' } });
    settled(home);
    // The list already answered, so nothing reads it again.
    expect(f.requests).not.toContain('/api/groups');
  });

  it('settles Home when the list lands after the member came back from a Group', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    // Home's figures are no longer recent, so going back reads them too.
    f.clock.now += 31_000;
    f.requests.length = 0;
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    await controller.openGroup(maple);
    const figures = f.hold('/api/user/balances');
    const back = controller.back();
    await figures.reached;
    // Still in flight: Home shows the pull it started with.
    expect(controller.getSnapshot().groups.status).toBe('loading');
    expect(refreshFeedback(controller.getSnapshot()).pull).toBe(true);
    // The list lands while Home's figures are still being read; both finish.
    list.release();
    await vi.waitFor(() => expect(controller.getSnapshot().groups.status).toBe('ready'));
    figures.release();
    await Promise.all([back, pulling]);
    const home = controller.getSnapshot();
    expect(home).toMatchObject({
      screen: 'groups',
      groups: { status: 'ready', data: [{ name: 'Maple House' }, { name: 'Lisbon Offsite' }] },
      home: { status: 'ready', stale: false },
    });
    settled(home);
    expect(f.requests.filter((path) => path === '/api/groups')).toHaveLength(1);
  });

  it('ends a first sign-in with the Groups shown after the member opened New Group during the load', async () => {
    const f = fixture();
    const controller = f.create();
    const list = f.hold('/api/groups');
    const signingIn = controller.signIn('alex');
    await list.reached;
    expect(refreshFeedback(controller.getSnapshot())).toMatchObject({ progress: 'Loading Home' });
    controller.startCreate();
    expect(controller.getSnapshot().screen).toBe('create');
    list.release();
    await signingIn;

    await controller.back();
    const home = controller.getSnapshot();
    expect(home).toMatchObject({
      screen: 'groups',
      groups: {
        status: 'ready',
        loaded: true,
        data: [{ name: 'Maple House' }, { name: 'Lisbon Offsite' }],
      },
      home: { status: 'ready' },
    });
    settled(home);
  });

  it('reads the list again when its answer predates losing a Group, so that Group never returns', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    // Alex is removed from Lisbon Offsite after the server answered the list.
    f.state.removed = lisbon;
    await controller.openGroup(lisbon);
    expect(controller.getSnapshot().detail).toMatchObject({ status: 'denied', id: lisbon });
    const published = record(controller);
    f.requests.length = 0;
    list.release(json({ status: 200, data: groups }));
    await pulling;
    expect(f.requests).toContain('/api/groups');
    expect(controller.getSnapshot().groups).toMatchObject({
      status: 'ready',
      data: [{ name: 'Maple House' }],
    });
    expect(published.some((state) => state.groups.data.some(({ id }) => id === lisbon))).toBe(
      false,
    );

    await controller.back();
    expect(controller.getSnapshot().groups).toMatchObject({
      status: 'ready',
      data: [{ name: 'Maple House' }],
    });
    settled(controller.getSnapshot());
  });

  it('never shows a list answered before losing a Group, even one that answered first', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    // The list answers, then waits while this device trims its saved copies to the listed Groups.
    const trim = f.holdRetain();
    const pulling = controller.refresh('pull');
    await trim.reached;
    // Meanwhile Alex opens Lisbon Offsite and is refused: Alex was removed from it.
    f.state.removed = lisbon;
    const opening = controller.openGroup(lisbon);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().groups.data.map(({ id }) => id)).toEqual([maple]),
    );
    const published = record(controller);
    f.requests.length = 0;
    trim.release();
    await Promise.all([opening, pulling]);
    expect(controller.getSnapshot().detail).toMatchObject({ status: 'denied', id: lisbon });
    expect(published.some((state) => state.groups.data.some(({ id }) => id === lisbon))).toBe(
      false,
    );

    await controller.back();
    expect(f.requests).toContain('/api/groups');
    expect(controller.getSnapshot().groups).toMatchObject({
      status: 'ready',
      data: [{ name: 'Maple House' }],
    });
    settled(controller.getSnapshot());
  });

  it('keeps nothing saved for a Group the list leaves out, even from a read of it landing later', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    // Lisbon Offsite is archived on the web: the list leaves it out, though it can still be read.
    f.state.archived = lisbon;
    const group = f.hold(`/api/groups/${lisbon}`);
    const opening = controller.openGroup(lisbon);
    await group.reached;
    list.release();
    await vi.waitFor(() => expect(controller.getSnapshot().groups.status).toBe('ready'));
    group.release();
    await Promise.all([opening, pulling]);
    expect(controller.getSnapshot().groups.data.map(({ name }) => name)).toEqual(['Maple House']);
    expect(f.saved(`/api/groups/${lisbon}`)).toBeNull();
  });

  it('shows a list that fell back to its saved copy while a Group was open with its saved time', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const savedAt = f.clock.now;
    f.clock.now += 60 * 60_000;
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    await controller.openGroup(maple);
    // The connection drops before the list answers.
    list.release(new Error('Network request failed'));
    await pulling;

    await controller.back();
    const home = controller.getSnapshot();
    expect(home).toMatchObject({
      screen: 'groups',
      groups: { status: 'ready', data: [{ name: 'Maple House' }, { name: 'Lisbon Offsite' }] },
      // Never shown as fresher than the saved copy it came from.
      offline: { active: true, refreshedAt: savedAt },
    });
    settled(home);
  });

  it('reads the list again on return when its read ended without an answer', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    // Lisbon Offsite is refused, which drops what was saved for it. Then the list's connection
    // drops, so its saved copy can't stand in for an answer.
    f.state.removed = lisbon;
    await controller.openGroup(lisbon);
    list.release(new Error('Network request failed'));
    await pulling;

    f.requests.length = 0;
    await controller.back();
    expect(f.requests).toContain('/api/groups');
    const home = controller.getSnapshot();
    expect(home).toMatchObject({
      screen: 'groups',
      groups: { status: 'ready', data: [{ name: 'Maple House' }] },
    });
    settled(home);
  });

  it('reads the list again at once when its read ends without an answer while Home shows', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    // Alex opens Lisbon Offsite and goes back before it answers.
    const opened = f.hold(`/api/groups/${lisbon}`);
    const opening = controller.openGroup(lisbon);
    await opened.reached;
    await controller.back();
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    // Lisbon Offsite is refused while Home refreshes, then the list's connection drops.
    f.state.removed = lisbon;
    opened.release(json({}, 403));
    await opening;
    f.requests.length = 0;
    list.release(new Error('Network request failed'));
    await pulling;

    expect(f.requests).toContain('/api/groups');
    const home = controller.getSnapshot();
    expect(home).toMatchObject({
      screen: 'groups',
      groups: { status: 'ready', data: [{ name: 'Maple House' }] },
    });
    settled(home);
  });
});
