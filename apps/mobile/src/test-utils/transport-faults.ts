import type { FetchResponse, MobileTimer } from '../data/types';

/**
 * A reply that hangs until its request is aborted: before the headers, or once they arrived,
 * while the body is read. It then fails as expo/fetch does, with the same error as a lost
 * connection, so only the transport can tell what aborted it.
 */
export function hangUntilAborted(
  init: RequestInit,
  stage: 'headers' | 'body',
  status = 200,
): Promise<FetchResponse> {
  const aborted = () =>
    new Promise<never>((_, reject) => {
      const fail = () => reject(new TypeError('Network request failed'));
      if (init.signal?.aborted) fail();
      else init.signal?.addEventListener('abort', fail);
    });
  return stage === 'headers'
    ? aborted()
    : Promise.resolve({ ok: status < 300, status, headers: new Headers(), json: aborted });
}

/** A reply whose headers arrive, then whose body stops arriving, as when the connection drops. */
export function bodyFails(): FetchResponse {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.reject(new TypeError('Network request failed')),
  };
}

/**
 * What a gateway in front of SplitBook answers with when it can't reach SplitBook: no body, a
 * page of its own, or JSON without the `code` every SplitBook error carries.
 */
export const gatewayBodies = {
  empty: '',
  HTML: '<html><body><h1>The upstream server is unavailable.</h1></body></html>',
  'uncoded JSON': '{"error":"Upstream unavailable"}',
};
export type GatewayBody = keyof typeof gatewayBodies;

/** A gateway's 502, 503 or 504, with one of its bodies. */
export const gatewayReply = (status: number, body: GatewayBody = 'HTML') =>
  new Response(gatewayBodies[body] || null, { status });

/** Every gateway status with every gateway body, for `it.each`. */
export const gatewayFailures = [502, 503, 504].flatMap((status) =>
  (Object.keys(gatewayBodies) as GatewayBody[]).map((body) => [status, body] as const),
);

/** A timer the test runs by hand: `elapse(ms)` runs every pending timer of that length. */
export function manualTimer() {
  const pending = new Set<{ ms: number; run: () => void }>();
  const timer: MobileTimer = (run, ms) => {
    const entry = { ms, run };
    pending.add(entry);
    return () => pending.delete(entry);
  };
  return {
    timer,
    elapse(ms: number) {
      for (const entry of [...pending])
        if (entry.ms === ms) {
          pending.delete(entry);
          entry.run();
        }
    },
  };
}

/**
 * `promise`, or a failure once `ms` of real time pass without it settling, so a request that
 * is never aborted fails its test instead of hanging it.
 */
export async function within<T>(promise: Promise<T>, ms = 1_000): Promise<T> {
  let late: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        late = setTimeout(() => reject(new Error(`Still waiting after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(late);
  }
}
