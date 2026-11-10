import { describe, expect, it } from 'vitest';
import { decodeStoredSession } from './cookies';
import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import type { MobileController } from './mobile-controller';
import type { MobileSnapshot } from './types';

// #284: a session the server started for a sign-in is revoked before this device gives it up,
// when the sign-in ends on a device storage failure, and when another sign-in or a sign-out
// replaces it. Fictional people only.
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
const now = Date.parse('2026-10-06T09:00:00.000Z');
const staging = 'https://staging.splitbook.test';
const googleClient = '123-test.apps.googleusercontent.com';
const cleanupFailed = 'Could not remove this account from the device. Try signing out again.';

/** The session cookie the server issues for its `n`th sign-in, which is `name`'s. */
const issued = (name: 'alex' | 'sam', n: number, google = false) =>
  `${google ? '__Secure-' : ''}better-auth.session_token=${name}-${n}.signature`;

/**
 * One phone and its server. The server starts a session, with a cookie of its own, for each
 * sign-in as soon as the request arrives. `hold(path)` keeps the reply to the next request on
 * that path until `release()`; an abort before then fails it as expo/fetch does, with the same
 * error as a lost connection. `google` makes it a staging build that signs in with Google.
 */
function phone({ google = false } = {}) {
  const backend = fakeSplitbook();
  backend.world.people.alex = alex;
  backend.world.people.sam = sam;
  backend.world.groups = [];
  backend.auth.secureCookies = google;
  const server = backend.auth;
  const sent: { method: string; path: string; cookie: string | null }[] = [];
  backend.reply('*', '*', ({ method, url, headers }) => {
    sent.push({ method, path: url.pathname, cookie: headers.get('Cookie') });
    return undefined;
  });
  const fail = { ownerLoad: false, ownerSave: false, markerClear: false };
  let chooser: 'alex' | 'sam' = 'alex';
  const native = testPhone(backend, {
    now,
    config: google
      ? {
          apiBaseUrl: staging,
          authOrigin: staging,
          developmentPersonaEnabled: false,
          googleWebClientId: googleClient,
        }
      : {
          apiBaseUrl: 'http://10.0.2.2:4127',
          authOrigin: 'http://localhost:4127',
          developmentPersonaEnabled: true,
        },
    purge: [],
    parts: {
      savedQueries: undefined,
      offlineIdentity: undefined,
      pendingInvitation: undefined,
      expenseDrafts: undefined,
      settlementAttempts: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      netInfo: undefined,
      newSubmissionKey: undefined,
      accountLocal: { financialCleanup: undefined, untrustedCopies: undefined },
      googleSignIn: async () => ({
        status: 'success',
        idToken: `google-token-${chooser}`,
        nonce: 'fresh-nonce',
      }),
    },
  });
  native.stores.owner.failPersistently(
    'load',
    new Error('SQLITE_IOERR: disk I/O error'),
    () => fail.ownerLoad,
  );
  native.stores.owner.failPersistently(
    'save',
    new Error('SQLITE_FULL: database or disk is full'),
    () => fail.ownerSave,
  );
  native.stores.cleanupMarker.failPersistently(
    'clear',
    new Error('SecureStore unavailable'),
    () => fail.markerClear,
  );
  const device = {
    get session() {
      return native.stores.credentials.value;
    },
    set session(v: string | null) {
      native.stores.credentials.value = v;
    },
    get owner() {
      return native.stores.owner.value;
    },
    set owner(v: string | null) {
      native.stores.owner.value = v;
    },
    get marked() {
      return native.stores.cleanupMarker.value;
    },
    set marked(v: boolean) {
      native.stores.cleanupMarker.value = v;
    },
    get recorded() {
      return native.stores.signOutRecord.value;
    },
    set recorded(v: { invitationCleared: boolean } | null) {
      native.stores.signOutRecord.value = v;
    },
  };
  const start = (selected: 'alex' | 'sam' = 'alex') => {
    chooser = selected;
    return native.open();
  };

  return {
    device,
    get saved() {
      return native.stores.credentials.writes.map((value) =>
        value === null ? '' : (decodeStoredSession(value, google)?.cookie ?? value),
      );
    },
    fail,
    server,
    sent,
    start,
    /** Holds the reply to the next request on `path`. */
    hold: (path: string) => {
      const held = backend.hold('*', path, { abortable: true });
      return { arrived: held.arrived, release: held.release };
    },
    holdSave: () => native.stores.credentials.holdNext('save'),
    /** The session cookie in the saved session now. */
    savedCookie: () =>
      device.session === null
        ? null
        : (decodeStoredSession(device.session, google)?.cookie ?? device.session),
    /** The cookie each sign-out request carried, in order. */
    revokes: () =>
      sent.filter((request) => request.path === '/api/auth/sign-out').map((r) => r.cookie),
    /** Every request that carried `cookie`, from the `from`th request sent on. */
    carrying: (cookie: string, from = 0) =>
      sent
        .slice(from)
        .filter((request) => request.cookie === cookie)
        .map(({ method, path }) => `${method} ${path}`),
  };
}

type Controller = MobileController;
/** Every snapshot the controller publishes from now on. */
function published(controller: Controller) {
  const seen: MobileSnapshot[] = [];
  controller.subscribe(() => seen.push(controller.getSnapshot()));
  return seen;
}

describe('a sign-in that fails on device storage after its session arrived (#284)', () => {
  it.each([
    ['this device’s owner can’t be read', 'ownerLoad'],
    ['this device’s owner can’t be saved', 'ownerSave'],
    ['the cleanup marker can’t be cleared after the account change', 'markerClear'],
  ] as const)('revokes the new session once when %s', async (_, failure) => {
    const device = phone();
    device.fail[failure] = true;
    const controller = device.start();
    await controller.signIn('alex');
    const alex1 = issued('alex', 1);
    expect(device.revokes()).toEqual([alex1]);
    expect(device.carrying(alex1)).toEqual([
      'GET /api/auth/get-session',
      'POST /api/auth/sign-out',
    ]);
    expect(device.device.session).toBeNull();
    expect(controller.getSnapshot().auth).toEqual({
      status: 'error',
      user: null,
      message: cleanupFailed,
    });
  });

  it.each([
    ['revokes it once, after checking the backend again', 'staging', ['POST /api/auth/sign-out']],
    ['never sends it to a backend that now fails the Google check', 'production', []],
  ] as const)('Google: %s', async (_, environment, revoked) => {
    const device = phone({ google: true });
    device.fail.ownerLoad = true;
    const controller = device.start();
    const check = device.hold('/api/auth/get-session');
    const signingIn = controller.signInWithGoogle();
    await check.arrived;
    device.server.bootstrap = { environment, googleWebClientId: googleClient };
    const from = device.sent.length;
    check.release();
    await signingIn;
    const alex1 = issued('alex', 1, true);
    expect(device.carrying(alex1, from)).toEqual(revoked);
    // The revoke goes only after the backend is checked again, for the session that sends it.
    expect(device.sent[from]?.path).toBe('/.well-known/splitbook-mobile.json');
    expect(device.device.session).toBeNull();
    // A revoke that couldn't be sent isn't confirmed, and #202 shows it so.
    expect(controller.getSnapshot().auth.status).toBe(
      environment === 'staging' ? 'error' : 'sign-out-unconfirmed',
    );
  });

  it('keeps an unconfirmed revoke for Try again, which sends it again, as #202 does', async () => {
    const device = phone();
    device.fail.ownerLoad = true;
    device.server.signOutStatus = 503;
    const controller = device.start();
    await controller.signIn('alex');
    const alex1 = issued('alex', 1);
    expect(device.revokes()).toEqual([alex1]);
    expect(controller.getSnapshot().auth).toMatchObject({
      status: 'sign-out-unconfirmed',
      user: null,
    });
    expect(device.device.session).toBeNull();

    // Try again.
    device.server.signOutStatus = 200;
    await controller.restore();
    expect(device.revokes()).toEqual([alex1, alex1]);
    expect(controller.getSnapshot().auth).toEqual({
      status: 'signed-out',
      user: null,
      message: null,
    });
  });
});

describe('a sign-in replaced by a second one (#284)', () => {
  it.each(['before', 'after'] as const)(
    'revokes the first session once, to sign-out only, when its held reply lands %s the second sign-in finishes',
    async (when) => {
      const device = phone();
      const controller = device.start();
      const reply = device.hold('/api/auth/demo-persona/sign-in');
      const first = controller.signIn('alex');
      await reply.arrived;
      const second = controller.signIn('sam');
      if (when === 'before') reply.release();
      await second;
      if (when === 'after') reply.release();
      await first;
      const alex1 = issued('alex', 1);
      expect(device.revokes()).toEqual([alex1]);
      expect(device.carrying(alex1)).toEqual(['POST /api/auth/sign-out']);
      expect(device.saved).not.toContain(alex1);
      expect(controller.getSnapshot().auth).toMatchObject({
        status: 'authenticated',
        user: { id: sam.id },
      });
      expect(device.savedCookie()).toBe(issued('sam', 2));
    },
  );

  it('revokes the first session once when its reply was adopted before the second sign-in', async () => {
    const device = phone();
    const controller = device.start();
    const check = device.hold('/api/auth/get-session');
    const first = controller.signIn('alex');
    await check.arrived;
    const alex1 = issued('alex', 1);
    expect(device.savedCookie()).toBe(alex1);
    const from = device.sent.length;
    await controller.signIn('sam');
    check.release();
    await first;
    expect(device.revokes()).toEqual([alex1]);
    expect(device.carrying(alex1, from)).toEqual(['POST /api/auth/sign-out']);
    expect(controller.getSnapshot().auth).toMatchObject({
      status: 'authenticated',
      user: { id: sam.id },
    });
    expect(device.savedCookie()).toBe(issued('sam', 2));
  });

  it('revokes the first session once when the second sign-in starts while its cookie is saved', async () => {
    const device = phone();
    const controller = device.start();
    const save = device.holdSave();
    const first = controller.signIn('alex');
    await save.arrived;
    const second = controller.signIn('sam');
    save.release();
    await Promise.all([first, second]);
    const alex1 = issued('alex', 1);
    expect(device.revokes()).toEqual([alex1]);
    expect(device.carrying(alex1)).toEqual(['POST /api/auth/sign-out']);
    expect(controller.getSnapshot().auth).toMatchObject({
      status: 'authenticated',
      user: { id: sam.id },
    });
    expect(device.savedCookie()).toBe(issued('sam', 2));
  });

  it('sends the first session’s revoke once, whatever the answer, and the second sign-in completes', async () => {
    const device = phone();
    device.server.signOutStatus = 503;
    const first = device.start();
    const reply = device.hold('/api/auth/demo-persona/sign-in');
    const signingIn = first.signIn('alex');
    await reply.arrived;
    const second = first.signIn('sam');
    reply.release();
    await Promise.all([signingIn, second]);
    const alex1 = issued('alex', 1);
    expect(device.revokes()).toEqual([alex1]);
    expect(first.getSnapshot().auth).toMatchObject({
      status: 'authenticated',
      user: { id: sam.id },
    });

    // Nothing sends it again, on a return to the app or after a restart.
    await first.refresh('foreground');
    first.dispose();
    const restarted = device.start();
    await restarted.restore();
    expect(device.carrying(alex1)).toEqual(['POST /api/auth/sign-out']);
    expect(restarted.getSnapshot().auth).toMatchObject({
      status: 'authenticated',
      user: { id: sam.id },
    });
  });
});

describe('a sign-in reply that lands after sign-out (#284)', () => {
  it('revokes that session, never saves it, and stays signed out', async () => {
    const device = phone();
    const controller = device.start();
    const reply = device.hold('/api/auth/demo-persona/sign-in');
    const signingIn = controller.signIn('alex');
    await reply.arrived;
    await controller.signOut();
    const seen = published(controller);
    reply.release();
    await signingIn;
    const alex1 = issued('alex', 1);
    expect(device.revokes()).toEqual([alex1]);
    expect(device.carrying(alex1)).toEqual(['POST /api/auth/sign-out']);
    expect(device.saved).toEqual([]);
    expect(device.device.session).toBeNull();
    expect(seen.every((shown) => shown.auth.user === null)).toBe(true);
    expect(controller.getSnapshot().auth).toEqual({
      status: 'signed-out',
      user: null,
      message: null,
    });
  });

  it.each([
    ['revokes it once, after checking the backend again', 'staging', ['POST /api/auth/sign-out']],
    ['never sends it to a backend that now fails the Google check', 'production', []],
  ] as const)('Google: %s', async (_, environment, revoked) => {
    const device = phone({ google: true });
    const controller = device.start();
    const reply = device.hold('/api/auth/sign-in/social');
    const signingIn = controller.signInWithGoogle();
    await reply.arrived;
    await controller.signOut();
    device.server.bootstrap = { environment, googleWebClientId: googleClient };
    const from = device.sent.length;
    reply.release();
    await signingIn;
    const alex1 = issued('alex', 1, true);
    expect(device.carrying(alex1)).toEqual(revoked);
    // The revoke goes only after the backend is checked again, for the session that sends it.
    expect(device.sent[from]?.path).toBe('/.well-known/splitbook-mobile.json');
    expect(device.saved).toEqual([]);
    expect(controller.getSnapshot().auth).toEqual({
      status: 'signed-out',
      user: null,
      message: null,
    });
  });
});

describe('a late reply’s revoke goes on without blocking anything (#284)', () => {
  it('lets Google sign-in start again after sign-out while the first reply is held, and still revokes that session once', async () => {
    const device = phone({ google: true });
    const controller = device.start();
    const reply = device.hold('/api/auth/sign-in/social');
    const first = controller.signInWithGoogle();
    await reply.arrived;
    await controller.signOut();
    await controller.signInWithGoogle();
    const alex2 = issued('alex', 2, true);
    expect(controller.getSnapshot().auth).toMatchObject({
      status: 'authenticated',
      user: { id: alex.id },
    });
    expect(device.savedCookie()).toBe(alex2);

    reply.release();
    await first;
    const alex1 = issued('alex', 1, true);
    expect(device.revokes()).toEqual([alex1]);
    expect(device.carrying(alex1)).toEqual(['POST /api/auth/sign-out']);
    expect(device.saved).not.toContain(alex1);
    expect(controller.getSnapshot().auth).toMatchObject({
      status: 'authenticated',
      user: { id: alex.id },
    });
    expect(device.savedCookie()).toBe(alex2);
  });

  it.each([
    ['a second sign-out', (controller: Controller) => controller.signOut()],
    ['a return to the app', (controller: Controller) => controller.refresh('foreground')],
  ] as const)(
    'sends it once when %s lands while the backend is checked for it',
    async (_, change) => {
      const device = phone({ google: true });
      const controller = device.start();
      const reply = device.hold('/api/auth/sign-in/social');
      const signingIn = controller.signInWithGoogle();
      await reply.arrived;
      await controller.signOut();
      const check = device.hold('/.well-known/splitbook-mobile.json');
      reply.release();
      await check.arrived;
      await change(controller);
      check.release();
      await signingIn;
      const alex1 = issued('alex', 1, true);
      expect(device.revokes()).toEqual([alex1]);
      expect(device.carrying(alex1)).toEqual(['POST /api/auth/sign-out']);
      expect(device.saved).toEqual([]);
      expect(device.device.session).toBeNull();
      expect(controller.getSnapshot().auth).toEqual({
        status: 'signed-out',
        user: null,
        message: null,
      });
    },
  );

  it('still revokes a reply that lands after the controller is disposed, and changes nothing', async () => {
    const device = phone();
    const controller = device.start();
    const reply = device.hold('/api/auth/demo-persona/sign-in');
    const signingIn = controller.signIn('alex');
    await reply.arrived;
    controller.dispose();
    const disposed = controller.getSnapshot();
    const seen = published(controller);
    reply.release();
    await signingIn;
    const alex1 = issued('alex', 1);
    expect(device.revokes()).toEqual([alex1]);
    expect(device.carrying(alex1)).toEqual(['POST /api/auth/sign-out']);
    expect(device.saved).toEqual([]);
    expect(device.device.session).toBeNull();
    expect(seen).toEqual([]);
    expect(controller.getSnapshot()).toBe(disposed);
  });
});
