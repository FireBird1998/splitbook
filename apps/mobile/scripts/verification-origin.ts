import assert from 'node:assert/strict';

export function localOrigin(): string {
  const url = new URL(process.env.MOBILE_VERIFY_URL ?? 'http://127.0.0.1:4138');
  assert.ok(
    url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    'MOBILE_VERIFY_URL must be a plain HTTP loopback origin. Remote targets are refused.',
  );
  return url.origin;
}
