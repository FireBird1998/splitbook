import { describe, it, expect } from 'vitest';
import { escapeRegex } from './escape-regex';

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('a+b*c?')).toBe('a\\+b\\*c\\?');
    expect(escapeRegex('(test)')).toBe('\\(test\\)');
    expect(escapeRegex('foo.bar')).toBe('foo\\.bar');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeRegex('coffee')).toBe('coffee');
  });
});
