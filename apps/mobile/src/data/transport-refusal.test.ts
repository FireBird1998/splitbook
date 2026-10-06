import { expect, it } from 'vitest';
import { createTransport, RequestError } from './transport';
import type { FetchResponse } from './types';

// #214: losing a Group removes its queries, and the query cache then aborts the signal of the
// read that was refused. That must not cost the refusal its reply: a phone can't read a body
// once its request is aborted.
const groupId = 'b00000000000000000000001';

it('keeps a refusal’s code and server message when losing the Group aborts its read', async () => {
  const caller = new AbortController();
  const transport = createTransport({
    apiBase: 'http://localhost:4145',
    authOrigin: 'http://localhost:4145',
    secureTransport: false,
    googleEnabled: false,
    fetch: async (_url, init): Promise<FetchResponse> => {
      const reply = Response.json(
        { error: 'You were removed from this Group.', code: 'NOT_A_MEMBER' },
        { status: 403 },
      );
      return {
        ok: false,
        status: 403,
        headers: reply.headers,
        json: () =>
          init.signal?.aborted
            ? Promise.reject(new TypeError('Network request failed'))
            : reply.json(),
      };
    },
    now: () => Date.parse('2026-10-05T12:00:00.000Z'),
    session: {
      current: (owner) => owner === 1,
      cookie: () => 'better-auth.session_token=alex.signature',
      saveCookie: async () => undefined,
    },
    onExpired: async () => undefined,
    // As the controller's purge does through the query cache.
    onGroupDenied: async () => caller.abort(),
  });
  const error = await transport
    .request(`/api/groups/${groupId}`, 1, { signal: caller.signal })
    .then(
      () => expect.unreachable('The request answered'),
      (failure: unknown) => failure,
    );
  expect(error).toBeInstanceOf(RequestError);
  expect(error).toMatchObject({
    status: 403,
    kind: 'access-denied',
    code: 'NOT_A_MEMBER',
    serverMessage: 'You were removed from this Group.',
    message: 'You no longer have access to this group.',
  });
});
