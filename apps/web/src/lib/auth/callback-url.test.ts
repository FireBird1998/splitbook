import { describe, expect, it } from 'vitest';
import { isSafeCallbackUrl, resolveCallbackUrl } from '@/lib/auth/callback-url';

describe('callback URLs', () => {
  it('keeps same-origin paths, including query strings', () => {
    expect(resolveCallbackUrl('/groups/abc')).toBe('/groups/abc');
    expect(resolveCallbackUrl('/join/XYZ?ref=1')).toBe('/join/XYZ?ref=1');
    expect(resolveCallbackUrl('/')).toBe('/');
  });

  it('falls back for anything that could leave the origin', () => {
    expect(resolveCallbackUrl('https://evil.example')).toBe('/dashboard');
    expect(resolveCallbackUrl('//evil.example/path')).toBe('/dashboard');
    expect(resolveCallbackUrl('/\\evil.example')).toBe('/dashboard');
    expect(resolveCallbackUrl('/ok\\..')).toBe('/dashboard');
    expect(resolveCallbackUrl('/line\nbreak')).toBe('/dashboard');
    expect(resolveCallbackUrl('javascript:alert(1)')).toBe('/dashboard');
  });

  it('falls back for empty values and honours a custom fallback', () => {
    expect(resolveCallbackUrl(null)).toBe('/dashboard');
    expect(resolveCallbackUrl(undefined)).toBe('/dashboard');
    expect(resolveCallbackUrl('')).toBe('/dashboard');
    expect(resolveCallbackUrl('', '/join/ABC')).toBe('/join/ABC');
  });

  it('exposes the predicate for callers that need a boolean', () => {
    expect(isSafeCallbackUrl('/x')).toBe(true);
    expect(isSafeCallbackUrl(42)).toBe(false);
  });
});
