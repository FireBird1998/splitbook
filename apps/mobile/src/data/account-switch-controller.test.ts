import { describe, expect, it } from 'vitest';
import { decodeStoredSession } from './cookies';
import { createMobileController } from './mobile-controller';
import type { FetchResponse, MobileSnapshot } from './types';

// #200: the app dies partway through an account switch and restarts over the same storage.
// Fictional people and Groups only.
const alex = {
  id: 'a00000000000000000000001',
  name: 'Alex Rivera',
  email: 'alex@example.test',
  image: null,
};
const sam = {
  id: 'a00000000000000000000002',
  name: 'Sam Chen',
  email: 'sam@example.test',
  image: null,
};
type Person = typeof alex;
const groupId = 'b00000000000000000000001',
  alexGroupId = 'b00000000000000000000002',
  expenseId = 'e00000000000000000000001',
  tagId = 'c00000000000000000000001';
const iso = '2026-10-01T12:00:00.000Z';
const alexDraft = 'Alex: private taxi';

const json = (body: unknown, status = 200, setCookie?: string): FetchResponse =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(setCookie ? { 'Set-Cookie': `${setCookie}; HttpOnly; Path=/; Max-Age=2592000` } : {}),
    },
  });
const member = (person: Person, role: 'admin' | 'member') => ({
  user: { ...person, _id: person.id },
  role,
  joinedAt: iso,
});
// Alex and Sam share this Group, so the server would accept a write sent with Sam's cookie.
const group = {
  _id: groupId,
  name: 'Harbour Flat',
  createdBy: alex.id,
  category: 'home',
  defaultCurrency: 'INR',
  members: [member(alex, 'admin'), member(sam, 'member')],
  tags: [{ _id: tagId, name: 'Travel', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
// Alex's own Group, which holds his draft.
const alexGroup = {
  ...group,
  _id: alexGroupId,
  name: 'Alex’s Trips',
  category: 'trip',
  members: [member(alex, 'admin')],
};
const person = (user: Person) => ({ _id: user.id, name: user.name, image: null });
const expense = (isDeleted: boolean) => ({
  _id: expenseId,
  group: groupId,
  revision: 0,
  description: 'Ferry tickets',
  amount: 12,
  amountMinor: 1200,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: person(alex), amount: 12, amountMinor: 1200 }],
  splitBetween: [
    { user: person(alex), amount: 6, amountMinor: 600 },
    { user: person(sam), amount: 6, amountMinor: 600 },
  ],
  splitMethod: 'equal',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'transport',
  tagId,
  tag: 'Travel',
  notes: '',
  isDeleted,
  editHistory: [],
});

/** One phone and its server. The phone's storage outlives each controller, as across a restart. */
function phone() {
  const stored = {
    cookie: null as string | null,
    owner: null as string | null,
    identity: null as unknown,
    cleanup: false,
    cache: new Map<string, unknown>(),
    drafts: new Map<string, unknown>(),
    creations: new Map<string, unknown>(),
  };
  const server = {
    offline: false,
    /** The next answer refreshes the session's cookie, as a server may. */
    rotate: false,
    deleted: false,
    sessions: new Map<string, Person>(),
    issuedTo: new Map<string, Person>(),
  };
  /** Every request the phone sent, with its cookie and the user on screen as it went out. */
  const requests: { method: string; path: string; cookie: string | null; shown: string | null }[] =
    [];
  /** Each time the cookie was recorded for an account: who owned the device then, and what else it held. */
  const verifiedWrites: { accountId: string; owner: string | null; foreign: number }[] = [];
  const holds: {
    prefix: string;
    arrive: () => void;
    response: Promise<Error | null>;
  }[] = [];
  let active: ReturnType<typeof createMobileController> | null = null;

  const issue = (user: Person) => {
    const cookie = `better-auth.session_token=${user === sam ? 'sam' : 'alex'}-${server.issuedTo.size + 1}.signature`;
    server.sessions.set(cookie, user);
    server.issuedTo.set(cookie, user);
    return cookie;
  };
  const respond = (path: string, init: RequestInit, cookie: string | null): FetchResponse => {
    const method = init.method ?? 'GET';
    if (path === '/api/auth/demo-persona/sign-in') {
      const user = String(init.body).includes('sam') ? sam : alex;
      return json({ user }, 200, issue(user));
    }
    const user = cookie ? server.sessions.get(cookie) : undefined;
    if (!user) return json({ error: 'Unauthorized' }, 401);
    let refreshed: string | undefined;
    if (server.rotate) {
      server.rotate = false;
      server.sessions.delete(cookie!);
      refreshed = issue(user);
    }
    const answer = (body: unknown, status = 200) => json(body, status, refreshed);
    if (path === '/api/auth/get-session')
      return answer({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00.000Z' } });
    if (path === '/api/auth/sign-out') {
      server.sessions.delete(cookie!);
      return answer({ success: true });
    }
    if (path === '/api/groups' && method === 'POST') {
      const { name } = JSON.parse(String(init.body)) as { name: string };
      return answer(
        {
          status: 201,
          data: {
            ...group,
            _id: 'b00000000000000000000099',
            name,
            createdBy: user.id,
            members: [member(user, 'admin')],
          },
        },
        201,
      );
    }
    const visible = [group, alexGroup].filter(({ members }) =>
      members.some((entry) => entry.user._id === user.id),
    );
    if (path === '/api/groups') return answer({ status: 200, data: visible });
    if (path === '/api/user/balances')
      return answer({
        status: 200,
        data: {
          buckets: [
            { currency: 'INR', youOwe: user === sam ? 6 : 0, youAreOwed: user === alex ? 6 : 0 },
          ],
        },
      });
    const id = /^\/api\/groups\/([a-f\d]{24})/.exec(path)?.[1];
    const found = visible.find((item) => item._id === id);
    if (!found) return answer({ error: 'Forbidden' }, 403);
    if (path === `/api/groups/${id}`) return answer({ status: 200, data: found });
    if (path === `/api/groups/${groupId}/expenses/${expenseId}`) {
      if (method === 'DELETE') server.deleted = true;
      return answer({ status: 200, data: expense(server.deleted) });
    }
    if (path === `/api/groups/${id}/expenses`)
      return answer({
        status: 200,
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
        },
      });
    if (path === `/api/groups/${id}/balances`)
      return answer({
        status: 200,
        data: { byCurrency: [{ currency: 'INR', balances: [], debts: [] }] },
      });
    if (path === `/api/groups/${id}/activity`)
      return answer({
        status: 200,
        data: { activities: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      });
    throw new Error(`Unexpected request ${method} ${path}`);
  };

  const create = () => {
    active = createMobileController(
      {
        apiBaseUrl: 'http://localhost:4146',
        authOrigin: 'http://localhost:4146',
        developmentPersonaEnabled: true,
      },
      {
        now: () => Date.parse(iso),
        newSubmissionKey: () => 'account-switch-test-0001',
        credentials: {
          load: async () => stored.cookie,
          save: async (value) => {
            stored.cookie = value;
            const accountId = decodeStoredSession(value, false)?.accountId;
            if (accountId)
              verifiedWrites.push({
                accountId,
                owner: stored.owner,
                foreign: [...stored.cache.keys(), ...stored.drafts.keys()].filter(
                  (key) => !key.startsWith(accountId),
                ).length,
              });
          },
          clear: async () => {
            stored.cookie = null;
          },
        },
        offlineIdentity: {
          load: async () => structuredClone(stored.identity),
          save: async (value) => {
            stored.identity = structuredClone(value);
          },
          clear: async () => {
            stored.identity = null;
          },
        },
        readCache: {
          retainGroups: async () => undefined,
          invalidateGroup: async (account, id) => {
            for (const key of [...stored.cache.keys()])
              if (key.startsWith(`${account}/api/groups/${id}`)) stored.cache.delete(key);
          },
          load: async (account, key) => structuredClone(stored.cache.get(account + key) ?? null),
          save: async (account, key, value) => {
            stored.cache.set(account + key, structuredClone(value));
          },
          clear: async () => {
            stored.cache.clear();
          },
        },
        expenseDrafts: {
          load: async (account, id) =>
            structuredClone(stored.drafts.get(`${account}:${id}`) ?? null),
          save: async (account, id, value) => {
            stored.drafts.set(`${account}:${id}`, structuredClone(value));
          },
          remove: async (account, id) => {
            stored.drafts.delete(`${account}:${id}`);
          },
          clear: async () => {
            stored.drafts.clear();
          },
          list: async (account) =>
            [...stored.drafts]
              .filter(([key]) => key.startsWith(`${account}:`))
              .map(([key, value]) => ({
                groupId: key.split(':')[1],
                value: structuredClone(value),
              })),
        },
        groupCreations: {
          load: async (account) => structuredClone(stored.creations.get(account) ?? null),
          save: async (account, value) => {
            stored.creations.set(account, structuredClone(value));
          },
          remove: async (account) => {
            stored.creations.delete(account);
          },
          clear: async () => {
            stored.creations.clear();
          },
        },
        accountLocal: {
          owner: {
            load: async () => stored.owner,
            save: async (value) => {
              stored.owner = value;
            },
            clear: async () => {
              stored.owner = null;
            },
          },
          cleanupMarker: {
            load: async () => stored.cleanup,
            mark: async () => {
              stored.cleanup = true;
            },
            clear: async () => {
              stored.cleanup = false;
            },
          },
          stores: [
            {
              clear: async () => {
                stored.cache.clear();
                stored.drafts.clear();
                stored.creations.clear();
                stored.identity = null;
              },
            },
          ],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname;
          const cookie = new Headers(init.headers).get('Cookie');
          requests.push({
            method: init.method ?? 'GET',
            path,
            cookie,
            shown: active?.getSnapshot().auth.user?.id ?? null,
          });
          if (server.offline) throw new Error('Offline');
          const index = holds.findIndex((item) => path.startsWith(item.prefix));
          if (index >= 0) {
            const [item] = holds.splice(index, 1);
            item.arrive();
            const outcome = await item.response;
            if (outcome) throw outcome;
          }
          return respond(path, init, cookie);
        },
      },
    );
    return active;
  };

  return {
    create,
    stored,
    server,
    requests,
    verifiedWrites,
    /** The saved session as this phone holds it. */
    session: () => (stored.cookie === null ? null : decodeStoredSession(stored.cookie, false)),
    /** Whose session a cookie is. */
    holder: (cookie: string | null) => (cookie ? server.issuedTo.get(cookie) : undefined),
    alexDrafts: () => [...stored.drafts.keys()].filter((key) => key.startsWith(alex.id)),
    /** Every session of this person is removed on the server: their next request is refused. */
    revoke: (user: Person) => {
      for (const [cookie, holder] of server.sessions)
        if (holder === user) server.sessions.delete(cookie);
    },
    /** The next request whose path starts with `prefix` waits until released, or fails. */
    hold: (prefix: string) => {
      let arrive!: () => void;
      let release!: (outcome?: Error) => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const response = new Promise<Error | null>((resolve) => {
        release = (outcome) => resolve(outcome ?? null);
      });
      holds.push({ prefix, arrive, response });
      return { reached, release };
    },
  };
}
type Phone = ReturnType<typeof phone>;

/** Every snapshot published from now on. */
function record(controller: ReturnType<Phone['create']>) {
  const published: MobileSnapshot[] = [];
  controller.subscribe(() => published.push(controller.getSnapshot()));
  return published;
}

/** Alex, his Groups, Home figures or draft, or any account content while Sam isn't confirmed. */
const showsAlex = (shown: MobileSnapshot) =>
  shown.auth.user?.id === alex.id ||
  shown.drafts.some((draft) => draft.description === alexDraft) ||
  shown.expense.draft?.description === alexDraft ||
  !!shown.home.data?.some((bucket) => bucket.youAreOwed === 6) ||
  (shown.auth.user?.id !== sam.id &&
    (shown.groups.data.length > 0 || shown.home.data !== null || shown.detail.data !== null));

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Alex opens the shared Group and one of its Expenses, and keeps a draft in his own Group. */
async function useAsAlex(p: Phone) {
  const first = p.create();
  await first.signIn('alex');
  await first.openGroup(groupId);
  await first.openExpense(groupId, expenseId);
  await first.back();
  await first.back();
  await first.openGroup(alexGroupId);
  await first.openExpense(alexGroupId);
  await first.updateExpenseDraft({ description: alexDraft, amount: '12', tagId });
  await first.back();
  await first.back();
  return first;
}

/**
 * Alex's session is removed on the server, so his next request ends it with a 401, which keeps his
 * data on the device. Then `persona` signs in: the reply and its cookie arrive, the session check
 * never does, and the app is killed while it waits.
 */
async function crashDuringSwitch(p: Phone, persona: 'sam' | 'alex') {
  const first = await useAsAlex(p);
  expect(showsAlex(first.getSnapshot())).toBe(true);
  p.revoke(alex);
  await first.refresh();
  expect(first.getSnapshot().auth).toMatchObject({ status: 'signed-out', user: null });
  const check = p.hold('/api/auth/get-session');
  void first.signIn(persona);
  await check.reached;
  first.dispose();
  check.release(new Error('The app was killed'));
  await settled();
}

describe('a crash during an account switch (#200)', () => {
  it('leaves the new cookie unverified on disk, beside the previous account’s data', async () => {
    const p = phone();
    await crashDuringSwitch(p, 'sam');
    expect(p.session()).toEqual({ cookie: expect.stringContaining('sam-'), accountId: null });
    expect(p.stored).toMatchObject({ owner: alex.id, cleanup: false });
    expect(p.alexDrafts()).toHaveLength(1);
  });

  it('restarts offline to the session error with Retry, showing nothing of Alex and sending nothing as him', async () => {
    const p = phone();
    await crashDuringSwitch(p, 'sam');
    p.server.offline = true;
    const restarted = p.create();
    const published = record(restarted);
    await restarted.restore();
    const restored = restarted.getSnapshot();

    // Delete and Create Group, offline and then reconnected, send nothing for Alex's screen.
    await restarted.openExpense(groupId, expenseId);
    restarted.reviewExpenseDeletion();
    p.server.offline = false;
    await restarted.deleteExpense();
    restarted.startCreate();
    restarted.updateCreation({ name: 'Sam’s new flat' });
    await restarted.createGroup();
    expect(
      p.requests.filter((sent) => sent.shown === alex.id && p.holder(sent.cookie) === sam),
    ).toEqual([]);
    expect(p.server.deleted).toBe(false);
    expect(published.filter(showsAlex)).toEqual([]);
    expect(restored.auth).toMatchObject({ status: 'error', user: null });
    // Nothing is purged without the session check: Alex's draft waits for it.
    expect(p.alexDrafts()).toHaveLength(1);
    expect(p.stored.owner).toBe(alex.id);

    // Retry, online: the check confirms Sam, so Alex's data goes before Sam's Home shows.
    await restarted.restore();
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: sam.id } },
      home: { data: [{ youOwe: 6 }] },
    });
    expect(published.filter(showsAlex)).toEqual([]);
    expect(p.alexDrafts()).toEqual([]);
    expect(p.session()).toMatchObject({ accountId: sam.id });
  });

  it('restarts online without Alex’s saved Home, and shows Sam once the check confirms him', async () => {
    const p = phone();
    await crashDuringSwitch(p, 'sam');
    const sent = p.requests.length;
    const restarted = p.create();
    const published = record(restarted);
    const check = p.hold('/api/auth/get-session');
    const restoring = restarted.restore();
    await check.reached;
    await settled();
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'restoring', user: null },
      groups: { data: [] },
      home: { data: null },
      drafts: [],
    });
    check.release();
    await restoring;
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: sam.id } },
      home: { data: [{ youOwe: 6 }] },
    });
    expect(published.filter(showsAlex)).toEqual([]);
    expect(p.requests.slice(sent).filter((request) => request.shown === alex.id)).toEqual([]);
    // Alex's drafts go only now, once Sam's session is confirmed.
    expect(p.alexDrafts()).toEqual([]);
    expect(p.session()).toMatchObject({ accountId: sam.id });
  });

  it('keeps Alex’s drafts when the crash was Alex himself signing back in', async () => {
    const p = phone();
    await crashDuringSwitch(p, 'alex');
    p.server.offline = true;
    const offline = p.create();
    const published = record(offline);
    await offline.restore();
    expect(offline.getSnapshot().auth).toMatchObject({ status: 'error', user: null });
    expect(published.filter((shown) => shown.auth.user !== null)).toEqual([]);
    expect(p.alexDrafts()).toHaveLength(1);
    offline.dispose();

    p.server.offline = false;
    const online = p.create();
    await online.restore();
    expect(online.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      drafts: [{ description: alexDraft }],
    });
    expect(p.alexDrafts()).toHaveLength(1);
    expect(p.session()).toMatchObject({ accountId: alex.id });
    online.dispose();

    // Recorded for Alex now, the cookie restores offline again.
    p.server.offline = true;
    const later = p.create();
    await later.restore();
    expect(later.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      offline: { active: true },
      drafts: [{ description: alexDraft }],
    });
  });
});

describe('the account recorded beside the session cookie (#200)', () => {
  it('records it only once get-session confirms it, and on a switch only after the purge and the new owner', async () => {
    const p = phone();
    const controller = p.create();
    const check = p.hold('/api/auth/get-session');
    const signingIn = controller.signIn('alex');
    await check.reached;
    expect(p.session()).toEqual({ cookie: expect.stringContaining('alex-'), accountId: null });
    check.release();
    await signingIn;
    expect(p.session()).toMatchObject({ accountId: alex.id });

    await controller.openExpense(alexGroupId);
    await controller.updateExpenseDraft({ description: alexDraft, amount: '12', tagId });
    await controller.back();
    await controller.signIn('sam');
    expect(p.session()).toEqual({ cookie: expect.stringContaining('sam-'), accountId: sam.id });
    // Each time, the device already belonged to that account and held nothing of another.
    expect(p.verifiedWrites).toEqual([
      { accountId: alex.id, owner: alex.id, foreign: 0 },
      { accountId: sam.id, owner: sam.id, foreign: 0 },
    ]);
  });

  it('keeps the recorded account when the server refreshes a verified cookie', async () => {
    const p = phone();
    const first = p.create();
    await first.signIn('alex');
    const before = p.session()!.cookie;
    p.server.rotate = true;
    await first.refresh();
    expect(p.session()?.cookie).not.toBe(before);
    expect(p.session()?.accountId).toBe(alex.id);
    first.dispose();

    p.server.offline = true;
    const restarted = p.create();
    await restarted.restore();
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      offline: { active: true },
    });
  });

  it.each([
    ['owner', 'online'],
    ['owner', 'offline'],
    ['identity', 'online'],
    ['identity', 'offline'],
  ] as const)(
    'signs out and purges the device when the cookie’s account differs from the %s (%s)',
    async (differs, network) => {
      const p = phone();
      (await useAsAlex(p)).dispose();
      const alexCookie = p.session()!.cookie;
      if (differs === 'owner') p.stored.owner = sam.id;
      else
        p.stored.identity = {
          user: sam,
          session: { userId: sam.id, expiresAt: '2030-01-01T00:00:00.000Z' },
        };
      p.server.offline = network === 'offline';
      const sent = p.requests.length;
      const restarted = p.create();
      const published = record(restarted);
      await restarted.restore();
      expect(restarted.getSnapshot()).toMatchObject({
        auth: { status: 'signed-out', user: null },
        screen: 'groups',
      });
      expect(
        published.filter(
          (shown) =>
            shown.auth.user !== null ||
            shown.groups.data.length > 0 ||
            shown.home.data !== null ||
            shown.drafts.length > 0,
        ),
      ).toEqual([]);
      expect(p.requests.slice(sent).filter((request) => request.cookie === alexCookie)).toEqual([]);
      expect(p.stored).toMatchObject({ cookie: null, owner: null, identity: null, cleanup: false });
      expect([
        ...p.stored.cache.keys(),
        ...p.stored.drafts.keys(),
        ...p.stored.creations.keys(),
      ]).toEqual([]);
    },
  );

  it('needs one online check for a cookie saved before accounts were recorded', async () => {
    const p = phone();
    (await useAsAlex(p)).dispose();
    // As every earlier version saved it: the cookie alone.
    p.stored.cookie = p.session()!.cookie;
    p.server.offline = true;
    const offline = p.create();
    const published = record(offline);
    await offline.restore();
    expect(offline.getSnapshot().auth).toMatchObject({ status: 'error', user: null });
    expect(published.filter((shown) => shown.auth.user !== null)).toEqual([]);
    expect(p.alexDrafts()).toHaveLength(1);
    offline.dispose();

    p.server.offline = false;
    const online = p.create();
    const check = p.hold('/api/auth/get-session');
    const restoring = online.restore();
    await check.reached;
    await settled();
    // No saved-Home preview before that check.
    expect(online.getSnapshot()).toMatchObject({
      auth: { status: 'restoring', user: null },
      groups: { data: [] },
    });
    check.release();
    await restoring;
    expect(online.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      drafts: [{ description: alexDraft }],
    });
    expect(p.session()).toMatchObject({ accountId: alex.id });
  });
});
