import { readSessionCookie, validSessionCookie } from './cookies';
import { objectId, parseGroup, parseGroups, parseSession, parseSignIn } from './dto';
import type { FetchResponse, MobileConfig, MobileDependencies, MobileSnapshot } from './types';

const expiredMessage = 'Your session has expired. Sign in again to continue.';
const storageMessage = 'Could not safely save your session. Please try signing in again.';
const disabledMessage = 'Development persona sign-in is disabled in this build.';

class Superseded extends Error {}
class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

function cleanSnapshot(auth: MobileSnapshot['auth']): MobileSnapshot {
  return {
    auth,
    screen: 'groups',
    groups: { status: 'idle', data: [], message: null },
    detail: { status: 'idle', id: null, data: null, message: null },
  };
}

function origin(value: string): string {
  const parsed = new URL(value);
  if (
    !['https:', 'http:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error('Configure an HTTP(S) backend origin without a path or credentials.');
  }
  return parsed.origin;
}

/**
 * Development-persona transport and memory-only Group reads. Secure credential
 * persistence is injected by the native runtime. It never imports React or a
 * native SDK, and it never treats a raw Better Auth token as a signed cookie.
 */
export function createMobileController(config: MobileConfig, dependencies: MobileDependencies) {
  const apiBase = origin(config.apiBaseUrl);
  const authOrigin = origin(config.authOrigin);
  const secureTransport = apiBase.startsWith('https:');
  const now = dependencies.now ?? Date.now;
  const listeners = new Set<() => void>();
  const requests = new Set<AbortController>();
  let snapshot = cleanSnapshot({ status: 'restoring', user: null, message: null });
  let cookie: string | null = null;
  let generation = 0;
  let viewRequest = 0;
  let storeQueue: Promise<unknown> = Promise.resolve();
  let cleanupRequired = false;

  const publish = (next: MobileSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const current = (owner: number) => owner === generation;
  const assertCurrent = (owner: number) => {
    if (!current(owner)) throw new Superseded();
  };
  const invalidate = () => {
    generation += 1;
    viewRequest += 1;
    requests.forEach((request) => request.abort());
    requests.clear();
    cookie = null;
    return generation;
  };

  // Serialize SecureStore operations as well as guarding UI responses. A save
  // already executing when logout occurs must finish before logout's clear.
  const store = <T>(owner: number, operation: () => Promise<T>): Promise<T> => {
    const result = storeQueue
      .catch(() => undefined)
      .then(async () => {
        assertCurrent(owner);
        const value = await operation();
        assertCurrent(owner);
        return value;
      });
    storeQueue = result;
    return result;
  };

  const clearSaved = async (owner: number) => {
    cleanupRequired = true;
    await store(owner, () => dependencies.credentials.clear());
    cleanupRequired = false;
  };

  const failSession = async (
    owner: number,
    message: string,
    status: 'signed-out' | 'error' = 'signed-out',
  ) => {
    if (!current(owner)) return;
    const next = invalidate();
    publish(cleanSnapshot({ status, user: null, message }));
    try {
      await clearSaved(next);
    } catch {
      if (current(next)) {
        publish(
          cleanSnapshot({
            status: 'error',
            user: null,
            message: 'Could not remove the saved session. Try signing out again.',
          }),
        );
      }
    }
  };

  const adoptCookie = async (response: FetchResponse, owner: number) => {
    assertCurrent(owner);
    let next: string | null | undefined;
    try {
      next = readSessionCookie(response.headers, secureTransport, now());
    } catch {
      await failSession(owner, storageMessage, 'error');
      throw new Superseded();
    }
    if (next === undefined) return;
    if (next === null) {
      await failSession(owner, expiredMessage);
      throw new Superseded();
    }
    if (next === cookie) return;
    try {
      await store(owner, () => dependencies.credentials.save(next));
      assertCurrent(owner);
      cookie = next;
    } catch (error) {
      if (!(error instanceof Superseded)) await failSession(owner, storageMessage, 'error');
      throw new Superseded();
    }
  };

  const request = async (
    path: string,
    owner: number,
    options: {
      method?: 'GET' | 'POST';
      body?: unknown;
      sessionCookie?: string | null;
      logout?: boolean;
    } = {},
  ): Promise<unknown> => {
    assertCurrent(owner);
    const abort = new AbortController();
    requests.add(abort);
    const timeout = setTimeout(() => abort.abort(), 20_000);
    try {
      const outgoingCookie = options.sessionCookie === undefined ? cookie : options.sessionCookie;
      const response = await dependencies.fetch(`${apiBase}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Origin: authOrigin,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(outgoingCookie ? { Cookie: outgoingCookie } : {}),
        },
        credentials: 'omit',
        redirect: 'error',
        signal: abort.signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      assertCurrent(owner);
      // Logout responses must never reinstall a cookie, even a surprising one.
      if (!options.logout) await adoptCookie(response, owner);
      assertCurrent(owner);
      if (response.status === 401 && !options.logout) {
        await failSession(owner, expiredMessage);
        throw new Superseded();
      }
      if (!response.ok) {
        const message =
          response.status === 403
            ? 'You no longer have access to this group.'
            : response.status === 404
              ? 'This group is no longer available.'
              : response.status === 429
                ? 'Too many attempts. Wait a moment and try again.'
                : 'The server could not complete this request. Please try again.';
        throw new RequestError(message, response.status);
      }
      const body = await response.json();
      assertCurrent(owner);
      return body;
    } catch (error) {
      if (!current(owner)) throw new Superseded();
      if (error instanceof RequestError || error instanceof Superseded) throw error;
      throw new RequestError('Could not reach SplitBook. Check your connection and try again.');
    } finally {
      clearTimeout(timeout);
      requests.delete(abort);
    }
  };

  const loadGroups = async (owner: number) => {
    assertCurrent(owner);
    const view = ++viewRequest;
    publish({
      ...snapshot,
      screen: 'groups',
      groups: { status: 'loading', data: [], message: null },
      detail: { status: 'idle', id: null, data: null, message: null },
    });
    try {
      const groups = parseGroups(await request('/api/groups', owner));
      assertCurrent(owner);
      if (view !== viewRequest) return;
      // Do not display a malformed server response as somebody else's groups.
      if (
        !groups.every((group) =>
          group.members.some((member) => member.user.id === snapshot.auth.user?.id),
        )
      ) {
        throw new RequestError('The server returned invalid group membership. Please refresh.');
      }
      publish({ ...snapshot, groups: { status: 'ready', data: groups, message: null } });
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      publish({
        ...snapshot,
        groups: {
          status: error instanceof RequestError && error.status === 403 ? 'denied' : 'error',
          data: [],
          message:
            error instanceof RequestError
              ? error.message
              : 'The server returned invalid group data. Please refresh.',
        },
      });
    }
  };

  const verifyAndLoad = async (owner: number) => {
    const session = parseSession(await request('/api/auth/get-session', owner));
    assertCurrent(owner);
    if (!session || session.expiresAt.getTime() <= now()) {
      await failSession(owner, expiredMessage);
      return;
    }
    publish(cleanSnapshot({ status: 'authenticated', user: session.user, message: null }));
    await loadGroups(owner);
  };

  const restore = async () => {
    const owner = invalidate();
    publish(cleanSnapshot({ status: 'restoring', user: null, message: null }));
    try {
      if (!config.developmentPersonaEnabled) {
        await clearSaved(owner);
        publish(cleanSnapshot({ status: 'signed-out', user: null, message: disabledMessage }));
        return;
      }
      if (cleanupRequired) await clearSaved(owner);
      const saved = await store(owner, () => dependencies.credentials.load());
      if (!saved) {
        publish(cleanSnapshot({ status: 'signed-out', user: null, message: null }));
        return;
      }
      if (!validSessionCookie(saved, secureTransport)) {
        await failSession(owner, 'Your saved session could not be restored. Please sign in again.');
        return;
      }
      cookie = saved;
      await verifyAndLoad(owner);
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      publish(
        cleanSnapshot({
          status: 'error',
          user: null,
          message:
            error instanceof RequestError
              ? error.message
              : 'Could not restore your session. Please try again.',
        }),
      );
    }
  };

  const signIn = async (personaId: string) => {
    const owner = invalidate();
    publish(cleanSnapshot({ status: 'signing-in', user: null, message: null }));
    try {
      await clearSaved(owner);
      if (!config.developmentPersonaEnabled) {
        publish(cleanSnapshot({ status: 'signed-out', user: null, message: disabledMessage }));
        return;
      }
      if (!['alex', 'sam', 'priya'].includes(personaId))
        throw new RequestError('Choose an available development persona.');
      parseSignIn(
        await request('/api/auth/demo-persona/sign-in', owner, {
          method: 'POST',
          body: { personaId },
        }),
      );
      if (!cookie)
        throw new RequestError('The server did not provide a usable session. Please try again.');
      await verifyAndLoad(owner);
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      const message =
        error instanceof RequestError && error.status === 404
          ? 'Development personas are unavailable. Check that the development server is in demo mode and seeded.'
          : error instanceof RequestError && error.status === 403
            ? 'Development persona sign-in was denied by the server.'
            : error instanceof RequestError
              ? error.message
              : 'Could not sign in with this development persona. Please try again.';
      await failSession(owner, message);
    }
  };

  const openGroup = async (id: string) => {
    if (snapshot.auth.status !== 'authenticated') return;
    const owner = generation;
    const view = ++viewRequest;
    publish({
      ...snapshot,
      screen: 'group',
      detail: { status: 'loading', id, data: null, message: null },
    });
    try {
      if (!objectId.safeParse(id).success)
        throw new RequestError('This group is no longer available.', 404);
      const group = parseGroup(await request(`/api/groups/${id}`, owner));
      assertCurrent(owner);
      if (view !== viewRequest) return;
      if (
        group.id !== id ||
        !group.members.some((member) => member.user.id === snapshot.auth.user?.id)
      ) {
        throw new RequestError('You no longer have access to this group.', 403);
      }
      publish({ ...snapshot, detail: { status: 'ready', id, data: group, message: null } });
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      const denied = error instanceof RequestError && [403, 404].includes(error.status);
      publish({
        ...snapshot,
        groups: denied
          ? { ...snapshot.groups, data: snapshot.groups.data.filter((group) => group.id !== id) }
          : snapshot.groups,
        detail: {
          status: error instanceof RequestError && error.status === 403 ? 'denied' : 'error',
          id,
          data: null,
          message:
            error instanceof RequestError
              ? error.message
              : 'The server returned invalid group data. Please try again.',
        },
      });
    }
  };

  const back = () => {
    viewRequest += 1;
    publish({
      ...snapshot,
      screen: 'groups',
      detail: { status: 'idle', id: null, data: null, message: null },
    });
  };

  const refresh = async () => {
    if (['restoring', 'signing-in'].includes(snapshot.auth.status)) return;
    if (snapshot.auth.status !== 'authenticated') return restore();
    if (snapshot.screen === 'group' && snapshot.detail.id) return openGroup(snapshot.detail.id);
    return loadGroups(generation);
  };

  const signOut = async () => {
    const oldCookie = cookie;
    const owner = invalidate();
    publish(cleanSnapshot({ status: 'signed-out', user: null, message: null }));
    try {
      await clearSaved(owner);
    } catch {
      if (current(owner)) {
        publish(
          cleanSnapshot({
            status: 'error',
            user: null,
            message: 'Could not remove the saved session. Try signing out again.',
          }),
        );
      }
      return;
    }
    if (!oldCookie || !current(owner)) return;
    try {
      await request('/api/auth/sign-out', owner, {
        method: 'POST',
        body: {},
        sessionCookie: oldCookie,
        logout: true,
      });
    } catch {
      if (current(owner)) {
        publish(
          cleanSnapshot({
            status: 'signed-out',
            user: null,
            message: 'Signed out on this device. The server could not confirm session revocation.',
          }),
        );
      }
    }
  };

  return {
    restore,
    signIn,
    openGroup,
    back,
    refresh,
    signOut,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      invalidate();
      listeners.clear();
      snapshot = cleanSnapshot({ status: 'signed-out', user: null, message: null });
    },
  };
}

export type MobileController = ReturnType<typeof createMobileController>;
