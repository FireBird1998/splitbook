import { describe, expect, it } from 'vitest';
import {
  assistantAttributionSchema,
  cleanAssistantName,
  cleanPublishedAssistantName,
  draftAttributionSchema,
} from './draft-attribution';

describe('Draft attribution', () => {
  it('only accepts assistant provenance on Expenses', () => {
    expect(assistantAttributionSchema.safeParse({ kind: 'member' }).success).toBe(false);
    expect(assistantAttributionSchema.safeParse(undefined).success).toBe(false);
    expect(assistantAttributionSchema.parse({ kind: 'assistant', name: 'Claude' })).toEqual({
      kind: 'assistant',
      name: 'Claude',
    });
  });
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
    ['A \u200b B', 'A B'],
    ['a'.repeat(45), 'a'.repeat(40)],
    ['🤖'.repeat(45), '🤖'.repeat(40)],
  ])('cleans client-controlled display names: %j', (input, expected) => {
    expect(cleanAssistantName(input)).toBe(expected);
    expect(cleanAssistantName(cleanAssistantName(input))).toBe(expected);
  });
  it.each([
    ['  Synthetic\n\t Assistant  ', 'Synthetic Assistant'],
    [' \t\u0000\u200b ', null],
    ['', null],
    // Letters that draw as blanks (#614).
    ['\u3164\u3164', null],
    ['\u2800', null],
    ['\u115f\u1160\uffa0', null],
    ['Cl\u3164aude', 'Claude'],
  ])(
    'says when a published name has nothing left to show, so callers choose the fallback: %j',
    (input, expected) => {
      expect(cleanPublishedAssistantName(input)).toBe(expected);
    },
  );
});
