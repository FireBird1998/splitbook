import { describe, expect, it } from 'vitest';
import { manualTimer, within } from '../test-utils/transport-faults';
import { createTransport, RequestError } from './transport';
import type { FetchResponse } from './types';

// #214: losing a Group removes its queries, and the query cache then aborts the signal of the
// read that was refused. That must not cost the refusal its reply: a phone can't read a body
// once its request is aborted. Nor may a reply's body hold up losing the Group.
const groupId = 'b00000000000000000000001';
const refusal = { error: 'You were removed from this Group.', code: 'NOT_A_MEMBER' };

/**
 * A refusal whose body can be read only until its request is aborted, as on a phone. It arrives
 * at once, or never: then reading it waits until the request is aborted, and fails.
 */
function refused(init: RequestInit, body: 'prompt' | 'stalled'): FetchResponse {
  const reply = Response.json(refusal, { status: 403 });
  const aborted = () => Promise.reject(new TypeError('Network request failed'));
  return {
    ok: false,
    status: 403,
    headers: reply.headers,
    json: () =>
      init.signal?.aborted
        ? aborted()
        : body === 'prompt'
          ? reply.json()
          : new Promise((_, reject) =>
              init.signal?.addEventListener('abort', () =>
                reject(new TypeError('Network request failed')),
              ),
            ),
  };
}

function setup(body: 'prompt' | 'stalled', timed = false) {
  const caller = new AbortController();
  const purges: string[] = [];
  const timers = manualTimer();
  /** Each timer started, and how many times it was ended. */
  const started: { ms: number; ended: number }[] = [];
  const transport = createTransport({
    apiBase: 'http://localhost:4145',
    authOrigin: 'http://localhost:4145',
    secureTransport: false,
    googleEnabled: false,
    fetch: async (_url, init) => refused(init, body),
    now: () => Date.parse('2026-10-05T12:00:00.000Z'),
    ...(timed && {
      timer: (run: () => void, ms: number) => {
        const entry = { ms, ended: 0 };
        started.push(entry);
        const end = timers.timer(run, ms);
        return () => {
          entry.ended += 1;
          end();
        };
      },
    }),
    session: {
      current: (owner) => owner === 1,
      cookie: () => 'better-auth.session_token=alex.signature',
      saveCookie: async () => undefined,
    },
    onExpired: async () => undefined,
    // As the controller's purge does through the query cache.
    onGroupDenied: async (id) => {
      purges.push(id);
      caller.abort();
    },
  });
  const request = transport.request(`/api/groups/${groupId}`, 1, { signal: caller.signal }).then(
    () => expect.unreachable('The request answered'),
    (failure: unknown) => failure,
  );
  return { request, purges, started, elapse: timers.elapse };
}

/** Lets the replies already given reach the transport. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a refusal from a Group', () => {
  it('keeps its code and server message when losing the Group aborts its read', async () => {
    const t = setup('prompt');
    const error = await t.request;
    expect(error).toBeInstanceOf(RequestError);
    expect(error).toMatchObject({
      status: 403,
      kind: 'access-denied',
      code: 'NOT_A_MEMBER',
      serverMessage: 'You were removed from this Group.',
      message: 'You no longer have access to this group.',
    });
    expect(t.purges).toEqual([groupId]);
  });

  it('loses the Group within a second when its body stalls, and still ends as access denied', async () => {
    const t = setup('stalled', true);
    await settle();
    expect(t.purges).toEqual([]);
    // A second, never the 20-second timeout: the Group goes without the body.
    t.elapse(1_000);
    const error = await within(t.request);
    expect(t.purges).toEqual([groupId]);
    expect(error).toBeInstanceOf(RequestError);
    expect(error).toMatchObject({
      status: 403,
      kind: 'access-denied',
      code: null,
      serverMessage: null,
      message: 'You no longer have access to this group.',
    });
    expect(t.started).toEqual([
      { ms: 20_000, ended: 1 },
      { ms: 1_000, ended: 1 },
    ]);
  });

  it('ends the wait for its body as soon as the body arrives', async () => {
    const t = setup('prompt', true);
    expect(await within(t.request)).toMatchObject({ code: 'NOT_A_MEMBER' });
    expect(t.purges).toEqual([groupId]);
    expect(t.started).toEqual([
      { ms: 20_000, ended: 1 },
      { ms: 1_000, ended: 1 },
    ]);
  });
});
