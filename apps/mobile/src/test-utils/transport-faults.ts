import type { FetchResponse, MobileTimer } from '../data/types';

/**
 * A reply that hangs until its request is aborted: before the headers, or once they arrived,
 * while the body is read. It then fails as expo/fetch does, with the same error as a lost
 * connection, so only the transport can tell what aborted it.
 */
export function hangUntilAborted(
  init: RequestInit,
  stage: 'headers' | 'body',
): Promise<FetchResponse> {
  const aborted = () =>
    new Promise<never>((_, reject) => {
      const fail = () => reject(new TypeError('Network request failed'));
      if (init.signal?.aborted) fail();
      else init.signal?.addEventListener('abort', fail);
    });
  return stage === 'headers'
    ? aborted()
    : Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: aborted });
}

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
