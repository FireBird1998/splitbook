import { describe, expect, it } from 'vitest';
import { cleanAssistantName, draftAttributionSchema } from './draft-attribution';

describe('Draft attribution', () => {
  it('reads legacy missing attribution as the member', () => {
    expect(draftAttributionSchema.parse(undefined)).toEqual({ kind: 'member' });
    expect(draftAttributionSchema.parse({ kind: 'assistant', name: 'ChatGPT' })).toEqual({
      kind: 'assistant',
      name: 'ChatGPT',
    });
  });
  it.each([
    ['  ChatGPT  ', 'ChatGPT'],
    ['  Synthetic\n\t Assistant  ', 'Synthetic Assistant'],
    ['Cl\u0000au\u007fde\u0085', 'Claude'],
    ['\u202eClaude\u202c', 'Claude'],
    [' \t\u0000\u200b ', 'Assistant'],
    ['', 'Assistant'],
    ['a'.repeat(45), 'a'.repeat(40)],
    ['🤖'.repeat(45), '🤖'.repeat(40)],
  ])('cleans client-controlled display names: %j', (input, expected) => {
    expect(cleanAssistantName(input)).toBe(expected);
  });
});
