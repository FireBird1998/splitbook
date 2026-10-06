import { describe, expect, it, vi } from 'vitest';
import {
  bodyFails,
  gatewayFailures,
  gatewayReply,
  hangUntilAborted,
  manualTimer,
  within,
} from '../test-utils/transport-faults';
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
  /** Each timer started, and how many times it was ended. */
  const started: { ms: number; ended: number }[] = [];
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
    timer: (run, ms) => {
      const entry = { ms, ended: 0 };
      started.push(entry);
      const end = timers.timer(run, ms);
      return () => {
        entry.ended += 1;
        end();
      };
    },
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
    started,
    elapse: timers.elapse,
    /** What `invalidate()` does: a new generation, then every request in flight aborted. */
    changeSession: () => {
      generation += 1;
      transport.abortAll();
    },
  };
}

type Setup = ReturnType<typeof setup>;

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

  it('sends nothing for a signal already aborted, and ends as cancelled', async () => {
    const t = setup((init) => hangUntilAborted(init, 'headers'));
    const caller = new AbortController();
    caller.abort();
    const error = await within(
      caught(t.request(`/api/groups/${groupId}`, 1, { signal: caller.signal })),
    );
    expect(error).toBeInstanceOf(RequestError);
    expect(error).toMatchObject({ kind: 'cancelled', networkFailure: false, status: 0 });
    expect(t.sent).toEqual([]);
    expect(t.started).toEqual([]);
  });

  // #231: a timeout after the headers counts as can't reach the server too.
  it.each(['headers', 'body'] as const)(
    'times out as can’t reach the server while waiting for the %s, even when the caller aborts after it',
    async (stage) => {
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
        networkFailure: true,
      });
    },
  );

  it.each([
    ['with', true],
    ['without', false],
  ])(
    'ends a request %s a caller signal in Superseded when the session changes',
    async (_, withSignal) => {
      const t = setup((init) => hangUntilAborted(init, 'headers'));
      const caller = new AbortController();
      const error = caught(
        t.request(`/api/groups/${groupId}`, 1, withSignal ? { signal: caller.signal } : {}),
      );
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      t.changeSession();
      // The session's own abort ends it: nothing else does.
      expect(await within(error)).toBeInstanceOf(Superseded);
      caller.abort();
    },
  );

  it('answers as before when the caller never cancels', async () => {
    const t = setup(async () => Response.json({ status: 200, data: { _id: groupId } }));
    const caller = new AbortController();
    await expect(
      t.request(`/api/groups/${groupId}`, 1, { signal: caller.signal }),
    ).resolves.toEqual({ status: 200, data: { _id: groupId } });
    caller.abort();
    expect(t.sent).toEqual([`GET /api/groups/${groupId}`]);
  });

  it('ends as cancelled, never as can’t reach the server, when the caller aborts while a gateway’s 502 body is read (#231)', async () => {
    const t = setup((init) => hangUntilAborted(init, 'body', 502));
    const caller = new AbortController();
    const error = caught(t.request(`/api/groups/${groupId}`, 1, { signal: caller.signal }));
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    caller.abort();
    expect(await within(error)).toMatchObject({ kind: 'cancelled', networkFailure: false });
    expect(t.sent).toHaveLength(1);
  });

  it.each([
    [500, `/api/groups/${groupId}/expenses`, []],
    // Its code is in the body the caller cancelled, so it is never read.
    [503, `/api/groups/${groupId}/expenses`, []],
    [429, `/api/groups/${groupId}/expenses`, []],
    // The headers already said denied, so the Group is still purged first.
    [403, `/api/groups/${groupId}/expenses`, [`denied: ${groupId} 403`]],
  ])(
    'ends a %i as cancelled when the caller aborts while its body is read',
    async (status, path, hooks) => {
      let reading = false;
      const t = setup((init) =>
        hangUntilAborted(init, 'body', status).then((response) => ({
          ...response,
          json: () => {
            reading = true;
            return response.json();
          },
        })),
      );
      const caller = new AbortController();
      const error = caught(t.request(path, 1, { signal: caller.signal }));
      await vi.waitFor(() => expect(reading).toBe(true));
      caller.abort();
      const cancelled = await within(error);
      expect(cancelled).toBeInstanceOf(RequestError);
      expect(cancelled).toMatchObject({
        kind: 'cancelled',
        networkFailure: false,
        status: 0,
        code: null,
        serverMessage: null,
      });
      expect(t.hooks).toEqual(hooks);
      expect(t.sent).toHaveLength(1);
    },
  );
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
    [503, 'ACTIVITY_BACKLOG_FULL', 'server-error', incomplete],
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

  it.each(gatewayFailures)(
    'gives a gateway’s %i with a body that is %s the network kind, with no status or code (#231)',
    async (status, body) => {
      const t = setup(async () => gatewayReply(status, body));
      const error = await caught(
        t.request(`/api/groups/${groupId}/expenses`, 1, { method: 'POST', body: {} }),
      );
      expect(error).toBeInstanceOf(RequestError);
      expect(error).toMatchObject({
        kind: 'network',
        message: unreachable,
        status: 0,
        code: null,
        networkFailure: true,
        serverMessage: null,
      });
      expect(t.sent).toHaveLength(1);
      expect(t.hooks).toEqual([]);
    },
  );

  it('gives a body that stops arriving the network kind (#231)', async () => {
    const t = setup(async () => bodyFails());
    expect(await caught(t.request('/api/groups', 1))).toMatchObject({
      kind: 'network',
      message: unreachable,
      status: 0,
      networkFailure: true,
    });
    expect(t.sent).toHaveLength(1);
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

describe('cleaning up after each request', () => {
  type Ending = [
    name: string,
    reply: (init: RequestInit) => Promise<FetchResponse>,
    end?: (t: Setup, caller: AbortController) => void,
  ];
  const endings: Ending[] = [
    ['an answer', async () => Response.json({ status: 200, data: [] })],
    ['an HTTP error', async () => Response.json({}, { status: 500 })],
    ['a lost connection', () => Promise.reject(new TypeError('Network request failed'))],
    ['a timeout', (init) => hangUntilAborted(init, 'headers'), (t) => t.elapse(20_000)],
    ['a session change', (init) => hangUntilAborted(init, 'body'), (t) => t.changeSession()],
  ];
  const cancel: Ending = [
    'the caller’s cancel',
    (init) => hangUntilAborted(init, 'body'),
    (_t, caller) => caller.abort(),
  ];
  /** Runs one request to its end, however it ends. */
  async function settle(t: Setup, [, , end]: Ending, caller: AbortController, signal: boolean) {
    const settled = t.request('/api/groups', 1, signal ? { signal: caller.signal } : {}).then(
      () => undefined,
      () => undefined,
    );
    if (end) {
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      end(t, caller);
    }
    await within(settled);
  }

  it.each(endings)('ends the timeout exactly once after %s', async (...ending) => {
    const t = setup(ending[1]);
    await settle(t, ending, new AbortController(), false);
    expect(t.started).toEqual([{ ms: 20_000, ended: 1 }]);
  });

  it.each([...endings, cancel])('lets go of the caller’s signal after %s', async (...ending) => {
    const t = setup(ending[1]);
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, 'addEventListener');
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    await settle(t, ending, caller, true);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0]).toBe('abort');
    expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]);
    expect(t.started).toEqual([{ ms: 20_000, ended: 1 }]);
  });
});
