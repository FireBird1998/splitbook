import { describe, expect, it } from 'vitest';
import { assertExpectedRevision, requestRevision } from './ledger-revision';

const request = (headers: Record<string, string>) =>
  new Request('https://example.test', { headers });

describe('ledger revision transport', () => {
  it('checks an application revision without HTTP entity-tag preconditions', () => {
    const revision = requestRevision(request({ 'X-Splitbook-Revision': '3' }));
    expect(revision).toBe(3);
    expect(() => assertExpectedRevision(3, revision)).not.toThrow();
    expect(() => assertExpectedRevision(4, revision)).toThrow('STALE_REVISION');
  });
  it('accepts legacy clients during rollout', () => {
    expect(requestRevision(request({ 'If-Match': '"0"' }))).toBe(0);
  });
  it.each(['', '-1', '1.5', '*', 'abc', '9007199254740992'])(
    'fails closed for invalid revision %j',
    (value) => {
      const revision = requestRevision(request({ 'X-Splitbook-Revision': value, 'If-Match': '3' }));
      expect(() => assertExpectedRevision(3, revision)).toThrow('REVISION_REQUIRED');
    },
  );
  it('requires a revision and prefers the application header when both are supplied', () => {
    expect(() => assertExpectedRevision(0, requestRevision(request({})))).toThrow(
      'REVISION_REQUIRED',
    );
    expect(requestRevision(request({ 'X-Splitbook-Revision': '4', 'If-Match': '3' }))).toBe(4);
  });
});
