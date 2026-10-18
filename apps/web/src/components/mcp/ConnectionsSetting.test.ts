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
              scopes: ['ledger:read', MCP_DRAFT_SCOPE],
            },
            { id: 'c2', clientId: 'Synthetic Assistant', scopes: ['ledger:read'] },
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
  it('names To review, not Drafts, and says deleting an item there is permanent (#579)', () => {
    expect(shown).toContain(
      'Assistants can read your ledger. If you also let one prepare Expenses, it can add, change and permanently delete items in your To review. Only you can save Expenses in Splitbook.',
    );
    expect(shown).toContain(
      'https://chatgpt.com/oauth/client.json All current and future Groups · Ledger access · To review access, including permanent deletion',
    );
    expect(shown).toContain(
      'Synthetic Assistant All current and future Groups · Ledger access Disconnect',
    );
    expect(shown).toContain(
      'Disconnecting blocks further requests and keeps what’s in your To review. Previously shared information may remain in your assistant.',
    );
    expect(shown).not.toMatch(/\bDrafts?\b/);
  });
});
