import { describe, it, expect } from 'vitest';
import { invitationEmailMatches } from './invitation-ownership';

describe('invitationEmailMatches', () => {
  it('matches case-insensitively', () => {
    expect(invitationEmailMatches('A@B.com', 'a@b.com')).toBe(true);
  });
  it('rejects different emails', () => {
    expect(invitationEmailMatches('a@b.com', 'c@d.com')).toBe(false);
  });
});
