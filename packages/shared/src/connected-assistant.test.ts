import { describe, expect, it } from 'vitest';
import { assistantGroupCount, connectedAssistantAccessLabel } from './connected-assistant';

describe('a Connected assistant’s access, as Settings words it', () => {
  it('says Read only for ledger access, and Read only + To review when it may prepare Expenses', () => {
    expect(connectedAssistantAccessLabel('Ledger')).toBe('Read only');
    expect(connectedAssistantAccessLabel('Ledger + To review')).toBe('Read only + To review');
  });

  it('shows an access it doesn’t know as the server sent it, rather than hide it', () => {
    expect(connectedAssistantAccessLabel('Ledger + Receipts')).toBe('Ledger + Receipts');
  });
});

describe('how many Groups an assistant reaches (#620)', () => {
  const group = (id: string, rule: 'allowed' | 'not_allowed' = 'allowed') => ({ id, rule });

  it('counts the member’s Groups it isn’t left out of, and that allow assistants', () => {
    const groups = [group('a'), group('b'), group('c', 'not_allowed'), group('d')];
    expect(assistantGroupCount(groups, ['b'])).toEqual({ reached: 2, of: 4 });
    expect(assistantGroupCount(groups, [])).toEqual({ reached: 3, of: 4 });
  });

  it('ignores Groups left out that the member is no longer in, and counts a Group once', () => {
    expect(assistantGroupCount([group('a'), group('b')], ['z', 'b', 'b'])).toEqual({
      reached: 1,
      of: 2,
    });
    expect(assistantGroupCount([], ['a'])).toEqual({ reached: 0, of: 0 });
  });
});
