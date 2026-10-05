import { describe, expect, it, vi } from 'vitest';
import { hangUntilAborted, manualTimer } from '../test-utils/transport-faults';
import { createTransport, RequestError, Superseded } from './transport';
import type { FetchResponse } from './types';

// No controller command passes a signal or reads a failure's kind yet (#214 will), so these
// drive the transport itself.
const groupId = 'b00000000000000000000001';
const unreachable = 'Could not reach SplitBook. Check your connection and try again.';
const incomplete = 'The server could not complete this request. Please try again.';

function setup(reply: (init: RequestInit) => Promise<FetchResponse>) {
  let generation = 1;
  const sent: string[] = [];
  const hooks: string[] = [];
  const timers = manualTimer();
  const transport = createTransport({
    apiBase: 'http://localhost:4145',
    authOrigin: 'http://localhost:4145',
    secureTransport: false,
    googleEnabled: false,
    fetch: (url, init) => {
      sent.push(`${init.method} ${new URL(url).pathname}`);
      return reply(init);
    },
    now: () => Date.parse('2026-10-05T12:00:00.000Z'),
    timer: timers.timer,
    session: {
      current: (owner) => owner === generation,
      cookie: () => 'better-auth.session_token=alex.signature',
      saveCookie: async () => undefined,
    },
    onExpired: async (_owner, message) => {
      hooks.push(`expired: ${message}`);
    },
    onGroupDenied: async (id, status) => {
      // The purge takes a moment; the caller's error waits for it.
      await new Promise((resolve) => setTimeout(resolve, 5));
      hooks.push(`denied: ${id} ${status}`);
    },
  });
  return {
    request: transport.request,
    sent,
    hooks,
    elapse: timers.elapse,
    /** What `invalidate()` does: a new generation, then every request in flight aborted. */
    changeSession: () => {
      generation += 1;
      transport.abortAll();
    },
  };
}

/** What the request's caller catches. */
const caught = (request: Promise<unknown>) =>
  request.then(
    () => expect.unreachable('The request answered'),
    (error: unknown) => error,
  );

describe('a caller’s own cancel', () => {
  it.each(['headers', 'body'] as const)(
    'ends as cancelled, never as a network failure, when the caller aborts while waiting for the %s',
    async (stage) => {
      const t = setup((init) => hangUntilAborted(init, stage));
      const caller = new AbortController();
      const error = caught(t.request(`/api/groups/${groupId}`, 1, { signal: caller.signal }));
      await vi.waitFor(() => expect(t.sent).toEqual([`GET /api/groups/${groupId}`]));
      caller.abort();
      expect(await error).toBeInstanceOf(RequestError);
      expect(await error).toMatchObject({
        kind: 'cancelled',
        networkFailure: false,
        status: 0,
        code: null,
      });
      expect(t.sent).toHaveLength(1);
      expect(t.hooks).toEqual([]);
    },
  );

  it('ends a request whose signal was already aborted as cancelled', async () => {
    const t = setup((init) => hangUntilAborted(init, 'headers'));
    const caller = new AbortController();
    caller.abort();
    expect(
      await caught(t.request(`/api/groups/${groupId}`, 1, { signal: caller.signal })),
    ).toMatchObject({ kind: 'cancelled', networkFailure: false });
  });

  it.each([
    ['headers', true],
    ['body', false],
  ] as const)(
    'keeps today’s timeout while waiting for the %s, even when the caller aborts after it',
    async (stage, networkFailure) => {
      const t = setup((init) => hangUntilAborted(init, stage));
      const caller = new AbortController();
      const error = caught(t.request(`/api/groups/${groupId}`, 1, { signal: caller.signal }));
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      t.elapse(20_000);
      caller.abort();
      expect(await error).toBeInstanceOf(RequestError);
      expect(await error).toMatchObject({
        kind: 'timeout',
        message: unreachable,
        status: 0,
        code: null,
        networkFailure,
      });
    },
  );

  it('ends in Superseded when the session changes, whatever the caller does after', async () => {
    const t = setup((init) => hangUntilAborted(init, 'headers'));
    const caller = new AbortController();
    const error = caught(t.request(`/api/groups/${groupId}`, 1, { signal: caller.signal }));
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.changeSession();
    caller.abort();
    expect(await error).toBeInstanceOf(Superseded);
  });

  it('answers as before when the caller never cancels', async () => {
    const t = setup(async () => Response.json({ status: 200, data: { _id: groupId } }));
    const caller = new AbortController();
    await expect(
      t.request(`/api/groups/${groupId}`, 1, { signal: caller.signal }),
    ).resolves.toEqual({ status: 200, data: { _id: groupId } });
    caller.abort();
    expect(t.sent).toEqual([`GET /api/groups/${groupId}`]);
  });
});

describe('failure kinds (#208)', () => {
  it.each([
    [400, 'VALIDATION_ERROR', 'rejected', incomplete],
    [403, null, 'access-denied', 'You no longer have access to this group.'],
    [404, null, 'access-denied', 'This group is no longer available.'],
    [408, null, 'server-error', incomplete],
    [409, 'STALE_REVISION', 'stale-revision', incomplete],
    [409, 'IDEMPOTENCY_CONFLICT', 'rejected', incomplete],
    [412, null, 'rejected', incomplete],
    [422, 'VALIDATION_ERROR', 'rejected', incomplete],
    [428, 'REVISION_REQUIRED', 'rejected', incomplete],
    [429, null, 'server-error', 'Too many attempts. Wait a moment and try again.'],
    [500, null, 'server-error', incomplete],
    [502, null, 'server-error', incomplete],
    [503, 'ACTIVITY_BACKLOG_FULL', 'server-error', incomplete],
    [504, null, 'server-error', incomplete],
  ])(
    'gives a %i (%s) the %s kind, with today’s message, status and code',
    async (status, code, kind, message) => {
      const t = setup(async () =>
        Response.json({ error: 'Server text', ...(code ? { code } : {}) }, { status }),
      );
      const error = await caught(
        t.request(`/api/groups/${groupId}/expenses`, 1, { method: 'POST', body: {} }),
      );
      expect(error).toBeInstanceOf(RequestError);
      expect(error).toMatchObject({
        kind,
        message,
        status,
        code,
        networkFailure: false,
        serverMessage: 'Server text',
      });
    },
  );

  it('gives a 401 that doesn’t end the session the signed-out kind', async () => {
    const t = setup(async () => Response.json({}, { status: 401 }));
    expect(
      await caught(t.request('/api/auth/sign-out', 1, { method: 'POST', body: {}, logout: true })),
    ).toMatchObject({ kind: 'signed-out', status: 401, networkFailure: false });
    expect(t.hooks).toEqual([]);
  });

  it('calls a lost connection a network failure, and a 2xx it can’t read malformed', async () => {
    const lost = setup(() => Promise.reject(new TypeError('Network request failed')));
    expect(await caught(lost.request('/api/groups', 1))).toMatchObject({
      kind: 'network',
      message: unreachable,
      status: 0,
      networkFailure: true,
    });
    const unreadable = setup(async () => new Response('<html>', { status: 200 }));
    expect(await caught(unreadable.request('/api/groups', 1))).toMatchObject({
      kind: 'malformed',
      message: unreachable,
      status: 0,
      networkFailure: false,
    });
  });
});

describe('the hooks', () => {
  it('ends the session on any other 401, and the caller gets Superseded', async () => {
    const t = setup(async () => Response.json({}, { status: 401 }));
    expect(await caught(t.request(`/api/groups/${groupId}`, 1))).toBeInstanceOf(Superseded);
    expect(t.hooks).toEqual(['expired: Your session has expired. Sign in again to continue.']);
  });

  it.each([
    [403, `/api/groups/${groupId}/expenses`, true],
    [403, `/api/groups/${groupId}`, true],
    [404, `/api/groups/${groupId}`, true],
    [404, `/api/groups/${groupId}/expenses`, false],
    [403, '/api/groups', false],
  ])('on a %i from %s, runs the Group denial first: %s', async (status, path, denied) => {
    const t = setup(async () => Response.json({}, { status }));
    expect(await caught(t.request(path, 1))).toMatchObject({ kind: 'access-denied', status });
    expect(t.hooks).toEqual(denied ? [`denied: ${groupId} ${status}`] : []);
  });
});
