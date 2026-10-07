/**
 * When each read last answered, for "Updated 10:42 AM" on Home (#306).
 *
 * `fetcher` notes every successful answer here, whichever hook started the request: Home and
 * the sidebar share their reads, and either one's poll may be the one that fetches. Only a
 * successful answer counts, so a failed refresh never makes old figures look new. Browser-only
 * state, like SWR's own cache: the server never calls `fetcher`.
 */

const answeredAt = new Map<string, number>();
const listeners = new Set<() => void>();

/** Record that `path` just answered successfully. */
export function noteAnswered(path: string, at: number = Date.now()): void {
  answeredAt.set(path, at);
  for (const listener of listeners) listener();
}

/** When `path` last answered successfully (epoch ms), or null if it hasn't in this page. */
export function lastAnswered(path: string): number | null {
  return answeredAt.get(path) ?? null;
}

/** For `useSyncExternalStore`: called after every answer. */
export function subscribeToAnswers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
