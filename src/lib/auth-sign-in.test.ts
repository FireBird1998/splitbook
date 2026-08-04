import { describe, expect, it } from 'vitest';
import { getSignInProvider } from '@/lib/auth-sign-in';

describe('getSignInProvider', () => {
  it('uses the demo credentials provider in demo mode', () => {
    expect(getSignInProvider('demo')).toBe('demo');
  });

  it('uses Google OAuth in google mode (the default mode)', () => {
    expect(getSignInProvider('google')).toBe('google');
  });
});
