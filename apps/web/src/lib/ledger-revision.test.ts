import { describe, expect, it } from 'vitest';
import { assertExpectedRevision, requestRevision } from './ledger-revision';

const request = (headers: Record<string, string>) =>
  new Request('http://localhost/api/groups/g/expenses/e', { method: 'PATCH', headers });

/** What the route does with the revision a client sent, against a saved revision of 3. */
function outcome(headers: Record<string, string>) {
  try {
    assertExpectedRevision(3, requestRevision(request(headers)));
    return 'accepted';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('the revision an edit or deletion was made against', () => {
  it('is read from X-Splitbook-Revision, and from If-Match when an older client sends only that', () => {
    expect(requestRevision(request({ 'X-Splitbook-Revision': '3' }))).toBe(3);
    expect(requestRevision(request({ 'If-Match': '3' }))).toBe(3);
    expect(requestRevision(request({ 'If-Match': '"0"' }))).toBe(0);
  });

  it('comes from X-Splitbook-Revision when both headers are sent', () => {
    expect(requestRevision(request({ 'X-Splitbook-Revision': '4', 'If-Match': '3' }))).toBe(4);
    expect(outcome({ 'X-Splitbook-Revision': '3', 'If-Match': '2' })).toBe('accepted');
    expect(outcome({ 'X-Splitbook-Revision': '2', 'If-Match': '3' })).toBe('STALE_REVISION');
  });

  it('is refused as stale or required with the same codes as before', () => {
    expect(outcome({ 'X-Splitbook-Revision': '2' })).toBe('STALE_REVISION');
    expect(outcome({ 'If-Match': '2' })).toBe('STALE_REVISION');
    expect(outcome({})).toBe('REVISION_REQUIRED');
    expect(outcome({ 'If-Match': 'abc' })).toBe('REVISION_REQUIRED');
  });

  it.each(['', '-1', '1.5', '*', 'abc', '9007199254740992'])(
    'is required when X-Splitbook-Revision is %j, even beside a valid If-Match',
    (value) => {
      expect(outcome({ 'X-Splitbook-Revision': value, 'If-Match': '3' })).toBe('REVISION_REQUIRED');
    },
  );
});
