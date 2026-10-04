/**
 * HTTP commands require the revision that was displayed to the editor. Clients send it in
 * `X-Splitbook-Revision`: a host may evaluate `If-Match` as an HTTP precondition and answer 412
 * after the route has saved. `If-Match` is still read for older clients that send only that.
 */
export function requestRevision(request: Request): number {
  const value = request.headers.get('X-Splitbook-Revision') ?? request.headers.get('If-Match');
  if (!value || !/^(?:\d+|"\d+")$/.test(value)) return Number.NaN;
  const revision = Number(value.replaceAll('"', ''));
  return Number.isSafeInteger(revision) ? revision : Number.NaN;
}

/** Undefined is reserved for trusted in-process callers, not the HTTP adapter. */
export function assertExpectedRevision(actual: number | undefined, expected?: number): void {
  if (expected === undefined) return;
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('REVISION_REQUIRED');
  if ((actual ?? 0) !== expected) throw new Error('STALE_REVISION');
}
