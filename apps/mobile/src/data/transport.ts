import { readSessionCookie } from './cookies';
import type { FetchResponse, MobileFetch, MobileTimer } from './types';

export const expiredMessage = 'Your session has expired. Sign in again to continue.';
export const storageMessage = 'Could not safely save your session. Please try signing in again.';

/** How long a request may take, from sending it until its whole body is read. */
const REQUEST_TIMEOUT_MS = 20_000;

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
 * - `network`: no reply arrived;
 * - `timeout`: the 20-second limit passed, before or after the headers;
 * - `cancelled`: the caller's own signal ended it. It is never a reason to show a saved copy;
 * - `signed-out`: a 401 that doesn't end the session here (sign-out, the staging check, Google
 *   sign-in);
 * - `access-denied`: a 403, or a 404: the member can't see it, or it's gone;
 * - `stale-revision`: a 409 `STALE_REVISION`: someone saved a newer revision first;
 * - `rejected`: any other definite 4xx, so any 4xx but 401, 403, 404, 408 and 429: the server
 *   refused this request as sent;
 * - `malformed`: a 2xx whose body can't be read;
 * - `server-error`: a 5xx, 408 or 429, or an answer the app can't use.
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
 * session or a lost Group through `onExpired` and `onGroupDenied`.
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

  const request = async (
    path: string,
    owner: number,
    options: RequestOptions = {},
  ): Promise<unknown> => {
    assertCurrent(owner);
    // Invitations can open even after restoration fails. Every ordinary request
    // must verify staging before it can send or adopt a session cookie.
    if (path !== '/.well-known/splitbook-mobile.json') await verifyGoogleBackend(owner);
    assertCurrent(owner);
    const abort = new AbortController();
    // expo/fetch throws the same error for an abort before the headers as for a lost connection,
    // and React Native's AbortSignal carries no reason, so the first source is recorded here.
    let aborted: AbortSource | null = null;
    const stop = (source: AbortSource) => {
      aborted ??= source;
      abort.abort();
    };
    requests.add(stop);
    const endTimeout = timer(() => stop('timeout'), REQUEST_TIMEOUT_MS);
    // Linked with a listener of its own, not AbortSignal.any, so a cancel is told apart.
    const cancel = () => stop('caller');
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener('abort', cancel);
    let received = false;
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
      assertCurrent(owner);
      // Logout responses must never reinstall a cookie, even a surprising one.
      if (!options.logout && options.adoptSession !== false) await adoptCookie(response, owner);
      assertCurrent(owner);
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
        const deniedGroup = /^\/api\/groups\/([a-f\d]{24})(?:\/|\?|$)/i.exec(path)?.[1];
        if (
          (response.status === 403 ||
            (response.status === 404 && path === `/api/groups/${deniedGroup}`)) &&
          deniedGroup
        )
          await onGroupDenied(deniedGroup, response.status, owner);
        const message =
          response.status === 403
            ? 'You no longer have access to this group.'
            : response.status === 404
              ? 'This group is no longer available.'
              : response.status === 429
                ? 'Too many attempts. Wait a moment and try again.'
                : 'The server could not complete this request. Please try again.';
        const details: unknown = await response.json().catch(() => null);
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
        throw new RequestError(message, response.status, code, false, serverMessage);
      }
      const body = await response.json();
      assertCurrent(owner);
      return body;
    } catch (error) {
      if (!session.current(owner) || aborted === 'session') throw new Superseded();
      if (error instanceof RequestError || error instanceof Superseded) throw error;
      if (aborted === 'caller')
        throw new RequestError('This request was cancelled.', 0, null, false, null, 'cancelled');
      throw new RequestError(
        'Could not reach SplitBook. Check your connection and try again.',
        0,
        null,
        !received,
        null,
        aborted === 'timeout' ? 'timeout' : received ? 'malformed' : 'network',
      );
    } finally {
      endTimeout();
      requests.delete(stop);
      options.signal?.removeEventListener('abort', cancel);
    }
  };

  const verifyGoogleBackend = async (owner: number) => {
    if (!googleEnabled || verifiedGoogleBackend === owner) return;
    let value: unknown;
    try {
      value = await request('/.well-known/splitbook-mobile.json', owner, {
        sessionCookie: null,
        adoptSession: false,
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
    assertCurrent(owner);
    verifiedGoogleBackend = owner;
  };

  /** A session change: every request in flight ends, and its caller gets `Superseded`. */
  const abortAll = () => {
    requests.forEach((stop) => stop('session'));
    requests.clear();
  };

  return { request, verifyGoogleBackend, abortAll };
}
