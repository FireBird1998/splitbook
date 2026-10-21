import { describe, expect, it } from 'vitest';
import { assistantReachesGroup } from './assistant-reach';

describe('assistantReachesGroup', () => {
  it('leaves an excluded Group out even when assistants are allowed', () => {
    expect(assistantReachesGroup({ id: 'a', assistantRule: 'allowed' }, ['a'])).toBe(false);
  });
  it('leaves a Not allowed Group out even when the connection includes it', () => {
    expect(assistantReachesGroup({ id: 'a', assistantRule: 'not_allowed' }, [])).toBe(false);
  });
  it('treats a Group with no stored rule as Allowed', () => {
    expect(assistantReachesGroup({ id: 'a' }, ['another-group'])).toBe(true);
  });
  it('includes an Allowed Group and accepts a capitalised route id', () => {
    expect(assistantReachesGroup({ id: 'a', assistantRule: 'allowed' })).toBe(true);
    expect(assistantReachesGroup({ id: 'AB12', assistantRule: 'allowed' }, ['ab12'])).toBe(false);
  });
});
