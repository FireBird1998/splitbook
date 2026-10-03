/** HTTP commands require the revision that was displayed to the editor. */
export function requestRevision(request: Request): number {
  // Business revisions are not HTTP entity tags; hosts may evaluate If-Match themselves.
  // Accept the legacy header while older clients are being upgraded.
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
