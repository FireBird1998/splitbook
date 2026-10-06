import { readSessionCookie } from './cookies';
import type { FetchResponse, MobileFetch, MobileTimer } from './types';

export const expiredMessage = 'Your session has expired. Sign in again to continue.';
export const storageMessage = 'Could not safely save your session. Please try signing in again.';

/** How long a request may take, from sending it until its whole body is read. */
const REQUEST_TIMEOUT_MS = 20_000;
/**
 * How long losing a Group waits for its refusal's body, whose code and message it keeps: the
 * Group's content goes at once, never after a reply that stalls (#214).
 */
const DENIAL_BODY_MS = 1_000;

/** The platform's own timer: the default for `MobileDependencies.timer`. */
const platformTimer: MobileTimer = (run, ms) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

/**
 * The work belongs to a session that has ended or changed, or something newer replaced it: what
 * it would return is never shown or kept. Callers get it after a 401, a session change, or a
 * cookie this device can't keep.
 */
export class Superseded extends Error {}

/**
 * What a failed request means, for callers to branch on instead of messages or codes (ADR 0006):
 * - `network`: SplitBook couldn't be reached: no reply arrived, its body stopped arriving, or a
 *   gateway in front of SplitBook answered 502, 503 or 504 without a SplitBook error code;
 * - `timeout`: the 20-second limit passed, before or after the headers;
 * - `cancelled`: the caller's own signal ended it. It is never a reason to show a saved copy;
 * - `signed-out`: a 401 that doesn't end the session here (sign-out, the staging check, Google
 *   sign-in);
 * - `access-denied`: a 403, or a 404: the member can't see it, or it's gone;
 * - `stale-revision`: a 409 `STALE_REVISION`: someone saved a newer revision first;
 * - `rejected`: any other definite 4xx, so any 4xx but 401, 403, 404, 408 and 429: the server
 *   refused this request as sent;
 * - `malformed`: a 2xx whose body arrived whole but isn't JSON;
 * - `server-error`: any other 5xx, a 408 or 429, or an answer the app can't use.
 */
export type FailureKind =
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'signed-out'
  | 'access-denied'
  | 'stale-revision'
  | 'rejected'
  | 'malformed'
  | 'server-error';

/** The kind a reply's status and code stand for, or a failure before any reply. */
function failureKind(status: number, code: string | null, networkFailure: boolean): FailureKind {
  if (networkFailure) return 'network';
  if (status === 401) return 'signed-out';
  if (status === 403 || status === 404) return 'access-denied';
  if (status === 409 && code === 'STALE_REVISION') return 'stale-revision';
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return 'rejected';
  return 'server-error';
}

export class RequestError extends Error {
  readonly kind: FailureKind;
  constructor(
    message: string,
    readonly status = 0,
    readonly code: string | null = null,
    readonly networkFailure = false,
    /** The server's own `error` text, shown only where it is known to be member-facing copy. */
    readonly serverMessage: string | null = null,
    /** Given only where the status, code and `networkFailure` don't already say it. */
    kind?: FailureKind,
  ) {
    super(message);
    this.kind = kind ?? failureKind(status, code, networkFailure);
  }
}

/** The caller's own signal ended the request. */
const cancelled = () =>
  new RequestError('This request was cancelled.', 0, null, false, null, 'cancelled');

/**
 * SplitBook couldn't be reached, so callers treat it as being offline: the saved copy, with the
 * time it was last verified. It carries no status, so nothing takes it for SplitBook's answer.
 */
const unreachable = (kind: 'network' | 'timeout') =>
  new RequestError(
    'Could not reach SplitBook. Check your connection and try again.',
    0,
    null,
    true,
    null,
    kind,
  );

/** The statuses a gateway in front of SplitBook answers with when it can't reach SplitBook. */
const gatewayStatuses = [502, 503, 504];

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Sent as `X-Splitbook-Revision`: the revision an edit or delete was made against. */
  revision?: number;
  body?: unknown;
  /** Sent instead of the session's cookie; null sends none. */
  sessionCookie?: string | null;
  /** A sign-out: its reply never installs a cookie, and its 401 doesn't end the session. */
  logout?: boolean;
  /** False: its reply's cookie isn't adopted, and its 401 doesn't end the session. */
  adoptSession?: boolean;
  /** The body exactly as it was stored before sending. */
  serializedBody?: string;
  idempotencyKey?: string;
  /**
   * The caller's own cancel. Aborting it ends the request with the `cancelled` kind, never as a
   * network failure. Only reads take one: writes stay explicit and are never cancelled.
   */
  signal?: AbortSignal;
  /**
   * Sign-in only. The server may start a session as soon as the request arrives, so a session
   * change doesn't abort it. A session its reply sets after a session change is handed here to
   * be revoked, never adopted or saved, and the caller then gets `Superseded`.
   */
  onAbandoned?: (cookie: string) => Promise<void>;
  /**
   * Sent for no session (`revokeDetached` only): no session change ends it or makes its answer
   * `Superseded`, and it changes no session state.
   */
  detached?: boolean;
}

export interface TransportDependencies {
  /** The backend origin, without /api. */
  apiBase: string;
  /** Sent as `Origin`. */
  authOrigin: string;
  /** The backend is HTTPS, so only secure session cookies are accepted. */
  secureTransport: boolean;
  /** Google builds check the staging backend, for this client, before any ordinary request. */
  googleEnabled: boolean;
  googleWebClientId?: string;
  fetch: MobileFetch;
  now: () => number;
  /** Runs the 20-second timeout. Defaults to the platform's own. */
  timer?: MobileTimer;
  /**
   * The session, which the controller owns. The transport only reads it, and keeps the cookie
   * each reply sets.
   */
  session: {
    /** `owner` is still the session's generation: anything for an older one is dropped. */
    current(owner: number): boolean;
    /** The cookie ordinary requests send. */
    cookie(): string | null;
    /**
     * Saves a cookie a reply set for `owner`'s session, and sends it from then on. Rejects with
     * `Superseded` once `owner` is no longer current.
     */
    saveCookie(owner: number, cookie: string): Promise<void>;
  };
  /**
   * The session ended (a 401 or an expired cookie), or its cookie can't be kept. Called with the
   * message and status to show, and a cookie to revoke when it can't be kept. The caller then
   * gets `Superseded`.
   */
  onExpired(
    owner: number,
    message: string,
    status?: 'signed-out' | 'error',
    unsaved?: string | null,
  ): Promise<void>;
  /**
   * The member lost access to a Group: a 403 under `/api/groups/:id`, or a 404 on exactly
   * `/api/groups/:id`. It finishes before the caller gets the error.
   */
  onGroupDenied(groupId: string, status: number, owner: number): Promise<void>;
}

/** What aborted a request first: a session change, the timeout, or the caller. */
type AbortSource = 'session' | 'timeout' | 'caller';

/**
 * The Android network layer: it sends each request with its headers, keeps the session cookie
 * each reply sets, checks the staging backend on Google builds, runs the 20-second timeout, and
 * turns every failure into a `RequestError` with a kind. It holds no session state and never
 * retries or queues: the controller keeps the session and its reads, and hears of an ended
 * session or a lost Group through `onExpired` and `onGroupDenied`, and of a replaced sign-in's
 * session through that sign-in's `onAbandoned`.
 */
export function createTransport({
  apiBase,
  authOrigin,
  secureTransport,
  googleEnabled,
  googleWebClientId,
  fetch,
  now,
  timer = platformTimer,
  session,
  onExpired,
  onGroupDenied,
}: TransportDependencies) {
  /** Requests in flight, each by what aborts it. */
  const requests = new Set<(source: AbortSource) => void>();
  let verifiedGoogleBackend = -1;

  const assertCurrent = (owner: number) => {
    if (!session.current(owner)) throw new Superseded();
  };

  const adoptCookie = async (response: FetchResponse, owner: number) => {
    assertCurrent(owner);
    let next: string | null | undefined;
    try {
      next = readSessionCookie(response.headers, secureTransport, now());
    } catch {
      // The session in use is still valid on the server: revoked before it's given up.
      await onExpired(owner, storageMessage, 'error', session.cookie());
      throw new Superseded();
    }
    if (next === undefined) return;
    if (next === null) {
      await onExpired(owner, expiredMessage);
      throw new Superseded();
    }
    if (next === session.cookie()) return;
    try {
      await session.saveCookie(owner, next);
    } catch (error) {
      if (!(error instanceof Superseded)) await onExpired(owner, storageMessage, 'error', next);
      throw new Superseded();
    }
  };

  /** A replaced sign-in's reply: the session it sets, if any, goes to be revoked. */
  const abandon = async (
    response: FetchResponse,
    onAbandoned: (cookie: string) => Promise<void>,
  ) => {
    let abandoned: string | null | undefined;
    try {
      abandoned = readSessionCookie(response.headers, secureTransport, now());
    } catch {
      // A cookie this device can't read can't be sent to revoke either.
      return;
    }
    if (abandoned) await onAbandoned(abandoned);
  };

  const request = async (
    path: string,
    owner: number,
    options: RequestOptions = {},
  ): Promise<unknown> => {
    const live = () => options.detached === true || session.current(owner);
    const assertLive = () => {
      if (!live()) throw new Superseded();
    };
    assertLive();
    // Invitations can open even after restoration fails. Every ordinary request
    // must verify staging before it can send or adopt a session cookie.
    if (path !== '/.well-known/splitbook-mobile.json')
      await verifyGoogleBackend(owner, options.detached);
    assertLive();
    // A request its caller has already cancelled is never sent.
    if (options.signal?.aborted) throw cancelled();
    const abort = new AbortController();
    // expo/fetch throws the same error for an abort before the headers as for a lost connection,
    // and React Native's AbortSignal carries no reason, so the first source is recorded here.
    let aborted: AbortSource | null = null;
    const stop = (source: AbortSource) => {
      aborted ??= source;
      abort.abort();
    };
    // A sign-in outlives a session change: its reply is the only way to learn its session.
    if (!options.onAbandoned && !options.detached) requests.add(stop);
    const endTimeout = timer(() => stop('timeout'), REQUEST_TIMEOUT_MS);
    // Linked with a listener of its own, not AbortSignal.any, so a cancel is told apart.
    const cancel = () => stop('caller');
    options.signal?.addEventListener('abort', cancel);
    let received = false;
    /** The headers arrived and the body is being read. */
    let reading = false;
    try {
      const outgoingCookie =
        options.sessionCookie === undefined ? session.cookie() : options.sessionCookie;
      const response = await fetch(`${apiBase}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Origin: authOrigin,
          ...(options.body === undefined && options.serializedBody === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
          // Not If-Match: a host may evaluate that as an HTTP precondition and answer 412
          // after the route has saved.
          ...(options.revision === undefined
            ? {}
            : { 'X-Splitbook-Revision': String(options.revision) }),
          ...(outgoingCookie ? { Cookie: outgoingCookie } : {}),
        },
        credentials: 'omit',
        redirect: 'error',
        signal: abort.signal,
        ...(options.serializedBody === undefined
          ? options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }
          : { body: options.serializedBody }),
      });
      received = true;
      if (options.onAbandoned && !live()) await abandon(response, options.onAbandoned);
      assertLive();
      // Logout responses must never reinstall a cookie, even a surprising one.
      if (!options.logout && options.adoptSession !== false) await adoptCookie(response, owner);
      assertLive();
      if (
        response.status === 401 &&
        !options.logout &&
        options.adoptSession !== false &&
        path !== '/api/auth/sign-in/social'
      ) {
        await onExpired(owner, expiredMessage);
        throw new Superseded();
      }
      if (!response.ok) {
        // The path decides the denial purge, never the failure's kind: a 404 under a Group's
        // Expenses is access-denied too, but purges nothing.
        const deniedGroup = /^\/api\/groups\/([a-f\d]{24})(?:\/|\?|$)/i.exec(path)?.[1];
        const denied =
          (response.status === 403 ||
            (response.status === 404 && path === `/api/groups/${deniedGroup}`)) &&
          deniedGroup;
        const reading = response.json().catch(() => null);
        let endWait = () => {};
        // Read before losing the Group, which aborts its reads: a reply can't be read after that.
        // A denial waits for it only briefly, then goes on without its code and message.
        const details: unknown = denied
          ? await Promise.race([
              reading,
              new Promise<null>((resolve) => {
                endWait = timer(() => resolve(null), DENIAL_BODY_MS);
              }),
            ]).finally(() => endWait())
          : await reading;
        if (denied) await onGroupDenied(denied, response.status, owner);
        const message =
          response.status === 403
            ? 'You no longer have access to this group.'
            : response.status === 404
              ? 'This group is no longer available.'
              : response.status === 429
                ? 'Too many attempts. Wait a moment and try again.'
                : 'The server could not complete this request. Please try again.';
        const code =
          details &&
          typeof details === 'object' &&
          'code' in details &&
          typeof details.code === 'string'
            ? details.code
            : null;
        const serverMessage =
          details &&
          typeof details === 'object' &&
          'error' in details &&
          typeof details.error === 'string'
            ? details.error
            : null;
        // The caller cancelled while the body was read. A denial has already been purged above;
        // only the error the caller gets is its own.
        if (aborted === 'caller') throw cancelled();
        // SplitBook's own errors carry a code, so a gateway answered: SplitBook wasn't reached.
        if (gatewayStatuses.includes(response.status) && code === null)
          throw unreachable(aborted === 'timeout' ? 'timeout' : 'network');
        throw new RequestError(message, response.status, code, false, serverMessage);
      }
      reading = true;
      const body = await response.json();
      assertLive();
      return body;
    } catch (error) {
      if (!live() || aborted === 'session') throw new Superseded();
      if (error instanceof RequestError || error instanceof Superseded) throw error;
      if (aborted === 'caller') throw cancelled();
      // Only a body that arrived whole, but isn't JSON, is malformed; so is a failure after the
      // headers that isn't the body's. A body that stopped arriving, or timed out, never arrived.
      if (received && aborted !== 'timeout' && (!reading || error instanceof SyntaxError))
        throw new RequestError(
          'Could not reach SplitBook. Check your connection and try again.',
          0,
          null,
          false,
          null,
          'malformed',
        );
      throw unreachable(aborted === 'timeout' ? 'timeout' : 'network');
    } finally {
      endTimeout();
      requests.delete(stop);
      options.signal?.removeEventListener('abort', cancel);
    }
  };

  /** `detached`: checked for a detached request, every time, and kept for no session. */
  const verifyGoogleBackend = async (owner: number, detached = false) => {
    if (!googleEnabled || (!detached && verifiedGoogleBackend === owner)) return;
    let value: unknown;
    try {
      value = await request('/.well-known/splitbook-mobile.json', owner, {
        sessionCookie: null,
        adoptSession: false,
        detached,
      });
    } catch (error) {
      if (error instanceof RequestError && error.status) {
        throw new RequestError(
          'This server is not configured for the Android beta. Please contact the beta organizer.',
        );
      }
      throw error;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !('environment' in value) ||
      value.environment !== 'staging' ||
      !('googleWebClientId' in value) ||
      value.googleWebClientId !== googleWebClientId
    ) {
      throw new RequestError(
        'This build does not match the staging login configuration. Please contact the beta organizer.',
      );
    }
    if (detached) return;
    assertCurrent(owner);
    verifiedGoogleBackend = owner;
  };

  /**
   * Revokes a session nothing here holds any more, such as one a replaced sign-in's reply set.
   * It is sent once, with its own cookie and only to `/api/auth/sign-out`, after the backend
   * passes the Google check. It belongs to no session, so no session change ends it, and it
   * changes nothing here. Resolves whether the server confirmed it.
   */
  const revokeDetached = async (cookie: string) => {
    try {
      // No session sends it, so no generation is current or stale for it.
      await request('/api/auth/sign-out', Number.NaN, {
        method: 'POST',
        body: {},
        sessionCookie: cookie,
        logout: true,
        detached: true,
      });
      return true;
    } catch {
      return false;
    }
  };

  /**
   * A session change: every request in flight but a sign-in or a detached one ends, and its
   * caller gets `Superseded`. A sign-in's caller gets it once the reply lands (see
   * `onAbandoned`); a detached request belongs to no session.
   */
  const abortAll = () => {
    requests.forEach((stop) => stop('session'));
    requests.clear();
  };

  return { request, verifyGoogleBackend, revokeDetached, abortAll };
}
