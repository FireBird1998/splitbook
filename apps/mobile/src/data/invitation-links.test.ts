import { describe, expect, it } from 'vitest';
import { parseInvitationLink } from './invitation-links';

describe('invitation link boundary', () => {
  it('reads a canonical invitation at the configured origin and normalizes its code', () => {
    expect(
      parseInvitationLink(
        'https://staging.splitbook.test/join/ABC012EF',
        'https://staging.splitbook.test',
      ),
    ).toBe('abc012ef');
  });

  it('keeps development invitations on their exact configured server and port', () => {
    const origin = 'http://127.0.0.1:4138';
    expect(parseInvitationLink(`${origin}/join/abc012ef`, origin)).toBe('abc012ef');
    for (const value of [
      'https://production.splitbook.test/join/abc012ef',
      'http://127.0.0.1:4139/join/abc012ef',
      'https://127.0.0.1:4138/join/abc012ef',
    ])
      expect(parseInvitationLink(value, origin)).toBeNull();
  });

  it('rejects noncanonical links instead of normalizing credentials, paths, or extra parameters', () => {
    const origin = 'https://staging.splitbook.test';
    for (const value of [
      `${origin}/join/abc012ef?redirect=elsewhere`,
      `${origin}/join/abc012ef#continue`,
      'https://person:password@staging.splitbook.test/join/abc012ef',
      `${origin}/%6aoin/abc012ef`,
      `${origin}/join/%61bc012ef`,
      `${origin}/ignored/../join/abc012ef`,
      `${origin}/join/abc012ef/`,
      `${origin}/join/abc012ef\n`,
      `${origin}/join/abc012e`,
      `${origin}/join/not-hex!`,
      'splitbook-dev://join/abc012ef',
      '/join/abc012ef',
      'not a link',
    ])
      expect(parseInvitationLink(value, origin)).toBeNull();
  });

  it('fails closed when the configured origin is not an HTTP(S) origin', () => {
    const link = 'https://staging.splitbook.test/join/abc012ef';
    for (const origin of [
      'https://staging.splitbook.test/api',
      'https://person:password@staging.splitbook.test',
      'https://staging.splitbook.test?token=private',
      'https://staging.splitbook.test#fragment',
      'file:///tmp',
      'not an origin',
    ])
      expect(parseInvitationLink(link, origin)).toBeNull();
  });
});
