import { describe, expect, it } from 'vitest';
import { connectedAssistantAccessLabel } from './connected-assistant';

describe('a Connected assistant’s access, as Settings words it', () => {
  it('says Read only for ledger access, and Read only + To review when it may prepare Expenses', () => {
    expect(connectedAssistantAccessLabel('Ledger')).toBe('Read only');
    expect(connectedAssistantAccessLabel('Ledger + To review')).toBe('Read only + To review');
  });

  it('shows an access it doesn’t know as the server sent it, rather than hide it', () => {
    expect(connectedAssistantAccessLabel('Ledger + Receipts')).toBe('Ledger + Receipts');
  });
});
