import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { MCP_DRAFT_SCOPE } from '@/lib/mcp/config';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import { ConnectionsList } from './ConnectionsSetting';

/* Settings' Connected assistants once loaded, rendered to static markup. */

const shown = text(
  renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(ConnectionsList, {
        data: {
          resource: 'https://splitbook.example/mcp',
          connections: [
            {
              id: 'c1',
              clientId: 'https://chatgpt.com/oauth/client.json',
              name: 'ChatGPT',
              lastUsedAt: new Date(2026, 7, 29, 10, 41).toISOString(),
              scopes: ['ledger:read', MCP_DRAFT_SCOPE],
            },
            {
              id: 'c2',
              clientId: 'https://assistant.example.test/client.json',
              name: 'Synthetic Assistant',
              lastUsedAt: null,
              scopes: ['ledger:read'],
            },
          ],
          nextOffset: null,
        },
        busy: null,
        onRevoke: () => {},
        onLoadMore: () => {},
      }),
    ),
  ),
);

describe('Settings → Connected assistants', () => {
  it('shows metadata names and last use rather than client addresses', () => {
    expect(shown).toContain('Last used 29 Aug');
    expect(shown).not.toContain('oauth/client.json');
  });

  it('names To review, not Drafts, and says deleting an item there is permanent (#579)', () => {
    expect(shown).toContain(
      'Assistants can read your ledger. If you also let one prepare Expenses, it can add, change and permanently delete items in your To review. Only you can save Expenses in Splitbook.',
    );
    expect(shown).toContain('ChatGPT Ledger + To review');
    expect(shown).toContain('Synthetic Assistant Ledger Not used yet Disconnect');
    expect(shown).toContain(
      'Disconnecting blocks further requests and keeps what’s in your To review. Previously shared information may remain in your assistant.',
    );
    expect(shown).not.toMatch(/\bDrafts?\b/);
  });
});
