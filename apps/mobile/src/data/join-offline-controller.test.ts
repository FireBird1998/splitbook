import { describe, expect, it } from 'vitest';
import { savedQueriesIn } from '../test-utils/saved-queries';
import { createMobileController } from './mobile-controller';
import type { FetchResponse, MobileSnapshot } from './types';

// #286: Join is a write, so it waits for a connection as every other write does (#200), and the
// invitation is read as every other view is: a session the app counts as offline is checked
// online first. Fictional people: Sam invites Alex to Maple House.
const alex = {
  id: 'a00000000000000000000001',
  name: 'Alex Rivera',
  email: 'a@x.test',
  image: null,
};
const sam = { _id: 'a00000000000000000000002', name: 'Sam Chen', email: 's@x.test', image: null };
const cedar = 'b00000000000000000000001',
  maple = 'b00000000000000000000002';
const code = 'deadbeef',
  link = `http://localhost:4138/join/${code}`;
const iso = '2026-10-06T09:00:00.000Z';
const json = (body: unknown, status = 200) => Response.json(body, { status });
const alexMember = { user: { ...alex, _id: alex.id }, role: 'admin', joinedAt: iso };
/** Alex's own Group, and Sam's, which Alex joins. */
const cedarFlat = {
  _id: cedar,
  name: 'Cedar Flat',
  createdBy: alex.id,
  category: 'home',
  defaultCurrency: 'INR',
  members: [alexMember],
  tags: [],
  createdAt: iso,
  updatedAt: iso,
};
const mapleHouse = {
  ...cedarFlat,
  _id: maple,
  name: 'Maple House',
  createdBy: sam._id,
  members: [
    { user: sam, role: 'admin', joinedAt: iso },
    { ...alexMember, role: 'member' },
  ],
};

/**
 * One phone and the fictional backend: its stores outlive each controller, as across restarts.
 * `sent` holds every request as `METHOD /path` and how it ended: its status, or `unreachable`.
 */
function phone() {
  const network = { online: true };
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null,
    invitation: string | null = null,
    joined = false;
  const disk = new Map<string, unknown>();
  const sent: string[] = [];
  const holds = new Map<string, { arrive: () => void; outcome: Promise<void> }>();
  const respond = (path: string, method: string): FetchResponse => {
    if (path.endsWith('/sign-in'))
      return new Response(JSON.stringify({ user: alex }), {
        headers: { 'Set-Cookie': 'better-auth.session_token=alex.signature; Path=/; HttpOnly' },
      });
    if (path.endsWith('/get-session'))
      return json({ user: alex, session: { userId: alex.id, expiresAt: '2030-01-01T00:00:00Z' } });
    const groups = joined ? [cedarFlat, mapleHouse] : [cedarFlat];
    if (path === '/api/groups') return json({ status: 200, data: groups });
    // Home's figures say which Groups they cover, as SplitBook's do (#333): none here.
    if (path === '/api/user/balances')
      return json({ status: 200, data: { buckets: [], groups: [] } });
    if (path === `/api/join/${code}` && method === 'POST') {
      joined = true;
      return json({ status: 201, data: { groupId: maple } }, 201);
    }
    if (path === `/api/join/${code}`)
      return json({
        status: 200,
        data: { _id: maple, name: 'Maple House', category: 'home', memberCount: 1 },
      });
    // Each Group Alex is in, with no Expenses yet.
    const id = /^\/api\/groups\/([a-f\d]{24})/.exec(path)?.[1];
    const found = groups.find((group) => group._id === id);
    if (!found) return json({}, 404);
    if (path === `/api/groups/${id}`) return json({ status: 200, data: found });
    if (path === `/api/groups/${id}/expenses`)
      return json({
        status: 200,
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
        },
      });
    if (path === `/api/groups/${id}/balances`)
      return json({ status: 200, data: { byCurrency: [] } });
    return json({}, 404);
  };
  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4138',
        authOrigin: 'http://localhost:4138',
        developmentPersonaEnabled: true,
      },
      {
        now: () => Date.parse(iso),
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        offlineIdentity: {
          load: async () => structuredClone(identity),
          save: async (value) => {
            identity = structuredClone(value);
          },
          clear: async () => {
            identity = null;
          },
        },
        pendingInvitation: {
          load: async () => invitation,
          save: async (value) => {
            invitation = value;
          },
          clear: async () => {
            invitation = null;
          },
        },
        savedQueries: savedQueriesIn(disk),
        readCache: {
          retainGroups: async () => undefined,
          invalidateGroup: async () => undefined,
          invalidateLedger: async () => undefined,
          load: async (account, key) => structuredClone(disk.get(account + key) ?? null),
          save: async (account, key, value) => {
            disk.set(account + key, structuredClone(value));
          },
          clear: async () => disk.clear(),
        },
        accountLocal: {
          owner: {
            load: async () => owner,
            save: async (value) => {
              owner = value;
            },
            clear: async () => {
              owner = null;
            },
          },
          cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
          stores: [{ clear: async () => disk.clear() }],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname,
            method = init.method ?? 'GET',
            request = `${method} ${path}`;
          const held = holds.get(request);
          holds.delete(request);
          held?.arrive();
          const reached = await held?.outcome.then(
            () => network.online,
            () => false,
          );
          if (reached === false || !network.online) {
            sent.push(`${request} unreachable`);
            throw new TypeError('Network request failed');
          }
          const response = respond(path, method);
          sent.push(`${request} ${response.status}`);
          return response;
        },
      },
    );
  return {
    network,
    sent,
    create,
    /** The invitation saved on this device. */
    invitation: () => invitation,
    /** This device no longer keeps Alex's saved copy of `path`, as after a change removed it. */
    forget: (path: string) => void disk.delete(alex.id + path),
    /** The next request `METHOD /path` waits until it is answered, or can't reach SplitBook. */
    hold(request: string) {
      let arrive!: () => void, answer!: () => void, drop!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const outcome = new Promise<void>((resolve, reject) => {
        answer = resolve;
        drop = () => reject(new Error('Unreachable'));
      });
      holds.set(request, { arrive, outcome });
      return { reached, answer, drop };
    },
  };
}

describe('Join waits for a connection (#286)', () => {
  it('checks the session before the invitation’s Try again after an offline restart, then joins', async () => {
    const f = phone();
    const first = f.create();
    await first.signIn('alex');
    first.dispose();

    // Alex's phone restarts offline, and Alex opens Sam's invitation. It can't load.
    f.network.online = false;
    const restart = f.sent.length;
    const controller = f.create();
    await controller.restore();
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: alex.id } },
      offline: { active: true },
    });
    await controller.openInvitation(link);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { code, status: 'error' },
    });

    // Alex reconnects and taps Try again on the invitation: the session is checked first.
    f.network.online = true;
    const retry = f.sent.length;
    await controller.retryInvitation();
    expect(f.sent.slice(retry)).toEqual([
      'GET /api/auth/get-session 200',
      `GET /api/join/${code} 200`,
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      invitation: { code, status: 'ready', preview: { name: 'Maple House' } },
    });

    await controller.joinInvitation();
    const since = f.sent.slice(restart);
    expect(since.filter((request) => request.startsWith('POST /api/join/'))).toEqual([
      `POST /api/join/${code} 201`,
    ]);
    // Sent only from a session checked online since the restart.
    expect(since.indexOf('GET /api/auth/get-session 200')).toBeGreaterThan(-1);
    expect(since.indexOf('GET /api/auth/get-session 200')).toBeLessThan(
      since.indexOf(`POST /api/join/${code} 201`),
    );
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', data: { id: maple } },
    });
    expect(f.invitation()).toBeNull();
  });

  it('sends and stores nothing for Join while the app counts itself offline', async () => {
    const f = phone();
    const controller = f.create();
    await controller.signIn('alex');
    // Home's Groups list is read again; the invitation opens before it answers.
    const list = f.hold('GET /api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    await controller.openInvitation(link);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      invitation: { code, status: 'ready' },
    });
    // The connection drops before the list answers, so Home falls back to its saved copies: the
    // app counts itself offline. The connection comes back, but nothing has checked it since.
    f.network.online = false;
    list.drop();
    await pulling;
    f.network.online = true;
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      offline: { active: true },
      invitation: { code, status: 'ready' },
    });

    const before = f.sent.length;
    await controller.joinInvitation();
    expect(f.sent.slice(before)).toEqual([]);
    expect(f.invitation()).toBe(code);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { code, status: 'ready', message: null },
    });

    // A pull on the invitation checks the session, then reads it again: Join works.
    const pull = f.sent.length;
    await controller.refresh('pull');
    expect(f.sent.slice(pull)).toEqual([
      'GET /api/auth/get-session 200',
      `GET /api/join/${code} 200`,
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      invitation: { code, status: 'ready' },
    });
    await controller.joinInvitation();
    expect(f.sent.filter((request) => request.startsWith('POST /api/join/'))).toEqual([
      `POST /api/join/${code} 201`,
    ]);
  });

  it('checks the session again over a Group’s saved copies, so a pull on the invitation offers Join', async () => {
    const f = phone();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(cedar);
    // Offline, a pull on Cedar Flat shows its saved copies; then Sam's invitation can't load.
    f.network.online = false;
    await controller.refresh('pull');
    await controller.openInvitation(link);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      offline: { active: true },
      invitation: { code, status: 'error' },
    });

    // Back online, a pull confirms the session. The Group's saved copies still say offline, so
    // the invitation's own read checks the session too, and nothing saved is shown any more.
    f.network.online = true;
    await controller.refresh('pull');
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      invitation: { code, status: 'ready' },
    });
    const join = f.sent.length;
    await controller.joinInvitation();
    expect(f.sent[join]).toBe(`POST /api/join/${code} 201`);
  });

  it('reads nothing more for an invitation closed while its session was checked', async () => {
    const f = phone();
    const first = f.create();
    await first.signIn('alex');
    first.dispose();
    f.network.online = false;
    const controller = f.create();
    await controller.restore();
    // Back online, Alex opens Sam's invitation, then goes back while the session is checked.
    f.network.online = true;
    const check = f.hold('GET /api/auth/get-session');
    const opening = controller.openInvitation(link);
    await check.reached;
    const closing = controller.cancelInvitation();
    check.answer();
    await Promise.all([opening, closing]);
    expect(f.sent.filter((request) => request.includes('/api/join/'))).toEqual([]);
    expect(f.invitation()).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      invitation: { code: null, status: 'idle' },
    });
  });

  it('reads only the invitation on Try again while the app is online', async () => {
    const f = phone();
    const controller = f.create();
    await controller.signIn('alex');
    const preview = f.hold(`GET /api/join/${code}`);
    const opening = controller.openInvitation(link);
    await preview.reached;
    preview.drop();
    await opening;
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      invitation: { code, status: 'error' },
    });

    const retry = f.sent.length;
    await controller.retryInvitation();
    expect(f.sent.slice(retry)).toEqual([`GET /api/join/${code} 200`]);
    expect(controller.getSnapshot().invitation).toMatchObject({ code, status: 'ready' });
  });
});

describe('After a Join, Home says what is true (#332)', () => {
  it('shows no offline banner once SplitBook confirms the join, and checks the session no more', async () => {
    const f = phone();
    const controller = f.create();
    await controller.signIn('alex');
    // Offline, a pull on Home shows its saved copies; then Sam's invitation can't load.
    f.network.online = false;
    await controller.refresh('pull');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      offline: { active: true },
      home: { restored: true },
    });
    await controller.openInvitation(link);
    // Back online, Try again checks the session and reads the invitation.
    f.network.online = true;
    await controller.retryInvitation();
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      invitation: { code, status: 'ready' },
    });

    const published: MobileSnapshot[] = [];
    controller.subscribe(() => published.push(controller.getSnapshot()));
    const sent = f.sent.length;
    await controller.joinInvitation();
    // The join answered, so nothing checks the session again before the joined Group opens.
    expect(f.sent.slice(sent)).toEqual([
      `POST /api/join/${code} 201`,
      'GET /api/groups 200',
      `GET /api/groups/${maple} 200`,
      `GET /api/groups/${maple}/expenses 200`,
      `GET /api/groups/${maple}/balances 200`,
    ]);
    // Home shows while its Groups are read again: never offline, its figures still "Saved".
    const home = published.filter((state) => state.screen === 'groups');
    expect(home.length).toBeGreaterThan(0);
    expect(home.every((state) => state.home.restored)).toBe(true);
    expect(published.filter((state) => state.offline.active)).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', data: { id: maple } },
    });
  });

  it('says nothing offline on Home once a Join after an offline start confirms', async () => {
    const f = phone();
    const first = f.create();
    await first.signIn('alex');
    first.dispose();
    // Alex's phone keeps no copy of Home's figures, and restarts offline.
    f.forget('/api/user/balances');
    f.network.online = false;
    const controller = f.create();
    await controller.restore();
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true },
      home: {
        status: 'error',
        data: null,
        message: 'Your balances aren’t saved on this phone. Connect to load them.',
      },
    });
    // Sam's invitation can't load; back online, Try again reads it, and Alex joins.
    await controller.openInvitation(link);
    f.network.online = true;
    await controller.retryInvitation();
    const published: MobileSnapshot[] = [];
    controller.subscribe(() => published.push(controller.getSnapshot()));
    await controller.joinInvitation();

    // Home shows while its Groups are read again: online, with no failure to reach SplitBook.
    const home = published.filter((state) => state.screen === 'groups');
    expect(home.length).toBeGreaterThan(0);
    expect(
      home.filter(
        (state) => state.offline.active || state.home.status === 'error' || state.home.message,
      ),
    ).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', data: { id: maple } },
    });
  });
});
