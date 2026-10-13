import { describe, expect, it } from 'vitest';
import { parseInvitationLink, parseToReviewLink } from './invitation-links';

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

it('accepts only the exact To review link on this environment', () => {
  const id = 'a00000000000000000000010';
  const origin = 'https://staging.splitbook.test';
  expect(parseToReviewLink(`${origin}/groups/${id}/review`, origin)).toBe(id);
  for (const value of [
    `${origin}/groups/${id}/review/`,
    `${origin}/groups/${id}/review?other=1`,
    `${origin}/groups/${id}/expenses`,
    `${origin}/groups/../groups/${id}/review`,
    `${origin}/groups/${id}%2freview`,
    `https://other.test/groups/${id}/review`,
    `${origin}/groups/bad/review`,
    `${origin}/groups/${id}/review#x`,
  ])
    expect(parseToReviewLink(value, origin)).toBeNull();
});
