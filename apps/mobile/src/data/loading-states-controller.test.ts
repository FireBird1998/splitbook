import { describe, expect, it, vi } from 'vitest';
import { currentMonthKey, getLocalMonthIsoRange, shiftMonthKey } from '@splitbook/shared/date';
import { refreshFeedback } from '../ui/refresh-feedback';
import { createMobileController } from './mobile-controller';
import type { FetchResponse, MobileSnapshot } from './types';
import { savedQueriesIn } from '../test-utils/saved-queries';

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
    /** A Group deleted on the web: the list leaves it out and every read of it is not found. */
    deleted: null as string | null,
    /** Groups created through this fixture's server, listed after the seed Groups. */
    created: [] as ReturnType<typeof group>[],
  };
  /** The Groups the server holds, and those it lists for the member. */
  const known = () => [...groups, ...state.created];
  const listed = () =>
    state.noGroups
      ? []
      : known().filter(({ _id }) => ![state.removed, state.archived, state.deleted].includes(_id));
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null;
  const cache = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    // A Group submission is sent only once this device holds it (#203).
    creations = new Map<string, unknown>();
  const requests: string[] = [];
  /** Every request as its method and path, with any query, in the order sent. */
  const calls: string[] = [];
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
  /** The Groups this device last kept saved copies for. */
  let retained: string[] = [];
  let saving: { path: string; arrive: () => void; released: Promise<void> } | null = null;
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
    if (path === '/api/groups' && init.method === 'POST') {
      const { name, category } = JSON.parse(String(init.body)) as Record<string, string>;
      const made = group(
        `b${String(100 + state.created.length).padStart(23, '0')}`,
        name,
        category,
      );
      state.created.push(made);
      return json({ status: 201, data: made }, 201);
    }
    if (path === '/api/groups') return json({ status: 200, data: listed() });
    // As Better Auth does: 200, even for a session already gone (#202).
    if (path === '/api/auth/sign-out' && init.method === 'POST') return json({ success: true });
    if (path === '/api/user/balances')
      return json({
        status: 200,
        data: {
          buckets: state.noGroups ? [] : [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }],
        },
      });
    const id = /^\/api\/groups\/([a-f\d]{24})/.exec(path)?.[1];
    if (path === `/api/groups/${id}/leave` && init.method === 'POST') {
      state.removed = id ?? null;
      return json({ data: { message: 'Left group', archived: false }, status: 200 });
    }
    if (id && id === state.removed) return json({}, 403);
    if (id && id === state.deleted) return json({}, 404);
    const found = known().find((item) => item._id === id);
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
        // The persister's rows sit beside the other saved copies, read and held the same way.
        savedQueries: savedQueriesIn(cache, {
          load: (account, key) => read(() => structuredClone(cache.get(account + key) ?? null)),
          save: async (account, key, value) => {
            const held = saving?.path === key ? saving : null;
            if (held) {
              saving = null;
              held.arrive();
              await held.released;
            }
            cache.set(account + key, structuredClone(value));
          },
        }),
        readCache: {
          retainGroups: async (account, groupIds) => {
            const held = retaining;
            retaining = null;
            held?.arrive();
            await held?.released;
            // As on a phone: what was saved for a Group no longer listed goes, with Home's figures.
            if (retained.some((id) => !groupIds.includes(id)))
              cache.delete(`${account}/api/user/balances`);
            retained = [...groupIds];
            for (const key of [...cache.keys()]) {
              const id = /^\/api\/groups\/([a-f\d]{24})/.exec(key.slice(account.length))?.[1];
              if (key.startsWith(account) && id && !groupIds.includes(id)) cache.delete(key);
            }
          },
          // As on a phone: the Group's saved copies go, with the saved list and Home's figures.
          invalidateGroup: async (account, id) => {
            for (const key of [...cache.keys()])
              if (
                key.startsWith(`${account}/api/groups/${id}`) ||
                key === `${account}/api/groups` ||
                key === `${account}/api/user/balances`
              )
                cache.delete(key);
          },
          // As on a phone: a change's Group keeps its own saved copy and the saved list.
          invalidateLedger: async (account, id) => {
            for (const key of [...cache.keys()])
              if (
                key.startsWith(`${account}/api/groups/${id}/`) ||
                key.startsWith(`${account}/api/groups/${id}?`) ||
                key === `${account}/api/user/balances`
              )
                cache.delete(key);
          },
          load: (account, key) => read(() => structuredClone(cache.get(account + key) ?? null)),
          save: async (account, key, value) => {
            const held = saving?.path === key ? saving : null;
            if (held) {
              saving = null;
              held.arrive();
              await held.released;
            }
            cache.set(account + key, structuredClone(value));
          },
          clear: async () => {
            cache.clear();
            retained = [];
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
        groupCreations: {
          load: (account) => read(() => structuredClone(creations.get(account) ?? null)),
          save: async (account, value) => {
            creations.set(account, structuredClone(value));
          },
          remove: async (account) => {
            creations.delete(account);
          },
          clear: async () => {
            creations.clear();
          },
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
                retained = [];
                drafts.clear();
                creations.clear();
                identity = null;
              },
            },
          ],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname;
          requests.push(path);
          calls.push(`${init.method ?? 'GET'} ${path}${new URL(url).search}`);
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
    calls,
    hold,
    create,
    /** What this device has saved for the signed-in account's read of `path`, if anything. */
    saved: (path: string) => cache.get(accountId + path) ?? null,
    /** Removes what this device saved for `path`, as a cleanup after a denial does. */
    unsave: (path: string) => cache.delete(accountId + path),
    /** Every path this device has saved a read of for the signed-in account. */
    savedPaths: () =>
      [...cache.keys()]
        .filter((key) => key.startsWith(accountId))
        .map((key) => key.slice(accountId.length)),
    /** The next save of `path` to this device waits until released. */
    holdSave: (path: string) => {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      saving = { path, arrive, released };
      return { reached, release };
    },
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
    // A 500, a server fault: an uncoded 503 now counts as can't reach the server (#231).
    f.state.session = 500;
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
  /** Home's figures are read, and nothing says Home is refreshing, pulling or first loading. */
  const settled = (state: MobileSnapshot) => {
    expect(state.home.status).toBe('ready');
    expect(refreshFeedback(state)).toMatchObject({ pull: false, quiet: false, progress: null });
  };
  /** What the figures saved on this device say Alex owes, if any are saved. */
  const savedOwe = (f: ReturnType<typeof fixture>) =>
    (f.saved('/api/user/balances') as { value: { data: { buckets: { youOwe: number }[] } } } | null)
      ?.value.data.buckets[0]?.youOwe ?? null;
  /** Figures worked out by the server before a Group left the list. */
  const olderFigures = () =>
    json({ status: 200, data: { buckets: [{ currency: 'INR', youOwe: 99, youAreOwed: 0 }] } });
  /** Home lists this Group. */
  const lists = (state: MobileSnapshot, id: string) =>
    state.groups.data.some((item) => item.id === id);

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
    // The list kept every Group, so the Group's read is saved for offline use as usual.
    expect(f.saved(`/api/groups/${maple}`)).not.toBeNull();

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
    });
    settled(home);
  });

  it('keeps loading a Group opened while the list leaves out another one', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    // Lisbon Offsite is archived on the web while Alex opens Maple House.
    f.state.archived = lisbon;
    const group = f.hold(`/api/groups/${maple}`);
    const opening = controller.openGroup(maple);
    await group.reached;
    list.release();
    await vi.waitFor(() => expect(controller.getSnapshot().groups.status).toBe('ready'));
    group.release();
    await Promise.all([opening, pulling]);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', id: maple },
      financial: { expenses: { status: 'ready' } },
      groups: { status: 'ready', data: [{ name: 'Maple House' }] },
    });
  });

  it('keeps loading a Group opened while another Group refuses the member', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    // Alex opens Lisbon Offsite and goes back before it answers, then opens Maple House.
    const refused = f.hold(`/api/groups/${lisbon}`);
    const lisbonOpening = controller.openGroup(lisbon);
    await refused.reached;
    await controller.back();
    const group = f.hold(`/api/groups/${maple}`);
    const opening = controller.openGroup(maple);
    await group.reached;
    // Lisbon Offsite refuses Alex while Maple House is still being read.
    f.state.removed = lisbon;
    refused.release(json({}, 403));
    await lisbonOpening;
    group.release();
    await opening;
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', id: maple },
      financial: { expenses: { status: 'ready' } },
    });
  });

  it.each([
    ['one Home listed', false],
    ['one opened from elsewhere that Home never listed', true],
  ])(
    'settles a Group the list leaves out while it is read (%s), showing only what was read after',
    async (_, unlisted) => {
      const f = fixture();
      // Lisbon Offsite is archived on the web: the list leaves it out, though Alex can still read it.
      if (unlisted) f.state.archived = lisbon;
      const controller = f.create();
      await controller.signIn('alex');
      const list = f.hold('/api/groups');
      const pulling = controller.refresh('pull');
      await list.reached;
      f.state.archived = lisbon;
      const group = f.hold(`/api/groups/${lisbon}`);
      const opening = controller.openGroup(lisbon);
      await group.reached;
      list.release();
      await vi.waitFor(() => expect(controller.getSnapshot().groups.status).toBe('ready'));
      const published = record(controller);
      // Its answer was read before the list left it out, under an earlier name.
      group.release(json({ status: 200, data: { ...groups[1], name: 'Lisbon Offsite 2025' } }));
      await Promise.all([opening, pulling]);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'group',
        detail: { status: 'ready', id: lisbon, data: { name: 'Lisbon Offsite' } },
        financial: { expenses: { status: 'ready' } },
        groups: { data: [{ name: 'Maple House' }] },
      });
      expect(published.some((state) => state.detail.data?.name === 'Lisbon Offsite 2025')).toBe(
        false,
      );
      // It shows, as the server still serves it, but nothing is saved while the list leaves it out.
      expect(f.savedPaths().filter((path) => path.includes(lisbon))).toEqual([]);
    },
  );

  it('shows an archived Group opened from elsewhere without saving it', async () => {
    const f = fixture();
    // Lisbon Offsite is archived on the web, so Home never lists it; Alex can still open it.
    f.state.archived = lisbon;
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(lisbon);
    expect(controller.getSnapshot()).toMatchObject({
      detail: { status: 'ready', data: { name: 'Lisbon Offsite' } },
      financial: { expenses: { status: 'ready' } },
    });
    expect(f.savedPaths().filter((path) => path.includes(lisbon))).toEqual([]);
    // Maple House, which the list holds, is saved as usual.
    await controller.openGroup(maple);
    expect(f.saved(`/api/groups/${maple}`)).not.toBeNull();
  });

  it('forgets a Group whose answer no longer lists the member, with what was saved for it', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(lisbon);
    await controller.back();
    expect(f.saved(`/api/groups/${lisbon}`)).not.toBeNull();
    f.clock.now += 31_000;
    const group = f.hold(`/api/groups/${lisbon}`);
    const opening = controller.openGroup(lisbon);
    await group.reached;
    // The server answers with Lisbon Offsite as it is now: Sam is its only member.
    const sam = {
      _id: 'a00000000000000000000002',
      name: 'Sam',
      email: 'sam@example.test',
      image: null,
    };
    group.release(
      json({
        status: 200,
        data: { ...groups[1], members: [{ user: sam, role: 'admin', joinedAt: iso }] },
      }),
    );
    await opening;
    expect(controller.getSnapshot()).toMatchObject({
      detail: { status: 'denied', id: lisbon, data: null },
      groups: { data: [{ name: 'Maple House' }] },
    });
    expect(f.savedPaths().filter((path) => path.includes(lisbon))).toEqual([]);
  });

  it('never shows a Group’s saved copy once the list has left it out, even one being read then', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    // Lisbon Offsite was opened here, so it has a saved copy.
    await controller.openGroup(lisbon);
    await controller.back();
    f.clock.now += 31_000;
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    const group = f.hold(`/api/groups/${lisbon}`);
    const opening = controller.openGroup(lisbon);
    await group.reached;
    const published = record(controller);
    // Alex is removed from Lisbon Offsite. The list answers without it and is being saved...
    f.state.removed = lisbon;
    const saving = f.holdSave('/api/groups');
    list.release();
    await saving.reached;
    // ...when the connection drops for Lisbon Offsite, whose saved copy is then read slowly.
    f.slowStorage();
    group.release(new Error('Network request failed'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    saving.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (let round = 0; round < 5; round += 1) await f.answerReads();
    f.fastStorage();
    await Promise.all([opening, pulling]);
    // Its saved copy is never shown after the list left it out; reading it again is refused.
    expect(
      published.some(
        (state) =>
          state.groups.status === 'ready' &&
          !lists(state, lisbon) &&
          state.detail.id === lisbon &&
          state.detail.status === 'ready',
      ),
    ).toBe(false);
    expect(controller.getSnapshot().detail).toMatchObject({ status: 'denied', id: lisbon });
  });

  it('settles Home’s figures when the list leaves out a Group only Home was showing', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    f.clock.now += 31_000;
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    await controller.openGroup(maple);
    // Lisbon Offsite, never opened here, is archived on the web while Home's figures are read.
    f.state.archived = lisbon;
    const figures = f.hold('/api/user/balances');
    const back = controller.back();
    await figures.reached;
    list.release();
    await vi.waitFor(() => expect(controller.getSnapshot().groups.status).toBe('ready'));
    figures.release(olderFigures());
    await Promise.all([back, pulling]);
    const home = controller.getSnapshot();
    expect(home).toMatchObject({
      groups: { status: 'ready', data: [{ name: 'Maple House' }] },
      home: { status: 'ready', stale: false, data: [{ youOwe: 30 }] },
    });
    settled(home);
    expect(savedOwe(f)).toBe(30);
  });

  it('reads Home’s figures again when a session’s first list leaves out a Group this device kept', async () => {
    const f = fixture();
    // An earlier session kept both Groups here; the saved list itself has since been removed.
    const earlier = f.create();
    await earlier.signIn('alex');
    earlier.dispose();
    f.unsave('/api/groups');
    // Lisbon Offsite is archived on the web before Alex signs in again.
    f.state.archived = lisbon;
    const controller = f.create();
    const list = f.hold('/api/groups');
    const signingIn = controller.signIn('alex');
    await list.reached;
    controller.startCreate();
    const figures = f.hold('/api/user/balances');
    const back = controller.back();
    await figures.reached;
    list.release();
    await vi.waitFor(() => expect(controller.getSnapshot().groups.status).toBe('ready'));
    figures.release(olderFigures());
    await Promise.all([back, signingIn]);
    expect(controller.getSnapshot().home).toMatchObject({ data: [{ youOwe: 30 }] });
    settled(controller.getSnapshot());
    expect(savedOwe(f)).toBe(30);
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
    expect(published.some((state) => lists(state, lisbon))).toBe(false);

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
    expect(published.some((state) => lists(state, lisbon))).toBe(false);

    // That answer was dropped on the Group, so going back reads the list.
    await controller.back();
    expect(f.requests).toContain('/api/groups');
    expect(controller.getSnapshot().groups).toMatchObject({
      status: 'ready',
      data: [{ name: 'Maple House' }],
    });
    settled(controller.getSnapshot());
  });

  it('never brings back a Group found deleted while a list answered before that was on its way', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    await controller.openGroup(lisbon);
    expect(controller.getSnapshot().detail.status).toBe('ready');
    // Lisbon Offsite is deleted on the web; reading its Balances again finds it gone.
    f.state.deleted = lisbon;
    await controller.refreshBalances();
    expect(controller.getSnapshot().groups.data.map(({ name }) => name)).toEqual(['Maple House']);
    const published = record(controller);
    // The list answered before the deletion.
    list.release(json({ status: 200, data: groups }));
    await pulling;
    await controller.back();
    expect(published.some((state) => lists(state, lisbon))).toBe(false);
    expect(controller.getSnapshot().groups).toMatchObject({
      status: 'ready',
      data: [{ name: 'Maple House' }],
    });
    expect(f.saved(`/api/groups/${lisbon}`)).toBeNull();
    settled(controller.getSnapshot());
  });

  it('reads the list again when a refused Group overtakes the saved copy standing in for it', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    // Lisbon Offsite refuses Alex, which drops what was saved for it. Then the list's connection
    // drops, so its saved copy, which may predate the refusal, can't stand in for an answer.
    f.state.removed = lisbon;
    await controller.openGroup(lisbon);
    f.requests.length = 0;
    list.release(new Error('Network request failed'));
    await pulling;
    // So it is read again at once, on the Group.
    expect(f.requests).toContain('/api/groups');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      groups: { status: 'ready', data: [{ name: 'Maple House' }] },
    });

    f.requests.length = 0;
    await controller.back();
    expect(f.requests).not.toContain('/api/groups');
    settled(controller.getSnapshot());
  });

  it('reads the list again at once when its answer is overtaken while Home shows', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    // Alex opens Lisbon Offsite and goes back before it answers.
    const opened = f.hold(`/api/groups/${lisbon}`);
    const opening = controller.openGroup(lisbon);
    await opened.reached;
    await controller.back();
    // The list answers, then waits while this device trims its saved copies.
    const trim = f.holdRetain();
    const pulling = controller.refresh('pull');
    await trim.reached;
    // Meanwhile Lisbon Offsite refuses Alex, so the list's answer is out of date.
    f.state.removed = lisbon;
    opened.release(json({}, 403));
    await vi.waitFor(() =>
      expect(controller.getSnapshot().groups.data.map(({ id }) => id)).toEqual([maple]),
    );
    f.requests.length = 0;
    trim.release();
    await Promise.all([opening, pulling]);
    expect(f.requests).toContain('/api/groups');
    const home = controller.getSnapshot();
    expect(home).toMatchObject({
      screen: 'groups',
      groups: { status: 'ready', data: [{ name: 'Maple House' }] },
    });
    settled(home);
  });

  it('reads the list again when New Group is discarded after the list ended without an answer', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const opened = f.hold(`/api/groups/${lisbon}`);
    const opening = controller.openGroup(lisbon);
    await opened.reached;
    await controller.back();
    const trim = f.holdRetain();
    const pulling = controller.refresh('pull');
    await trim.reached;
    // Alex opens New Group; meanwhile Lisbon Offsite refuses Alex, so the list's answer is dropped.
    controller.startCreate();
    f.state.removed = lisbon;
    opened.release(json({}, 403));
    await vi.waitFor(() =>
      expect(controller.getSnapshot().groups.data.map(({ id }) => id)).toEqual([maple]),
    );
    trim.release();
    await Promise.all([opening, pulling]);
    expect(controller.getSnapshot().screen).toBe('create');

    f.requests.length = 0;
    await controller.discardCreation();
    expect(f.requests).toContain('/api/groups');
    const home = controller.getSnapshot();
    expect(home).toMatchObject({
      screen: 'groups',
      groups: { status: 'ready', data: [{ name: 'Maple House' }] },
    });
    settled(home);
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

  it.each([
    ['discarding New Group', 'create'],
    ['closing an invitation', 'invite'],
  ] as const)(
    'shows a list that fell back to its saved copy with its saved time after %s',
    async (_, screen) => {
      const f = fixture();
      const controller = f.create();
      await controller.signIn('alex');
      const savedAt = f.clock.now;
      f.clock.now += 60 * 60_000;
      const list = f.hold('/api/groups');
      const pulling = controller.refresh('pull');
      await list.reached;
      if (screen === 'create') controller.startCreate();
      else await controller.openInvitation('https://wrong-origin.test/invalid');
      expect(controller.getSnapshot().screen).toBe(screen);
      list.release(new Error('Network request failed'));
      await pulling;

      if (screen === 'create') await controller.discardCreation();
      else await controller.cancelInvitation();
      const home = controller.getSnapshot();
      expect(home).toMatchObject({
        screen: 'groups',
        groups: { status: 'ready', data: [{ name: 'Maple House' }, { name: 'Lisbon Offsite' }] },
        offline: { active: true, refreshedAt: savedAt },
      });
      settled(home);
    },
  );

  it('shows a list neither read nor saved here as a failure, and does not read it again', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    // Nothing is saved for the list on this device any more.
    f.unsave('/api/groups');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    await controller.openGroup(maple);
    list.release(new Error('Network request failed'));
    await pulling;
    expect(controller.getSnapshot().groups).toMatchObject({
      status: 'error',
      message: 'This view was not saved on this device. Connect to load it.',
    });

    f.requests.length = 0;
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      groups: { status: 'error', data: [{ name: 'Maple House' }, { name: 'Lisbon Offsite' }] },
    });
    settled(controller.getSnapshot());
    expect(f.requests).not.toContain('/api/groups');
  });

  it('shows a server failure for a list that lands while a Group is open, and does not read it again', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    await controller.openGroup(maple);
    list.release(json({ error: 'Internal error', status: 500 }, 500));
    await pulling;
    expect(controller.getSnapshot().groups).toMatchObject({
      status: 'error',
      message: 'The server could not complete this request. Please try again.',
    });

    f.requests.length = 0;
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      groups: { status: 'error', data: [{ name: 'Maple House' }, { name: 'Lisbon Offsite' }] },
    });
    settled(controller.getSnapshot());
    expect(f.requests).not.toContain('/api/groups');
  });

  it('drops a list that lands after signing out from a Group', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    await controller.openGroup(maple);
    await controller.signOut();
    const published = record(controller);
    list.release();
    await pulling;
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'signed-out', user: null },
      groups: { data: [] },
    });
    expect(published.some((state) => state.groups.data.length > 0)).toBe(false);
    expect(f.saved('/api/groups')).toBeNull();
  });

  it('keeps a Group created while the list loads, whichever answers first', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    controller.startCreate();
    controller.updateCreation({ name: 'Cabin Weekend' });
    await controller.createGroup();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { data: { name: 'Cabin Weekend' } },
    });
    const published = record(controller);
    // The list answered before the Group was created.
    list.release(json({ status: 200, data: groups }));
    await pulling;
    expect(
      published.every((state) => state.groups.data.some(({ name }) => name === 'Cabin Weekend')),
    ).toBe(true);

    await controller.back();
    expect(controller.getSnapshot().groups).toMatchObject({
      status: 'ready',
      data: [{ name: 'Maple House' }, { name: 'Lisbon Offsite' }, { name: 'Cabin Weekend' }],
    });
    settled(controller.getSnapshot());
  });

  it('saves a Group created since the latest list, like any listed Group', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Cabin Weekend' });
    await controller.createGroup();
    const created = controller.getSnapshot().detail.id;
    // Reading the new Group again saves it for offline use, as its reads did when it opened,
    // before the list read after the create listed it (#283).
    await controller.refresh();
    expect(controller.getSnapshot().detail).toMatchObject({ status: 'ready', id: created });
    expect(f.saved(`/api/groups/${created}`)).not.toBeNull();
  });

  it('keeps a Group left while the list loads off Home, whichever answers first', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const list = f.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    await controller.openGroup(lisbon);
    controller.openMembers();
    await controller.reviewLeaveGroup();
    expect(controller.getSnapshot().leave.status).toBe('confirm');
    await controller.leaveGroup();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      homeSnackbar: { message: 'You left Lisbon Offsite.' },
    });
    const published = record(controller);
    // The list answered before Alex left.
    list.release(json({ status: 200, data: groups }));
    await pulling;
    expect(published.some((state) => lists(state, lisbon))).toBe(false);
    const home = controller.getSnapshot();
    expect(home).toMatchObject({ groups: { status: 'ready', data: [{ name: 'Maple House' }] } });
    settled(home);
  });
});

describe('a new Group opens ready (#189)', () => {
  /** The requests sent from now on, as method and path, without their query. */
  const sentFrom = (f: ReturnType<typeof fixture>) => {
    const start = f.calls.length;
    return () => f.calls.slice(start).map((call) => call.split('?')[0]);
  };

  it('reads a new Group, then its Expenses, then its Balances, as for a Group opened from Home', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Cabin Weekend' });
    const sent = sentFrom(f);
    await controller.createGroup();
    const [{ _id: created }] = f.state.created;
    expect(sent()).toEqual([
      'POST /api/groups',
      `GET /api/groups/${created}`,
      `GET /api/groups/${created}/expenses`,
      `GET /api/groups/${created}/balances`,
      // Then the Groups list, as after a join, so the saved list holds the new Group (#283).
      'GET /api/groups',
    ]);
    // Empty Expenses and Balances, not placeholders.
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'expenses',
      creation: { status: 'editing', attempt: null, draft: { name: '' } },
      detail: { status: 'ready', id: created, data: { name: 'Cabin Weekend' } },
      financial: {
        groupId: created,
        month: null,
        expenses: { status: 'ready', data: [], summary: { count: 0 } },
        balances: { status: 'ready', stale: false },
      },
    });
    expect(controller.getSnapshot().groups.data.map(({ name }) => name)).toContain('Cabin Weekend');
    // Saved for offline use, like any Group read from Home.
    expect(f.saved(`/api/groups/${created}`)).not.toBeNull();
    expect(f.saved(`/api/groups/${created}/balances`)).not.toBeNull();
    expect(f.savedPaths().some((path) => path.startsWith(`/api/groups/${created}/expenses?`))).toBe(
      true,
    );
    expect(f.saved('/api/groups')).toMatchObject({
      value: { data: expect.arrayContaining([expect.objectContaining({ _id: created })]) },
    });
  });

  it('opens a new Household on the current Month, whatever Month another Household was left on', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const month = currentMonthKey(new Date(f.clock.now));
    // Maple House, a Household, is left on the Month before.
    await controller.openGroup(maple);
    await controller.selectMonth(shiftMonthKey(month, -1));
    await controller.back();
    controller.startCreate();
    controller.updateCreation({ name: 'Flat 4B', category: 'home' });
    const start = f.calls.length;
    await controller.createGroup();
    const [{ _id: created }] = f.state.created;
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', id: created, data: { name: 'Flat 4B', category: 'home' } },
      financial: {
        groupId: created,
        month,
        expenses: { month, status: 'ready', data: [] },
        balances: { status: 'ready', stale: false },
      },
    });
    // Its Expenses were read for the current Month.
    const reads = f.calls
      .slice(start)
      .filter((call) => call.startsWith(`GET /api/groups/${created}/expenses?`));
    expect(reads).toHaveLength(1);
    const query = new URL(reads[0].slice('GET '.length), 'http://localhost').searchParams;
    const { dateFrom, dateTo } = getLocalMonthIsoRange(month);
    expect([query.get('dateFrom'), query.get('dateTo')]).toEqual([dateFrom, dateTo]);
  });

  it('stays where the member went when they left New Group before the Group was confirmed', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Cabin Weekend' });
    const reply = f.hold('/api/groups');
    const creating = controller.createGroup();
    await reply.reached;
    controller.openSettings();
    const sent = sentFrom(f);
    reply.release();
    await creating;
    const [{ _id: created }] = f.state.created;
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settings',
      detail: { id: null },
      creation: { status: 'editing', attempt: null, draft: { name: '' } },
    });
    // Home lists it, and nothing of it is read until the member opens it.
    expect(controller.getSnapshot().groups.data.some(({ id }) => id === created)).toBe(true);
    expect(sent()).toEqual([]);
  });
});
