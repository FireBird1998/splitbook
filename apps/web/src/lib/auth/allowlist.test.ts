import { describe, expect, it } from 'vitest';
import {
  EMAIL_NOT_ALLOWED,
  isEmailAllowed,
  normaliseEmail,
  parseAllowedEmails,
  validateAllowedUser,
} from '@/lib/auth/allowlist';

describe('parseAllowedEmails', () => {
  it('trims, lower-cases and drops blank entries', () => {
    expect([...parseAllowedEmails(' owner@example.com, Invited@Example.COM ,, ')]).toEqual([
      'owner@example.com',
      'invited@example.com',
    ]);
  });

  it('is empty for a missing or blank variable', () => {
    expect(parseAllowedEmails(undefined).size).toBe(0);
    expect(parseAllowedEmails('').size).toBe(0);
    expect(parseAllowedEmails(' , ').size).toBe(0);
  });
});

describe('normaliseEmail', () => {
  it('normalises strings and rejects everything else', () => {
    expect(normaliseEmail('  Person@Example.com ')).toBe('person@example.com');
    expect(normaliseEmail('')).toBeNull();
    expect(normaliseEmail('   ')).toBeNull();
    expect(normaliseEmail(null)).toBeNull();
    expect(normaliseEmail(42)).toBeNull();
  });
});

describe('isEmailAllowed', () => {
  it('accepts an allowlisted Google identity after normalising case and whitespace', () => {
    const env = { AUTH_ALLOWED_EMAILS: ' owner@example.com, Invited@Example.COM ' };
    expect(isEmailAllowed('invited@example.com', env)).toBe(true);
    expect(isEmailAllowed('  INVITED@example.com', env)).toBe(true);
  });

  it('rejects an identity that is not allowlisted', () => {
    expect(
      isEmailAllowed('stranger@example.com', { AUTH_ALLOWED_EMAILS: 'owner@example.com' }),
    ).toBe(false);
  });

  it.each([undefined, '', ' , '])('fails closed when AUTH_ALLOWED_EMAILS is %j', (raw) => {
    expect(isEmailAllowed('owner@example.com', { AUTH_ALLOWED_EMAILS: raw })).toBe(false);
  });

  it('rejects a missing email', () => {
    expect(isEmailAllowed(undefined, { AUTH_ALLOWED_EMAILS: 'owner@example.com' })).toBe(false);
    expect(isEmailAllowed(null, { AUTH_ALLOWED_EMAILS: 'owner@example.com' })).toBe(false);
  });
});

describe('validateAllowedUser (Better Auth validateUserInfo gate)', () => {
  const env = { AUTH_ALLOWED_EMAILS: 'owner@example.com' };

  it('admits an allowlisted user by returning nothing', () => {
    expect(validateAllowedUser({ user: { email: 'Owner@Example.com' } }, env)).toBeUndefined();
  });

  it('rejects with the email_not_allowed code', () => {
    expect(validateAllowedUser({ user: { email: 'stranger@example.com' } }, env)).toEqual({
      error: EMAIL_NOT_ALLOWED,
      errorDescription: expect.stringContaining('not invited'),
    });
  });

  it('rejects a user without an email', () => {
    expect(validateAllowedUser({ user: {} }, env)?.error).toBe(EMAIL_NOT_ALLOWED);
  });
});
